import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { watchCueOrientation } from '../../src/cue-engine/three/watchSpin.ts'
import { patternSurfaceSize } from '../../src/cue-engine/stickers/patternPlacement.ts'

const cameraDirection = new THREE.Vector3(0.38, 0.34, 0.86).normalize()
const screenRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), cameraDirection).normalize()
const screenUp = new THREE.Vector3().crossVectors(cameraDirection, screenRight).normalize()

test('观看旋转保持杆头在上、杆尾在下，中心固定且先向相反深度运动', () => {
  const tip = new THREE.Vector3(-1, 0, 0)
  const butt = new THREE.Vector3(1, 0, 0)
  const initial = watchCueOrientation(0)
  const initialTip = tip.clone().applyQuaternion(initial)
  const initialButt = butt.clone().applyQuaternion(initial)
  assert.ok(initialTip.dot(screenRight) < 0, '初始杆头在屏幕左侧')
  assert.ok(initialTip.dot(screenUp) > 0, '初始杆头在屏幕上方')
  assert.ok(initialButt.dot(screenRight) > 0, '初始杆尾在屏幕右侧')
  assert.ok(initialButt.dot(screenUp) < 0, '初始杆尾在屏幕下方')

  for (let step = 0; step < 72; step++) {
    const orientation = watchCueOrientation(step * Math.PI * 2 / 72)
    const movedTip = tip.clone().applyQuaternion(orientation)
    const movedButt = butt.clone().applyQuaternion(orientation)
    assert.ok(movedTip.dot(screenUp) > 0, `第 ${step} 帧杆头仍在上方`)
    assert.ok(movedButt.dot(screenUp) < 0, `第 ${step} 帧杆尾仍在下方`)
    assert.ok(movedTip.clone().add(movedButt).length() < 1e-10, '中点不移动')
  }

  const advanced = watchCueOrientation(0.1)
  assert.ok(tip.clone().applyQuaternion(advanced).dot(cameraDirection) < initialTip.dot(cameraDirection), '杆头先进入屏幕')
  assert.ok(butt.clone().applyQuaternion(advanced).dot(cameraDirection) > initialButt.dot(cameraDirection), '杆尾先朝屏幕外')
})

test('选中花纹初次应用时覆盖整个圆柱部位的展开面和端面', () => {
  assert.deepEqual(patternSurfaceSize({ kind: 'lathe', width: 70, height: 384 }), { width: 70, height: 384 })
  assert.deepEqual(patternSurfaceSize({ kind: 'face', width: 28, height: 28 }), { width: 28, height: 28 })
})
