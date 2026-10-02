import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => db.get(key)),
  set: vi.fn(async (key: string, value: unknown) => { db.set(key, value); }),
  del: vi.fn(async (key: string) => { db.delete(key); })
}));
vi.mock('../state/imageStore', () => ({
  loadImage: vi.fn(async () => ({ naturalWidth: 64, naturalHeight: 256 })),
  putBlob: vi.fn(async (key: string, value: Blob) => { db.set(key, value); }),
  removeBlob: vi.fn(), canvasToBlob: vi.fn()
}));

import { startGeneration, cancelJob } from '../ai/client';
import { useStore } from '../state/store';
import { createArtworkScope } from '../cue/artwork';
import { resolveTemplate } from '../cue/templates';
import type { GenerationJob } from '../core/types';

const input = (mode: 'linked' | 'single', n = 1): GenerationJob['input'] => ({
  subject: '青绿贝母', style: '经典插花', palette: '青绿银白', keep: '', avoid: '品牌文字', n,
  refAssetIds: [], removeWhite: false,
  scope: createArtworkScope(resolveTemplate('nineball'), useStore.getState().design, mode, mode === 'linked' ? ['butt-forearm', 'butt-cap'] : ['butt-cap'])
});
const successResponse = () => new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), { status: 200 });
const finished = async (id: string) => {
  await vi.waitFor(() => expect(useStore.getState().jobs.find((j) => j.id === id)?.status).not.toMatch(/queued|running/), { interval: 10 });
  return useStore.getState().jobs.find((j) => j.id === id)!;
};

beforeEach(() => {
  db.clear();
  useStore.setState({ jobs: [], assets: [], loaded: false });
  vi.stubGlobal('sessionStorage', { getItem: () => 'test-only-key' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('联动生成请求链路', () => {
  it('母稿生成后通过 edits 发给每个部位，解析标准 b64_json 并保存完整候选', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const job = await startGeneration(input('linked'), 'generate');
    const result = await finished(job.id);
    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain('/images/generations');
    const generationBody = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(generationBody.prompt).toContain('风格母稿');
    for (const call of fetchMock.mock.calls.slice(1) as unknown as [string, RequestInit][]) {
      expect(call[0]).toContain('/images/edits');
      const body = call[1].body as FormData;
      expect(await (body.get('image') as Blob).text()).toBe('image');
      expect(body.get('prompt')).toContain('使用参考母稿');
    }
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates![0].partAssets.map((p) => p.partId)).toEqual(['butt-forearm', 'butt-cap']);
    expect(result.progress).toMatchObject({ done: 3, total: 3 });
    expect(useStore.getState().assets).toHaveLength(3);
  });

  it('单部位只发一次请求，不产生风格母稿', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await finished((await startGeneration(input('single'), 'generate')).id);
    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.candidates![0].masterAssetId).toBeUndefined();
    expect(result.candidates![0].partAssets).toHaveLength(1);
    expect(useStore.getState().assets[0].aiPartId).toBe('butt-cap');
  });

  it('后一套失败时保留已完成的前一套候选', async () => {
    let request = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ++request <= 3 ? successResponse() : new Response('service unavailable', { status: 503 })));
    const result = await finished((await startGeneration(input('linked', 2), 'generate')).id);
    expect(result.status).toBe('failed');
    expect(result.candidates).toHaveLength(1);
    expect(result.resultAssetIds).toHaveLength(3);
    expect(result.error).toContain('503');
  });

  it('取消任务停止后续部位请求，状态不被超时覆盖', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const job = await startGeneration(input('linked'), 'generate');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    cancelJob(job.id);
    await vi.waitFor(() => expect(useStore.getState().jobs[0].status).toBe('cancelled'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('单张请求超时后进入待核对，不自动重试', async () => {
    db.set('settings:ai', { timeoutMs: 15 });
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await finished((await startGeneration(input('linked'), 'generate')).id);
    expect(result.status).toBe('needs-review');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
