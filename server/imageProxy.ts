import type { ProxyOptions } from 'vite';
import { IMAGE_PROVIDER_ROUTES } from '../src/ai/transport';

// 固定供应商域名，不能通过请求参数把本地转发器指向其他上游。
export function imageProviderProxy(): Record<string, ProxyOptions> {
  const routes: Record<string, ProxyOptions> = {};
  for (const provider of IMAGE_PROVIDER_ROUTES) {
    routes[`^${provider.proxyPath}(?:/|\\?|$)`] = {
      target: provider.origin,
      changeOrigin: true,
      secure: true,
      proxyTimeout: 300000,
      rewrite: (path) => path.slice(provider.proxyPath.length),
      configure: (proxy) => {
        proxy.on('proxyReq', (request) => {
          // 只使用本次请求的 Bearer 密钥，不向供应商传递本地网站的会话。
          request.removeHeader('cookie');
          request.removeHeader('origin');
          request.removeHeader('referer');
        });
        proxy.on('proxyRes', (response) => {
          delete response.headers['set-cookie'];
        });
      }
    };
  }
  return routes;
}
