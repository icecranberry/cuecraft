import { describe, expect, it } from 'vitest';
import type { StickerInstance } from '../core/types';
import { previewPrintResolution } from '../stickers/previewResolution';
import { canvasToTexture, partCanvasDims } from '../stickers/composite';
import { LinearFilter, LinearMipmapLinearFilter } from 'three';

const sticker: StickerInstance = {
  id: 'detail', name: '细线纹样', assetId: 'gold-diamond', processedRev: 0,
  target: { kind: 'lathe', segId: 'butt-forearm', a: 900, angDeg: 70 },
  w: 22, h: 33, rotDeg: 0, flipX: false, flipY: false,
  opacity: 1, z: 1, hidden: false, locked: false,
};
const source = () => ({ w: 1024, h: 1536 });

describe('预览印刷精度', () => {
  it('默认画质下小贴花保留足够细节，不再把 1024px 原图压成 44px', () => {
    const result = previewPrintResolution(80, 384, [sticker], source, 'balanced', false, 16384);
    const dims = partCanvasDims(80, 384, result.ppm, result.maxDim);
    expect(sticker.w * dims.ppm).toBeGreaterThan(350);
    expect(dims.h).toBeLessThanOrEqual(8192);
  });

  it('短部位在预算允许时保留原图像素密度，包括旋转图案', () => {
    const result = previewPrintResolution(40, 60, [{ ...sticker, rotDeg: 90 }], source, 'balanced', false, 16384);
    expect(result.ppm * sticker.w).toBeCloseTo(1024);
    expect(result.ppm * sticker.h).toBeCloseTo(1536);
  });

  it('遵守显卡尺寸限制和大面积贴图的内存预算', () => {
    const limited = previewPrintResolution(80, 384, [sticker], source, 'sharp', false, 2048);
    const dims = partCanvasDims(80, 384, limited.ppm, limited.maxDim);
    expect(Math.max(dims.w, dims.h)).toBeLessThanOrEqual(2048);
    const square = previewPrintResolution(500, 500, [sticker], source, 'balanced', false, 16384);
    expect(500 * 500 * square.ppm ** 2).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it('拖动时降低合成成本，结束后恢复高精度', () => {
    const moving = previewPrintResolution(80, 384, [sticker], source, 'balanced', true, 16384);
    const settled = previewPrintResolution(80, 384, [sticker], source, 'balanced', false, 16384);
    expect(moving.ppm).toBeGreaterThanOrEqual(4);
    expect(moving.maxDim).toBeLessThanOrEqual(2048);
    expect(settled.ppm).toBeGreaterThan(moving.ppm * 3);
  });

  it('隐藏或缺失的素材不抬高分辨率，处理后图像按实际尺寸计算', () => {
    const hidden = previewPrintResolution(40, 60, [{ ...sticker, hidden: true }], source, 'balanced', false, 16384);
    const missing = previewPrintResolution(40, 60, [sticker], () => null, 'balanced', false, 16384);
    const processed = previewPrintResolution(40, 60, [sticker], () => ({ w: 440, h: 660 }), 'balanced', false, 16384);
    expect(hidden.ppm).toBe(12);
    expect(missing.ppm).toBe(12);
    expect(processed.ppm).toBe(20);
  });

  it('使用平滑采样并限制各向异性过滤至显卡能力', () => {
    const texture = canvasToTexture({} as HTMLCanvasElement, 4);
    expect(texture.anisotropy).toBe(4);
    expect(texture.magFilter).toBe(LinearFilter);
    expect(texture.minFilter).toBe(LinearMipmapLinearFilter);
    expect(texture.flipY).toBe(false);
    texture.dispose();
  });
});
