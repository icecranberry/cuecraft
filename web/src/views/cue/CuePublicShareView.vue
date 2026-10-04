<template>
  <main class="cue-public-page">
    <header class="cue-public-header">
      <div><strong>{{ shared?.name || '球杆作品' }}</strong><span v-if="shared">版本 {{ shared.version }} · Yuxi 球杆设计</span></div>
      <a-segmented v-if="shared" v-model:value="frame" :options="frames" @change="engine?.setView($event)" />
    </header>
    <div v-if="error" class="cue-public-error"><h1>无法打开球杆作品</h1><p>{{ error }}</p></div>
    <div v-else class="cue-public-body">
      <section class="cue-public-stage" aria-label="球杆三维预览">
        <div ref="canvasEl" class="cue-public-canvas"></div>
        <a-spin v-if="!ready" class="cue-public-spinner" tip="正在载入球杆…" />
      </section>
      <aside v-if="shared" class="cue-public-specs">
        <h1>规格信息</h1>
        <p class="cue-public-version">固定作品版本 {{ shared.version }}</p>
        <dl>
          <div v-if="shared.specification.source_sku"><dt>来源 SKU</dt><dd>{{ shared.specification.source_sku }}</dd></div>
          <div v-if="template.name"><dt>杆型</dt><dd>{{ template.name }}</dd></div>
          <div v-if="template.lengthMm"><dt>总长</dt><dd>{{ template.lengthMm }} mm</dd></div>
          <div v-if="template.shaftLengthMm"><dt>前支长度</dt><dd>{{ template.shaftLengthMm }} mm</dd></div>
          <div v-if="template.buttLengthMm"><dt>后把长度</dt><dd>{{ template.buttLengthMm }} mm</dd></div>
          <div v-if="template.tipDiameterMm"><dt>皮头直径</dt><dd>{{ template.tipDiameterMm }} mm</dd></div>
          <div v-if="template.jointDiameterMm"><dt>接头直径</dt><dd>{{ template.jointDiameterMm }} mm</dd></div>
          <div v-if="template.buttDiameterMm"><dt>后把直径</dt><dd>{{ template.buttDiameterMm }} mm</dd></div>
          <div v-if="shared.specification.sku_specification.material"><dt>材质</dt><dd>{{ shared.specification.sku_specification.material }}</dd></div>
        </dl>
        <section v-if="parts.length" class="cue-public-parts">
          <h2>部件</h2>
          <div v-for="part in parts" :key="part.id"><span>{{ part.name }}</span><span>{{ part.a1 - part.a0 }} mm</span></div>
        </section>
        <p class="cue-public-note">此规格来自分享时的作品版本；量产前请与厂家技术资料核对。</p>
      </aside>
    </div>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fetchCuePublicShareAsset, getCuePublicShare } from '@/apis/cue_api'
import { BUILTIN_ASSETS, builtinPatternUrl } from '@/cue-engine/materials/patterns'
import { mountCueCanvas } from '@/cue-engine/bridge'

const route = useRoute()
const shared = ref(null)
const error = ref('')
const ready = ref(false)
const canvasEl = ref(null)
const frame = ref('whole')
const frames = [
  { label: '整杆', value: 'whole' }, { label: '前支', value: 'shaft' },
  { label: '后把', value: 'butt' }, { label: '接头', value: 'joint' }, { label: '端面', value: 'face' }
]
const template = computed(() => shared.value?.specification?.template || {})
const parts = computed(() => template.value.segments || [])
let engine = null
let loadSequence = 0

