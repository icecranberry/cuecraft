import { describe, expect, it } from 'vitest';
import type { ArtworkCandidate, Asset, DesignSnapshot, StickerInstance } from '../core/types';
import { applyArtworkToDesign, artworkParts, buildArtworkPrompt, createArtworkScope } from '../cue/artwork';
import { expandedSegments, resolveTemplate } from '../cue/templates';
import { partFocusDistance } from '../three/framing';
import { useStore } from '../state/store';

const tpl = resolveTemplate('nineball');
const empty: DesignSnapshot = { name: '联动测试', cueTemplateId: tpl.id, globalFinish: 'gloss', partOverrides: {}, stickers: [] };
const scope = createArtworkScope(tpl, empty, 'linked', ['butt-forearm', 'butt-cap', 'ring-deco']);
const assets: Asset[] = scope.parts.map((p) => ({ id: `asset-${p.id}`, name: p.name, source: 'ai', tags: [], w: 300, h: p.id.startsWith('ring-') ? 30 : 1200, blobKey: `blob:${p.id}`, createdAt: 1 }));
const candidate: ArtworkCandidate = { id: 'set-1', partAssets: scope.parts.map((p) => ({ partId: p.id, assetId: `asset-${p.id}` })) };
const makeId = () => `st-${Math.random()}`;
const sticker = (id: string, partId: string, locked = false): StickerInstance => ({
  id, name: id, assetId: 'previous', processedRev: 0, target: { kind: 'lathe', segId: partId, a: 1200, angDeg: 70 },
  w: 20, h: 20, rotDeg: 0, flipX: false, flipY: false, opacity: 1, z: 1, hidden: false, locked
});

