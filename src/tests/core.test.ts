import { describe, expect, it } from 'vitest';
import { CUE_TEMPLATES, expandedSegments, radiusAt, resolveTemplate } from '../cue/templates';
import { buildSegmentGeometry, lathePoint, surfaceNormal } from '../cue/geometry';
import * as THREE from 'three';
import { latheUvToSurface, stickerLocalPoint, pointInRect, angDelta, moveStickerTo, pickSticker, normAngle } from '../cue/mapping';
import { buildUnfoldTemplate, mmToPx, sheetPixels, stickerPosInBlock } from '../cue/unwrap';
import { autoRemoveWhiteBg, effectivePpi, featherAlpha, type Img } from '../editor/cutout';
import type { StickerInstance, SurfaceTarget } from '../core/types';

// 覆盖 plan.md §4.1「模型、贴纸坐标与生产展开模板之间明确、可测试的转换关系」。

const tpl = resolveTemplate('nineball');

describe('杆型模板', () => {
  it('仅保留用户指定的大头杆规格', () => {
    expect(CUE_TEMPLATES.map((t) => t.id)).toEqual(['nineball']);
    expect(tpl.lengthMm).toBe(1474);
    expect(tpl.shaftLengthMm).toBe(737);
    expect(tpl.buttLengthMm).toBe(737);
    expect(tpl.shaftLengthMm + tpl.buttLengthMm).toBe(tpl.lengthMm);
    expect(tpl.tipDiameterMm).toBe(13);
    expect(tpl.jointDiameterMm).toBe(21.4);
    expect(tpl.buttDiameterMm).toBe(31.4);
  });

  it('旧保存的杆型统一解析为大头杆', () => {
    expect(resolveTemplate('snooker')).toBe(tpl);
    expect(resolveTemplate('chinese8')).toBe(tpl);
    expect(() => resolveTemplate('unknown')).toThrow();
  });

  it('展开后的部件轴向连续且覆盖全杆（皮头到杆尾）', () => {
    for (const t of CUE_TEMPLATES) {
      const segs = expandedSegments(t);
      expect(segs[0].a0).toBe(0);
      for (let i = 1; i < segs.length; i++) {
        expect(segs[i].a0).toBeCloseTo(segs[i - 1].a1, 3);
        expect(segs[i].r0).toBeCloseTo(segs[i - 1].r1, 6);
      }
      expect(segs[segs.length - 1].a1).toBeCloseTo(t.lengthMm, 3);
    }
  });

  it('实际模型在先角、中轮、大轮处符合指定直径', () => {
    const segs = expandedSegments(tpl);
    const ferrule = segs.find((s) => s.id === 'ferrule')!;
    const shaft = segs.find((s) => s.id === 'shaft')!;
    const joint = segs.find((s) => s.id === 'joint')!;
    expect(shaft.a1).toBe(737);
    expect(joint.a0).toBe(737);
    expect(radiusAt(tpl, ferrule.a0) * 2).toBeCloseTo(13, 6);
    expect(radiusAt(tpl, 737) * 2).toBeCloseTo(21.4, 6);
    expect(radiusAt(tpl, 1474) * 2).toBeCloseTo(31.4, 6);
    for (const [segId, x, diameter] of [
      ['ferrule', 5, 13], ['joint', 737, 21.4], ['butt-cap', 1474, 31.4]
    ] as const) {
      const geometry = buildSegmentGeometry(segs.find((s) => s.id === segId)!);
      const positions = geometry.getAttribute('position');
      const radii: number[] = [];
      for (let i = 0; i < positions.count; i++) {
        if (Math.abs(positions.getX(i) - x) < 0.001) {
          radii.push(Math.hypot(positions.getY(i), positions.getZ(i)));
        }
      }
      expect(radii.length).toBeGreaterThan(0);
      for (const r of radii) expect(r * 2).toBeCloseTo(diameter, 4);
      geometry.dispose();
    }
  });

  it('杆头半径与杆头直径一致，端面半径与末段一致', () => {
    for (const t of CUE_TEMPLATES) {
      expect(radiusAt(t, 0)).toBeCloseTo(t.tipDiameterMm / 2, 3);
      const segs = expandedSegments(t);
      const last = segs[segs.length - 1];
      const buttFace = t.faces.find((f) => f.id === 'face-butt')!;
      expect(buttFace.radius).toBeCloseTo(last.r1, 3);
    }
  });
});