function disposeCanvas() { engine?.dispose(); engine = null; ready.value = false }
async function loadShare() {
  const sequence = ++loadSequence
  error.value = ''
  shared.value = null
  disposeCanvas()
  try {
    const data = await getCuePublicShare(String(route.params.token || ''))
    if (sequence !== loadSequence) return
    shared.value = data
    await nextTick()
    if (!canvasEl.value || sequence !== loadSequence) return
    engine = mountCueCanvas(canvasEl.value, { onReady: () => { if (sequence === loadSequence) ready.value = true } })
    engine.setSnapshot(data.snapshot)
    engine.setReadOnly(true)
    engine.setView(frame.value)
    const custom = data.assets || []
    const allAssets = [
      ...BUILTIN_ASSETS,
      ...custom.map((item) => ({
        id: item.id, name: item.name, source: item.source, kind: item.kind, tags: item.tags || [],
        w: item.width_px || 0, h: item.height_px || 0, blobKey: `blob:${item.id}`, createdAt: Date.now()
      }))
    ]
    engine.setAssets(allAssets)
    const usedIds = new Set((data.snapshot.stickers || []).map((item) => item.assetId))
    await Promise.all([...usedIds].map(async (id) => {
      const asset = allAssets.find((item) => item.id === id)
      if (!asset) return
      if (asset.source === 'builtin') {
        const url = builtinPatternUrl(asset.blobKey)
        if (!url) return
        const response = await fetch(url)
        if (response.ok) await engine?.cacheAssetImage(id, await response.blob())
      } else {
        await engine?.cacheAssetImage(id, await fetchCuePublicShareAsset(String(route.params.token || ''), id))
      }
    }))
  } catch (cause) {
    if (sequence === loadSequence) error.value = cause.message || '分享链接无效或已撤销。'
  }
}

watch(() => route.params.token, loadShare)
onMounted(loadShare)
onBeforeUnmount(() => { loadSequence += 1; disposeCanvas() })
</script>

<style scoped>
.cue-public-page { width: 100%; height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: #f6f8f7; color: #26372e; }
.cue-public-header { flex: 0 0 60px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 20px; border-bottom: 1px solid #e4eae6; background: #fff; }
.cue-public-header > div { min-width: 0; display: flex; flex-direction: column; gap: 4px; }.cue-public-header strong { overflow: hidden; color: #25352c; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }.cue-public-header span { color: #7b8780; font-size: 11px; }
.cue-public-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 320px; }
.cue-public-stage { position: relative; min-width: 0; min-height: 0; padding: 12px; }.cue-public-canvas { width: 100%; height: 100%; overflow: hidden; border-radius: 12px; background: #edf1ef; }.cue-public-spinner { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
.cue-public-specs { min-height: 0; overflow: auto; padding: 22px 20px; border-left: 1px solid #e4eae6; background: #fff; }.cue-public-specs h1 { margin: 0; color: #26372e; font-size: 16px; }.cue-public-version { margin: 5px 0 18px; color: #89948d; font-size: 11px; }
.cue-public-specs dl { margin: 0; }.cue-public-specs dl > div { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f3f1; font-size: 12px; }.cue-public-specs dt { color: #78857c; }.cue-public-specs dd { margin: 0; color: #33443a; font-weight: 600; text-align: right; }
.cue-public-parts { margin-top: 20px; }.cue-public-parts h2 { margin: 0 0 8px; font-size: 13px; }.cue-public-parts div { display: flex; justify-content: space-between; gap: 8px; padding: 7px 0; color: #66736a; font-size: 11px; }.cue-public-note { margin-top: 22px; padding: 10px; border-radius: 8px; background: #f5f8f6; color: #78857c; font-size: 10px; line-height: 1.55; }
.cue-public-error { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; text-align: center; }.cue-public-error h1 { font-size: 18px; }.cue-public-error p { color: #728077; }
@media (max-width: 760px) { .cue-public-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(50vh, 1fr) auto; overflow: auto; }.cue-public-page { height: auto; min-height: 100vh; overflow: auto; }.cue-public-stage { min-height: 54vh; }.cue-public-specs { border-top: 1px solid #e4eae6; border-left: 0; }.cue-public-header { flex-basis: 60px; padding: 0 12px; }.cue-public-header :deep(.ant-segmented-item-label) { padding: 0 6px; font-size: 10px; } }
</style>
