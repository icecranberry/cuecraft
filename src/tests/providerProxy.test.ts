/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import { imageProviderProxy } from '../../server/imageProxy';

let upstream: Server;
let local: ViteDevServer;
let localUrl: string;
const requests: { url: string; method: string; authorization?: string; cookie?: string; origin?: string; referer?: string; contentType?: string; body: Buffer }[] = [];
const lastRequest = () => requests[requests.length - 1];

beforeAll(async () => {
  upstream = createHttpServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ url: req.url!, method: req.method!, authorization: req.headers.authorization,
      cookie: req.headers.cookie, origin: req.headers.origin, referer: req.headers.referer,
      contentType: req.headers['content-type'], body: Buffer.concat(chunks) });
    res.writeHead(req.headers.authorization ? 200 : 401, { 'Content-Type': 'application/json', 'Set-Cookie': 'upstream-session=discard' });
    res.end(JSON.stringify(req.headers.authorization ? { data: [{ id: 'test-image-model' }] } : { message: 'missing key' }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const proxy = imageProviderProxy();
  for (const route of Object.values(proxy)) {
    const path = new URL(route.target as string).pathname.replace(/\/$/, '');
    route.target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}${path}`;
  }
  local = await createServer({ configFile: false, logLevel: 'silent', appType: 'custom',
    server: { host: '127.0.0.1', port: 0, proxy }, optimizeDeps: { noDiscovery: true, include: [] } });
  // Vite 5 treats port: 0 as its default port. Bind the underlying HTTP server
  // directly so concurrent dev servers and Windows reserved ports cannot collide.
  await new Promise<void>((resolve, reject) => {
    local.httpServer!.once('error', reject);
    local.httpServer!.listen(0, '127.0.0.1', resolve);
  });
  localUrl = `http://127.0.0.1:${(local.httpServer!.address() as AddressInfo).port}/api/image-provider`;
});
afterAll(async () => {
  await local?.close();
  await new Promise<void>((resolve, reject) => upstream?.close((error) => error ? reject(error) : resolve()));
});

describe.each([
  { provider: 'tokenrhythm', prefix: '/v1' },
  { provider: 'aikun', prefix: '/v1' },
])('图片服务本地转发：$provider', ({ provider, prefix }) => {
  const providerUrl = () => `${localUrl}/${provider}`;
  it('保留鉴权并返回真实响应，隔离本地与上游的 cookies', async () => {
    const response = await fetch(`${providerUrl()}${prefix}/models`, { headers: {
      Authorization: 'Bearer test-only-key', Cookie: 'local-session=private',
      Origin: 'http://127.0.0.1:3311', Referer: 'http://127.0.0.1:3311/'
    } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ id: 'test-image-model' }] });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(lastRequest()).toMatchObject({ url: `${prefix}/models`, authorization: 'Bearer test-only-key', cookie: undefined, origin: undefined, referer: undefined });
  });

  it('没有密钥时保留供应商 401，不能误报成功', async () => {
    const response = await fetch(`${providerUrl()}${prefix}/models`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'missing key' });
  });

  it('图片生成的 JSON 参数完整转发', async () => {
    const payload = { model: 'test-image-model', prompt: 'test only', n: 1, size: '1024x1024' };
    const response = await fetch(`${providerUrl()}${prefix}/images/generations`, { method: 'POST', headers: {
      Authorization: 'Bearer test-only-key', 'Content-Type': 'application/json'
    }, body: JSON.stringify(payload) });
    expect(response.status).toBe(200);
    expect(lastRequest()).toMatchObject({ url: `${prefix}/images/generations`, method: 'POST' });
    expect(JSON.parse(lastRequest().body.toString())).toEqual(payload);
  });

  it('图片编辑的 multipart 图片和边界完整转发', async () => {
    const body = new FormData();
    body.append('model', 'test-image-model');
    body.append('image', new Blob(['test-image-bytes'], { type: 'image/png' }), 'reference.png');
    const response = await fetch(`${providerUrl()}${prefix}/images/edits`, { method: 'POST', headers: { Authorization: 'Bearer test-only-key' }, body });
    expect(response.status).toBe(200);
    const request = lastRequest();
    expect(request.url).toBe(`${prefix}/images/edits`);
    expect(request.contentType).toContain('multipart/form-data; boundary=');
    expect(request.body.toString()).toContain('test-image-bytes');
    expect(request.body.toString()).toContain('filename="reference.png"');
  });

  it('自定义路径、尾斜杠和查询参数原样传到固定上游，不能通过参数换目标', async () => {
    await fetch(`${providerUrl()}/custom/generate/?target=http://localhost&route=fast`, { headers: { Authorization: 'Bearer test-only-key' } });
    expect(lastRequest().url).toBe('/custom/generate/?target=http://localhost&route=fast');
    const count = requests.length;
    expect((await fetch(`${localUrl}/${provider}-unknown/models`)).status).toBe(404);
    expect(requests).toHaveLength(count);
  });
});