describe('表面映射', () => {
  it('锥面法线垂直于实际曲面的轴向与环向切线', () => {
    for (const seg of expandedSegments(tpl)) {
      const a = (seg.a0 + seg.a1) / 2;
      for (const ang of [0, 0.7, Math.PI, Math.PI * 1.8]) {
        const normal = surfaceNormal(seg, a, ang);
        const axial = lathePoint(seg, a + 0.001, ang).sub(lathePoint(seg, a - 0.001, ang)).normalize();
        const around = lathePoint(seg, a, ang + 0.001).sub(lathePoint(seg, a, ang - 0.001)).normalize();
        expect(normal.dot(axial)).toBeCloseTo(0, 8);
        expect(normal.dot(around)).toBeCloseTo(0, 8);
        expect(normal.length()).toBeCloseTo(1, 8);
      }
      const geometry = buildSegmentGeometry(seg);
      const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
      for (let i = 0; i < positions.count; i += 17) {
        const expected = surfaceNormal(seg, positions.getX(i), Math.atan2(positions.getZ(i), positions.getY(i)));
        expect(new THREE.Vector3().fromBufferAttribute(normals, i).distanceTo(expected)).toBeLessThan(1e-6);
      }
      geometry.dispose();
    }
  });

  it('uv→表面坐标→角度还原一致', () => {
    const seg = expandedSegments(tpl)[2];
    const hit = latheUvToSurface(seg, 0.25, 0.5);
    expect(hit.kind).toBe('lathe');
    expect(hit.angDeg).toBeCloseTo(90, 3);
    expect(hit.a).toBeCloseTo(seg.a0 + 0.5 * (seg.a1 - seg.a0), 3);
  });

  it('角度差取最短路径（跨接缝连续，plan §4.2）', () => {
    expect(angDelta(350, 10)).toBe(-20);
    expect(angDelta(10, 350)).toBe(20);
    expect(normAngle(-30)).toBe(330);
  });

  it('贴纸局部点与旋转互逆', () => {
    // 正变换：q = R(rot)·p（canvas y 向下）；逆变换应还原 p
    const p = { lx: 4, ly: -3 };
    const rot = 30;
    const th = (rot * Math.PI) / 180;
    const qx = p.lx * Math.cos(th) - p.ly * Math.sin(th);
    const qy = p.lx * Math.sin(th) + p.ly * Math.cos(th);
    const inv = stickerLocalPoint(qx, qy, 10, 10, rot);
    // stickerLocalPoint 以 (hit-center) 为输入
    const inv2 = stickerLocalPoint(qx + 10, qy + 10, 10, 10, rot);
    void inv;
    expect(inv2.lx).toBeCloseTo(p.lx, 6);
    expect(inv2.ly).toBeCloseTo(p.ly, 6);
    expect(pointInRect(inv2.lx, inv2.ly, 10, 10)).toBe(true);
  });
});

describe('贴纸命中与拖动', () => {
  const seg = expandedSegments(tpl).find((s) => s.id === 'butt-forearm')!;
  const mkSticker = (over?: Partial<StickerInstance>): StickerInstance => ({
    id: 's1',
    name: 'test',
    assetId: 'a1',
    processedRev: 0,
    target: { kind: 'lathe', segId: 'butt-forearm', a: 900, angDeg: 45 } as SurfaceTarget,
    w: 20,
    h: 30,
    rotDeg: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    z: 1,
    hidden: false,
    locked: false,
    ...over
  });

  it('pickSticker 命中矩形内贴纸', () => {
    const s = mkSticker();
    const hit = latheUvToSurface(seg, (45 / 360), (900 - seg.a0) / (seg.a1 - seg.a0));
    const got = pickSticker([hit], [s], tpl, () => 1);
    expect(got?.id).toBe('s1');
  });

  it('透明像素不遮挡（返回 null 表示未命中）', () => {
    const s = mkSticker();
    const hit = latheUvToSurface(seg, 45 / 360, (900 - seg.a0) / (seg.a1 - seg.a0));
    expect(pickSticker([hit], [s], tpl, () => 0)?.id).toBeUndefined();
  });

  it('拖动保持抓取偏移（位置与相机无关）', () => {
    const s = mkSticker();
    const hit = latheUvToSurface(seg, (55 / 360), (910 - seg.a0) / (seg.a1 - seg.a0));
    const moved = moveStickerTo(s, hit, { dx: 2, dy: 2 }, tpl);
    expect(moved).not.toBeNull();
    expect(moved!.target.kind).toBe('lathe');
    const t2 = moved!.target as { a: number; angDeg: number };
    // 命中点(55°,910mm) 减去偏移(dx=2mm弧长≈1.2°, dy=2mm) ≈ (53.8°, 908mm)
    const r = seg.r0 + (seg.r1 - seg.r0) * ((900 - seg.a0) / (seg.a1 - seg.a0));
    const dxAng = (2 / (2 * Math.PI * r)) * 360;
    expect(t2.angDeg).toBeCloseTo(45 + 10 - dxAng, 1);
    expect(t2.a).toBeCloseTo(908, 1);
  });
});

