import type { CueTemplate, SegmentSpec } from '../core/types';

/** Unwrapped continuation measured along the hemisphere, starting at the barrel edge. */
export function tailPrintSegment(template: CueTemplate): SegmentSpec | null {
  const barrel = template.segments.find((part) => part.id === 'butt-cap');
  const face = template.faces.find((part) => part.id === 'face-butt');
  if (!barrel || !face) return null;
  return { ...barrel, a0: face.a, a1: face.a + face.radius * Math.PI / 2, r0: face.radius, r1: face.radius };
}
