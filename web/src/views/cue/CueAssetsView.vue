<template>
  <div class="cue-assets-page">
    <PageHeader title="素材库" :loading="loading" :show-border="true">
      <template #actions><a-button @click="openAi">AI 生成素材</a-button><a-button type="primary" @click="openCreate">新增素材</a-button></template>
    </PageHeader>
    <PageShoulder v-model:search="search" search-placeholder="搜索名称、标签、介绍">
      <template #filters>
        <a-segmented v-model:value="kindFilter" :options="filterOptions" />
      </template>
    </PageShoulder>
    <a-alert v-if="error" class="cue-alert" type="error" :message="error" show-icon closable @close="error = ''" />
    <a-spin :spinning="loading">
      <ResourceEmptyState v-if="!filtered.length" title="暂无匹配素材" description="保存不同规格的光杆模型、清晰花纹或可覆盖整圈的包裹图片。">
        <template #actions><a-button type="primary" @click="openCreate">新增素材</a-button></template>
      </ResourceEmptyState>
      <div v-else class="cue-asset-grid">
        <InfoCard v-for="item in filtered" :key="item.id" class="cue-asset-card" :class="{ 'cue-asset-card--wrap': item.kind === 'wrap' }" :title="item.name" :subtitle="kindLabel(item.kind)" :description="item.description" :tags="item.tags.map((tag) => ({ name: tag }))" @click="openDetail(item)">
          <template #card-more-action-corner>
            <a-menu @click="handleAssetMenuClick($event, item)">
              <a-menu-item key="design"><span class="cue-asset-menu-item"><PenTool :size="14" />用于设计</span></a-menu-item>
              <a-menu-item v-if="assetImage(item)" key="export"><span class="cue-asset-menu-item"><Download :size="14" />导出图片</span></a-menu-item>
            </a-menu>
          </template>
          <template #info>
            <CueModelPreview v-if="item.kind === 'blank' && item.source === 'builtin'" :asset="item" class="cue-asset-model-preview" />
            <img v-else-if="assetImage(item)" :src="assetImage(item)" class="cue-asset-image" :alt="item.name" />
            <div v-else class="cue-blank-preview">
              {{ blankSpecificationSummary(item) }}
            </div>
          </template>
        </InfoCard>
      </div>
    </a-spin>

    <a-modal v-model:open="createOpen" title="新增素材" :confirm-loading="creating" ok-text="保存素材" @ok="create" @cancel="resetForm">
      <a-form layout="vertical">
        <a-form-item label="类型"><a-segmented v-model:value="form.kind" :options="createOptions" /></a-form-item>
        <a-form-item label="名称"><a-input v-model:value="form.name" maxlength="255" /></a-form-item>
        <a-form-item label="介绍"><a-textarea v-model:value="form.description" :rows="2" maxlength="2000" /></a-form-item>
        <a-form-item label="标签（逗号分隔）"><a-input v-model:value="form.tags" placeholder="例：中式，几何，深色" /></a-form-item>
        <template v-if="form.kind === 'blank'">
          <a-alert type="info" message="尺寸按毫米填写，杆段必须连续。AI 生成的尺寸属于设计草案。" show-icon />
          <div v-for="(segment, index) in form.segments" :key="index" class="cue-segment-row">
            <a-input v-model:value="segment.name" :aria-label="`第 ${index + 1} 段名称`" placeholder="部位名称" />
            <a-input-number v-model:value="segment.a0" :min="0" addon-after="起点" />
            <a-input-number v-model:value="segment.a1" :min="1" addon-after="终点" />
            <a-input-number v-model:value="segment.r0" :min="1" :max="30" addon-after="前半径" />
            <a-input-number v-model:value="segment.r1" :min="1" :max="30" addon-after="后半径" />
            <a-button v-if="form.segments.length > 1" danger @click="form.segments.splice(index, 1)">删除</a-button>
          </div>
          <a-button @click="addSegment">添加杆段</a-button>
        </template>
        <template v-else>
          <a-form-item :label="form.kind === 'wrap' ? '正方形材质图（PNG / JPEG / WebP，至少 512px）' : '图片（PNG / JPEG / WebP，至少 512px）'">
            <a-upload :before-upload="beforeUpload" :max-count="1" :show-upload-list="true"><a-button>选择图片</a-button></a-upload>
          </a-form-item>
          <a-alert v-if="form.kind === 'wrap'" type="info" message="包裹素材会铺满所选部位一周，请上传正方形、左右边缘可自然衔接的材质或纹理图。" show-icon />
          <a-form-item v-if="form.kind === 'wrap'" label="覆盖杆段">
            <a-select v-model:value="form.targetSegmentId" :options="segmentOptions" placeholder="选择完整包裹的杆段" />
          </a-form-item>
        </template>
      </a-form>
    </a-modal>

    <a-modal v-model:open="detailOpen" :title="detail?.name" :footer="null" width="min(1100px, 96vw)">
      <div v-if="detail?.kind === 'blank'" class="cue-model-detail">
        <CueModelPreview :asset="detail" :interactive="true" :auto-rotate="true" class="cue-model-detail-preview" />
        <section class="cue-model-detail-specs">
          <p>{{ detail.description }}</p>
          <p class="cue-model-summary">{{ detail.specification?.length_mm || detail.specification?.segments?.at(-1)?.a1 }} mm · {{ detail.specification?.size_status || '用户指定尺寸' }}</p>
          <h3>拆解部位</h3>
          <div v-for="part in detail.specification?.display_parts || detail.specification?.segments || []" :key="part.id" class="cue-model-part-spec">
            <strong>{{ part.name }}</strong>
            <span v-if="part.a0 !== undefined">长度 {{ part.length_mm ?? (part.a1 - part.a0) }} mm</span>
            <span v-else>位置 {{ part.a }} mm</span>
            <span v-if="part.diameter_front_mm !== undefined">直径 {{ part.diameter_front_mm }}–{{ part.diameter_back_mm }} mm</span>
            <span v-else-if="part.diameter_mm !== undefined">直径 {{ part.diameter_mm }} mm</span>
            <span v-if="part.r0 !== undefined">半径 {{ part.r0 }}–{{ part.r1 }} mm</span>
          </div>
          <p class="cue-model-source">{{ detail.specification?.size_source || '设计示意尺寸；请勿直接用作制造参数。' }}</p>
        </section>
      </div>
      <template v-else>
        <img v-if="detail && assetImage(detail)" :src="assetImage(detail)" class="cue-detail-image" :alt="detail.name" />
        <p>{{ detail?.description }}</p>
        <a-tag v-for="tag in detail?.tags || []" :key="tag">{{ tag }}</a-tag>
      </template>
    </a-modal>

    <a-modal v-model:open="aiOpen" title="AI 生成素材" ok-text="开始生成" :confirm-loading="startingJob" :ok-button-props="{ disabled: Boolean(job && !['success', 'failed', 'cancelled'].includes(job.status)) }" @ok="startGeneration">
      <a-form layout="vertical">
        <a-form-item label="素材类型"><a-segmented v-model:value="aiForm.kind" :options="createOptions" /></a-form-item>
        <a-form-item label="名称"><a-input v-model:value="aiForm.name" /></a-form-item>
        <a-form-item label="设计描述"><a-textarea v-model:value="aiForm.prompt" :rows="4" placeholder="例：深蓝与银色的几何花纹，适合枫木后把" /></a-form-item>
        <a-form-item v-if="aiForm.kind !== 'blank'" label="参考素材（可选）"><a-select v-model:value="aiForm.reference_asset_id" allow-clear :options="referenceOptions" placeholder="选一张共享花纹或包裹图片作为风格参考" /></a-form-item>
        <a-form-item v-if="aiForm.kind === 'wrap'" label="覆盖杆段"><a-select v-model:value="aiForm.target_segment_id" :options="segmentOptions" /></a-form-item>
        <a-form-item label="Workbench 模型"><a-select v-model:value="aiForm.model_spec" :options="availableAiModels" placeholder="请先在 Workbench 模型管理中配置模型" /></a-form-item>
      </a-form>
      <a-alert v-if="job" :type="job.status === 'failed' ? 'error' : job.status === 'success' ? 'success' : 'info'" :message="job.error || job.message || job.status" show-icon />
      <a-progress v-if="job && !['success', 'failed', 'cancelled'].includes(job.status)" :percent="job.progress || 0" />
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { Download, PenTool } from '@lucide/vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import PageShoulder from '@/components/shared/PageShoulder.vue'
import InfoCard from '@/components/shared/InfoCard.vue'
import ResourceEmptyState from '@/components/shared/ResourceEmptyState.vue'
import { listCueAssets, uploadCueAsset, fetchCueAssetImage, listCueAiModels, createCueAiJob, getCueAiJob } from '@/apis/cue_api'
import { expandedSegments, resolveTemplate } from '@/cue-engine/cue/templates'
import { BUILTIN_PATTERNS, builtinPatternUrl } from '@/cue-engine/materials/patterns'
import CueModelPreview from './CueModelPreview.vue'