describe('工厂部位联动方案', () => {
  it('只列可印刷部位，使用当前尺寸与材质覆盖创建快照', () => {
    const parts = artworkParts(tpl, { ...empty, partOverrides: { 'butt-forearm': { matPreset: 'blackSolid', color: '#000000' } } });
    expect(parts.some((p) => p.id === 'tip' || p.id === 'face-tip')).toBe(false);
    const forearm = parts.find((p) => p.id === 'butt-forearm')!;
    const seg = expandedSegments(tpl).find((s) => s.id === forearm.id)!;
    expect(forearm.wMm).toBeCloseTo(Math.PI * (seg.r0 + seg.r1));
    expect(forearm.hMm).toBe(seg.a1 - seg.a0);
    expect(forearm.material).toContain('纯色（黑）');
    expect(forearm.material).toContain('#000000');
  });

  it('联动至少两部位，单独模式恰好一部位，重复 id 不重复生成', () => {
    expect(() => createArtworkScope(tpl, empty, 'linked', ['grip'])).toThrow('至少');
    expect(() => createArtworkScope(tpl, empty, 'single', ['tip'])).toThrow('一个');
    expect(() => createArtworkScope(tpl, empty, 'single', ['grip', 'butt-cap'])).toThrow('一个');
    expect(createArtworkScope(tpl, empty, 'single', ['grip', 'grip']).parts).toHaveLength(1);
  });

  it('前臂、尾段与装饰环具有不同构图职责，携带展开比例', () => {
    expect(buildArtworkPrompt(scope)).toContain('风格母稿');
    const forearm = scope.parts.find((p) => p.id === 'butt-forearm')!;
    const ring = scope.parts.find((p) => p.id === 'ring-deco')!;
    expect(buildArtworkPrompt(scope, forearm)).toContain('长尖插花');
    expect(buildArtworkPrompt(scope, ring)).toContain('横向环绕');
    expect(buildArtworkPrompt(scope, forearm)).toContain('实际展开宽');
    expect(buildArtworkPrompt(scope, ring)).toContain('参考母稿');
  });

  it('整套应用只替换目标部位，保留握把和锁定层，原设计不可变', () => {
    const design = { ...empty, stickers: [sticker('forearm', 'butt-forearm'), sticker('locked', 'butt-cap', true), sticker('grip', 'grip')] };
    const next = applyArtworkToDesign(design, scope, candidate, assets, { replace: true }, makeId);
    expect(next.stickers.some((s) => s.id === 'forearm')).toBe(false);
    expect(next.stickers.filter((s) => ['locked', 'grip'].includes(s.id))).toHaveLength(2);
    expect(next.stickers.filter((s) => s.assetId.startsWith('asset-'))).toHaveLength(3);
    expect(design.stickers).toHaveLength(3);
    expect(next.partOverrides).toBe(design.partOverrides);
  });

  it('仅应用尾段不触及前臂；叠加模式保留所选部位的旧图案', () => {
    const design = { ...empty, stickers: [sticker('forearm', 'butt-forearm'), sticker('tail', 'butt-cap')] };
    const single = applyArtworkToDesign(design, scope, candidate, assets, { replace: true, onlyPartId: 'butt-cap' }, makeId);
    expect(single.stickers.map((s) => s.assetId)).toEqual(['previous', 'asset-butt-cap']);
    const overlay = applyArtworkToDesign(design, scope, candidate, assets, { replace: false }, makeId);
    expect(overlay.stickers).toHaveLength(5);
  });

  it('按真实部位范围等比例放置图案，不挤压装饰环、不越出端面', () => {
    const next = applyArtworkToDesign(empty, scope, candidate, assets, { replace: true }, makeId);
    for (const s of next.stickers) {
      const part = scope.parts.find((p) => p.id === (s.target.kind === 'lathe' ? s.target.segId : s.target.faceId))!;
      const asset = assets.find((a) => a.id === s.assetId)!;
      expect(s.w / s.h).toBeCloseTo(asset.w / asset.h);
      expect(s.w).toBeLessThan(part.wMm);
      expect(s.h).toBeLessThan(part.hMm);
      const seg = expandedSegments(tpl).find((s) => s.id === part.id)!;
      expect(s.target.kind === 'lathe' && s.target.a).toBe((seg.a0 + seg.a1) / 2);
    }
    const faceScope = createArtworkScope(tpl, empty, 'single', ['face-butt']);
    const faceAsset: Asset = { ...assets[0], id: 'face', w: 600, h: 600 };
    const face = applyArtworkToDesign(empty, faceScope, { id: 'face', partAssets: [{ partId: 'face-butt', assetId: 'face' }] }, [faceAsset], { replace: true }, makeId).stickers[0];
    expect(face.target).toEqual({ kind: 'face', faceId: 'face-butt', fx: 0, fz: 0 });
    expect(Math.hypot(face.w, face.h)).toBeLessThan(faceScope.parts[0].wMm);
  });

  it('不完整方案或已切换杆型时拒绝应用，不丢失当前图案', () => {
    expect(() => applyArtworkToDesign(empty, scope, { ...candidate, partAssets: [] }, assets, { replace: true }, makeId)).toThrow('尚未就绪');
    expect(() => applyArtworkToDesign({ ...empty, cueTemplateId: 'other' }, scope, candidate, assets, { replace: true }, makeId)).toThrow('杆型');
  });

  it('整套应用在历史中是一步，撤销与重做完整恢复', () => {
    useStore.setState({ design: empty, past: [], future: [], loaded: false });
    const next = applyArtworkToDesign(empty, scope, candidate, assets, { replace: true }, makeId);
    useStore.getState().pushHistory();
    useStore.getState().set({ design: next });
    expect(useStore.getState().past).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().design).toBe(empty);
    useStore.getState().redo();
    expect(useStore.getState().design).toBe(next);
  });
});

describe('部件聚焦距离', () => {
  it('皮头、先角、端面与接头都不比皮革握把的观察距离更近', () => {
    const grip = expandedSegments(tpl).find((s) => s.id === 'grip')!;
    for (const aspect of [0.8, 1.5, 2.4]) {
      const reference = partFocusDistance((grip.a1 - grip.a0) * 2.2, aspect);
      for (const span of [5 * 2.2, 24 * 2.2, 15.7 * 5.5, 90 / 0.5, 80 / 0.5]) expect(partFocusDistance(span, aspect)).toBeCloseTo(reference);
      expect(partFocusDistance(384 * 2.2, aspect)).toBeGreaterThan(reference);
    }
  });
});

describe('新手质感切换', () => {
  it('切换整体漆面保留底色和底材，并能一次撤销', () => {
    const before = { ...empty, partOverrides: { 'butt-forearm': { matPreset: 'blackSolid', color: '#172a20', finish: 'matte' as const }, grip: { matPreset: 'leather' } } };
    useStore.setState({ design: before, past: [], future: [], loaded: false });
    useStore.getState().applyFinishAll('semi');
    expect(useStore.getState().design.globalFinish).toBe('semi');
    expect(useStore.getState().design.partOverrides['butt-forearm']).toEqual({ matPreset: 'blackSolid', color: '#172a20' });
    expect(useStore.getState().design.partOverrides.grip).toEqual({ matPreset: 'leather' });
    expect(useStore.getState().past).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().design).toEqual(before);
  });
});
