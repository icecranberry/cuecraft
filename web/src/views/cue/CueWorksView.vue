<template>
  <div class="cue-works-page">
    <div class="cue-works-layout">
      <section class="cue-works-main">
        <PageHeader title="我的作品" :loading="loading">
          <template #actions><a-button @click="importOpen = true">导入旧版作品</a-button></template>
        </PageHeader>
        <a-alert v-if="error" class="cue-alert" type="error" :message="error" show-icon closable @close="error = ''" />
        <ResourceEmptyState v-if="!loading && !works.length" title="还没有作品" description="在球杆设计页保存后，作品会出现在这里。">
          <template #actions><a-button type="primary" @click="router.push('/cue/design')">开始设计</a-button></template>
        </ResourceEmptyState>
        <div v-else class="cue-works-grid">
          <InfoCard
            v-for="work in works"
            :key="work.id"
            :title="work.name"
            :subtitle="`版本 ${work.version}`"
            :description="`更新于 ${formatDate(work.updated_at)}`"
            action-label="查看 3D"
            @action-click="openPreview(work.id)"
            @click="openPreview(work.id)"
          >
            <template #card-more-action-corner>
              <a-menu @click="handleWorkMenuClick($event, work)">
                <a-menu-item key="share"><span class="cue-menu-item"><Share2 :size="14" />分享 3D 链接</span></a-menu-item>
                <a-menu-item key="cost"><span class="cue-menu-item"><Sparkles :size="14" />AI 成本预测</span></a-menu-item>
                <a-menu-item key="vector"><span class="cue-menu-item"><Shapes :size="14" />矢量图转换</span></a-menu-item>
                <a-menu-divider />
                <a-menu-item key="sku"><span class="cue-menu-item"><PackagePlus :size="14" />加入 SKU</span></a-menu-item>
              </a-menu>
            </template>
            <template #footer>
              <a-button type="link" @click.stop="router.push({ path: '/cue/design', query: { id: work.id } })">继续编辑</a-button>
            </template>
          </InfoCard>
        </div>
      </section>

      <aside class="cue-work-assistant" aria-label="作品 AI 对话">
        <header class="cue-work-assistant-header">
          <div>
            <h2>作品 AI 助手</h2>
            <p>{{ assistantWork?.name || '选择作品后开始对话' }}</p>
          </div>
          <a-select
            :value="assistantWork?.id"
            class="cue-assistant-work-select"
            :options="assistantWorkOptions"
            placeholder="选择要分析的作品"
            aria-label="选择要分析的作品"
            @change="selectAssistantWork"
          />
          <a-select
            v-model:value="activeSkill"
            class="cue-skill-select"
            :loading="skillsLoading"
            :disabled="!assistantWork"
            :options="skillOptions"
            placeholder="选择作品后选择 Skill"
            aria-label="当前使用的 Skill"
            @change="switchSkill"
          />
        </header>
        <a-tag v-if="selectedSkill" color="green" class="cue-active-skill">当前 Skill：{{ selectedSkill.name }}</a-tag>
        <div ref="assistantMessagesEl" class="cue-assistant-messages" aria-live="polite">
          <div v-if="!assistantMessages.length && !assistantSending" class="cue-assistant-empty">
            {{ assistantWork ? '关于这个作品的对话会保存在此处，再次打开时可以继续。' : '选择一个球杆作品，AI 就能结合它的规格和花纹回答问题。' }}
          </div>
          <article v-for="(item, index) in assistantMessages" :key="`${index}-${item.role}`" class="cue-assistant-message" :class="`cue-assistant-${item.role}`">
            <strong>{{ item.role === 'user' ? '你' : 'AI' }}</strong>
            <div>{{ item.content }}</div>
            <small v-if="item.skill_slug">{{ skillName(item.skill_slug) }}</small>
          </article>
          <div v-if="assistantSending" class="cue-assistant-loading"><a-spin size="small" />正在分析作品…</div>
          <a-alert v-if="assistantError" type="error" show-icon :message="assistantError" />
        </div>
        <form class="cue-assistant-composer" @submit.prevent="sendAssistantMessage()">
          <a-textarea v-model:value="assistantDraft" :disabled="assistantSending || !assistantWork" :auto-size="{ minRows: 2, maxRows: 5 }" :placeholder="assistantWork ? '继续询问当前球杆作品…' : '先选择一个球杆作品…'" @keydown.enter.exact.prevent="sendAssistantMessage()" />
          <div><span>成本为 AI 粗估，不是厂家正式报价。</span><a-button type="primary" html-type="submit" :disabled="!assistantWork || !assistantDraft.trim()" :loading="assistantSending">发送</a-button></div>
        </form>
      </aside>
    </div>

    <a-modal :open="previewOpen" :title="preview?.name || '作品预览'" width="min(1100px, 96vw)" :footer="null" :destroy-on-close="true" @cancel="closePreview" @after-close="disposePreview">
      <div v-if="previewKind === 'work' && previewModelAsset" class="cue-work-model-detail">
        <CueModelPreview :asset="previewModelAsset" :interactive="true" :auto-rotate="true" class="cue-work-model-canvas" />
        <section class="cue-work-model-info" aria-label="球杆规格与花纹">
          <p v-if="previewModelAsset.description">{{ previewModelAsset.description }}</p>
          <p class="cue-model-summary">{{ previewModelAsset.specification.length_mm }} mm · {{ previewModelAsset.specification.size_status }}</p>
          <h3>拆解部位</h3>
          <div v-for="part in previewModelAsset.specification.display_parts" :key="part.id" class="cue-model-part-spec">
            <strong>{{ part.name }}</strong>
            <span v-if="part.a0 !== undefined">长度 {{ part.length_mm ?? (part.a1 - part.a0) }} mm</span>
            <span v-else>位置 {{ part.a }} mm</span>
            <span v-if="part.diameter_front_mm !== undefined">直径 {{ part.diameter_front_mm }}–{{ part.diameter_back_mm }} mm</span>
            <span v-else-if="part.diameter_mm !== undefined">直径 {{ part.diameter_mm }} mm</span>
            <span v-if="part.r0 !== undefined">半径 {{ part.r0 }}–{{ part.r1 }} mm</span>
          </div>
          <p class="cue-model-source">{{ previewModelAsset.specification.size_source || '设计示意尺寸；请勿直接用作制造参数。' }}</p>
          <section class="cue-work-pattern-section" aria-label="作品花纹">
            <h3>作品花纹 <span>{{ previewPatterns.length }}</span></h3>
            <div v-if="previewPatterns.length" class="cue-work-pattern-grid">
              <a-popover v-for="pattern in previewPatterns" :key="pattern.key" :trigger="['hover', 'focus']" placement="top" overlay-class-name="cue-pattern-preview-popover">
                <template #content>
                  <div class="cue-pattern-preview-content">
                    <img v-if="pattern.url" :src="pattern.url" :alt="pattern.name" />
                    <span v-else>暂无图片</span>
                    <strong>{{ pattern.name }}</strong>
                  </div>
                </template>
                <button class="cue-work-pattern-thumb" type="button" :aria-label="`放大查看花纹：${pattern.name}`">
                  <img v-if="pattern.url" :src="pattern.url" :alt="''" loading="lazy" />
                  <span v-else><Shapes :size="16" /></span>
                  <small>{{ pattern.name }}</small>
                </button>
              </a-popover>
            </div>
            <p v-else class="cue-no-patterns">这个作品还没有添加花纹。</p>
          </section>
        </section>
      </div>
      <template v-else>
        <div class="cue-preview-tools">
          <a-segmented v-model:value="frame" :options="frameOptions" @change="changeFrame" />
          <a-select v-model:value="exportSize" class="cue-export-size" :options="[{ label: '2K PNG', value: 2048 }, { label: '4K PNG', value: 3840 } ]" />
          <a-button type="primary" :loading="exporting" :disabled="!previewReady" @click="exportImage">导出图片</a-button>
        </div>
        <div ref="previewEl" class="cue-preview-canvas" aria-label="方案三维预览" />
        <a-spin v-if="!previewReady" class="cue-preview-spinner" tip="加载球杆…" />
      </template>
    </a-modal>

    <a-modal v-model:open="shareOpen" title="分享球杆 3D 作品" width="min(620px, 94vw)" :footer="null">
      <a-alert type="info" show-icon message="链接固定到创建时的作品版本。访客无需登录即可全屏查看 3D 预览和规格信息。" />
      <div v-if="shareUrl" class="cue-share-created">
        <a-input :value="shareUrl" readonly />
        <a-button type="primary" @click="copyShareUrl"><template #icon><Copy :size="14" /></template>复制</a-button>
      </div>
      <div v-else class="cue-share-create"><span>可创建多个独立链接，任一链接都能单独撤销。</span><a-button type="primary" :loading="sharing" @click="createShare">创建分享链接</a-button></div>
      <a-divider>分享记录</a-divider>
      <div v-if="shareRecords.length" class="cue-share-list">
        <div v-for="record in shareRecords" :key="record.id" class="cue-share-row">
          <div><strong>版本 {{ record.design_version }}</strong><span>{{ record.active ? '有效' : '已撤销' }} · {{ formatDate(record.created_at) }}</span></div>
          <a-button v-if="record.active" size="small" danger :loading="revokingShareId === record.id" @click="revokeShare(record)">撤销</a-button>
        </div>
      </div>
      <a-empty v-else description="还没有分享链接" :image-style="{ height: '46px' }" />
      <p v-if="shareRecords.some((item) => item.active) && !shareUrl" class="cue-share-secret-note">旧链接只在创建时显示。如果原链接未保存，请创建一个新链接，再按需撤销旧记录。</p>
      <div class="cue-share-create"><a-button :loading="sharing" @click="createShare">创建另一个链接</a-button><a-button @click="shareOpen = false">完成</a-button></div>
    </a-modal>

    <a-modal v-model:open="skuOpen" title="加入厂家 SKU 目录" :confirm-loading="skuSaving" ok-text="发布 SKU" @ok="createSku">
      <a-alert class="cue-sku-source" type="info" show-icon :message="`${skuWork?.name || '当前作品'} · 作品版本 ${skuWork?.version || '—'}`" description="发布后所有登录用户均可在共享 SKU 目录中查看。此表单只记录产品目录信息。" />
      <a-form layout="vertical" class="cue-sku-form">
        <a-form-item label="SKU 编号" required><a-input v-model:value="skuForm.code" maxlength="100" placeholder="可编辑的系统建议编号" /></a-form-item>
        <a-form-item label="产品名称" required><a-input v-model:value="skuForm.name" maxlength="255" /></a-form-item>
        <div class="cue-sku-form-grid">
          <a-form-item label="类别" required><a-input v-model:value="skuForm.category" maxlength="100" placeholder="球杆" /></a-form-item>
          <a-form-item label="系列"><a-input v-model:value="skuForm.series" maxlength="100" /></a-form-item>
        </div>
        <a-form-item label="材质"><a-input v-model:value="skuForm.material" maxlength="255" placeholder="填写厂家确认材质" /></a-form-item>
        <div class="cue-sku-form-grid cue-dimensions">
          <a-form-item label="总长（mm）" required><a-input-number v-model:value="skuForm.length_mm" :min="1" :max="3000" :precision="1" /></a-form-item>
          <a-form-item label="皮头直径（mm）"><a-input-number v-model:value="skuForm.tip_diameter_mm" :min="1" :max="40" :precision="1" /></a-form-item>
          <a-form-item label="后把直径（mm）"><a-input-number v-model:value="skuForm.butt_diameter_mm" :min="1" :max="60" :precision="1" /></a-form-item>
          <a-form-item label="重量（g）"><a-input-number v-model:value="skuForm.weight_g" :min="1" :max="2000" :precision="1" /></a-form-item>
        </div>
      </a-form>
    </a-modal>

    <a-modal v-model:open="importOpen" title="导入 CueCraft 资料包" ok-text="开始导入" :confirm-loading="importing" :ok-button-props="{ disabled: !importFile }" @ok="importBundle">
      <p>在旧版 CueCraft 的「服务设置」导出迁移资料包，然后在这里选择 JSON 文件。同一文件重复导入会自动跳过已有内容。</p>
      <a-upload accept=".json,application/json" :max-count="1" :before-upload="selectImportFile"><a-button>选择资料包</a-button></a-upload>
    </a-modal>

  </div>
