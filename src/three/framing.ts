/** 小部件聚焦沿用九球杆皮革握把的观察范围（202mm × 2.2）。 */
export const MIN_FOCUS_SPAN_MM = 202 * 2.2;

export function partFocusDistance(spanMm: number, aspect: number, fovDeg = 30): number {
  const span = Math.max(MIN_FOCUS_SPAN_MM, spanMm);
  const tanH = Math.tan(fovDeg * Math.PI / 360);
  return Math.min(3200, Math.max(120, span / (2 * tanH * Math.max(0.8, aspect))));
}
