import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => db.get(key)),
  set: vi.fn(async (key: string, value: unknown) => { db.set(key, value); }),
  del: vi.fn(async (key: string) => { db.delete(key); })
}));
vi.mock('../state/imageStore', () => ({
  getBlob: vi.fn(async (key: string) => db.get(key)),
  loadImage: vi.fn(async () => ({ naturalWidth: 64, naturalHeight: 256 })),
  putBlob: vi.fn(async (key: string, value: Blob) => { db.set(key, value); }),
  removeBlob: vi.fn(), canvasToBlob: vi.fn(async () => new Blob(['processed']))
}));

vi.mock('../editor/cutout', () => ({ autoRemoveWhiteBg: vi.fn() }));

import { startGeneration, cancelJob, DEFAULT_AI_SETTINGS, loadAiSettings, saveAiSettings, getApiKey, setApiKey } from '../ai/client';
import { autoRemoveWhiteBg } from '../editor/cutout';
import { letteringRequest } from '../ai/lettering';
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
  db.set('settings:ai', { editUrl: 'https://api.openai.com/custom/images/edits?route=reference' });
  useStore.setState({ jobs: [], assets: [], loaded: false });
  db.set('cue:ai:key', 'test-only-key');
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('服务设置保存', () => {
  it('忽略并在保存时移除旧版固定尺寸', async () => {
    db.set('settings:ai', { ...DEFAULT_AI_SETTINGS, size: '512x512' });
    const settings = await loadAiSettings();
    expect(settings).not.toHaveProperty('size');
    await saveAiSettings(settings);
    expect(db.get('settings:ai')).not.toHaveProperty('size');
  });
  it('密钥独立持久保存，清空后删除，不混入服务设置', async () => {
    await setApiKey(' persisted-test-key ');
    expect(await getApiKey()).toBe('persisted-test-key');
    expect(db.get('cue:ai:key')).toBe('persisted-test-key');
    expect(JSON.stringify(await loadAiSettings())).not.toContain('persisted-test-key');
    await setApiKey(' ');
    expect(db.has('cue:ai:key')).toBe(false);
    expect(await getApiKey()).toBe('');
  });
  it('完整接口 URL 的路径和查询参数按原值保存', async () => {
    const address = 'https://aikun.uk/v1/images/generations?route=fast';
    await saveAiSettings({ ...DEFAULT_AI_SETTINGS, baseUrl: address });
    expect((await loadAiSettings()).baseUrl).toBe(address);
  });

  it('Aikun 保存和加载地址都保留原路径，不补全 /v1', async () => {
    await saveAiSettings({ ...DEFAULT_AI_SETTINGS, baseUrl: ' https://aikun.uk/ ' });
    expect((await loadAiSettings()).baseUrl).toBe('https://aikun.uk/');
    expect(db.get('settings:ai')).toMatchObject({ baseUrl: 'https://aikun.uk/' });
    db.set('settings:ai', { baseUrl: 'https://aikun.uk' });
    expect((await loadAiSettings()).baseUrl).toBe('https://aikun.uk');
    await saveAiSettings({ ...DEFAULT_AI_SETTINGS, baseUrl: 'https://aikun.uk/v1' });
    expect((await loadAiSettings()).baseUrl).toBe('https://aikun.uk/v1');
  });

  it('保存后按原值加载配置，清理空白但不存入密钥', async () => {
    await saveAiSettings({ ...DEFAULT_AI_SETTINGS, baseUrl: ' https://tokenrhythm.studio/v1/ ', model: ' qwen-image-2.0 ', timeoutMs: 180000 });
    expect(await loadAiSettings()).toEqual({ ...DEFAULT_AI_SETTINGS, baseUrl: 'https://tokenrhythm.studio/v1/', model: 'qwen-image-2.0', timeoutMs: 180000 });
    expect(JSON.stringify(db.get('settings:ai'))).not.toContain('test-only-key');
  });
});

