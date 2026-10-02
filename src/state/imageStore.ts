import { get, set, del } from 'idb-keyval';

// 图像 blob 注册表：原图、处理图、封面等统一存 IndexedDB，内存中缓存 ObjectURL。
// 原始素材保持可恢复（plan.md §6.3），设计数据不内嵌大图二进制（plan.md §9.3）。

const urlCache = new Map<string, string>();
const blobCache = new Map<string, Blob>();

export async function putBlob(key: string, blob: Blob): Promise<void> {
  const oldUrl = urlCache.get(key);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  urlCache.delete(key);
  blobCache.set(key, blob);
  await set(key, blob);
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const hit = blobCache.get(key);
  if (hit) return hit;
  const b = await get<Blob>(key);
  if (b) blobCache.set(key, b);
  return b;
}

export async function removeBlob(key: string): Promise<void> {
  blobCache.delete(key);
  urlCache.delete(key);
  await del(key);
}

export async function blobUrl(key: string): Promise<string | undefined> {
  const hit = urlCache.get(key);
  if (hit) return hit;
  const b = await getBlob(key);
  if (!b) return undefined;
  const url = URL.createObjectURL(b);
  urlCache.set(key, url);
  return url;
}

/** 解码为 canvas（绘制与 alpha 命中测试共用） */
export async function blobToCanvas(key: string): Promise<HTMLCanvasElement | undefined> {
  const b = await getBlob(key);
  if (!b) return undefined;
  const url = URL.createObjectURL(b);
  try {
    const img = await loadImage(url);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), 'image/png')
  );
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
