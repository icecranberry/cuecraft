import assert from 'node:assert/strict'
import test from 'node:test'
import { propertyPartAfterSelection, stickerSelectionState } from '../../src/cue-engine/state/stickerSelection.js'
import { resizeStickerFromCorner } from '../../src/cue-engine/three/stickerResize.js'

test('选择纹样保留相机与当前部件', () => {
  const current = { view: 'focus', focusPartId: 'butt-forearm', viewNonce: 4 }
  assert.deepEqual(stickerSelectionState(current, 'sticker-1'), {
    selection: { kind: 'sticker', id: 'sticker-1' },
    view: 'focus', focusPartId: 'butt-forearm', viewNonce: 4
  })
  assert.equal(propertyPartAfterSelection('butt-forearm', { kind: 'sticker', id: 'sticker-1' }), 'butt-forearm')
  assert.equal(propertyPartAfterSelection('butt-forearm', { kind: 'part', id: 'shaft' }), 'shaft')
})

test('从四个角放大都沿各自的对角锚点移动花纹中心', () => {
  const expectedOffsets = [[-10, 5], [10, 5], [10, -5], [-10, -5]]
  expectedOffsets.forEach(([fx, fz], corner) => {
    const result = resizeStickerFromCorner(
      { kind: 'face', faceId: 'face-tip', fx: 0, fz: 0 }, 100, 50, 0, corner, 120, 60
    )
    assert.deepEqual(result, {
      w: 120,
      h: 60,
      target: { kind: 'face', faceId: 'face-tip', fx, fz }
    }, `corner ${corner}`)
  })
})

test('旋转后的圆柱部位缩放保持对角锚点并更新轴向坐标', () => {
  const result = resizeStickerFromCorner(
    { kind: 'lathe', segId: 'butt', a: 700, angDeg: 0 }, 100, 50, 90, 0, 120, 60, 10
  )
  assert.equal(result.w, 120)
  assert.equal(result.h, 60)
  assert.equal(result.target.a, 690)
  assert.ok(Math.abs(result.target.angDeg + 28.6479) < 0.001)
})
