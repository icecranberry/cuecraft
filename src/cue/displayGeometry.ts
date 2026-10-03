import * as THREE from 'three';
import type { SegmentSpec, FaceSpec } from '../core/types';
import { buildSegmentGeometry, buildFaceGeometry } from './geometry';

export function bumperSurfaceFrame(face: FaceSpec, y: number, z: number) {
  const depth = Math.sqrt(Math.max(0, face.radius ** 2 - y ** 2 - z ** 2));
  const normal = new THREE.Vector3(depth, y, z).normalize();
  let across = new THREE.Vector3(0, 1, 0).addScaledVector(normal, -normal.y);
  if (across.lengthSq() < 1e-8) across = new THREE.Vector3(0, 0, 1).addScaledVector(normal, -normal.z);
  across.normalize();
  return { position: new THREE.Vector3(face.a + depth, y, z), quaternion: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, normal.clone().cross(across), normal)), normal };
}

/** Small manufactured edge breaks for the display mesh only. Print dimensions stay canonical. */
export function buildDisplaySegmentGeometry(seg: SegmentSpec): THREE.BufferGeometry {
  if (seg.kind === 'tip') {
    const geometry = buildSegmentGeometry(seg);
    const positions = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) if (positions.getX(i) === seg.a0) {
      positions.setX(i, seg.a0 + 0.8);
      uv.setY(i, 0.8 / (seg.a1 - seg.a0));
    }
    return geometry;
  }
  if (!['ring', 'joint', 'endcap'].includes(seg.kind)) return buildSegmentGeometry(seg);
  const len = seg.a1 - seg.a0;
  const bevel = Math.min(0.16, len / 5);
  const axial = [0, bevel / 2, bevel, len - bevel, len - bevel / 2, len];
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const count = 96;
  const taper = (seg.r1 - seg.r0) / len;
  for (const a of axial) {
    const edgeDistance = Math.min(a, len - a);
    const angle = Math.min(1, edgeDistance / bevel) * Math.PI / 2;
    const inset = bevel * (1 - Math.sin(angle));
    const slope = taper + (edgeDistance < bevel ? Math.cos(angle) * Math.PI / 2 * (a < len / 2 ? 1 : -1) : 0);
    const radius = seg.r0 + taper * a - inset;
    for (let j = 0; j <= count; j++) {
      const theta = j / count * Math.PI * 2;
      positions.push(seg.a0 + a, radius * Math.cos(theta), radius * Math.sin(theta));
      const normal = new THREE.Vector3(-slope, Math.cos(theta), Math.sin(theta)).normalize();
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(j / count, a / len);
    }
  }
  for (let i = 0; i < axial.length - 1; i++) for (let j = 0; j < count; j++) {
    const k = i * (count + 1) + j;
    indices.push(k, k + 1, k + count + 1, k + 1, k + count + 2, k + count + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** A shallow dressed leather crown, entirely inside the existing tip envelope. */
export function buildDisplayFaceGeometry(face: FaceSpec): THREE.BufferGeometry {
  if (face.id === 'face-butt') return buildButtBumperGeometry(face);
  if (face.id !== 'face-tip') return buildFaceGeometry(face);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const rings = 16, count = 96, depth = 0.8;
  for (let i = 0; i <= rings; i++) for (let j = 0; j <= count; j++) {
    const radius = face.radius * i / rings, angle = j / count * Math.PI * 2;
    const y = radius * Math.cos(angle), z = radius * Math.sin(angle);
    positions.push(face.a + depth * (radius / face.radius) ** 2, y, z);
    const normal = new THREE.Vector3(-1, 2 * depth * y / face.radius ** 2, 2 * depth * z / face.radius ** 2).normalize();
    normals.push(normal.x, normal.y, normal.z);
    uvs.push((y / face.radius + 1) / 2, (z / face.radius + 1) / 2);
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < count; j++) {
    const k = i * (count + 1) + j;
    indices.push(k, k + 1, k + count + 1, k + 1, k + count + 2, k + count + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Separate hemispherical bumper; the printed barrel keeps its original millimetre dimensions. */
function buildButtBumperGeometry(face: FaceSpec): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const continuationUvs: number[] = [];
  const rings = 32, count = 96;
  for (let i = 0; i <= rings; i++) {
    const theta = i / rings * Math.PI / 2;
    const axial = Math.cos(theta), radial = Math.sin(theta);
    for (let j = 0; j <= count; j++) {
      const angle = j / count * Math.PI * 2;
      const y = radial * Math.cos(angle), z = radial * Math.sin(angle);
      positions.push(face.a + face.radius * axial, face.radius * y, face.radius * z);
      normals.push(axial, y, z);
      // Keep the end-face artwork's existing projected disc coordinates.
      uvs.push((y + 1) / 2, (z + 1) / 2);
      continuationUvs.push(j / count, 1 - i / rings);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < count; j++) {
    const k = i * (count + 1) + j;
    if (i > 0) indices.push(k, k + count + 1, k + 1);
    indices.push(k + 1, k + count + 1, k + count + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('uvTail', new THREE.Float32BufferAttribute(continuationUvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