describe('联动生成请求链路', () => {
  it('纹字内容和风格传入母稿及各部位的实际图片请求', async () => {
    const fetchMock = vi.fn(async () => successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const request = { ...input('linked'), ...letteringRequest('  一杆入魂 ABC  ', '  行书，银白金属质感  ') };
    const result = await finished((await startGeneration(request, 'generate')).id);
    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      const prompt = init.body instanceof FormData ? String(init.body.get('prompt')) : JSON.parse(init.body as string).prompt;
      expect(prompt).toContain('文字内容："一杆入魂 ABC"');
      expect(prompt).toContain('风格：行书，银白金属质感');
      expect(prompt).toContain('不翻译、不增删');
      expect(prompt).not.toContain('青绿贝母');
      expect(prompt).not.toContain('经典插花');
    }
  });

  it('原生透明图保留白色主体，不再次执行去白底', async () => {
    const pixels = new Uint8ClampedArray(64 * 256 * 4);
    pixels.set([255, 255, 255, 255], (8 * 64 + 4) * 4);
    const ctx = { drawImage: vi.fn(), getImageData: () => ({ data: pixels }), putImageData: vi.fn() };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
    vi.stubGlobal('fetch', vi.fn(async () => successResponse()));
    const result = await finished((await startGeneration({ ...input('single'), removeWhite: true }, 'generate')).id);
    expect(result.status).toBe('success');
    expect(autoRemoveWhiteBg).not.toHaveBeenCalled();
    expect(useStore.getState().assets[0]).toMatchObject({ w: 1, h: 1 });
    expect(pixels[(8 * 64 + 4) * 4 + 3]).toBe(255);
  });

  it('联动整圈母稿与三部位分别传导尺寸，清理透明外围且不去白', async () => {
    const pixels = new Uint8ClampedArray(64 * 256 * 4);
    for (let y = 8; y < 248; y++) for (let x = 20; x < 44; x++) pixels[(y * 64 + x) * 4 + 3] = 255;
    const drawImage = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage, getImageData: () => ({ data: pixels }) }) }) });
    const fetchMock = vi.fn(async () => successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const request = input('linked');
    request.scope = createArtworkScope(resolveTemplate('nineball'), useStore.getState().design, 'linked', ['butt-forearm', 'grip', 'butt-cap'], 'wrap');
    request.removeWhite = true;
    const result = await finished((await startGeneration(request, 'generate')).id);
    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const master = JSON.parse(calls[0][1].body as string);
    expect(master.background).toBe('opaque');
    expect(master.prompt).toContain('画幅 1:1');
    expect(master.prompt).not.toContain('目标图案尺寸');
    for (let i = 1; i < calls.length; i++) {
      const body = calls[i][1].body as FormData;
      const prompt = String(body.get('prompt'));
      const part = request.scope.parts[i - 1];
      expect(body.has('size')).toBe(false);
      expect(body.get('background')).toBe('opaque');
      expect(prompt).toContain(`目标图案尺寸 ${part.wMm.toFixed(1)} mm × ${part.hMm.toFixed(1)} mm`);
      expect(prompt).toContain('不继承其画幅');
      expect(prompt).not.toContain('必须返回带真实 alpha');
      const asset = useStore.getState().assets.find((a) => a.aiPartId === part.id)!;
      expect(asset.originalBlobKey).toBeTruthy();
      expect(asset.w / asset.h).toBeCloseTo(part.wMm / part.hMm, 2);
    }
    expect(autoRemoveWhiteBg).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 20, 8, 24, 240, 0, 0, expect.any(Number), expect.any(Number));
  });
  it('聊天 URL 保持原路径与查询参数，并发送 messages，解析聊天图片', async () => {
    const url = 'https://aikun.uk/v1/chat/completions?channel=image';
    db.set('settings:ai', { ...DEFAULT_AI_SETTINGS, baseUrl: url, model: 'gpt-image-2' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: {
      content: '', images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }]
    } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await finished((await startGeneration({ ...input('single'), scope: undefined }, 'generate')).id);
    expect(result.status).toBe('success');
    expect(result.resultAssetIds).toHaveLength(1);
    const [address, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(address).toBe('/api/image-provider/aikun/v1/chat/completions?channel=image');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ model: 'gpt-image-2', messages: [{ role: 'user', content: result.prompt }], temperature: 0.7 });
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-only-key' });
  });

  it('聊天接口只返回文字时不能误报生图成功', async () => {
    db.set('settings:ai', { ...DEFAULT_AI_SETTINGS, baseUrl: 'https://aikun.uk/v1/chat/completions' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Here is a description of a blue circle.' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await finished((await startGeneration(input('single'), 'generate')).id);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('没有图片');
    expect(result.resultAssetIds).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('单张试生成使用当前输入的 URL、模型和密钥，不用已保存的旧配置', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await finished((await startGeneration(input('single'), 'generate', {
      settings: { ...DEFAULT_AI_SETTINGS, baseUrl: 'https://aikun.uk/v1/images/generations', model: 'gpt-image-2' }, apiKey: 'current-input-key'
    })).id);
    expect(result.status).toBe('success');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/image-provider/aikun/v1/images/generations');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer current-input-key' });
    expect(JSON.parse(init.body as string).model).toBe('gpt-image-2');
    expect(JSON.stringify(db.get('settings:ai'))).not.toContain('current-input-key');
  });

  it('使用用户完整 URL，POST、鉴权和 JSON 参数与服务商示例一致', async () => {
    db.set('settings:ai', { ...DEFAULT_AI_SETTINGS, baseUrl: 'https://aikun.uk/v1/images/generations', model: 'gpt-image-2' });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await finished((await startGeneration(input('single'), 'generate')).id);
    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/image-provider/aikun/v1/images/generations');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer test-only-key', 'Content-Type': 'application/json' } });
    const payload = JSON.parse(init.body as string);
    expect(Object.keys(payload).sort()).toEqual(['background', 'model', 'n', 'output_format', 'prompt']);
    expect(payload).toMatchObject({ model: 'gpt-image-2', n: 1 });
    expect(payload.prompt).toContain('目标图案尺寸');
    expect(payload.prompt).toContain('30%');
    expect(payload.prompt).toBeTruthy();
  });

  it('自定义生图地址无法识别编辑路径时在第一张生图前停止', async () => {
    db.set('settings:ai', { ...DEFAULT_AI_SETTINGS, baseUrl: 'https://aikun.uk/custom-render' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await finished((await startGeneration(input('linked'), 'generate')).id);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('图片编辑 URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['single', 'linked'] as const)('标准接口自动识别编辑地址并发送 %s 参考图', async (mode) => {
    db.set('settings:ai', { ...DEFAULT_AI_SETTINGS, baseUrl: 'https://aikun.uk/v1/images/generations?route=image' });
    db.set('custom:reference', new Blob(['jpeg-reference'], { type: 'image/jpeg' }));
    useStore.setState({ assets: [{ id: 'ref', blobKey: 'custom:reference', name: 'reference', source: 'upload', tags: [], w: 20, h: 20, createdAt: 1 }] });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await finished((await startGeneration({ ...input(mode), refAssetIds: ['ref'] }, 'edit')).id);
    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(mode === 'single' ? 1 : 3);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe('/api/image-provider/aikun/v1/images/edits?route=image');
      const body = init.body as FormData;
      expect(body.has('size')).toBe(false);
      expect(body.get('background')).toBe('transparent');
      expect(body.get('output_format')).toBe('png');
      expect(body.get('prompt')).toContain('真实 alpha');
    }
    const reference = (fetchMock.mock.calls[0][1].body as FormData).get('image') as File;
    expect(reference.type).toBe('image/jpeg');
    expect(reference.name).toBe('ref.jpg');
    expect(await reference.text()).toBe('jpeg-reference');
    if (mode === 'linked') expect((fetchMock.mock.calls[1][1].body as FormData).getAll('image[]')).toHaveLength(2);
  });

  it.each(['single', 'linked'] as const)('聊天生图接口携带 %s 的参考图与母稿，不需要编辑 URL', async (mode) => {
    db.set('settings:ai', { ...DEFAULT_AI_SETTINGS, baseUrl: 'https://aikun.uk/v1/chat/completions?channel=image' });
    db.set('blob:ref', new Blob(['reference'], { type: 'image/png' }));
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await finished((await startGeneration({ ...input(mode), refAssetIds: ['ref'] }, 'edit')).id);
    expect(result.status).toBe('success');
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe('/api/image-provider/aikun/v1/chat/completions?channel=image');
      const content = JSON.parse(init.body as string).messages[0].content;
      expect(content[0].text).toContain('真实 alpha');
      expect(content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    }
    if (mode === 'linked') expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).messages[0].content).toHaveLength(3);
  });

  it('不带参考图的联动从文生图开始，再将母稿传给自动识别的编辑接口', async () => {
    db.set('settings:ai', DEFAULT_AI_SETTINGS);
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await finished((await startGeneration(input('linked'), 'generate')).id);
    expect(result.status).toBe('success');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.openai.com/v1/images/generations', 'https://api.openai.com/v1/images/edits', 'https://api.openai.com/v1/images/edits'
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ background: 'transparent', output_format: 'png' });
  });

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
      expect(call[0]).toBe('https://api.openai.com/custom/images/edits?route=reference');
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
    db.set('settings:ai', { timeoutMs: 15, editUrl: 'https://api.openai.com/custom/images/edits?route=reference' });
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await finished((await startGeneration(input('linked'), 'generate')).id);
    expect(result.status).toBe('needs-review');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
