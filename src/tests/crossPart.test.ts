import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StickerInstance } from '../core/types';
import { expandedSegments, resolveTemplate } from '../cue/templates';
import { latheUvToSurface, moveStickerTo, pickSticker, stickerOverlapsSegment } from '../cue/mapping';
import { composeSegmentPrint, drawLatheStickers, getStickerImage } from '../stickers/composite';

vi.mock('../state/imageStore', () => ({ blobToCanvas: vi.fn(async () => ({ width: 2, height: 2,
  getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(16).fill(255) }) })
})) }));

const tpl = resolveTemplate('nineball', false);
const segments = expandedSegments(tpl);
const forearm = segments.find((s) => s.id === 'butt-forearm')!;
const next = segments.find((s) => s.a0 === forearm.a1)!;
const sticker = (changes: Partial<StickerInstance> = {}): StickerInstance => ({
  id: 'cross', name: 'cross', assetId: 'cross', processedRev: 0,
  target: { kind: 'lathe', segId: forearm.id, a: forearm.a1 - 2, angDeg: 180 },
  w: 20, h: 40, rotDeg: 0, flipX: false, flipY: false, opacity: 1, z: 1, hidden: false, locked: false,
  ...changes
});
const context = () => ({ save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
  translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() });
afterEach(() => vi.unstubAllGlobals());

describe('跨部位贴图', () => {
  it('旋转后的边界参与跨部位筛选，隐藏或不可印刷表面不参与', () => {
    const rotated = sticker({ w: 50, h: 1, rotDeg: 90 });
    expect(stickerOverlapsSegment(rotated, next)).toBe(true);
    expect(stickerOverlapsSegment({ ...rotated, hidden: true }, next)).toBe(false);
    expect(stickerOverlapsSegment(rotated, { ...next, printEnabled: false })).toBe(false);
    expect(stickerOverlapsSegment(sticker(), segments[0])).toBe(false);
  });

  it('相邻部位上的图案可以按真实透明像素选中，镜像与旋转的逆变换一致', () => {
    const s = sticker({ rotDeg: 90, flipX: true });
    const hit = latheUvToSurface(next, 0.5, 1 / (next.a1 - next.a0));
    const alpha = vi.fn(() => 1);
    expect(pickSticker([hit], [s], tpl, alpha)?.id).toBe(s.id);
    expect(alpha.mock.calls[0]).toEqual([s, 7, 20]);
    expect(pickSticker([hit], [s], tpl, () => 0)).toBeNull();
  });

  it('抓住溢出部分拖动不会将中心吸到部位边界', () => {
    const s = sticker();
    const hit = latheUvToSurface(next, 0.5, 1 / (next.a1 - next.a0));
    const moved = moveStickerTo(s, hit, { dx: 0, dy: 3 }, tpl)!;
    expect(moved.target).toEqual(s.target);
  });

  it('预览与生产导出共用投影，邻段绘制同一源图并在各输出块内裁切', async () => {
    const s = sticker();
    await getStickerImage(s);
    const preview = context();
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => preview }) });
    composeSegmentPrint(next, [s], 4, 4096, segments);
    expect(preview.drawImage).toHaveBeenCalledTimes(1);
    expect(preview.translate).toHaveBeenCalledWith(expect.any(Number), -8);
    const output = context();
    const circ = Math.PI * (next.r0 + next.r1);
    drawLatheStickers(output as unknown as CanvasRenderingContext2D, [s], segments, next.a0, next.a1, circ, circ, 4);
    expect(output.translate.mock.calls).toEqual(preview.translate.mock.calls);
    expect(output.scale.mock.calls).toEqual(preview.scale.mock.calls);
    expect(output.rect).toHaveBeenCalledWith(0, 0, circ * 4, (next.a1 - next.a0) * 4);
    expect(output.clip).toHaveBeenCalledTimes(1);
  });

  it('旋转长贴图跨圆周接缝时绘制完整复制，并按图层顺序合成', async () => {
    const s = sticker({ w: 2, h: 60, rotDeg: 90, target: { kind: 'lathe', segId: forearm.id, a: forearm.a1 - 2, angDeg: 30 } });
    await getStickerImage(s);
    const ctx = context();
    const circ = Math.PI * (forearm.r0 + forearm.r1);
    drawLatheStickers(ctx as unknown as CanvasRenderingContext2D, [s], segments, forearm.a0, forearm.a1, circ, circ, 1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });
});
