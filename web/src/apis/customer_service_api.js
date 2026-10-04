import { apiGet, apiPost, apiPut } from '@/apis/base'

const base = '/api/customer-service'
const publicUrl = (path) => `${window.location.origin}${path}`

export const listCustomerServiceAgents = () => apiGet(`${base}/agents`)
export const listCustomerServiceDeployments = () => apiGet(`${base}/deployments`)
export const createCustomerServiceDeployment = (payload) => apiPost(`${base}/deployments`, payload)
export const updateCustomerServiceDeployment = (id, payload) => apiPut(`${base}/deployments/${encodeURIComponent(id)}`, payload)
export const publishCustomerServiceDeployment = (id) => apiPost(`${base}/deployments/${encodeURIComponent(id)}/publish`, {})
export const rotateCustomerServiceToken = (id) => apiPost(`${base}/deployments/${encodeURIComponent(id)}/rotate-token`, {})
export const revokeCustomerServiceDeployment = (id) => apiPost(`${base}/deployments/${encodeURIComponent(id)}/revoke`, {})
export const sendCustomerServiceTestMessage = (payload) => apiPost(`${base}/test/messages`, payload)

export const getCustomerServiceEmbedUrl = (token) => publicUrl(`${base}/embed/${encodeURIComponent(token)}`)
export const getCustomerServiceWebhookUrl = () => publicUrl(`${base}/webhook`)
export const getCustomerServiceMcpUrl = () => publicUrl(`${base}/mcp`)

export const getPublicCustomerService = (token, mode = 'share') =>
  apiGet(`${base}/public/${encodeURIComponent(token)}?mode=${encodeURIComponent(mode)}`, {}, false)

export const sendPublicCustomerServiceMessage = (token, payload) =>
  apiPost(`${base}/public/${encodeURIComponent(token)}/messages`, payload, {}, false)
