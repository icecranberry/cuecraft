import { apiDelete, apiGet, apiPost, apiPut } from '@/apis/base'

const base = '/api/cue'

export const listCueAssets = (kind) => apiGet(`${base}/assets${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`)

export const uploadCueAsset = (payload) => {
  const form = new FormData()
  form.set('kind', payload.kind)
  form.set('name', payload.name)
  form.set('description', payload.description || '')
  form.set('tags', JSON.stringify(payload.tags || []))
  form.set('specification', JSON.stringify(payload.specification || {}))
  if (payload.image) form.set('image', payload.image)
  return apiPost(`${base}/assets`, form)
}

export const fetchCueAssetImage = async (id) => {
  const response = await apiGet(`${base}/assets/${encodeURIComponent(id)}/image`, {}, true, 'blob')
  return response.blob()
}

export const listCueDesigns = () => apiGet(`${base}/designs`)
export const listCueDesignShares = (id) => apiGet(`${base}/designs/${encodeURIComponent(id)}/shares`)
export const createCueDesignShare = (id) => apiPost(`${base}/designs/${encodeURIComponent(id)}/shares`, {})
export const revokeCueDesignShare = (id, shareId) => apiDelete(`${base}/designs/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}`)
export const getCuePublicShare = (token) => apiGet(`${base}/share/${encodeURIComponent(token)}`, {}, false)
export const fetchCuePublicShareAsset = async (token, id) => {
  const response = await apiGet(`${base}/share/${encodeURIComponent(token)}/assets/${encodeURIComponent(id)}/image`, {}, false, 'blob')
  return response.blob()
}
export const getCueWorkAssistant = (id) => apiGet(`${base}/designs/${encodeURIComponent(id)}/assistant`)
export const sendCueWorkAssistantMessage = (id, payload) => apiPost(`${base}/designs/${encodeURIComponent(id)}/assistant`, payload)
export const setCueWorkAssistantSkill = (id, skill_slug) => apiPut(`${base}/designs/${encodeURIComponent(id)}/assistant`, { skill_slug })
export const listCueAssistantSkills = () => apiGet(`${base}/ai/skills`)
export const importCuecraftBundle = (file) => {
  const form = new FormData()
  form.set('file', file)
  return apiPost(`${base}/legacy/import`, form)
}
export const getCueDesign = (id) => apiGet(`${base}/designs/${encodeURIComponent(id)}`)
export const createCueDesign = (payload) => apiPost(`${base}/designs`, payload)
export const updateCueDesign = (id, payload) => apiPut(`${base}/designs/${encodeURIComponent(id)}`, payload)
export const listCueDesignVersions = (id) => apiGet(`${base}/designs/${encodeURIComponent(id)}/versions`)

export const listCueSkus = (q = '') => apiGet(`${base}/skus?q=${encodeURIComponent(q)}`)
export const createCueSkuFromWork = (payload) => apiPost(`${base}/skus`, payload)
export const previewCueSkuImport = (file) => {
  const form = new FormData()
  form.set('file', file)
  return apiPost(`${base}/skus/import/preview`, form)
}
export const commitCueSkuImport = (rows) => apiPost(`${base}/skus/import`, { rows })

export const listCueAiModels = () => apiGet(`${base}/ai/models`)
export const chatCueAi = (payload) => apiPost(`${base}/ai/chat`, payload)
export const createCueAiJob = (payload) => apiPost(`${base}/ai/jobs`, payload)
export const getCueAiJob = (id) => apiGet(`${base}/ai/jobs/${encodeURIComponent(id)}`)
export const getCueProposal = (id, variant = 0) => apiGet(`${base}/ai/proposals/${encodeURIComponent(id)}?variant=${variant}`)
