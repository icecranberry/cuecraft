import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildDisplayFaceGeometry, buildDisplaySegmentGeometry, bumperSurfaceFrame } from '../cue/displayGeometry';
import { expandedSegments, resolveTemplate } from '../cue/templates';

describe('manufactured display surfaces', () => {
  const template = resolveTemplate('nineball');
  it('keeps edge breaks inside production dimensions and uses axial millimetre UVs', () => {
    for (const segment of expandedSegments(template)) {
      const geometry = buildDisplaySegmentGeometry(segment);
      const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), n = geometry.getAttribute('normal');
      for (let i = 0; i < p.count; i++) {
        expect(p.getX(i)).toBeGreaterThanOrEqual(segment.a0 - 0.0001);
        expect(p.getX(i)).toBeLessThanOrEqual(segment.a1 + 0.0001);
        expect(uv.getY(i)).toBeCloseTo((p.getX(i) - segment.a0) / (segment.a1 - segment.a0), 4);
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
      }
      geometry.dispose();
    }
  });
  it('meets the tip side at the crown edge while preserving the original apex', () => {
    const geometry = buildDisplayFaceGeometry(template.faces.find((face) => face.id === 'face-tip')!);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.x).toBeCloseTo(0);
    expect(geometry.boundingBox!.max.x).toBeCloseTo(0.8);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(6.5);
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), index = geometry.index!;
    const vertex = (i: number) => new Vector3().fromBufferAttribute(p, index.getX(i));
    const a = vertex(600), b = vertex(601), c = vertex(602);
    const outward = new Vector3().fromBufferAttribute(n, index.getX(600));
    expect(b.sub(a).cross(c.sub(a)).dot(outward)).toBeGreaterThan(0);
    geometry.dispose();
  });
  it('joins the barrel with an outward-facing, smooth hemisphere without changing the print template', () => {
    const face = template.faces.find((part) => part.id === 'face-butt')!;
    const geometry = buildDisplayFaceGeometry(face);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.x).toBeCloseTo(template.lengthMm, 3);
    expect(geometry.boundingBox!.max.x).toBeCloseTo(template.lengthMm + face.radius, 3);
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv'), index = geometry.index!;
    for (let i = 0; i < p.count; i++) {
      expect(Math.hypot(p.getX(i) - face.a, p.getY(i), p.getZ(i))).toBeCloseTo(face.radius, 3);
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
      expect(uv.getX(i)).toBeCloseTo((p.getY(i) / face.radius + 1) / 2, 5);
      expect(uv.getY(i)).toBeCloseTo((p.getZ(i) / face.radius + 1) / 2, 5);
    }
    for (let i = 0; i < index.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(p, index.getX(i));
      const b = new Vector3().fromBufferAttribute(p, index.getX(i + 1));
      const c = new Vector3().fromBufferAttribute(p, index.getX(i + 2));
      expect(b.sub(a).cross(c.sub(a)).dot(new Vector3().fromBufferAttribute(n, index.getX(i)))).toBeGreaterThan(0);
    }
    expect(face.a).toBe(template.lengthMm);
    for (const [y, z] of [[0, 0], [8, 3], [face.radius, 0]]) {
      const frame = bumperSurfaceFrame(face, y, z);
      expect(frame.position.clone().sub(new Vector3(face.a, 0, 0)).length()).toBeCloseTo(face.radius);
      expect(new Vector3(0, 0, 1).applyQuaternion(frame.quaternion).distanceTo(frame.normal)).toBeLessThan(1e-6);
    }
    geometry.dispose();
  });
});
