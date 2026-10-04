<template>
  <canvas ref="canvas" class="cue-model-preview" :class="{ 'is-interactive': interactive }" />
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import { buildFaceGeometry, buildSegmentGeometry } from '@/cue-engine/cue/geometry'
import { partAppearance } from '@/cue-engine/cue/partAppearance'
import { expandedSegments, resolveTemplate } from '@/cue-engine/cue/templates'
import { composeFacePrint, composeSegmentPrint, canvasToTexture, getCachedStickerImage, getStickerImage } from '@/cue-engine/stickers/composite'
import { stickerOverlapsSegment } from '@/cue-engine/cue/mapping'
import { presetById } from '@/cue-engine/materials/presets'
import { createCueMaterial } from '@/cue-engine/materials/factory'
import { previewPrintResolution } from '@/cue-engine/stickers/previewResolution'

const props = defineProps({
  asset: { type: Object, required: true },
  interactive: { type: Boolean, default: false },
  autoRotate: { type: Boolean, default: false }
})

const canvas = ref(null)
let renderer
let scene
let camera
let controls
let resizeObserver
let frameId
let model
let buildSequence = 0

function disposeModel() {
  if (!model) return
  scene?.remove(model)
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    object.userData.materialHandle?.dispose()
    object.userData.printTexture?.dispose()
  })
  model = null
}

async function loadPrintableStickers(stickers) {
  const printable = []
  for (const sticker of stickers.filter((item) => !item.hidden)) {
    try {
      if (await getStickerImage(sticker)) {
        printable.push(sticker)
        continue
      }
      // A processed cutout can be browser-local; keep the saved placement and
      // use the original shared asset when that local derivative is missing.
      if (sticker.processedKey) {
        const original = { ...sticker, processedKey: undefined }
        if (await getStickerImage(original)) printable.push(original)
      }
    } catch {
      // Missing optional image data should not hide the cue model itself.
    }
  }
  return printable
}

function createPartMaterial(template, id, segment, specification, totalLength, surface = 'lathe') {
  const appearance = partAppearance(template, id, specification.part_overrides || {})
  const override = appearance.override || {}
  const finishId = override.finish || specification.global_finish || 'gloss'
  const presetId = override.matPreset || segment?.matPreset || 'maple'
  return createCueMaterial({
    preset: presetById(presetId),
    finishId,
    colorOverride: override.color,
    colorOpacity: override.colorOpacity,
    circMm: surface === 'face' ? (segment.radius * 2) : Math.PI * (segment.r0 + segment.r1),
    lenMm: surface === 'face' ? (segment.radius * 2) : segment.a1 - segment.a0,
    axialOriginMm: segment.a0,
    surface,
    partKind: segment.kind || (id === 'face-butt' ? 'butt' : undefined)
  })
}

