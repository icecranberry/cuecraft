import * as THREE from 'three';
import type { FaceSpec, SegmentSpec, StickerInstance } from '../core/types';
import { radiusAtSeg } from '../cue/mapping';
import { blobToCanvas } from '../state/imageStore';

// 印刷层合成（plan.md §4.3）：预览纹理、导出图层、展开检查共用同一绘制规则。
// 画布仅含印刷内容（透明底），底材由材质贴片提供，不入印刷层（plan.md §5.1）。
// 画布坐标：x 沿环绕角（或端面 fx），y 沿轴向杆尾（或端面 fz）。

export interface StickerImage {
  canvas: HTMLCanvasElement;
  /** alpha 通道（命中测试用） */
  alpha: Uint8ClampedArray;
  w: number;
  h: number;
}

const imgCache = new Map<string, StickerImage | null>();

export function invalidateStickerImage(s: StickerInstance) {
  imgCache.delete(imageKey(s));
}

function imageKey(s: StickerInstance) {
  return s.processedKey ? `${s.processedKey}@${s.processedRev}` : `asset:${s.assetId}`;
}

export async function getStickerImage(s: StickerInstance): Promise<StickerImage | null> {
  const key = imageKey(s);
  if (imgCache.has(key)) return imgCache.get(key)!;
  const canvas = s.processedKey
    ? await blobToCanvas(s.processedKey)
    : await blobToCanvas(`blob:${s.assetId}`);
  let out: StickerImage | null = null;
  if (canvas) {
    const alpha = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    out = { canvas, alpha, w: canvas.width, h: canvas.height };
  }
  imgCache.set(key, out);
  return out;
}

/** 同步读取已缓存图像（命中测试用）；未加载返回 null（矩形内即视为命中） */
export function getCachedStickerImage(s: StickerInstance): StickerImage | null {
  return imgCache.get(imageKey(s)) ?? null;
}

/** 贴纸局部点（mm）→ 源图像素 alpha（0..1）；无图返回 null（不遮挡选择） */
export function stickerAlphaAt(
  img: StickerImage | null,
  s: StickerInstance,
  lxMm: number,
  lyMm: number
): number | null {
  if (!img) return null;
  const px = ((lxMm / s.w) * img.w) | 0;
  const py = ((lyMm / s.h) * img.h) | 0;
  if (px < 0 || py < 0 || px >= img.w || py >= img.h) return 0;
  return img.alpha[(py * img.w + px) * 4 + 3] / 255;
}

/** 统一贴纸绘制：canvas y 向下，rot 正值为顺时针；与命中测试互逆 */
export function drawStickerMM(
  ctx: CanvasRenderingContext2D,
  img: StickerImage,
  centerMm: { x: number; y: number },
  s: StickerInstance,
  pxPerMm: number
) {
  const pw = s.w * pxPerMm;
  const ph = s.h * pxPerMm;
  ctx.save();
  ctx.translate(centerMm.x * pxPerMm, centerMm.y * pxPerMm);
  ctx.rotate((s.rotDeg * Math.PI) / 180);
  ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
  ctx.globalAlpha = s.opacity;
  ctx.drawImage(img.canvas, -pw / 2, -ph / 2, pw, ph);
  ctx.restore();
}

/** 部件印刷画布尺寸与像素密度 */
export function partCanvasDims(
  wMm: number,
  hMm: number,
  qualityPpm: number,
  maxDim = 4096
): { w: number; h: number; ppm: number } {
  const ppm = Math.min(qualityPpm, maxDim / Math.max(wMm, hMm, 1));
  return { w: Math.max(4, Math.round(wMm * ppm)), h: Math.max(4, Math.round(hMm * ppm)), ppm };
}

/** 旋转面部件的印刷合成（含跨接缝双绘，plan.md §4.2） */
export function composeSegmentPrint(
  seg: SegmentSpec,
  stickers: StickerInstance[],
  qualityPpm: number,
  maxDim = 4096
): { canvas: HTMLCanvasElement; ppm: number } {
  const lenMm = seg.a1 - seg.a0;
  const rMid = (seg.r0 + seg.r1) / 2;
  const circMm = 2 * Math.PI * rMid;
  const { w, h, ppm } = partCanvasDims(circMm, lenMm, qualityPpm, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const mine = stickers
    .filter((s) => !s.hidden && s.target.kind === 'lathe' && s.target.segId === seg.id)
    .sort((a, b) => a.z - b.z);
  for (const s of mine) {
    if (s.target.kind !== 'lathe') continue;
    const img = imgCache.get(imageKey(s)) ?? null;
    if (!img) continue;
    const r = radiusAtSeg(seg, s.target.a);
    const cx = ((((s.target.angDeg % 360) + 360) % 360) / 360) * (2 * Math.PI * r);
    const cy = s.target.a - seg.a0;
    const offs: number[] = [0];
    if (cx < s.w / 2) offs.push(w / ppm);
    if (cx > circMm - s.w / 2) offs.push(-w / ppm);
    for (const off of offs) {
      drawStickerMM(ctx, img, { x: cx + off, y: cy }, s, ppm);
    }
  }
  return { canvas, ppm };
}

/** 端面印刷合成 */
export function composeFacePrint(
  face: FaceSpec,
  stickers: StickerInstance[],
  qualityPpm: number,
  maxDim = 4096
): { canvas: HTMLCanvasElement; ppm: number } {
  const sizeMm = face.radius * 2;
  const { w, h, ppm } = partCanvasDims(sizeMm, sizeMm, qualityPpm, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const mine = stickers
    .filter((s) => !s.hidden && s.target.kind === 'face' && s.target.faceId === face.id)
    .sort((a, b) => a.z - b.z);
  for (const s of mine) {
    if (s.target.kind !== 'face') continue;
    const img = imgCache.get(imageKey(s)) ?? null;
    if (!img) continue;
    drawStickerMM(ctx, img, { x: s.target.fx + face.radius, y: s.target.fz + face.radius }, s, ppm);
  }
  return { canvas, ppm };
}

/** 预览用 CanvasTexture（flipY=false：画布顶行 = 杆头侧，与导出一致） */
export function canvasToTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
