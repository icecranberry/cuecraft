import { describe, expect, it, vi } from 'vitest';
import { prepareSceneStartup, SceneStartup } from '../three/startup';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('scene opening readiness', () => {
  it('keeps the mask up while resources are pending; cancelled effects settle only once', async () => {
    const startup = new SceneStartup();
    const done = startup.begin();
    const compile = vi.fn();
    expect(await prepareSceneStartup(startup, compile, async () => {}, () => {}, () => true)).toBe(false);
    expect(compile).not.toHaveBeenCalled();
    done();
    done();
    expect(startup.pending).toBe(0);
  });

  it('waits for shader compilation, full rendered frames and GPU completion before revealing', async () => {
    const startup = new SceneStartup();
    const shaders = deferred();
    const events: string[] = [];
    const run = prepareSceneStartup(startup, () => shaders.promise,
      async () => { events.push('frame'); }, () => { events.push('gpu'); }, () => true);
    await Promise.resolve();
    expect(events).toEqual([]);
    shaders.resolve();
    expect(await run).toBe(true);
    expect(events).toEqual(['frame', 'frame', 'frame', 'gpu', 'frame']);
  });

  it('does not reveal stale artwork when a new effect replaces it during prewarming', async () => {
    const startup = new SceneStartup();
    const shaders = deferred();
    const gpu = vi.fn();
    const run = prepareSceneStartup(startup, () => shaders.promise, async () => {}, gpu, () => true);
    const replacement = startup.begin();
    replacement();
    shaders.resolve();
    expect(await run).toBe(false);
    expect(gpu).not.toHaveBeenCalled();
    expect(await prepareSceneStartup(startup, async () => {}, async () => {}, gpu, () => true)).toBe(true);
  });

  it('cancels an unmounted canvas and never reopens loading for later edits', async () => {
    const startup = new SceneStartup();
    let alive = true;
    const gpu = vi.fn();
    expect(await prepareSceneStartup(startup, async () => {}, async () => { alive = false; }, gpu, () => alive)).toBe(false);
    expect(gpu).not.toHaveBeenCalled();
    startup.released = true;
    const done = startup.begin();
    done();
    expect(startup.pending).toBe(0);
    expect(startup.released).toBe(true);
  });
});
