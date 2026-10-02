import { afterEach, describe, expect, it, vi } from 'vitest';
import { transitionUI } from '../ui/motion';

function environment({ reduced = false, native = true } = {}) {
  const names = new Map<string, string>();
  const element = {
    getClientRects: () => [{}],
    style: { getPropertyValue: (key: string) => names.get(key) ?? '', setProperty: (key: string, value: string) => names.set(key, value), removeProperty: (key: string) => names.delete(key) },
    animate: vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() }))
  };
  const callbacks: (() => void)[] = [];
  const transitions: { skipTransition: ReturnType<typeof vi.fn>; complete: () => void }[] = [];
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal('document', {
    documentElement: { style: { setProperty: vi.fn() } },
    ...(native ? { startViewTransition: (callback: () => void) => {
      callbacks.push(callback);
      let complete!: () => void;
      const finished = new Promise<void>((resolve) => { complete = resolve; });
      const transition = { skipTransition: vi.fn(), complete };
      transitions.push(transition);
      return { ...transition, finished, ready: Promise.resolve() };
    } } : {})
  });
  return { element, names, callbacks, transitions, targets: () => [element as unknown as HTMLElement] };
}

afterEach(() => {
  // Settle any in-flight transition before removing the browser stubs.
  transitionUI(() => [], 0, () => {});
  vi.unstubAllGlobals();
});

describe('interruptible UI transitions', () => {
  it('rapid navigation commits the latest choice and never replays stale browser callbacks', () => {
    const env = environment();
    const states: number[] = [];
    transitionUI(env.targets, 1, () => states.push(1));
    transitionUI(env.targets, -1, () => states.push(0));
    env.callbacks[1]();
    env.callbacks[0]();
    expect(states).toEqual([1, 0]);
    expect(env.transitions[0].skipTransition).toHaveBeenCalledOnce();
  });

  it('finishing an older transition cannot clear the new transition names', async () => {
    const env = environment();
    transitionUI(env.targets, 1, () => {});
    transitionUI(env.targets, -1, () => {});
    env.transitions[0].complete();
    await Promise.resolve(); await Promise.resolve();
    expect(env.names.get('view-transition-name')).toBe('ui-content-0');
    env.callbacks[1](); env.transitions[1].complete();
    await Promise.resolve(); await Promise.resolve();
    expect(env.names.has('view-transition-name')).toBe(false);
  });

  it('reduced motion updates and restores focus immediately without starting animations', () => {
    const env = environment({ reduced: true });
    const order: string[] = [];
    transitionUI(env.targets, 1, () => order.push('render'), () => order.push('focus'));
    expect(order).toEqual(['render', 'focus']);
    expect(env.callbacks).toHaveLength(0);
    expect(env.element.animate).not.toHaveBeenCalled();
  });

  it('unsupported browsers update immediately and cancel the previous fallback on interruption', () => {
    const env = environment({ native: false });
    const update = vi.fn();
    transitionUI(env.targets, 1, update);
    const first = env.element.animate.mock.results[0].value;
    transitionUI(env.targets, -1, update);
    expect(update).toHaveBeenCalledTimes(2);
    expect(first.cancel).toHaveBeenCalledOnce();
  });

  it('snapshot failures still commit the requested state exactly once', () => {
    const env = environment();
    Object.assign(document, { startViewTransition: (commit: () => void) => { commit(); throw new Error('snapshot unavailable'); } });
    const update = vi.fn();
    transitionUI(env.targets, 1, update);
    expect(update).toHaveBeenCalledOnce();
    expect(env.names.has('view-transition-name')).toBe(false);
  });
});
