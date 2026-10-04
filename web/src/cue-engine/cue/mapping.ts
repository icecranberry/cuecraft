import type { CueTemplate, FaceSpec, SegmentSpec, StickerInstance } from '../core/types';
import { expandedSegments, faceById, segmentById } from './templates';

// 表面坐标与贴纸命中（plan.md §4.1/§3.4）。
// 画布坐标约定（预览合成与生产展开共用，plan.md §4.3）：
//   旋转面：x 沿环绕角增加方向，y 沿轴向杆尾方向（向下）。
//   端面：x = fx（+Y 方向 mm），y = fz（+Z 方向 mm）。
// 所有绘制与命中测试共用同一套旋转/镜像矩阵，保证预览与导出一致。

export function normAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 最短角差，落在 (-180, 180] */
export function angDelta(a: number, b: number): number {
  let d = normAngle(a) - normAngle(b);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** 贴纸在画布坐标（mm）中的中心点 */
export function stickerCanvasCenter(s: StickerInstance, t: CueTemplate): { x: number; y: number } {
  if (s.target.kind === 'lathe') {
    const seg = segmentById(t, s.target.segId);
    if (!seg) return { x: 0, y: 0 };
    const r = radiusAtSeg(seg, s.target.a);
    const circ = 2 * Math.PI * r;
    return { x: (normAngle(s.target.angDeg) / 360) * circ, y: s.target.a - seg.a0 };
  }
  const face = faceById(t, s.target.faceId);
  if (!face) return { x: 0, y: 0 };
  return { x: s.target.fx + face.radius, y: s.target.fz + face.radius };
}

export function radiusAtSeg(seg: SegmentSpec, a: number): number {
  const f = seg.a1 === seg.a0 ? 0 : Math.min(1, Math.max(0, (a - seg.a0) / (seg.a1 - seg.a0)));
  return seg.r0 + (seg.r1 - seg.r0) * f;
}

/** Rotated footprint in unwrapped millimetres, shared by preview and export. */
export function stickerExtent(s: StickerInstance): { x: number; y: number } {
  const angle = s.rotDeg * Math.PI / 180;
  const c = Math.abs(Math.cos(angle)), n = Math.abs(Math.sin(angle));
  return { x: (s.w * c + s.h * n) / 2, y: (s.w * n + s.h * c) / 2 };
}

export function stickerOverlapsSegment(s: StickerInstance, seg: Pick<SegmentSpec, 'a0' | 'a1' | 'printEnabled'>): boolean {
  if (s.hidden || s.target.kind !== 'lathe' || !seg.printEnabled) return false;
  const extent = stickerExtent(s).y;
  return s.target.a + extent > seg.a0 && s.target.a - extent < seg.a1;
}

export interface SurfaceHit {
  /** 命中面所属段（或端面 id） */
  surfaceId: string;
  kind: 'lathe' | 'face';
  /** 命中点在画布坐标（mm）——旋转面画布宽取命中处周长 */
  x: number;
  y: number;
  /** 命中信息 */
  a?: number;
  angDeg?: number;
  fx?: number;
  fz?: number;
}

/** uv（旋转面）→ 表面画布坐标 */
export function latheUvToSurface(seg: SegmentSpec, u: number, v: number): SurfaceHit {
  const a = seg.a0 + v * (seg.a1 - seg.a0);
  const angDeg = u * 360;
  const r = radiusAtSeg(seg, a);
  const circ = 2 * Math.PI * r;
  return { surfaceId: seg.id, kind: 'lathe', x: (angDeg / 360) * circ, y: a - seg.a0, a, angDeg };
}

/** 端面 uv → 表面画布坐标 */
export function faceUvToSurface(face: { id: string; radius: number }, u: number, v: number): SurfaceHit {
  const fx = (u * 2 - 1) * face.radius;
  const fz = (v * 2 - 1) * face.radius;
  return { surfaceId: face.id, kind: 'face', x: fx + face.radius, y: fz + face.radius, fx, fz };
}

/** 表面画布点（mm，x 为环绕弧长）→ 环绕角 */
export function arcXToAng(x: number, r: number): number {
  return (x / (2 * Math.PI * r)) * 360;
}

/**
 * 命中点相对贴纸中心的画布坐标，经「逆自身旋转」得到贴纸局部坐标（mm）。
 * 与 drawSticker 的正变换互逆（矩阵约定与 Canvas 2D 一致，y 向下）。
 */
export function stickerLocalPoint(
  hitX: number,
  hitY: number,
  centerX: number,
  centerY: number,
  rotDeg: number
): { lx: number; ly: number } {
  const dx = hitX - centerX;
  const dy = hitY - centerY;
  const th = (-rotDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return { lx: dx * c - dy * s, ly: dx * s + dy * c };
}

/** 局部矩形包含测试（含跨接缝：任一侧复制均计入） */
export function pointInRect(lx: number, ly: number, w: number, h: number): boolean {
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

/** 跨接缝等效位移：把候选横向偏移展开为列表（0 与 ±画布宽） */
export function seamOffsets(x: number, canvasW: number): number[] {
  if (canvasW <= 0) return [0];
  const offs = [0];
  if (x < canvasW / 2) offs.push(canvasW);
  if (x > canvasW / 2) offs.push(-canvasW);
  return offs;
}

/** 从命中点自上而下找被点中的贴纸（透明像素不遮挡，plan.md §3.4） */
export function pickSticker(
  hits: SurfaceHit[],
  stickers: StickerInstance[],
  t: CueTemplate,
  alphaAt: (s: StickerInstance, lx: number, ly: number) => number | null
): StickerInstance | null {
  const sorted = [...stickers].filter((s) => !s.hidden).sort((a, b) => b.z - a.z);
  for (const hit of hits) {
    for (const s of sorted) {
      if (s.target.kind !== hit.kind) continue;
      if (hit.kind === 'lathe' && s.target.kind === 'lathe') {
        const surface = segmentById(t, hit.surfaceId);
        if (!segmentById(t, s.target.segId)?.printEnabled) continue;
        if (!surface || !stickerOverlapsSegment(s, surface)) continue;
      }
      if (hit.kind === 'face' && s.target.kind === 'face') {
        if (s.target.faceId !== hit.surfaceId) continue;
      }
      const c = stickerCanvasCenter(s, t);
      let lx: number, ly: number;
      if (hit.kind === 'lathe' && s.target.kind === 'lathe') {
        // 弧长差取最短方向（跨接缝）
        const seg = segmentById(t, s.target.segId)!;
        const r = radiusAtSeg(seg, s.target.a);
        const dAng = angDelta(hit.angDeg!, s.target.angDeg);
        lx = (dAng / 360) * 2 * Math.PI * r;
        ly = hit.a! - s.target.a;
      } else if (hit.kind === 'face' && s.target.kind === 'face') {
        lx = hit.x - c.x;
        ly = hit.y - c.y;
      } else {
        continue;
      }
      const local = stickerLocalPoint(lx, ly, 0, 0, s.rotDeg);
      if (!pointInRect(local.lx, local.ly, s.w, s.h)) continue;
      const a = alphaAt(s, (s.flipX ? -local.lx : local.lx) + s.w / 2, (s.flipY ? -local.ly : local.ly) + s.h / 2);
      if (a === null || a > 0.08) return s;
    }
  }
  return null;
}

/** 拖动贴纸：把命中面坐标换算为新的贴纸中心（保持抓取偏移；允许跨连续旋转面） */
export function moveStickerTo(
  s: StickerInstance,
  hit: SurfaceHit,
  grabOffset: { dx: number; dy: number },
  t: CueTemplate
): StickerInstance | null {
  if (s.target.kind === 'lathe' && hit.kind === 'lathe') {
    const origSeg = segmentById(t, s.target.segId);
    const grabAng = origSeg ? arcXToAng(grabOffset.dx, radiusAtSeg(origSeg, s.target.a)) : 0;
    const seg = segmentById(t, hit.surfaceId);
    if (!seg) return null;
    const printable = expandedSegments(t).filter((part) => part.printEnabled);
    const newA = Math.min(Math.max(...printable.map((part) => part.a1)), Math.max(Math.min(...printable.map((part) => part.a0)), (hit.a ?? s.target.a) - grabOffset.dy));
    const newAng = normAngle((hit.angDeg ?? 0) - grabAng);
    return { ...s, target: { kind: 'lathe', segId: s.target.segId, a: newA, angDeg: newAng } };
  }
  if (s.target.kind === 'face' && hit.kind === 'face') {
    return {
      ...s,
      target: { ...s.target, fx: (hit.fx ?? 0) - grabOffset.dx, fz: (hit.fz ?? 0) - grabOffset.dy }
    };
  }
  return null;
}

/** 展开连续贴纸坐标的轴向范围（供夹取与检查） */
export function stickerAxialRange(s: StickerInstance, t: CueTemplate): { a0: number; a1: number } {
  if (s.target.kind === 'lathe') {
    const seg = segmentById(t, s.target.segId)!;
    return { a0: seg.a0, a1: seg.a1 };
  }
  const f = faceById(t, s.target.faceId)!;
  return { a0: f.a, a1: f.a };
}

export function allSegments(t: CueTemplate) {
  return expandedSegments(t);
}

/** 贴纸目标部件查找（供 UI 面板，类型安全收窄） */
export function latheSegOfSticker(s: StickerInstance, t: CueTemplate): SegmentSpec | null {
  if (s.target.kind !== 'lathe') return null;
  return segmentById(t, s.target.segId) ?? null;
}

export function faceOfSticker(s: StickerInstance, t: CueTemplate): FaceSpec | null {
  if (s.target.kind !== 'face') return null;
  return faceById(t, s.target.faceId) ?? null;
}
