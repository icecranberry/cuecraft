import type { ArtworkCandidate, ArtworkPart, Asset, GenerationJob, JobStatus } from '../core/types';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { useStore } from '../state/store';
import { loadImage, canvasToBlob, putBlob } from '../state/imageStore';
import { buildArtworkPrompt } from '../cue/artwork';
import { autoRemoveWhiteBg } from '../editor/cutout';
import { normalizeProviderUrl, providerUrlError, providerRequestUrl } from './transport';

// GPTImage 服务适配层（plan.md §6.1/§10）：
// 兼容 OpenAI Image API 的生成与编辑；模型 ID 可配置；
// 密钥仅保存在会话存储（非持久），不进入项目数据或导出文件（plan §10.1）。

export interface AiSettings {
  baseUrl: string;
  editUrl?: string;
  modelsUrl?: string;
  model: string;
  size: string;
  quality: string;
  n: number;
  timeoutMs: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: 'https://api.openai.com/v1/images/generations',
  editUrl: '',
  modelsUrl: '',
  model: 'gpt-image-1',
  size: '1024x1024',
  quality: 'auto',
  n: 2,
  timeoutMs: 120000
};

export async function loadAiSettings(): Promise<AiSettings> {
  const s = await idbGet<AiSettings>('settings:ai');
  const settings = { ...DEFAULT_AI_SETTINGS, ...(s ?? {}) };
  return { ...settings, baseUrl: normalizeProviderUrl(settings.baseUrl) };
}

export async function saveAiSettings(s: AiSettings) {
  const addressError = providerUrlError(s.baseUrl);
  if (addressError) throw new Error(addressError);
  for (const [name, address] of [['图片编辑', s.editUrl], ['模型查询', s.modelsUrl]]) {
    if (address?.trim()) {
      const error = providerUrlError(address);
      if (error) throw new Error(`${name}地址：${error}`);
    }
  }
  await idbSet('settings:ai', { ...s, baseUrl: normalizeProviderUrl(s.baseUrl),
    editUrl: s.editUrl?.trim() ?? '', modelsUrl: s.modelsUrl?.trim() ?? '', model: s.model.trim() });
}

export function getApiKey(): string {
  return sessionStorage.getItem('cue:ai:key') ?? '';
}

export function setApiKey(key: string) {
  if (key) sessionStorage.setItem('cue:ai:key', key);
  else sessionStorage.removeItem('cue:ai:key');
}

function safeServiceMessage(message: string, key: string): string {
  return (key ? message.split(key).join('[密钥已隐藏]') : message).replace(/sk-[A-Za-z0-9_-]+/g, '[密钥已隐藏]').slice(0, 300);
}