</template>

<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { Copy, PackagePlus, Shapes, Share2, Sparkles } from '@lucide/vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import InfoCard from '@/components/shared/InfoCard.vue'
import ResourceEmptyState from '@/components/shared/ResourceEmptyState.vue'
import CueModelPreview from './CueModelPreview.vue'
import {
  createCueDesignShare,
  createCueSkuFromWork,
  fetchCueAssetImage,
  getCueDesign,
  getCueProposal,
  getCueWorkAssistant,
  importCuecraftBundle,
  listCueAssets,
  listCueAssistantSkills,
  listCueDesignShares,
  listCueDesigns,
  revokeCueDesignShare,
  sendCueWorkAssistantMessage,
  setCueWorkAssistantSkill
} from '@/apis/cue_api'
import { mountCueCanvas, downloadBlob } from '@/cue-engine/bridge'
import { hydrateProposalSnapshot } from '@/cue-engine/proposalSnapshot'
import { BUILTIN_ASSETS, builtinPatternUrl } from '@/cue-engine/materials/patterns'
import { resolveTemplate } from '@/cue-engine/cue/templates'
import { putBlob } from '@/cue-engine/state/imageStore'

const route = useRoute()
const router = useRouter()
const works = ref([])
const preview = ref(null)
const previewKind = ref('work')
const previewOpen = ref(false)
const previewReady = ref(false)
const previewEl = ref(null)
const frame = ref('whole')
const frameOptions = [
  { label: '整杆', value: 'whole' }, { label: '前支', value: 'shaft' },
  { label: '后把', value: 'butt' }, { label: '接头', value: 'joint' }, { label: '端面', value: 'face' }
]
const exportSize = ref(2048)
const exporting = ref(false)
const loading = ref(false)
const error = ref('')
const importOpen = ref(false)
const importFile = ref(null)
const importing = ref(false)
const shareOpen = ref(false)
const shareWork = ref(null)
const shareRecords = ref([])
const shareUrl = ref('')
const sharing = ref(false)
const revokingShareId = ref('')
const skuOpen = ref(false)
const skuWork = ref(null)
const skuSaving = ref(false)
const skuForm = reactive({ code: '', name: '', category: '球杆', series: '', material: '', length_mm: 1470, tip_diameter_mm: 12.5, butt_diameter_mm: 30, weight_g: undefined })
const assistantWork = ref(null)
const assistantMessages = ref([])
const assistantMessagesEl = ref(null)
const assistantDraft = ref('')
const assistantSending = ref(false)
const assistantError = ref('')
const assistantSkills = ref([])
const activeSkill = ref('')
const skillsLoading = ref(false)
const cueAssets = ref([])
const cueAssetsLoaded = ref(false)
const previewAssetImages = reactive({})
const previewImageUrls = new Set()
let engine = null
let openingKey = null