describe('生产展开模板（plan §7）', () => {
  it('像素换算 px = mm/25.4 × PPI（取整）', () => {
    expect(mmToPx(100, 300)).toBe(Math.round((100 / 25.4) * 300));
    expect(mmToPx(25.4, 300)).toBe(300);
  });

  it('展开块尺寸与半径成比例，锥度分段半径差受控', () => {
    const tpl2 = buildUnfoldTemplate(tpl, { ppi: 300, bleedMm: 2, overlapMm: 2, rowWidthMm: 640, mirror: false });
    expect(tpl2.blocks.length).toBeGreaterThan(5);
    for (const b of tpl2.blocks) {
      if (b.kind === 'lathe') {
        expect(b.wMm).toBeCloseTo(2 * Math.PI * b.rMid + 2, 3);
        expect(b.hMm).toBeGreaterThan(0);
      }
    }
    // 分段半径差 ≤ maxStep（0.3mm 默认）
    const bySeg: Record<string, number[]> = {};
    for (const b of tpl2.blocks) {
      if (b.kind !== 'lathe') continue;
      (bySeg[b.segId] ??= []).push(b.rMid);
    }
    for (const [segId, mids] of Object.entries(bySeg)) {
      if (mids.length < 2) continue;
      const seg = expandedSegments(tpl).find((s) => s.id === segId)!;
      const totalDr = Math.abs(seg.r1 - seg.r0);
      expect(mids.length).toBeGreaterThanOrEqual(Math.ceil(totalDr / 0.3));
    }
  });

  it('贴纸在块内的位置随角度/轴向线性映射', () => {
    const tpl2 = buildUnfoldTemplate(tpl, { ppi: 150, bleedMm: 0, overlapMm: 0, rowWidthMm: 640, mirror: false });
    const block = tpl2.blocks.find((b) => b.kind === 'lathe' && b.segId === 'shaft')!;
    const p = stickerPosInBlock(90, block.a0 + block.hMm / 2, block);
    expect(p.x).toBeCloseTo(2 * Math.PI * block.rMid * 0.25, 3);
    expect(p.y).toBeCloseTo(block.hMm / 2, 3);
  });

  it('版面像素不超过画布安全上限', () => {
    const tpl2 = buildUnfoldTemplate(tpl, { ppi: 300, bleedMm: 2, overlapMm: 2, rowWidthMm: 640, mirror: false });
    const px = sheetPixels(tpl2);
    expect(px.w).toBeLessThan(32767);
    expect(px.h).toBeLessThan(32767);
  });
});

describe('抠图与清晰度', () => {
  function makeWhiteBgImg(): Img {
    // 8×8：左上 4×4 红色主体，其余白底
    const w = 8;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const inSubject = x < 4 && y < 4;
        data[i] = inSubject ? 220 : 250;
        data[i + 1] = inSubject ? 30 : 250;
        data[i + 2] = inSubject ? 40 : 250;
        data[i + 3] = 255;
      }
    }
    return { data, w, h };
  }

  it('自动去白底保留画面中央的白色块（非边缘连通）', () => {
    const img = makeWhiteBgImg();
    // 在主体内部放一个白点（不与边缘连通）
    const i = (1 * img.w + 1) * 4;
    img.data[i] = 255;
    img.data[i + 1] = 255;
    img.data[i + 2] = 255;
    autoRemoveWhiteBg(img, 20, null);
    // 主体红色保留
    expect(img.data[(0 * 8 + 0) * 4 + 3]).toBe(255);
    // 主体内部白点保留（连通性保护，plan §6.3）
    expect(img.data[(1 * 8 + 1) * 4 + 3]).toBe(255);
    // 右下白底被移除
    expect(img.data[(7 * 8 + 7) * 4 + 3]).toBe(0);
  });

  it('保护蒙版阻止删除', () => {
    const img = makeWhiteBgImg();
    const protect = new Uint8Array(img.w * img.h);
    protect[7 * 8 + 7] = 255;
    autoRemoveWhiteBg(img, 20, protect);
    expect(img.data[(7 * 8 + 7) * 4 + 3]).toBe(255);
  });

  it('羽化降低但不完全移除 alpha', () => {
    const img = makeWhiteBgImg();
    featherAlpha(img, 1);
    const center = (2 * 8 + 2) * 4 + 3;
    expect(img.data[center]).toBeGreaterThan(200);
  });

  it('有效清晰度计算（plan §6.4）', () => {
    // 1181px 宽打印 100mm → 300 PPI
    expect(effectivePpi(1181, 100)).toBeCloseTo(300, 0);
  });
});