/** 连接检测（与实际试生成分开，plan §10.1） */
export async function testConnection(settings: AiSettings, apiKey = getApiKey()): Promise<{ ok: boolean; message: string; models?: string[]; warning?: boolean }> {
  const key = apiKey.trim();
  if (!key) return { ok: false, message: '未填写服务密钥。密钥仅保存在当前标签页，关闭标签页后需重新填写。' };
  if (/^Bearer\s/i.test(key)) return { ok: false, message: '服务密钥只填写 API Key 本身，不要包含 Bearer 前缀。' };
  if (!settings.model.trim()) return { ok: false, message: '请填写图片模型名称，例如服务商示例中的 gpt-image-2。' };
  const modelsUrl = settings.modelsUrl?.trim();
  const address = modelsUrl || settings.baseUrl.trim();
  const addressError = providerUrlError(address);
  if (addressError) return { ok: false, message: addressError };
  try {
    // 未配置查询接口时，只向原 URL 发 HEAD，不生成图片，不猜测或拼接 /models。
    const resp = await fetch(providerRequestUrl(address), {
      method: modelsUrl ? 'GET' : 'HEAD',
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!modelsUrl && [404, 405].includes(resp.status)) return { ok: true, warning: true, message: `服务已响应（HEAD 返回 HTTP ${resp.status}）。图片接口可能只支持 POST，不能据此判定 URL 错误。尚未验证密钥和图片模型，需实际生成或填写完整的模型查询地址后检测。` };
    const body = await resp.text();
    let json: { data?: unknown; error?: { message?: unknown }; message?: unknown } | undefined;
    try { json = JSON.parse(body); } catch { /* 非 JSON 响应交由下方诊断 */ }
    if (!resp.ok) {
      const reasons: Record<number, string> = {
        401: '密钥未通过验证，请检查是否过期、复制完整，以及是否属于此服务商',
        403: '服务拒绝访问，请检查密钥权限或服务商的访问限制',
        404: '填写的完整请求 URL 不存在，请与服务商示例核对；程序没有追加或改写接口路径',
        405: '填写的模型查询接口不支持 GET，请核对该完整地址',
        429: '服务限制了请求，请检查额度或稍后再试'
      };
      const detail = json?.error?.message ?? json?.message;
      return { ok: false, message: `HTTP ${resp.status}：${reasons[resp.status] ?? '服务返回错误，请检查服务商状态'}${typeof detail === 'string' ? `。服务提示：${safeServiceMessage(detail, key)}` : ''}` };
    }
    if (!modelsUrl) {
      if (resp.headers.get('content-type')?.includes('text/html')) return { ok: false, message: '此地址返回网页内容，请确认填写的是服务商提供的完整图片请求 URL。' };
      return { ok: true, warning: true, message: '服务已响应，完整 URL 的网络检测通过。HEAD 检测不会生成图片，也不能确认密钥、模型和生图参数是否可用。' };
    }
    if (!Array.isArray(json?.data)) return { ok: false, message: '模型查询地址已响应，但未返回兼容的模型列表，请核对完整的模型查询 URL。' };
    const models = json.data.flatMap((m: unknown) => {
      if (m && typeof m === 'object' && 'id' in m && typeof m.id === 'string') return [m.id];
      return [];
    });
    const model = settings.model.trim();
    const modelHint = model && !models.includes(model) ? `；列表中未找到所选模型「${model}」，请向服务商确认模型名称和图片接口权限` : '';
    return { ok: true, message: `连接成功，服务返回 ${models.length} 个模型${modelHint}。图片生成能力仍需实际生成验证。`, models: models.slice(0, 50) };
  } catch (e) {
    const error = e as Error;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return { ok: false, message: '连接检测超时（15 秒），请检查网络、代理或服务商状态。' };
    if (error instanceof TypeError) return { ok: false, message: '浏览器未能取得服务响应。可能是网络、代理、证书或服务未允许浏览器跨域访问；请查看浏览器控制台的具体错误。' };
    return { ok: false, message: `连接失败：${safeServiceMessage(error.message, key)}` };
  }
}

export function buildPrompt(input: GenerationJob['input'], part?: ArtworkPart): string {
  const parts: string[] = [];
  if (input.subject) parts.push(`主题：${input.subject}`);
  if (input.style) parts.push(`风格：${input.style}`);
  if (input.palette) parts.push(`配色：${input.palette}`);
  if (input.keep) parts.push(`需要保留：${input.keep}`);
  if (input.avoid) parts.push(`避免出现：${input.avoid}`);
  if (input.scope) parts.push(buildArtworkPrompt(input.scope, part ?? (input.scope.mode === 'single' ? input.scope.parts[0] : undefined)));
  // 白底生图固定要求（plan §6.2）
  if (input.scope?.textureMode !== 'wrap' || (part ?? input.scope.parts[0])?.kind === 'face') parts.push('纯白背景，主体完整居中，四周留白，无地面阴影，无产品展示背景，无文字水印。');
  return parts.join('；');
}

function inputHash(j: GenerationJob): string {
  return JSON.stringify([j.input, j.model, j.size]);
}

const activeControllers = new Map<string, AbortController>();

export function cancelJob(id: string) {
  const st = useStore.getState();
  const job = st.jobs.find((j) => j.id === id);
  if (!job) return;
  if (job.status === 'queued') {
    st.updateJob(id, { status: 'cancelled', error: '排队中取消' });
    return;
  }
  if (job.status === 'running') {
    const c = activeControllers.get(id);
    if (c) {
      c.abort();
      st.updateJob(id, { status: 'cancelled', error: '已请求取消（供应商侧结果未知时不自动重试）' });
    } else {
      st.updateJob(id, { status: 'needs-review', error: '无法取消已发出的请求，请核对结果' });
    }
  }
}

/** 创建生图任务（用户明确点击生成才调用，plan §10.3） */
export async function startGeneration(input: GenerationJob['input'], mode: 'generate' | 'edit', connection?: { settings: AiSettings; apiKey: string }): Promise<GenerationJob> {
  const settings = connection ? { ...connection.settings } : await loadAiSettings();
  const job: GenerationJob = {
    id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'queued',
    mode,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    model: settings.model,
    size: settings.size,
    input: JSON.parse(JSON.stringify(input)),
    prompt: buildPrompt(input),
    resultAssetIds: []
  };
  // 请求去重：同一输入且仍在执行的任务不重复提交
  const st = useStore.getState();
  const dup = st.jobs.find(
    (j) => (j.status === 'queued' || j.status === 'running') && inputHash(j) === inputHash(job)
  );
  if (dup) {
    st.showToast('相同请求正在执行中，已复用该任务');
    return dup;
  }
  st.addJob(job);
  void executeJob(job, settings, connection?.apiKey);
  return job;
}

async function executeJob(job: GenerationJob, settings: AiSettings, apiKey = getApiKey()) {
  const st = useStore.getState();
  const addressError = providerUrlError(settings.baseUrl);
  if (addressError) {
    st.updateJob(job.id, { status: 'failed', error: addressError });
    return;
  }
  const key = apiKey.trim();
  if (!key) {
    st.updateJob(job.id, { status: 'failed', error: '未配置 API Key，请到「设置」填写' });
    return;
  }
  if (/^Bearer\s/i.test(key) || !settings.model.trim()) {
    st.updateJob(job.id, { status: 'failed', error: /^Bearer\s/i.test(key) ? '服务密钥只填写 API Key 本身，不要包含 Bearer 前缀。' : '未填写图片模型名称，请到「设置」填写。' });
    return;
  }
  const needsEdit = job.input.refAssetIds.length > 0 || job.input.scope?.mode === 'linked';
  if (needsEdit && (!settings.editUrl?.trim() || providerUrlError(settings.editUrl))) {
    st.updateJob(job.id, { status: 'failed', error: '参考图和多部位联动需要图片编辑接口。请在设置中填写服务商提供的完整「图片编辑 URL」，程序不会根据生图地址猜测编辑地址。' });
    return;
  }
  const ctrl = new AbortController();
  activeControllers.set(job.id, ctrl);
  st.updateJob(job.id, { status: 'running' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const checkCancelled = () => {
    if (ctrl.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
  };
  const requestImage = async (prompt: string, refs: { blob: Blob; name: string }[]): Promise<Blob> => {
    checkCancelled();
    // 每张图分别计时：联动方案包含多次请求，不能共用单张超时预算。
    timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, settings.timeoutMs);
    try {
      let resp: Response;
      if (refs.length) {
        const fd = new FormData();
        fd.append('model', settings.model.trim());
        fd.append('prompt', prompt);
        fd.append('size', settings.size);
        fd.append('n', '1');
        if (settings.quality && settings.quality !== 'auto') fd.append('quality', settings.quality);
        for (const r of refs) fd.append(refs.length === 1 ? 'image' : 'image[]', r.blob, r.name);
        resp = await fetch(providerRequestUrl(settings.editUrl!), {
          method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: ctrl.signal
        });
      } else {
        const chat = /\/chat\/completions\/?$/.test(new URL(settings.baseUrl.trim()).pathname);
        resp = await fetch(providerRequestUrl(settings.baseUrl), {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(chat
            ? { model: settings.model.trim(), messages: [{ role: 'user', content: prompt }], temperature: 0.7 }
            : { model: settings.model.trim(), prompt, n: 1, size: settings.size,
                ...(settings.quality && settings.quality !== 'auto' ? { quality: settings.quality } : {}) }), signal: ctrl.signal
        });
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${safeServiceMessage(await resp.text(), key)}`);
      const json = await resp.json();
      const d = json.data?.[0];
      // OpenAI 标准字段为 b64_json；保留兼容服务的 b64 字段。
      if (d?.b64_json || d?.b64) return b64ToBlob(d.b64_json || d.b64);
      const message = json.choices?.[0]?.message;
      const parts = [...(Array.isArray(message?.images) ? message.images : []), ...(Array.isArray(message?.content) ? message.content : [])];
      const chatImage = parts.find(p => p?.type === 'image_url' || p?.image_url)?.image_url;
      const markdownImage = typeof message?.content === 'string' ? message.content.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+|data:image\/[^\s)]+)\)/)?.[1] : undefined;
      const imageUrl = d?.url ?? (typeof chatImage === 'string' ? chatImage : chatImage?.url) ?? markdownImage;
      if (typeof imageUrl === 'string' && /^data:image\/[\w.+-]+;base64,/.test(imageUrl)) return b64ToBlob(imageUrl);
      if (typeof imageUrl === 'string' && /^https?:\/\//.test(imageUrl)) {
        const imageResp = await fetch(imageUrl, { signal: ctrl.signal });
        if (!imageResp.ok) throw new Error(`下载生成图失败：HTTP ${imageResp.status}`);
        return await imageResp.blob();
      }
      throw new Error(message ? '服务返回了聊天响应，但没有图片。请确认该模型和聊天接口支持生图；文字回答不算生图成功。' : '响应中没有可用图像');
    } finally {
      clearTimeout(timer);
    }
  };

  const assetIds: string[] = [];
  const candidates: ArtworkCandidate[] = [];
  const saveImage = async (blob: Blob, prompt: string, partId?: string): Promise<Asset> => {
    checkCancelled();
    const url = URL.createObjectURL(blob);
    let img: HTMLImageElement;
    try { img = await loadImage(url); } finally { URL.revokeObjectURL(url); }
    const id = `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    let savedBlob = blob;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    let processingWarning: string | undefined;
    const removeWhite = partId && job.input.removeWhite && !(job.input.scope?.textureMode === 'wrap' && job.input.scope.parts.find((p) => p.id === partId)?.kind === 'lathe');
    if (removeWhite) {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, w, h);
      autoRemoveWhiteBg({ data: pixels.data, w, h }, 15);
      ctx.putImageData(pixels, 0, 0);
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (pixels.data[(y * w + x) * 4 + 3] > 8) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
      if (x1 < x0) {
        processingWarning = '自动去白底未保留有效图案，已保留原图，请先手动剪切。';
      } else {
        const cropped = document.createElement('canvas');
        w = x1 - x0 + 1; h = y1 - y0 + 1;
        cropped.width = w; cropped.height = h;
        cropped.getContext('2d')!.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
        savedBlob = await canvasToBlob(cropped);
      }
      await putBlob(`original:${id}`, blob);
    }
    checkCancelled();
    const part = job.input.scope?.parts.find((p) => p.id === partId);
    const asset: Asset = {
      id, name: `${(job.input.subject || 'AI 图案').slice(0, 16)}${part ? ` · ${part.name}` : job.input.scope?.mode === 'linked' ? ' · 风格母稿' : ''}`,
      source: 'ai', tags: ['AI 生成', ...(part ? [part.name] : []), ...(job.input.scope?.mode === 'linked' ? ['联动方案'] : [])],
      w, h, blobKey: `blob:${id}`, createdAt: Date.now(), aiPrompt: prompt, aiModel: settings.model,
      aiJobId: job.id, aiPartId: partId,
      processingWarning,
      ...(removeWhite ? { originalBlobKey: `original:${id}` } : {})
    };
    await putBlob(asset.blobKey, savedBlob);
    st.addAsset(asset, savedBlob);
    assetIds.push(asset.id);
    st.updateJob(job.id, { resultAssetIds: [...assetIds] });
    return asset;
  };

  try {
    const refBlobs: { blob: Blob; name: string }[] = [];
    for (const id of job.input.refAssetIds) {
      const b = await idbGet<Blob>(`blob:${id}`);
      if (!b) throw new Error('参考素材文件缺失，请重新选择参考图');
      refBlobs.push({ blob: b, name: `${id}.png` });
    }
    const n = Math.max(1, Math.min(4, job.input.n));
    const scope = job.input.scope;
    const total = n * (scope ? scope.parts.length + (scope.mode === 'linked' ? 1 : 0) : 1);
    let done = 0;
    const progress = (label: string) => st.updateJob(job.id, { progress: { done, total, label } });
    // 逐张请求，规避不同服务对批量参数的差异
    for (let i = 0; i < n; i++) {
      checkCancelled();
      if (!scope) {
        progress(`候选 ${i + 1}`);
        await saveImage(await requestImage(job.prompt, refBlobs), job.prompt);
        done++;
        continue;
      }
      const candidate: ArtworkCandidate = { id: `${job.id}-set-${i}`, partAssets: [] };
      let sharedRefs = refBlobs;
      if (scope.mode === 'linked') {
        progress(`方案 ${i + 1} · 统一风格母稿`);
        const masterBlob = await requestImage(job.prompt, refBlobs);
        candidate.masterAssetId = (await saveImage(masterBlob, job.prompt)).id;
        sharedRefs = [{ blob: masterBlob, name: 'shared-design.png' }, ...refBlobs];
        done++;
      }
      for (const part of scope.parts) {
        progress(`方案 ${i + 1} · ${part.name}`);
        const prompt = buildPrompt(job.input, part);
        const asset = await saveImage(await requestImage(prompt, sharedRefs), prompt, part.id);
        candidate.partAssets.push({ partId: part.id, assetId: asset.id });
        done++;
      }
      candidates.push(candidate);
      st.updateJob(job.id, { candidates: [...candidates] });
    }
    checkCancelled();
    progress('全部完成');
    st.updateJob(job.id, { status: 'success', resultAssetIds: assetIds, candidates });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      if (useStore.getState().jobs.find((j) => j.id === job.id)?.status === 'cancelled' || (!timedOut && ctrl.signal.aborted)) return;
      // 超时且结果未知 → 待核对，不盲目重试（plan §10.3）
      st.updateJob(job.id, {
        status: 'needs-review',
        error: `请求超时（${settings.timeoutMs}ms），结果未知，请核对供应商后台后决定是否重试`
      });
    } else {
      st.updateJob(job.id, { status: 'failed', error: err.message });
    }
  } finally {
    clearTimeout(timer);
    activeControllers.delete(job.id);
  }
}

function b64ToBlob(b64: string): Blob {
  const clean = b64.includes(',') ? b64.split(',')[1] : b64;
  const bin = atob(clean);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'image/png' });
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: '排队中',
  running: '生成中',
  success: '已完成',
  failed: '失败',
  cancelled: '已取消',
  'needs-review': '待核对'
};