const selectedSkill = computed(() => assistantSkills.value.find((skill) => skill.slug === activeSkill.value) || null)
const skillOptions = computed(() => assistantSkills.value.map((skill) => ({ label: skill.name, value: skill.slug })))
const assistantWorkOptions = computed(() => works.value.map((work) => ({ label: work.name, value: work.id })))
const previewModelAsset = computed(() => buildWorkModelAsset(preview.value))
const previewPatterns = computed(() => {
  const stickers = preview.value?.snapshot?.stickers || []
  return stickers.map((sticker, index) => {
    const asset = [...BUILTIN_ASSETS, ...cueAssets.value].find((item) => item.id === sticker.assetId)
    return {
      key: sticker.id || `${sticker.assetId}-${index}`,
      name: asset?.name || sticker.name || `花纹 ${index + 1}`,
      url: asset?.source === 'builtin' ? builtinPatternUrl(asset.blobKey) : previewAssetImages[asset?.id || sticker.assetId],
      hidden: Boolean(sticker.hidden)
    }
  })
})

function formatDate(value) { return value ? new Date(value).toLocaleString('zh-CN') : '' }
function formatMm(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(Number(number.toFixed(1))) : '—'
}
function buildWorkModelAsset(work) {
  if (!work?.snapshot) return null
  const snapshot = work.snapshot
  const templateId = snapshot.cueTemplateId || snapshot.cueTemplate?.id || 'nineball'
  const sourceAsset = cueAssets.value.find((item) => item.id === snapshot.blankAssetId && item.kind === 'blank')
  const sourceSpec = sourceAsset?.specification || {}
  let template = snapshot.cueTemplate || null
  if (!template) {
    let baseTemplate
    try {
      baseTemplate = resolveTemplate(sourceSpec.cue_template_id || templateId, snapshot.decorativeRings, snapshot.partOverrides)
    } catch {
      baseTemplate = resolveTemplate('nineball')
    }
    template = {
      ...baseTemplate,
      id: sourceSpec.cue_template_id || templateId,
      ...(Array.isArray(sourceSpec.segments) ? { segments: sourceSpec.segments } : {}),
      ...(Array.isArray(sourceSpec.faces) ? { faces: sourceSpec.faces } : {}),
      lengthMm: Number(sourceSpec.length_mm || baseTemplate.lengthMm) || baseTemplate.lengthMm,
      sizeStatus: sourceSpec.size_status || baseTemplate.sizeStatus,
      sizeSource: sourceSpec.size_source || baseTemplate.sizeSource
    }
  }
  const segments = template.segments
  const totalLength = Number(template.lengthMm || sourceSpec.length_mm || segments.at(-1)?.a1) || 1474
  const displayParts = segments.map((part) => ({
    id: part.id,
    name: part.name,
    a0: part.a0,
    a1: part.a1,
    length_mm: formatMm(Number(part.a1) - Number(part.a0)),
    diameter_front_mm: Number(part.r0) * 2,
    diameter_back_mm: Number(part.r1) * 2,
    r0: part.r0,
    r1: part.r1
  }))
  return {
    id: sourceAsset?.id || snapshot.blankAssetId || `work-${work.id}`,
    name: work.name,
    source: 'work',
    kind: 'blank',
    description: sourceAsset?.description || '',
    specification: {
      ...sourceSpec,
      cue_template_id: template.id || sourceSpec.cue_template_id || snapshot.cueTemplateId || 'nineball',
      cue_template: template,
      length_mm: totalLength,
      size_status: sourceSpec.size_status || template.sizeStatus || '设计规格',
      size_source: sourceSpec.size_source || template.sizeSource || '设计示意尺寸；请勿直接用作制造参数。',
      segments,
      faces: template.faces || [],
      part_overrides: snapshot.partOverrides || {},
      global_finish: snapshot.globalFinish || 'gloss',
      stickers: snapshot.stickers || [],
      display_parts: [...displayParts, ...(template.faces || []).map((face) => ({
        id: face.id,
        name: face.name,
        a: face.a,
        diameter_mm: face.radius * 2
      }))]
    }
  }
}
function changeFrame(value) { engine?.setView(value) }
function disposePreview() { engine?.dispose(); engine = null; previewReady.value = false }
function selectImportFile(file) { importFile.value = file; return false }
async function loadCueAssets() {
  if (!cueAssetsLoaded.value) {
    cueAssets.value = await listCueAssets()
    cueAssetsLoaded.value = true
  }
  return cueAssets.value
}
async function cacheWorkPatternImages(snapshot) {
  const usedIds = new Set((snapshot?.stickers || []).map((sticker) => sticker.assetId))
  let assets
  try { assets = await loadCueAssets() }
  catch { return }
  await Promise.all(assets.filter((asset) => usedIds.has(asset.id) && asset.has_image && !previewAssetImages[asset.id]).map(async (asset) => {
    try {
      const blob = await fetchCueAssetImage(asset.id)
      await putBlob(`blob:${asset.id}`, blob)
      const url = URL.createObjectURL(blob)
      previewAssetImages[asset.id] = url
      previewImageUrls.add(url)
    } catch { /* Keep the thumbnail placeholder when an optional image is unavailable. */ }
  }))
}
async function importBundle() {
  if (!importFile.value) return
  importing.value = true
  error.value = ''
  try {
    const result = await importCuecraftBundle(importFile.value)
    works.value = await listCueDesigns()
    importOpen.value = false
    importFile.value = null
    message.success(`已导入 ${result.assets} 个素材、${result.works} 个作品；跳过已有 ${result.skipped_assets + result.skipped_works} 项`)
  } catch (cause) { error.value = cause.message || '迁移资料包导入失败' }
  finally { importing.value = false }
}

