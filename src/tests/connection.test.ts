import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_SETTINGS, testConnection } from '../ai/client';
import { providerRequestUrl } from '../ai/transport';

vi.mock('idb-keyval', () => ({ get: vi.fn(async () => 'saved-test-key'), set: vi.fn(), del: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

describe('完整 URL 连接检测', () => {
  it('向用户填写的完整 URL 发 HEAD，不追加 /models、不发出生图 POST', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await testConnection({ ...DEFAULT_AI_SETTINGS, baseUrl: 'https://aikun.uk/v1/images/generations?route=fast' });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('不能确认密钥');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/image-provider/aikun/v1/images/generations?route=fast', expect.objectContaining({ method: 'HEAD' }));
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('不追加版本或接口，也不删除尾斜杠', () => {
    expect(providerRequestUrl('https://aikun.uk')).toBe('/api/image-provider/aikun/');
    expect(providerRequestUrl('https://aikun.uk/v1/')).toBe('/api/image-provider/aikun/v1/');
    expect(providerRequestUrl('https://tokenrhythm.studio/custom/generate')).toBe('/api/image-provider/tokenrhythm/custom/generate');
    expect(providerRequestUrl(' https://other-provider.example/submit/?route=1 ')).toBe('https://other-provider.example/submit/?route=1');
  });

  it('单独填写模型查询 URL 时对该地址发 GET，使用当前输入的密钥', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }] })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await testConnection({ ...DEFAULT_AI_SETTINGS, model: 'gpt-image-2', modelsUrl: 'https://aikun.uk/v1/models?group=image' }, ' current-input-key ');
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['gpt-image-2']);
    expect(fetchMock).toHaveBeenCalledWith('/api/image-provider/aikun/v1/models?group=image', expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer current-input-key' } }));
  });

  it('HEAD 不被支持时说明可达，但不声称密钥或模型已验证', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 405 })));
    const result = await testConnection(DEFAULT_AI_SETTINGS);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('尚未验证密钥和图片模型');
    expect(result.warning).toBe(true);
  });

  it('缺少密钥、错误密钥格式、空模型或无效地址时不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await testConnection(DEFAULT_AI_SETTINGS, ' ')).message).toContain('未填写服务密钥');
    expect((await testConnection(DEFAULT_AI_SETTINGS, 'Bearer test-only-key')).message).toContain('不要包含 Bearer');
    expect((await testConnection({ ...DEFAULT_AI_SETTINGS, model: ' ' })).message).toContain('图片模型名称');
    expect((await testConnection({ ...DEFAULT_AI_SETTINGS, baseUrl: 'aikun.uk' })).message).toContain('服务地址无效');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('鉴权错误保留实际原因，隐藏回显的密钥', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid key current-input-key' } }), { status: 401 })));
    const result = await testConnection(DEFAULT_AI_SETTINGS, 'current-input-key');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('401');
    expect(result.message).toContain('密钥未通过验证');
    expect(result.message).not.toContain('current-input-key');
  });

  it('HEAD 返回 404 时不误判为 POST 地址错误，模型查询 GET 的 404 仍报告失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const reachable = await testConnection(DEFAULT_AI_SETTINGS);
    expect(reachable.warning).toBe(true);
    expect(reachable.message).toContain('不能据此判定 URL 错误');
    const result = await testConnection({ ...DEFAULT_AI_SETTINGS, modelsUrl: 'https://aikun.uk/v1/models' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('完整请求 URL 不存在');
  });

  it('返回网页不能误报为图片接口可用', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { headers: { 'Content-Type': 'text/html' } })));
    expect((await testConnection(DEFAULT_AI_SETTINGS)).ok).toBe(false);
  });

  it('模型列表没有所选模型时提示确认服务商权限', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'text-model' }] }))));
    const result = await testConnection({ ...DEFAULT_AI_SETTINGS, modelsUrl: 'https://aikun.uk/v1/models' });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('未找到所选模型');
  });

  it('分别报告网络失败与超时', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect((await testConnection(DEFAULT_AI_SETTINGS)).message).toContain('跨域');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); }));
    expect((await testConnection(DEFAULT_AI_SETTINGS)).message).toContain('15 秒');
  });
});