async function rebuildModel() {
  if (!scene) return
  const sequence = ++buildSequence
  disposeModel()

  const specification = props.asset.specification || {}
  let template = specification.cue_template
  if (!template) {
    try { template = resolveTemplate(specification.cue_template_id || 'nineball') }
    catch { template = resolveTemplate('nineball') }
  }
  const segments = (specification.segments?.length ? specification.segments : expandedSegments(template))
    .map((part) => ({ ...part }))
  if (specification.cue_template_id === 'nineball' && Number(segments[0]?.a0) > 0) {
    segments.unshift(
      { id: 'tip', name: '皮头', kind: 'tip', a0: 0, a1: 5, r0: 6.5, r1: 6.5, matPreset: 'tipLeather', printEnabled: false },
      { id: 'ferrule', name: '先角', kind: 'ring', a0: 5, a1: 29, r0: 6.5, r1: 6.5, matPreset: 'ivory', printEnabled: true }
    )
  }
  const totalLength = Number(specification.length_mm || template.lengthMm || segments.at(-1)?.a1) || 1474
  const stickers = await loadPrintableStickers(specification.stickers || [])
  if (sequence !== buildSequence) return

  model = new THREE.Group()
  const partTemplate = { ...template, segments, faces: specification.faces?.length ? specification.faces : (template.faces || []) }
  for (const segment of segments) {
    if (!(segment.a1 > segment.a0) || !(segment.r0 > 0) || !(segment.r1 > 0)) continue
    const geometry = buildSegmentGeometry(segment)
    geometry.translate(-totalLength / 2, 0, 0)
    const handle = createPartMaterial(partTemplate, segment.id, segment, specification)
    const mesh = new THREE.Mesh(geometry, handle.material)
    mesh.userData.materialHandle = handle
    model.add(mesh)

    const placed = stickers.filter((sticker) => sticker.target.kind === 'lathe' && stickerOverlapsSegment(sticker, segment))
    if (!segment.printEnabled || !placed.length) continue
    const { ppm, maxDim } = previewPrintResolution(
      Math.PI * (segment.r0 + segment.r1), segment.a1 - segment.a0,
      placed,
      (sticker) => {
        const image = getCachedStickerImage(sticker)
        return image ? { w: image.w, h: image.h } : null
      },
      'balanced', props.interactive, renderer.capabilities.maxTextureSize
    )
    const print = composeSegmentPrint(segment, placed, ppm, maxDim, segments)
    if (sequence !== buildSequence) return
    const texture = canvasToTexture(print.canvas, renderer.capabilities.getMaxAnisotropy())
    handle.setPrintMap(texture)
    mesh.userData.printTexture = texture
  }

  for (const face of partTemplate.faces) {
    const geometry = buildFaceGeometry(face)
    geometry.translate(-totalLength / 2, 0, 0)
    const handle = createPartMaterial(partTemplate, face.id, face, specification, totalLength, 'face')
    const mesh = new THREE.Mesh(geometry, handle.material)
    mesh.userData.materialHandle = handle
    model.add(mesh)

    const placed = stickers.filter((sticker) => sticker.target.kind === 'face' && sticker.target.faceId === face.id)
    if (!placed.length) continue
    const print = composeFacePrint(face, placed, 16, Math.min(4096, renderer.capabilities.maxTextureSize))
    if (sequence !== buildSequence) return
    const texture = canvasToTexture(print.canvas, renderer.capabilities.getMaxAnisotropy())
    handle.setPrintMap(texture)
    mesh.userData.printTexture = texture
  }
  scene.add(model)
}

function resize() {
  if (!canvas.value || !renderer || !camera) return
  const width = Math.max(1, canvas.value.clientWidth)
  const height = Math.max(1, canvas.value.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function render() {
  if (!renderer || !scene || !camera) return
  controls?.update()
  renderer.render(scene, camera)
  frameId = requestAnimationFrame(render)
}

onMounted(() => {
  if (!canvas.value) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#e8eae2')
  camera = new THREE.PerspectiveCamera(32, 1, 1, 8000)
  camera.position.set(60, 260, 1800)
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(1, 1, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  scene.add(new THREE.HemisphereLight(0xf6f5ed, 0x59544c, 2.2))
  const key = new THREE.DirectionalLight(0xffffff, 3)
  key.position.set(250, 500, 700)
  scene.add(key)
  void rebuildModel()
  if (props.interactive) {
    controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0, 0)
    controls.enableDamping = true
    controls.autoRotate = props.autoRotate
    controls.autoRotateSpeed = 0.7
  }
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas.value)
  resize()
  render()
})

watch(() => props.asset, () => { void rebuildModel() }, { deep: true })
watch(() => props.autoRotate, (value) => { if (controls) controls.autoRotate = value })

onBeforeUnmount(() => {
  buildSequence += 1
  cancelAnimationFrame(frameId)
  resizeObserver?.disconnect()
  controls?.dispose()
  disposeModel()
  renderer?.dispose()
})
</script>

<style scoped>
.cue-model-preview { display: block; width: 100%; height: 100%; min-height: 110px; border-radius: 10px; background: #e8eae2; }
.cue-model-preview.is-interactive { cursor: grab; }
.cue-model-preview.is-interactive:active { cursor: grabbing; }
</style>