async function openPreview(id) {
  if (openingKey === `work:${id}`) return
  openingKey = `work:${id}`
  if (route.query.preview !== id) await router.push({ path: '/cue/works', query: { preview: id } })
  error.value = ''
  try {
    disposePreview()
    previewKind.value = 'work'
    preview.value = await getCueDesign(id)
    await cacheWorkPatternImages(preview.value.snapshot)
    previewOpen.value = true
  } catch (cause) { error.value = cause.message || '预览加载失败' }
  finally { openingKey = null }
}
async function openProposalPreview(id, variant) {
  if (openingKey === `proposal:${id}:${variant}`) return
  openingKey = `proposal:${id}:${variant}`
  error.value = ''
  try {
    previewKind.value = 'proposal'
    const proposal = await getCueProposal(id, Number(variant || 0))
    preview.value = { name: proposal.title, snapshot: await hydrateProposalSnapshot(proposal.snapshot) }
    await mountPreview()
  } catch (cause) { error.value = cause.message || '方案预览加载失败' }
  finally { openingKey = null }
}
async function mountPreview() {
  previewOpen.value = true
  await nextTick()
  disposePreview()
  engine = mountCueCanvas(previewEl.value, { onReady: () => { previewReady.value = true } })
  engine.setSnapshot(preview.value.snapshot)
  engine.setReadOnly(true)
  engine.setView(frame.value)
  const assets = await loadCueAssets()
  engine.setAssets(assets.map((item) => ({
    id: item.id, name: item.name, source: item.source, kind: item.kind, tags: item.tags,
    w: item.width_px || 0, h: item.height_px || 0, blobKey: `blob:${item.id}`,
    createdAt: Date.parse(item.created_at) || Date.now()
  })))
  await Promise.all(assets.filter((item) => preview.value.snapshot.stickers?.some((sticker) => sticker.assetId === item.id)).map(async (item) => {
    await engine?.cacheAssetImage(item.id, await fetchCueAssetImage(item.id))
  }))
}
async function closePreview() {
  previewOpen.value = false
  if (route.query.preview) await router.replace('/cue/works')
}
async function exportImage() {
  if (!engine) return
  exporting.value = true
  try {
    const blob = await engine.exportPng({ frame: frame.value, size: exportSize.value })
    downloadBlob(blob, `${preview.value.name}-${frame.value}-${exportSize.value}.png`)
    message.success('图片已导出')
  } catch (cause) { error.value = cause.message || '图片导出失败' }
  finally { exporting.value = false }
}

