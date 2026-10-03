// 本地转发只改变传输方式，上游收到的路径和查询参数与用户填写的完整 URL 一致。
export const IMAGE_PROVIDER_ROUTES = [
  { origin: 'https://tokenrhythm.studio', proxyPath: '/api/image-provider/tokenrhythm' },
  { origin: 'https://aikun.uk', proxyPath: '/api/image-provider/aikun' }
] as const;

export function normalizeProviderUrl(address: string): string {
  return address.trim();
}

export function isChatEndpoint(address: string): boolean {
  return /\/chat\/completions\/?$/.test(new URL(address.trim()).pathname);
}

/** Derive only the standard sibling endpoint; explicit custom URLs take priority. */
export function imageEditUrl(baseUrl: string, explicit?: string): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  const url = new URL(baseUrl.trim());
  if (!/\/images\/generations\/?$/.test(url.pathname)) return undefined;
  url.pathname = url.pathname.replace(/\/generations\/?$/, '/edits');
  return url.toString();
}

export function providerUrlError(address: string): string | null {
  try {
    const url = new URL(normalizeProviderUrl(address));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
  } catch {
    return '服务地址无效，请填写完整的 http:// 或 https:// 请求 URL，不要包含账号密码或页面锚点。';
  }
  return null;
}

export function providerRequestUrl(address: string): string {
  const exactUrl = normalizeProviderUrl(address);
  const url = new URL(exactUrl);
  const provider = IMAGE_PROVIDER_ROUTES.find((entry) => url.origin === entry.origin);
  if (provider) return `${provider.proxyPath}${url.pathname}${url.search}`;
  return exactUrl;
}