const router = useRouter()
const assets = ref([])
const images = reactive({})
const search = ref('')
const kindFilter = ref('all')
const filterOptions = [
  { label: '全部', value: 'all' }, { label: '光杆模型', value: 'blank' },
  { label: '花纹', value: 'pattern' }, { label: '包裹', value: 'wrap' }
]
const createOptions = filterOptions.slice(1)
const segmentOptions = expandedSegments(resolveTemplate('nineball')).filter((item) => item.printEnabled).map((item) => ({ label: item.name, value: item.id }))
const loading = ref(false)
const creating = ref(false)
const error = ref('')
const createOpen = ref(false)
const detailOpen = ref(false)
const detail = ref(null)
const aiOpen = ref(false)
const startingJob = ref(false)
const aiModels = ref([])
const aiForm = reactive({ kind: 'pattern', name: '', prompt: '', target_segment_id: undefined, reference_asset_id: undefined, model_spec: undefined })
const job = ref(null)
let jobTimer = null
const availableAiModels = computed(() => aiModels.value
  .filter((item) => item.type === (aiForm.kind === 'blank' ? 'chat' : 'image'))
  .filter((item) => !aiForm.reference_asset_id || item.supports_reference)
  .map((item) => ({ label: item.name, value: item.spec })))
const referenceOptions = computed(() => assets.value.filter((item) => item.has_image).map((item) => ({ label: `${item.name} · ${kindLabel(item.kind)}`, value: item.id })))
const form = reactive({ kind: 'pattern', name: '', description: '', tags: '', image: null, targetSegmentId: undefined, segments: [] })
const allAssets = computed(() => [...BUILTIN_PATTERNS, ...assets.value.filter((item) => item.kind !== 'sticker')])
const filtered = computed(() => allAssets.value.filter((item) => {
  if (kindFilter.value !== 'all' && item.kind !== kindFilter.value) return false
  const haystack = `${item.name} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase()
  return haystack.includes(search.value.trim().toLowerCase())
}))

function kindLabel(kind) { return { blank: '光杆模型', pattern: '花纹', wrap: '包裹' }[kind] || kind }
function blankSpecificationSummary(item) {
  const segments = item.specification?.segments || []
  const length = segments.at(-1)?.a1
  return `${segments.length || 0} 段光杆${length ? ` · ${length} mm` : ''}`
}
function assetImage(item) {
  if (item.kind === 'blank' && item.source === 'builtin') return ''
  return item.source === 'builtin' ? builtinPatternUrl(item.blobKey) : images[item.id]
}
function useForDesign(item) {
  if (item.kind === 'blank') {
    router.push({ path: '/cue/design', query: { asset: item.id } })
    return
  }
  router.push({ path: '/cue/design', query: { pattern: item.id } })
}
function handleAssetMenuClick({ key }, item) {
  if (key === 'design') useForDesign(item)
  if (key === 'export') void exportAssetImage(item)
}
async function exportAssetImage(item) {
  const source = assetImage(item)
  if (!source) return
  try {
    const response = await fetch(source)
    if (!response.ok) throw new Error('素材图片读取失败')
    const blob = await response.blob()
    const extension = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp'
    }[blob.type.split(';', 1)[0].toLowerCase()]
    if (!extension) throw new Error('暂不支持导出这种图片格式')
    const fileName = Array.from(item.name || '球杆素材', (character) => {
      return /[<>:"/\\|?*]/.test(character) || character.charCodeAt(0) < 32 ? '-' : character
    }).join('').trim() || '球杆素材'
    const downloadUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = `${fileName}.${extension}`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
    message.success('图片已导出')
  } catch (cause) {
    message.error(cause.message || '导出图片失败')
  }
}
function resetForm() {
  form.kind = 'pattern'; form.name = ''; form.description = ''; form.tags = ''; form.image = null; form.targetSegmentId = undefined; form.segments = []
}
function openCreate() {
  resetForm()
  createOpen.value = true
  form.segments = expandedSegments(resolveTemplate('nineball')).map((segment) => ({ ...segment }))
}
function addSegment() {
  const last = form.segments.at(-1)
  form.segments.push({ id: crypto.randomUUID(), kind: 'butt', name: '新杆段', a0: last?.a1 || 0, a1: (last?.a1 || 0) + 100, r0: last?.r1 || 10, r1: last?.r1 || 10, matPreset: 'maple', printEnabled: true })
}
async function beforeUpload(file) {
  if (form.kind === 'wrap') {
    const size = await readImageSize(file)
    if (!size) {
      error.value = '无法读取图片尺寸'
      return false
    }
    const tolerance = Math.abs(size.width - size.height) / Math.max(size.width, size.height)
    if (tolerance > 0.01) {
      error.value = '包裹素材必须使用正方形图片'
      return false
    }
  }
  form.image = file
  return false
}
function readImageSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}
function openDetail(item) { detail.value = item; detailOpen.value = true }
async function openAi() {
  aiOpen.value = true
  try { aiModels.value = await listCueAiModels() }
  catch (cause) { error.value = cause.message || '模型列表加载失败' }
}

async function pollJob() {
  if (!job.value?.id) return
  try {
    job.value = await getCueAiJob(job.value.id)
    if (job.value.status === 'success') {
      clearInterval(jobTimer); jobTimer = null
      message.success('AI 素材已加入共享库')
      await refresh()
    } else if (['failed', 'cancelled'].includes(job.value.status)) {
      clearInterval(jobTimer); jobTimer = null
    }
  } catch (cause) {
    clearInterval(jobTimer); jobTimer = null
    error.value = cause.message || '生成任务查询失败'
  }
}

async function startGeneration() {
  startingJob.value = true
  try {
    job.value = await createCueAiJob({ ...aiForm })
    clearInterval(jobTimer)
    jobTimer = setInterval(pollJob, 1800)
  } catch (cause) { error.value = cause.message || '任务提交失败' }
  finally { startingJob.value = false }
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    assets.value = await listCueAssets()
    await Promise.all(assets.value.filter((item) => item.has_image && !images[item.id]).map(async (item) => {
      images[item.id] = URL.createObjectURL(await fetchCueAssetImage(item.id))
    }))
  } catch (cause) { error.value = cause.message || '素材加载失败' }
  finally { loading.value = false }
}
async function create() {
  creating.value = true
  error.value = ''
  try {
    const specification = form.kind === 'blank'
      ? { segments: form.segments }
      : form.kind === 'wrap' ? { target_segment_id: form.targetSegmentId } : {}
    await uploadCueAsset({
      kind: form.kind, name: form.name, description: form.description,
      tags: form.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      specification, image: form.image
    })
    createOpen.value = false
    message.success('素材已加入共享库')
    await refresh()
  } catch (cause) { error.value = cause.message || '保存素材失败' }
  finally { creating.value = false }
}
onMounted(refresh)
onBeforeUnmount(() => { clearInterval(jobTimer); Object.values(images).forEach((url) => URL.revokeObjectURL(url)) })
watch(() => aiForm.kind, () => { aiForm.model_spec = undefined; aiForm.reference_asset_id = undefined })
watch(() => aiForm.reference_asset_id, () => {
  if (aiForm.reference_asset_id && !availableAiModels.value.some((item) => item.value === aiForm.model_spec)) aiForm.model_spec = undefined
})
</script>

<style scoped>
.cue-assets-page { height: 100%; overflow: auto; background: var(--gray-25); }
.cue-alert { margin: 12px var(--page-padding); }
.cue-asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 20px var(--page-padding); }
.cue-asset-menu-item { display: inline-flex; align-items: center; gap: 8px; }
.cue-asset-image { display: block; width: 100%; height: 170px; object-fit: contain; border-radius: 6px; background: var(--gray-50); }
.cue-asset-card--wrap :deep(.info-card-body) { aspect-ratio: 1; }
.cue-asset-card--wrap .cue-asset-image { height: 100%; aspect-ratio: 1; }
.cue-blank-preview { display: grid; place-items: center; height: 170px; border-radius: 6px; background: var(--main-30); color: var(--gray-700); }
.cue-detail-image { display: block; width: 100%; max-height: 400px; object-fit: contain; background: var(--gray-50); }
.cue-asset-model-preview { display: block; width: 100%; height: 190px; }
.cue-model-detail { display: grid; width: 100%; height: min(68vh, 680px); min-height: 430px; grid-template-columns: minmax(0, 1.4fr) minmax(300px, 1fr); gap: 18px; overflow: hidden; }
.cue-model-detail-preview { min-height: 0; height: 100%; }
.cue-model-detail-specs { display: flex; min-height: 0; flex-direction: column; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: 0 8px 0 0; color: var(--gray-700); font-size: 12px; }
.cue-model-detail-specs > p { margin: 0 0 12px; line-height: 1.6; }
.cue-model-detail-specs h3 { margin: 6px 0 8px; font-size: 14px; }
.cue-model-summary { font-variant-numeric: tabular-nums; }
.cue-model-part-spec { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 9px 0; border-bottom: 1px solid var(--gray-150); font-size: 11px; }
.cue-model-part-spec strong { grid-column: 1 / -1; color: var(--gray-900); font-size: 12px; }
.cue-model-source { margin-top: auto !important; padding-top: 14px; color: var(--gray-500); }
.cue-segment-row { display: grid; grid-template-columns: 1.2fr repeat(4, 1fr) auto; gap: 6px; margin: 8px 0; }
@media (max-width: 760px) { .cue-model-detail { height: min(78vh, 760px); min-height: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(210px, 0.9fr) minmax(0, 1fr); gap: 12px; } .cue-model-detail-preview { min-height: 0; } .cue-model-detail-specs { max-height: none; } }
@media (max-width: 600px) { .cue-segment-row { grid-template-columns: 1fr 1fr; } }
</style>
