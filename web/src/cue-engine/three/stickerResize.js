/** 按屏幕拖拽比例缩放纹样，并保持被拖角的对角锚点固定。 */
export function resizeStickerFromCorner(target, startW, startH, rotDeg, corner, w, h, radius = 1) {
  const signX = corner === 0 || corner === 3 ? -1 : 1
  const signY = corner < 2 ? 1 : -1
  const theta = (rotDeg * Math.PI) / 180
  const localX = signX * (w - startW) / 2
  const localY = signY * (h - startH) / 2
  const offsetX = localX * Math.cos(theta) - localY * Math.sin(theta)
  const offsetY = localX * Math.sin(theta) + localY * Math.cos(theta)
  const nextTarget = target.kind === 'lathe'
    ? { ...target, a: target.a + offsetY, angDeg: target.angDeg + offsetX / (2 * Math.PI * radius) * 360 }
    : { ...target, fx: target.fx + offsetX, fz: target.fz + offsetY }
  return { w, h, target: nextTarget }
}
