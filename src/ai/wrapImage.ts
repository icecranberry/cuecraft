import type { ArtworkPart } from '../core/types';
import { canvasToBlob } from '../state/imageStore';

/** 去掉模型返回的透明外围，不去白、不删除内部透明纹样。 */
export function wrapImageLayout(data: Uint8ClampedArray, width: number, height: number, part: Pick<ArtworkPart, 'wMm' | 'hMm'>) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 0) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  if (x1 < x0) throw new Error('整圈贴图为空白透明图，请重新生成。');
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  // 保留源图最长边的像素量，统一为物理展开比例；不增加固定服务尺寸参数。
  const ppm = Math.min(4096, Math.max(sw, sh)) / Math.max(part.wMm, part.hMm);
  return { sx: x0, sy: y0, sw, sh, w: Math.max(1, Math.round(part.wMm * ppm)), h: Math.max(1, Math.round(part.hMm * ppm)) };
}

export async function prepareWrapImage(img: HTMLImageElement, part: ArtworkPart) {
  const source = document.createElement('canvas');
  source.width = img.naturalWidth; source.height = img.naturalHeight;
  const ctx = source.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, source.width, source.height).data;
  const layout = wrapImageLayout(pixels, source.width, source.height, part);
  const output = document.createElement('canvas');
  output.width = layout.w; output.height = layout.h;
  output.getContext('2d')!.drawImage(source, layout.sx, layout.sy, layout.sw, layout.sh, 0, 0, layout.w, layout.h);
  const cropped = layout.sw !== source.width || layout.sh !== source.height;
  return { blob: await canvasToBlob(output), w: layout.w, h: layout.h,
    warning: cropped ? '已去掉透明外围并适配整圈展开尺寸，原始生成图已保留。' : undefined };
}