function handleWorkMenuClick({ key }, work) {
  if (key === 'share') void openShares(work)
  if (key === 'cost') void openAssistant(work, 'cost')
  if (key === 'vector') void openAssistant(work, 'vector')
  if (key === 'sku') void openSkuForm(work)
}
async function openShares(work) {
  shareWork.value = work
  shareUrl.value = ''
  shareOpen.value = true
  try {
    shareRecords.value = await listCueDesignShares(work.id)
    await createShare()
  } catch (cause) { error.value = cause.message || '分享链接加载失败' }
}
async function createShare() {
  if (!shareWork.value || sharing.value) return
  sharing.value = true
  try {
    const share = await createCueDesignShare(shareWork.value.id)
    shareUrl.value = `${window.location.origin}${share.path}`
    shareRecords.value = [share, ...shareRecords.value]
  } catch (cause) { error.value = cause.message || '分享链接创建失败' }
  finally { sharing.value = false }
}
async function revokeShare(record) {
  if (!shareWork.value) return
  revokingShareId.value = record.id
  try {
    await revokeCueDesignShare(shareWork.value.id, record.id)
    shareRecords.value = shareRecords.value.map((item) => item.id === record.id ? { ...item, active: false } : item)
    if (record.id === shareRecords.value[0]?.id) shareUrl.value = ''
    message.success('分享链接已撤销')
  } catch (cause) { error.value = cause.message || '分享链接撤销失败' }
  finally { revokingShareId.value = '' }
}
async function copyShareUrl() {
  try { await navigator.clipboard.writeText(shareUrl.value); message.success('分享链接已复制') }
  catch { error.value = '剪贴板不可用，请手动复制链接' }
}

