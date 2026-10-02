import type { ArtworkCandidate, Asset, GenerationJob, JobStatus } from '../core/types';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { useStore } from '../state/store';
import { loadImage, canvasToBlob, putBlob } from '../state/imageStore';
import { buildArtworkPrompt } from '../cue/artwork';
import { autoRemoveWhiteBg } from '../editor/cutout';

// GPTImage 服务适配层（plan.md §6.1/§10）：
// 兼容 OpenAI Image API 的生成与编辑；模型 ID 可配置；
// 密钥仅保存在会话存储（非持久），不进入项目数据或导出文件（plan §10.1）。

export interface AiSettings {
  baseUrl: string;
  model: string;
  size: string;
  quality: string;
  n: number;
  timeoutMs: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-image-1',
  size: '1024x1024',
  quality: 'auto',
  n: 2,
  timeoutMs: 120000
};

export async function loadAiSettings(): Promise<AiSettings> {
  const s = await idbGet<AiSettings>('settings:ai');
  return { ...DEFAULT_AI_SETTINGS, ...(s ?? {}) };
}

export async function saveAiSettings(s: AiSettings) {
  await idbSet('settings:ai', s);
}

export function getApiKey(): string {
  return sessionStorage.getItem('cue:ai:key') ?? '';
}

export function setApiKey(key: string) {
  if (key) sessionStorage.setItem('cue:ai:key', key);
  else sessionStorage.removeItem('cue:ai:key');
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}${path}`;
}

/** 连接检测（与实际试生成分开，plan §10.1） */
export async function testConnection(settings: AiSettings): Promise<{ ok: boolean; message: string; models?: string[] }> {
  try {
    const resp = await fetch(joinUrl(settings.baseUrl, '/models'), {
      headers: { Authorization: `Bearer ${getApiKey()}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) return { ok: false, message: `HTTP ${resp.status}` };
    const json = await resp.json();
    const models: string[] = (json.data ?? []).map((m: { id: string }) => m.id).slice(0, 50);
    return { ok: true, message: `连接成功，服务可用模型 ${models.length} 个`, models };
  } catch (e) {
    return { ok: false, message: `连接失败：${(e as Error).message}` };
  }
}

export function buildPrompt(input: GenerationJob['input']): string {
  const parts: string[] = [];
  if (input.subject) parts.push(`主题：${input.subject}`);
  if (input.style) parts.push(`风格：${input.style}`);
  if (input.palette) parts.push(`配色：${input.palette}`);
  if (input.keep) parts.push(`需要保留：${input.keep}`);
  if (input.avoid) parts.push(`避免出现：${input.avoid}`);
  if (input.scope) parts.push(buildArtworkPrompt(input.scope, input.scope.mode === 'single' ? input.scope.parts[0] : undefined));
  // 白底生图固定要求（plan §6.2）
  parts.push('纯白背景，主体完整居中，四周留白，无地面阴影，无产品展示背景，无文字水印。');
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
export async function startGeneration(input: GenerationJob['input'], mode: 'generate' | 'edit'): Promise<GenerationJob> {
  const settings = await loadAiSettings();
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
  void executeJob(job, settings);
  return job;
}

async function executeJob(job: GenerationJob, settings: AiSettings) {
  const st = useStore.getState();
  const key = getApiKey();
  if (!key) {
    st.updateJob(job.id, { status: 'failed', error: '未配置 API Key，请到「设置」填写' });
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
        fd.append('model', settings.model);
        fd.append('prompt', prompt);
        fd.append('size', settings.size);
        fd.append('n', '1');
        if (settings.quality && settings.quality !== 'auto') fd.append('quality', settings.quality);
        for (const r of refs) fd.append(refs.length === 1 ? 'image' : 'image[]', r.blob, r.name);
        resp = await fetch(joinUrl(settings.baseUrl, '/images/edits'), {
          method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: ctrl.signal
        });
      } else {
        resp = await fetch(joinUrl(settings.baseUrl, '/images/generations'), {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: settings.model, prompt, n: 1, size: settings.size,
            ...(settings.quality && settings.quality !== 'auto' ? { quality: settings.quality } : {}) }), signal: ctrl.signal
        });
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${(await resp.text()).slice(0, 300)}`);
      const json = await resp.json();
      const d = json.data?.[0];
      if (!d) throw new Error('响应中没有图像数据');
      // OpenAI 标准字段为 b64_json；保留兼容服务的 b64 字段。
      if (d.b64_json || d.b64) return b64ToBlob(d.b64_json || d.b64);
      if (d.url) {
        const imageResp = await fetch(d.url, { signal: ctrl.signal });
        if (!imageResp.ok) throw new Error(`下载生成图失败：HTTP ${imageResp.status}`);
        return await imageResp.blob();
      }
      throw new Error('响应中没有可用图像');
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
    if (partId && job.input.removeWhite) {
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
      ...(partId && job.input.removeWhite ? { originalBlobKey: `original:${id}` } : {})
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
        const prompt = `${buildPrompt({ ...job.input, scope: undefined })}；${buildArtworkPrompt(scope, part)}`;
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
