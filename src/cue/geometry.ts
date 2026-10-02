import * as THREE from 'three';
import type { CueTemplate, SegmentSpec, FaceSpec } from '../core/types';
import { expandedSegments } from './templates';

// 参数化旋转体白模（plan.md §2.3）：按杆身剖面分段建立，每段独立部件、独立 UV。
// 坐标约定：杆轴沿 X，x = a - L/2（a 为距杆头 mm）；环绕角 ang=0 指向 +Y，
// u = ang/2π；段内 v = 0 在杆头一侧。端面用圆盘扇面，u/v 由面内毫米坐标导出。

export function lathePoint(seg: SegmentSpec, a: number, ang: number): THREE.Vector3 {
  const f = seg.a1 === seg.a0 ? 0 : (a - seg.a0) / (seg.a1 - seg.a0);
  const r = seg.r0 + (seg.r1 - seg.r0) * f;
  return new THREE.Vector3(a, r * Math.cos(ang), r * Math.sin(ang));
}

export function surfaceNormal(seg: SegmentSpec, a: number, ang: number): THREE.Vector3 {
  const dr = (seg.r1 - seg.r0) / Math.max(1e-6, seg.a1 - seg.a0);
  const f = seg.a1 === seg.a0 ? 0 : (a - seg.a0) / (seg.a1 - seg.a0);
  const r = seg.r0 + (seg.r1 - seg.r0) * f;
  const n = new THREE.Vector3(-r * dr, Math.cos(ang), Math.sin(ang));
  return n.normalize();
}

/** 建立一个旋转体部件的 BufferGeometry（含法线与 uv） */
export function buildSegmentGeometry(seg: SegmentSpec): THREE.BufferGeometry {
  const len = seg.a1 - seg.a0;
  const nA = Math.max(2, Math.ceil(len / 8) + 1);
  const nR = seg.kind === 'ring' ? 64 : 96;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];

  for (let i = 0; i <= nA; i++) {
    const f = i / nA;
    const a = seg.a0 + f * len;
    const r = seg.r0 + (seg.r1 - seg.r0) * f;
    const dr = (seg.r1 - seg.r0) / Math.max(1e-6, len);
    for (let j = 0; j <= nR; j++) {
      const u = j / nR;
      const ang = u * Math.PI * 2;
      positions.push(a, r * Math.cos(ang), r * Math.sin(ang));
      const n = new THREE.Vector3(-r * dr, Math.cos(ang), Math.sin(ang)).normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push(u, f);
    }
  }
  const row = nR + 1;
  for (let i = 0; i < nA; i++) {
    for (let j = 0; j < nR; j++) {
      const i0 = i * row + j;
      // 绕序保证外法线朝外（正面朝外可见、射线可命中）
      index.push(i0, i0 + 1, i0 + row, i0 + 1, i0 + row + 1, i0 + row);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

/** 端面圆盘：x 固定于 a，面内坐标 (fy, fz) mm，u = (fy/r+1)/2，v = (fz/r+1)/2 */
export function buildFaceGeometry(face: FaceSpec): THREE.BufferGeometry {
  const n = 64;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  positions.push(face.a, 0, 0);
  normals.push(face.normalSign, 0, 0);
  uvs.push(0.5, 0.5);
  for (let j = 0; j <= n; j++) {
    const ang = (j / n) * Math.PI * 2;
    const fy = face.radius * Math.cos(ang);
    const fz = face.radius * Math.sin(ang);
    positions.push(face.a, fy, fz);
    normals.push(face.normalSign, 0, 0);
    uvs.push((fy / face.radius + 1) / 2, (fz / face.radius + 1) / 2);
  }
  for (let j = 0; j < n; j++) {
    // 依据法线方向决定绕序，保证正面朝外
    if (face.normalSign > 0) index.push(0, j + 1, j + 2);
    else index.push(0, j + 2, j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

export interface CueParts {
  /** 旋转体部件 */
  segments: SegmentSpec[];
  faces: FaceSpec[];
}

export function cueParts(t: CueTemplate): CueParts {
  return { segments: expandedSegments(t), faces: t.faces };
}

/** 部件在场景中的分组位移：整体居中于原点 */
export const axialToX = (totalLen: number, a: number) => a - totalLen / 2;