function suggestedSkuCode() {
  const day = new Date().toISOString().slice(2, 10).replaceAll('-', '')
  return `CUE-${day}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}
async function openSkuForm(work) {
  error.value = ''
  try {
    const fullWork = await getCueDesign(work.id)
    skuWork.value = fullWork
    const snapshot = fullWork.snapshot || {}
    const template = snapshot.cueTemplate || {}
    const sku = snapshot.skuSpecification || {}
    skuForm.code = suggestedSkuCode()
    skuForm.name = fullWork.name
    skuForm.category = '球杆'
    skuForm.series = ''
    skuForm.material = sku.material || ''
    skuForm.length_mm = Number(template.lengthMm || sku.length_mm) || 1470
    skuForm.tip_diameter_mm = Number(template.tipDiameterMm || sku.tip_diameter_mm) || 12.5
    skuForm.butt_diameter_mm = Number(template.buttDiameterMm || sku.butt_diameter_mm) || 30
    skuForm.weight_g = sku.weight_g ? Number(sku.weight_g) : undefined
    skuOpen.value = true
  } catch (cause) { error.value = cause.message || '作品规格加载失败' }
}
async function createSku() {
  if (!skuWork.value) return
  skuSaving.value = true
  try {
    const sku = await createCueSkuFromWork({
      code: skuForm.code,
      name: skuForm.name,
      category: skuForm.category,
      series: skuForm.series,
      material: skuForm.material,
      specification: {
        length_mm: skuForm.length_mm,
        tip_diameter_mm: skuForm.tip_diameter_mm,
        butt_diameter_mm: skuForm.butt_diameter_mm,
        weight_g: skuForm.weight_g
      },
      design_id: skuWork.value.id,
      design_version: skuWork.value.version
    })
    skuOpen.value = false
    message.success(`SKU ${sku.code} 已发布到共享目录`)
  } catch (cause) { error.value = cause.message || 'SKU 发布失败' }
  finally { skuSaving.value = false }
}

function skillName(slug) { return assistantSkills.value.find((skill) => skill.slug === slug)?.name || slug }
async function openAssistant(work, mode = 'chat') {
  assistantWork.value = work
  assistantError.value = ''
  assistantMessages.value = []
  skillsLoading.value = true
  try {
    const [assistant, skills] = await Promise.all([getCueWorkAssistant(work.id), listCueAssistantSkills()])
    assistantSkills.value = skills
    assistantMessages.value = assistant.messages || []
    activeSkill.value = mode === 'cost' ? 'cue-cost-estimation' : mode === 'vector' ? 'cue-vector-conversion-placeholder' : assistant.active_skill_slug
    if (activeSkill.value !== assistant.active_skill_slug) await switchSkill(activeSkill.value)
  } catch (cause) { assistantError.value = cause.message || '作品 AI 对话加载失败' }
  finally { skillsLoading.value = false; await scrollAssistant() }
  if (mode === 'cost') await sendAssistantMessage('请基于这个球杆作品，直接给出人民币单支成本粗估区间，并列出主要假设。', 'cost')
  if (mode === 'vector') await sendAssistantMessage('请转换当前作品所用的纹样为矢量文件。', 'vector')
}
async function selectAssistantWork(id) {
  const work = works.value.find((item) => item.id === id)
  if (work && work.id !== assistantWork.value?.id) await openAssistant(work)
}
async function switchSkill(slug) {
  if (!assistantWork.value || !slug) return
  activeSkill.value = slug
  try {
    const result = await setCueWorkAssistantSkill(assistantWork.value.id, slug)
    assistantMessages.value = result.messages || assistantMessages.value
  } catch (cause) { assistantError.value = cause.message || 'Skill 切换失败' }
}
async function sendAssistantMessage(messageText = assistantDraft.value.trim(), mode = 'chat') {
  if (!assistantWork.value || !messageText || assistantSending.value) return
  assistantDraft.value = ''
  assistantError.value = ''
  assistantSending.value = true
  try {
    const result = await sendCueWorkAssistantMessage(assistantWork.value.id, {
      message: messageText,
      skill_slug: activeSkill.value,
      mode
    })
    activeSkill.value = result.active_skill_slug
    assistantMessages.value = result.messages || []
  } catch (cause) { assistantError.value = cause.message || 'AI 暂时无法回复，请稍后重试。' }
  finally { assistantSending.value = false; await scrollAssistant() }
}
async function scrollAssistant() { await nextTick(); if (assistantMessagesEl.value) assistantMessagesEl.value.scrollTop = assistantMessagesEl.value.scrollHeight }

async function refreshWorks() {
  loading.value = true
  error.value = ''
  try {
    works.value = await listCueDesigns()
    return true
  } catch (cause) {
    error.value = cause.message || '作品加载失败'
    return false
  } finally { loading.value = false }
}

let skipInitialActivationRefresh = true
onActivated(() => {
  if (skipInitialActivationRefresh) {
    skipInitialActivationRefresh = false
    return
  }
  void refreshWorks()
})

onMounted(async () => {
  if (!await refreshWorks()) return
  try {
    if (route.query.preview) await openPreview(String(route.query.preview))
    if (route.query.proposal) await openProposalPreview(String(route.query.proposal), route.query.variant)
  } catch (cause) { error.value = cause.message || '作品加载失败' }
})
onBeforeUnmount(() => {
  disposePreview()
  for (const url of previewImageUrls) URL.revokeObjectURL(url)
})
watch(() => route.query.preview, (id, previous) => {
  if (id && id !== previous && !previewOpen.value) void openPreview(String(id))
  if (!id && previewOpen.value) { previewOpen.value = false; disposePreview() }
})
watch(() => route.query.proposal, (id, previous) => {
  if (id && id !== previous) void openProposalPreview(String(id), route.query.variant)
  if (!id && previous && previewOpen.value) { previewOpen.value = false; disposePreview() }
})
</script>

<style scoped>
.cue-works-page { height: 100%; min-height: 0; overflow: hidden; background: var(--gray-25); }
.cue-works-layout { display: grid; width: 100%; height: 100%; min-height: 0; grid-template-columns: minmax(0, 1fr) minmax(300px, 360px); }
.cue-works-main { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; }
.cue-alert { margin: 12px var(--page-padding); }
.cue-works-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 20px var(--page-padding); }
.cue-work-assistant { display: flex; min-width: 0; min-height: 0; flex-direction: column; gap: 12px; overflow: hidden; border-left: 1px solid var(--gray-150); background: var(--gray-0); padding: 18px 16px 14px; }
.cue-work-assistant-header { display: flex; flex: 0 0 auto; flex-direction: column; gap: 11px; }
.cue-work-assistant-header > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.cue-work-assistant-header h2 { margin: 0; color: var(--gray-900); font-size: 15px; font-weight: 650; }
.cue-work-assistant-header p { max-width: 58%; margin: 0; overflow: hidden; color: var(--gray-500); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.cue-assistant-work-select, .cue-skill-select { width: 100%; }
.cue-active-skill { flex: 0 0 auto; align-self: flex-start; margin: 0; }
.cue-assistant-messages { display: flex; min-height: 0; flex: 1 1 auto; flex-direction: column; gap: 12px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: 2px 4px 10px 1px; }
.cue-assistant-empty { max-width: 280px; margin: auto; color: var(--gray-500); font-size: 12px; line-height: 1.6; text-align: center; }
.cue-assistant-message { display: flex; flex: 0 0 auto; flex-direction: column; gap: 5px; padding: 11px 12px; border-radius: 9px; background: var(--gray-50); }
.cue-assistant-user { background: var(--primary-50, #edf8f1); }
.cue-assistant-message strong { color: var(--gray-700); font-size: 11px; }
.cue-assistant-message div { overflow-wrap: anywhere; color: var(--gray-800); font-size: 12px; line-height: 1.65; white-space: pre-wrap; }
.cue-assistant-message small { color: var(--gray-500); font-size: 10px; }
.cue-assistant-loading { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; color: var(--gray-500); font-size: 12px; }
.cue-assistant-composer { flex: 0 0 auto; border-top: 1px solid var(--gray-150); padding-top: 12px; }
.cue-assistant-composer > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
.cue-assistant-composer span { color: var(--gray-500); font-size: 10px; }
.cue-menu-item { display: inline-flex; align-items: center; gap: 8px; }
.cue-preview-tools { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.cue-preview-canvas { width: 100%; height: min(65vh, 580px); background: var(--gray-50); border-radius: 8px; }
.cue-export-size { width: 120px; }.cue-preview-spinner { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
.cue-work-model-detail { display: grid; width: 100%; height: min(68vh, 680px); min-height: 430px; grid-template-columns: minmax(0, 1.4fr) minmax(300px, 1fr); gap: 18px; overflow: hidden; }
.cue-work-model-canvas { height: 100%; min-height: 0; }
.cue-work-model-info { display: flex; min-height: 0; flex-direction: column; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: 0 8px 0 0; color: var(--gray-700); font-size: 12px; }
.cue-work-model-info > p { margin: 0 0 12px; line-height: 1.6; }
.cue-work-model-info h3 { display: flex; align-items: center; gap: 8px; margin: 6px 0 8px; color: var(--gray-900); font-size: 14px; }
.cue-work-model-info h3 span { color: var(--gray-500); font-size: 11px; font-weight: 500; }
.cue-model-summary { font-variant-numeric: tabular-nums; }
.cue-model-part-spec { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 9px 0; border-bottom: 1px solid var(--gray-150); font-size: 11px; }
.cue-model-part-spec strong { grid-column: 1 / -1; color: var(--gray-900); font-size: 12px; }
.cue-model-source { margin-top: auto !important; padding-top: 14px; color: var(--gray-500); }
.cue-work-pattern-section { flex: 0 0 auto; margin-top: 12px; }
.cue-work-pattern-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.cue-work-pattern-thumb { display: flex; width: 100%; min-width: 0; min-height: 84px; flex-direction: column; align-items: stretch; gap: 5px; overflow: hidden; border: 1px solid var(--gray-150); border-radius: 7px; background: var(--gray-0); padding: 5px; color: var(--gray-700); cursor: pointer; text-align: left; }
.cue-work-pattern-thumb:hover, .cue-work-pattern-thumb:focus-visible { border-color: var(--primary-300, #8bb397); outline: none; }
.cue-work-pattern-thumb img, .cue-work-pattern-thumb > span { display: grid; width: 100%; height: 54px; place-items: center; border-radius: 4px; background: var(--gray-50); object-fit: contain; }
.cue-work-pattern-thumb small { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.cue-no-patterns { margin: 0; color: var(--gray-500); font-size: 11px; }
:global(.cue-pattern-preview-popover .ant-popover-inner) { padding: 8px; }
:global(.cue-pattern-preview-content) { display: flex; width: 220px; flex-direction: column; gap: 7px; }
:global(.cue-pattern-preview-content img) { display: block; width: 220px; height: 180px; border-radius: 5px; background: var(--gray-50); object-fit: contain; }
:global(.cue-pattern-preview-content strong) { overflow: hidden; color: var(--gray-800); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
:global(.cue-pattern-preview-content span) { display: grid; height: 180px; place-items: center; color: var(--gray-500); font-size: 11px; }
.cue-share-created { display: flex; gap: 8px; margin-top: 15px; }.cue-share-create { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; color: var(--gray-600); font-size: 12px; }
.cue-share-list { max-height: 180px; overflow: auto; }.cue-share-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--gray-150); }.cue-share-row > div { display: flex; flex-direction: column; gap: 4px; }.cue-share-row strong { color: var(--gray-800); font-size: 12px; }.cue-share-row span,.cue-share-secret-note { color: var(--gray-500); font-size: 11px; }.cue-share-secret-note { line-height: 1.5; }
.cue-sku-source { margin-bottom: 16px; }.cue-sku-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.cue-dimensions { grid-template-columns: 1fr 1fr; }.cue-dimensions :deep(.ant-input-number) { width: 100%; }
@media (max-width: 760px) {
  :global(.app-layout:has(.cue-works-page)) { min-width: 0; }
  .cue-works-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(300px, 1fr) minmax(390px, 52vh); overflow: auto; }
  .cue-work-assistant { border-top: 1px solid var(--gray-150); border-left: 0; }
  .cue-work-model-detail { height: min(78vh, 760px); min-height: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(210px, 0.9fr) minmax(0, 1fr); gap: 12px; }
  .cue-work-model-info { max-height: none; }
}
@media (max-width: 600px) { .cue-share-create { align-items: flex-start; flex-direction: column; }.cue-sku-form-grid { grid-template-columns: 1fr; gap: 0; }.cue-work-pattern-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (prefers-reduced-motion: reduce) { .cue-work-pattern-thumb { transition: none; } }
</style>
