import assert from 'node:assert/strict'
import test from 'node:test'
import { colorOverlayFragment, colorOverlayUniforms, setColorOverlayUniform } from '../../src/cue-engine/materials/colorOverlay.js'
import { assignStickerStackOrder, moveStickerInOrder } from '../../src/cue-engine/state/stickerOrder.js'
import { withWrapColor, withWrapSticker } from '../../src/cue-engine/state/wrapAppearance.js'
import { stickerPaintOrder } from '../../src/cue-engine/stickers/paintOrder.js'

function sticker(id, assetId, segId, z) {
  return {
    id, name: id, assetId,
    target: { kind: 'lathe', segId, a: 40, angDeg: 0 },
    w: 30, h: 80, rotDeg: 0, flipX: false, flipY: false,
    opacity: 1, z, hidden: false, locked: false
  }
}

test('应用包裹颜色移除该部位的包裹贴图并保留普通花纹', () => {
  const design = {
    name: '测试设计', cueTemplateId: 'nineball', globalFinish: 'gloss',
    partOverrides: { grip: { matPreset: 'leather' } },
    stickers: [sticker('wrap-grip', 'wrap-1', 'grip', 2), sticker('pattern-grip', 'pattern-1', 'grip', 1), sticker('wrap-shaft', 'wrap-1', 'shaft', 3)]
  }
  const result = withWrapColor(design, 'grip', '#22aa88', 0.4, [
    { id: 'wrap-1', kind: 'wrap' }, { id: 'pattern-1', kind: 'pattern' }
  ])

  assert.deepEqual(result.removedIds, ['wrap-grip'])
  assert.deepEqual(result.design.stickers.map((item) => item.id), ['pattern-grip', 'wrap-shaft'])
  assert.deepEqual(result.design.partOverrides.grip, { matPreset: 'leather', color: '#22aa88', colorOpacity: 0.4 })
})

test('应用包裹贴图清除纯色并替换旧包裹，普通花纹仍保留', () => {
  const design = {
    name: '测试设计', cueTemplateId: 'nineball', globalFinish: 'gloss',
    partOverrides: { grip: { color: '#bb5533', colorOpacity: 0.25 } },
    stickers: [sticker('old-wrap', 'wrap-1', 'grip', 1), sticker('pattern-grip', 'pattern-1', 'grip', 2)]
  }
  const nextWrap = sticker('new-wrap', 'wrap-2', 'grip', 3)
  const result = withWrapSticker(design, 'grip', nextWrap, [
    { id: 'wrap-1', kind: 'wrap' }, { id: 'wrap-2', kind: 'wrap' }, { id: 'pattern-1', kind: 'pattern' }
  ])

  assert.deepEqual(result.removedIds, ['old-wrap'])
  assert.equal(result.design.partOverrides.grip, undefined)
  assert.deepEqual(result.design.stickers.map((item) => item.id), ['pattern-grip', 'new-wrap'])
})

test('图层拖放重排显示顺序并将较高图层最后绘制', () => {
  const initialOrder = ['front', 'middle', 'back']
  const movedOrder = moveStickerInOrder(initialOrder, 'front', 'back', 'after')
  assert.deepEqual(movedOrder, ['middle', 'back', 'front'])

  const stickers = [sticker('front', 'p1', 'grip', 3), sticker('middle', 'p2', 'grip', 2), sticker('back', 'p3', 'grip', 1)]
  const reordered = assignStickerStackOrder(stickers, movedOrder)
  assert.deepEqual(reordered.slice().sort((a, b) => b.z - a.z).map((item) => item.id), movedOrder)
  assert.deepEqual(stickerPaintOrder(reordered).map((item) => item.id), ['front', 'back', 'middle'])
})

test('透明度 0 不覆盖底材，100% 颜色覆盖先于花纹印刷', () => {
  const shader = { uniforms: {} }
  const colorUniform = { value: { value: '', set(value) { this.value = value } } }
  const opacityUniform = { value: 0 }
  colorOverlayUniforms(shader, colorUniform, opacityUniform)
  setColorOverlayUniform(shader.uniforms.wrapColor, shader.uniforms.wrapColorOpacity, '#ff0000', 0)
  assert.equal(shader.uniforms.wrapColorOpacity.value, 0)
  setColorOverlayUniform(shader.uniforms.wrapColor, shader.uniforms.wrapColorOpacity, '#ff0000', 1)
  assert.equal(shader.uniforms.wrapColorOpacity.value, 1)
  assert.equal(shader.uniforms.wrapColor.value.value, '#ff0000')

  const fragment = colorOverlayFragment('#include <common>\n#include <map_fragment>', 'PRINT_MIX')
  const colorMix = fragment.indexOf('diffuseColor.rgb = mix(diffuseColor.rgb, wrapColor, wrapColorOpacity)')
  const printMix = fragment.indexOf('PRINT_MIX')
  assert.ok(colorMix >= 0 && printMix > colorMix)
})
