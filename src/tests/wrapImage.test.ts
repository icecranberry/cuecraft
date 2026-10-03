import { describe, expect, it } from 'vitest';
import { wrapImageLayout } from '../ai/wrapImage';

describe('整圈图有效范围与展开尺寸', () => {
  it('正方形画布中央窄条去掉外围后映射整圈，保留白色和内部透明孔洞', () => {
    const pixels = new Uint8ClampedArray(100 * 100 * 4);
    for (let y = 10; y < 90; y++) for (let x = 40; x < 60; x++) pixels.set([255, 255, 255, 255], (y * 100 + x) * 4);
    pixels[(50 * 100 + 50) * 4 + 3] = 0;
    const before = pixels.slice();
    expect(wrapImageLayout(pixels, 100, 100, { wMm: 80, hMm: 320 })).toEqual({ sx: 40, sy: 10, sw: 20, sh: 80, w: 20, h: 80 });
    expect(pixels).toEqual(before);
  });
  it('满版图不裁边，横向部位使用横向画幅', () => {
    const pixels = new Uint8ClampedArray(100 * 100 * 4).fill(255);
    expect(wrapImageLayout(pixels, 100, 100, { wMm: 80, hMm: 20 })).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100, w: 100, h: 25 });
  });
  it('完全透明图不能作为成功贴图应用', () => {
    expect(() => wrapImageLayout(new Uint8ClampedArray(16), 2, 2, { wMm: 80, hMm: 320 })).toThrow('空白透明图');
  });
});
