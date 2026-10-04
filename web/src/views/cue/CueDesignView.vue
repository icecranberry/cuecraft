<template>
  <div class="cue-page cue-design-page">
    <PageHeader title="球杆设计" :loading="loading || saving" :show-border="true">
      <template #actions>
        <a-input v-model:value="name" aria-label="作品名称" class="cue-name" placeholder="作品名称" />
        <a-button @click="newDesign">新建</a-button>
        <a-button type="primary" :loading="saving" @click="save">保存作品</a-button>
      </template>
    </PageHeader>
    <a-alert v-if="error" type="error" :message="error" show-icon closable @close="error = ''" />
    <div class="cue-design-shell">
      <aside class="cue-panel cue-panel-left cue-part-navigator" :inert="watching" :aria-disabled="watching">
        <header class="cue-panel-head">
          <h2>球杆部位</h2>
          <p>点击选择并聚焦</p>
        </header>
        <button class="cue-overview-button" :aria-pressed="!selection.id && view === 'whole'" @click="showWhole">
          <Maximize2 :size="15" />查看整杆
        </button>
        <nav class="cue-part-list" aria-label="各个部位">
          <button
            v-for="(part, index) in parts"
            :key="part.id"
            :title="part.name"
            :aria-label="`选择${part.name}`"
            :aria-pressed="selectedPartId === part.id"
            @click="selectPart(part.id)"
          >
            <span class="cue-list-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="cue-list-label">{{ partLabel(part.name) }}</span>
            <Check v-if="selectedPartId === part.id" :size="13" />
          </button>
        </nav>
        <p class="cue-parts-hint">选择只影响当前查看部位，花纹和生成范围在右侧设置。</p>
      </aside>

      <main ref="canvasAreaEl" class="cue-canvas-area" :class="{ 'cue-watch-fullscreen': watching }">
        <div class="cue-preview-toolbar">
          <div class="cue-preview-title">
            <span class="cue-live-dot" aria-hidden="true" />
            <strong>实时预览</strong>
            <span>{{ templateName }}</span>
          </div>
          <a-select :value="activeBlankAssetId" class="cue-model-select" :options="blankAssetOptions" aria-label="选择光杆模型" @change="changeBlankAsset" />
          <div class="cue-background-switch" role="group" aria-label="预览背景颜色">
            <button v-for="mode in backgroundOptions" :key="mode.value" :aria-label="mode.label" :aria-pressed="stageBgMode === mode.value" :title="mode.label" @click="setBackground(mode.value)">
              <span :style="{ backgroundColor: mode.color }" />
            </button>
          </div>
        </div>
        <div class="cue-preview-stage" :data-bg-mode="stageBgMode" :style="{ '--cue-stage': stageBgColor }">
          <div class="cue-stage-watermark" aria-hidden="true">MADE BY YOU</div>
          <div ref="canvasEl" class="cue-canvas" aria-label="球杆三维设计画布" />
          <div v-if="!ready" class="cue-canvas-loading" role="status" aria-live="polite"><a-spin tip="加载三维球杆…" /></div>
          <div class="cue-stage-label">
            <span>CUE / 01</span>
            <p>你的设计，正在这里发生</p>
          </div>
          <div v-if="tipVisible && !selection.id" class="cue-stage-tip">
            <MousePointer2 :size="17" />
            <span>拖动空白处旋转球杆<br /><small>{{ watching ? '滚轮缩放，右键拖动平移，自由旋转' : '点击花纹可拖动，双击部位可聚焦' }}</small></span>
            <button aria-label="收起操作提示" @click="tipVisible = false"><X :size="15" /></button>
          </div>
          <div v-if="selectionToastVisible && selectionLabel" class="cue-selection-note">
            <span>{{ selectionLabel }}</span>
            <button aria-label="关闭选中提示" @click="selectionToastVisible = false"><X :size="14" /></button>
          </div>
          <div class="cue-studio-views">
            <div class="cue-mode-switch">
              <button :aria-pressed="!watching" @click="setMode('design')"><PenTool :size="14" /> 设计</button>
              <button :aria-pressed="watching" @click="setMode('watch')"><Eye :size="14" /> 观看</button>
            </div>
            <button v-if="!watching" class="cue-auto-rotate" :aria-pressed="autoRotate" @click="toggleAutoRotate"><RotateCcw :size="16" />自旋转</button>
            <button class="cue-reset-view" @click="resetView">重置位置</button>
            <button v-if="watching" class="cue-watch-exit" aria-label="退出观看" @click="setMode('design')"><X :size="16" />退出观看</button>
          </div>
        </div>

        <section
          class="cue-preview-tools"
          :class="{ 'is-part-adjustment': selectedPart && !selectedSticker, 'is-pattern-adjustment': selectedSticker }"
          :inert="watching"
          :aria-disabled="watching"
          aria-label="预览调整工具"
        >
          <div class="cue-tools-context">
            <strong>{{ toolsContextLabel }}</strong>
          </div>
          <div class="cue-tools-content">
          <template v-if="selectedSticker">
            <div class="cue-tool-row">
              <label v-if="selectedSticker.target.kind === 'lathe'" class="cue-tool-field">
                <span>沿杆 mm</span>
                <a-input-number :value="selectedSticker.target.a" :min="selectedStickerPart?.a0 ?? 0" :max="selectedStickerPart?.a1 ?? 1500" @change="(value) => updateStickerTarget({ a: Number(value) })" />
              </label>
              <label v-if="selectedSticker.target.kind === 'lathe'" class="cue-tool-field">
                <span>环绕 °</span>
                <a-input-number :value="selectedSticker.target.angDeg" :min="0" :max="360" @change="(value) => updateStickerTarget({ angDeg: Number(value) })" />
              </label>
              <label v-if="selectedSticker.target.kind === 'face'" class="cue-tool-field">
                <span>水平 mm</span>
                <a-input-number :value="selectedSticker.target.fx" @change="(value) => updateStickerTarget({ fx: Number(value) })" />
              </label>
              <label v-if="selectedSticker.target.kind === 'face'" class="cue-tool-field">
                <span>垂直 mm</span>
                <a-input-number :value="selectedSticker.target.fz" @change="(value) => updateStickerTarget({ fz: Number(value) })" />
              </label>
              <label class="cue-tool-field">
                <span>宽 mm</span>
                <a-input-number :value="numberValue(selectedSticker.w)" :min="1" :step="0.5" @change="setStickerWidth" />
              </label>
              <label class="cue-tool-field">
                <span>高 mm</span>
                <a-input-number :value="numberValue(selectedSticker.h)" :min="1" :step="0.5" @change="setStickerHeight" />
              </label>
              <a-button size="small" :aria-pressed="lockAspect" title="锁定宽高比例" @click="lockAspect = !lockAspect">
                <Lock v-if="lockAspect" :size="13" /><LockOpen v-else :size="13" />等比
              </a-button>
              <label class="cue-tool-field">
                <span>旋转 °</span>
                <a-input-number :value="selectedSticker.rotDeg" :step="5" @change="(value) => setSticker({ rotDeg: Number(value) })" />
              </label>
              <label class="cue-tool-field cue-tool-opacity">
                <span>透明度 {{ Math.round(selectedSticker.opacity * 100) }}%</span>
                <a-slider :value="selectedSticker.opacity * 100" :min="5" :max="100" @change="(value) => setSticker({ opacity: Number(value) / 100 })" />
              </label>
            </div>
            <div class="cue-tool-actions">
              <a-button size="small" @click="zoomSticker(0.9)"><Minus :size="13" />缩小</a-button>
              <a-button size="small" @click="zoomSticker(1.1)"><Plus :size="13" />放大</a-button>
              <a-button size="small" @click="zoomSticker(1.1, Math.PI / 4)">⟳ 90°</a-button>
              <a-button size="small" :aria-pressed="selectedSticker.flipX" @click="setSticker({ flipX: !selectedSticker.flipX })">水平翻转</a-button>
              <a-button size="small" :aria-pressed="selectedSticker.flipY" @click="setSticker({ flipY: !selectedSticker.flipY })">垂直翻转</a-button>
              <a-button size="small" @click="engine?.reorderSticker(selectedSticker.id, 1)"><MoveUp :size="13" />上移</a-button>
              <a-button size="small" @click="engine?.reorderSticker(selectedSticker.id, -1)"><MoveDown :size="13" />下移</a-button>
              <a-button size="small" @click="setSticker({ hidden: !selectedSticker.hidden })">
                <EyeOff v-if="selectedSticker.hidden" :size="13" /><Eye v-else :size="13" />{{ selectedSticker.hidden ? '显示' : '隐藏' }}
              </a-button>
              <a-button size="small" @click="setSticker({ locked: !selectedSticker.locked })">
                <Lock v-if="selectedSticker.locked" :size="13" /><LockOpen v-else :size="13" />{{ selectedSticker.locked ? '解锁' : '锁定' }}
              </a-button>
              <a-button size="small" title="复制花纹" aria-label="复制花纹" @click="engine?.duplicateSticker(selectedSticker.id)"><Copy :size="13" /></a-button>
              <a-button size="small" danger title="删除花纹" aria-label="删除花纹" @click="removeSelectedSticker"><Trash2 :size="13" /></a-button>
            </div>
          </template>
          <div v-else-if="selectedPart" class="cue-part-tools-hint">
            <div class="cue-part-dimensions" aria-label="选中部位的只读尺寸">
              <div v-for="dimension in selectedPartDimensions" :key="dimension.label"><span>{{ dimension.label }}</span><strong>{{ dimension.value }}</strong></div>
            </div>
            <span>选中部位尺寸仅供查看，可从素材库添加花纹。</span>
          </div>
          <p v-else class="cue-tools-hint">选中部位调整材质，选中图案调整位置和尺寸。</p>
          </div>
        </section>
      </main>

      <aside class="cue-panel cue-panel-right" :inert="watching" :aria-disabled="watching">
        <a-tabs v-model:activeKey="rightTab" class="cue-right-tabs">
          <a-tab-pane key="design" tab="设计属性">
            <div class="cue-design-tab-layout">
              <div class="cue-panel-body">
                <template v-if="selectedPart">
                  <p class="cue-muted">{{ selectedPart.name }} · {{ partRangeLabel(selectedPart) }}</p>
                  <a-button class="cue-pattern-action" block @click="openPatternPicker"><Shapes :size="14" />花纹</a-button>
                  <a-form layout="vertical">
                    <a-form-item label="材质"><a-select :value="selectedOverride.matPreset || selectedPart.matPreset" :options="materials" @change="(value) => setPart({ matPreset: value })" /></a-form-item>
                    <a-form-item label="漆面"><a-select :value="selectedOverride.finish || snapshot.globalFinish" :options="finishes" @change="(value) => setPart({ finish: value })" /></a-form-item>
                  </a-form>
                  <div v-if="canWrapSelectedPart" class="cue-wrap-config">
                    <h3>包裹配置</h3>
                    <a-form layout="vertical">
                      <a-form-item label="整圈包裹素材">
                        <a-select v-model:value="selectedWrapAssetId" allow-clear :options="wrapOptions" placeholder="从素材库选择包裹材质" />
                      </a-form-item>
                      <a-form-item label="包裹颜色（实时同步）">
                        <input class="cue-color-input" type="color" :value="wrapColor" @input="(event) => setWrapColor(event.target.value)" />
                      </a-form-item>
                      <a-form-item :label="`颜色覆盖 ${Math.round(wrapColorOpacity * 100)}%`">
                        <a-slider :value="wrapColorOpacity * 100" :min="0" :max="100" @change="setWrapColorOpacity" />
                      </a-form-item>
                    </a-form>
                    <div class="cue-wrap-actions">
                      <a-button type="primary" :disabled="!selectedWrapAssetId" @click="applyWrapAsset">应用包裹</a-button>
                      <a-button @click="clearWrap">移除包裹</a-button>
                    </div>
                    <p>图片会完整包裹当前部位一周；只选择颜色时会直接同步到三维材质。</p>
                  </div>
                </template>
                <ResourceEmptyState v-else size="compact" title="选择球杆部位" description="在左侧选择部位后，可设置材质或添加花纹。" />
              </div>
            </div>
          </a-tab-pane>
          <a-tab-pane key="layers">
            <template #tab>
              <span class="cue-layers-tab">图层<span class="cue-layers-count">{{ sortedStickers.length }}</span></span>
            </template>
            <div class="cue-layer-panel">
              <header class="cue-layer-header">
                <h3>已上杆花纹</h3>
                <p>眼睛控制显示；点击花纹定位，可复制或删除。</p>
              </header>
              <div v-if="sortedStickers.length" class="cue-layer-list" role="list" aria-label="花纹图层">
                <div
                  v-for="sticker in sortedStickers"
                  :key="sticker.id"
                  class="cue-layer-row"
                  :class="{
                    'is-selected': selection.kind === 'sticker' && selection.id === sticker.id,
                    'is-hidden': sticker.hidden,
                    'is-dragging': draggedLayerId === sticker.id,
                    'is-drop-before': dropTarget?.id === sticker.id && dropTarget.position === 'before',
                    'is-drop-after': dropTarget?.id === sticker.id && dropTarget.position === 'after'
                  }"
                  draggable="true"
                  role="listitem"
                  aria-roledescription="可拖动图层"
                  @dragstart="beginLayerDrag($event, sticker.id)"
                  @dragover="allowLayerDrop($event, sticker.id)"
                  @drop="dropLayer($event, sticker.id)"
                  @dragend="endLayerDrag"
                >
                  <span class="cue-layer-drag-handle" aria-hidden="true"><GripVertical :size="14" /></span>
                  <button class="cue-layer-eye" :aria-label="sticker.hidden ? `显示${sticker.name}` : `隐藏${sticker.name}`" @click.stop="setStickerHidden(sticker, !sticker.hidden)">
                    <EyeOff v-if="sticker.hidden" :size="15" /><Eye v-else :size="15" />
                  </button>
                  <button class="cue-layer-main" :aria-pressed="selection.kind === 'sticker' && selection.id === sticker.id" @click="selectSticker(sticker.id)">
                    <span>{{ sticker.name }}</span>
                    <small>{{ stickerTargetName(sticker) }}</small>
                  </button>
                  <button class="cue-layer-action" title="复制花纹" aria-label="复制花纹" @click.stop="engine?.duplicateSticker(sticker.id)"><Copy :size="14" /></button>
                  <button class="cue-layer-action is-danger" title="删除花纹" aria-label="删除花纹" @click.stop="engine?.removeSticker(sticker.id)"><Trash2 :size="14" /></button>
                </div>
              </div>
              <ResourceEmptyState v-else size="compact" title="暂无图层" description="从设计属性的“花纹”按钮选择素材并应用到球杆。" />
            </div>
          </a-tab-pane>
        </a-tabs>
        <section class="cue-ai-design" aria-label="AI 设计对话">
          <header><Sparkles :size="15" /><strong>AI 设计</strong></header>
          <div class="cue-ai-messages" aria-live="polite">
            <div v-for="(item, index) in chatMessages" :key="index" class="cue-ai-message" :class="`is-${item.role}`">
              <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.imageName || '参考图'" />
              <p>{{ item.content }}</p>
            </div>
            <p v-if="chatSending" class="cue-ai-status">正在整理设计建议…</p>
          </div>
          <div v-if="chatImage" class="cue-ai-attachment">
            <img :src="chatImage.url" :alt="chatImage.name" />
            <span>{{ chatImage.name }}</span>
            <button aria-label="移除参考图" @click="removeChatImage"><X :size="13" /></button>
          </div>
          <form class="cue-ai-composer" @submit.prevent="sendCueMessage">
            <input v-model="chatDraft" type="text" aria-label="输入 AI 设计描述" placeholder="说说你的球杆设计想法…" autocomplete="off" />
            <div class="cue-ai-composer-actions">
              <input ref="chatImageInput" class="cue-ai-file" type="file" accept="image/*" @change="attachChatImage" />
              <button type="button" class="cue-ai-upload" aria-label="上传参考图" title="上传参考图" @click="chatImageInput?.click()"><ImagePlus :size="17" /></button>
              <button type="submit" class="cue-ai-send" aria-label="发送" :disabled="!chatDraft.trim() || chatSending"><Send :size="16" /></button>
            </div>
          </form>
          <p class="cue-ai-footnote">对话仅保存在当前页面；参考图暂作为对话附件展示。</p>
        </section>
      </aside>
    </div>

    <a-modal
      v-model:open="patternPickerOpen"
      width="min(980px, 94vw)"
      title="选择花纹"
      ok-text="应用到当前部件"
      :ok-button-props="{ disabled: !patternDraftId || !selectedPart, loading: applyingPattern }"
      @ok="applySelectedPattern"
    >
      <CuePatternPicker v-model="patternDraftId" :assets="patternPickerAssets" />
    </a-modal>
    <a-modal v-model:open="savePromptOpen" title="保存当前设计？" :closable="false" :mask-closable="false" :footer="null">
      <p>当前球杆设计有未保存的改动。继续操作前可以先保存。</p>
      <div class="cue-save-prompt-actions">
        <a-button @click="cancelPendingChange">取消</a-button>
        <a-button danger @click="discardAndContinue">不保存</a-button>
        <a-button type="primary" :loading="saving" @click="saveAndContinue">保存并继续</a-button>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  Check, Copy, Eye, EyeOff, GripVertical, ImagePlus, Lock, LockOpen, Maximize2, Minus,
  MousePointer2, MoveDown, MoveUp, PenTool, Plus, RotateCcw, Send, Shapes, Sparkles, Trash2, X
} from '@lucide/vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import ResourceEmptyState from '@/components/shared/ResourceEmptyState.vue'
import CuePatternPicker from './CuePatternPicker.vue'
import { listCueAssets, fetchCueAssetImage, getCueDesign, createCueDesign, updateCueDesign, listCueSkus, getCueProposal, chatCueAi } from '@/apis/cue_api'
import { mountCueCanvas, templateFromSpecification } from '@/cue-engine/bridge'
import { hydrateProposalSnapshot } from '@/cue-engine/proposalSnapshot'
import { expandedSegments, resolveTemplate } from '@/cue-engine/cue/templates'
import { MATERIAL_PRESETS, FINISHES } from '@/cue-engine/materials/presets'
import { BUILTIN_ASSETS, BUILTIN_PATTERNS, builtinPatternUrl } from '@/cue-engine/materials/patterns'
import { patternSurfaceSize } from '@/cue-engine/stickers/patternPlacement'
import { propertyPartAfterSelection } from '@/cue-engine/state/stickerSelection.js'
import { moveStickerInOrder } from '@/cue-engine/state/stickerOrder.js'

const route = useRoute()
const router = useRouter()
const canvasEl = ref(null)
const canvasAreaEl = ref(null)
const name = ref('未命名球杆')
const snapshot = ref({ name: '未命名球杆', cueTemplateId: 'nineball', partOverrides: {}, globalFinish: 'gloss', stickers: [] })
const designId = ref(null)
const selection = ref({ kind: 'global' })
const selectionToastVisible = ref(false)
const propertyPartId = ref(null)
const assets = ref([])
const assetPreviews = reactive({})
const view = ref('whole')
const rightTab = ref('design')
const interactionMode = ref('design')
const tipVisible = ref(true)
const lockAspect = ref(true)
const patternPickerOpen = ref(false)
const patternDraftId = ref('')
const applyingPattern = ref(false)
const selectedWrapAssetId = ref('')
const wrapColor = ref('#ffffff')
const draggedLayerId = ref(null)
const dropTarget = ref(null)
const stageBgMode = ref('neutral')
const backgroundOptions = [
  { value: 'neutral', label: '浅灰绿背景', color: '#e8eae2' },
  { value: 'bright', label: '亮色背景', color: '#f3f3ed' },
  { value: 'dark', label: '深色背景', color: '#191c21' }
]
const chatMessages = ref([])
const chatDraft = ref('')
const chatSending = ref(false)
const chatImage = ref(null)
const chatImageInput = ref(null)
const savePromptOpen = ref(false)
const pendingSavePrompt = ref(null)
const materials = MATERIAL_PRESETS.map((item) => ({ label: item.name, value: item.id }))
const finishes = FINISHES.map((item) => ({ label: item.name, value: item.id }))
const ready = ref(false)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
let engine = null
let selectionTimer = null
let cleanState = ''
let skipNextRouteLoad = false

const watching = computed(() => interactionMode.value === 'watch')
const autoRotate = ref(false)
const template = computed(() => snapshot.value.cueTemplate || resolveTemplate(snapshot.value.cueTemplateId, snapshot.value.decorativeRings, snapshot.value.partOverrides))
const templateName = computed(() => template.value.name || '球杆')
const parts = computed(() => {
  const segments = expandedSegments(template.value)
  const visibleSegments = template.value.selectablePartIds
    ? segments.filter((part) => template.value.selectablePartIds.includes(part.id))
    : segments
  return [...visibleSegments, ...(template.value.selectablePartIds ? [] : template.value.faces)]
})
const activeBlankAssetId = computed(() => snapshot.value.blankAssetId
  || assets.value.find((asset) => asset.kind === 'blank' && asset.name === templateName.value)?.id
  || 'builtin-cue-nineball')
const blankAssetOptions = computed(() => assets.value
  .filter((asset) => asset.kind === 'blank')
  .map((asset) => ({ label: asset.name, value: asset.id })))
const stageBgColor = computed(() => backgroundOptions.find((item) => item.value === stageBgMode.value)?.color || '#e8eae2')
const currentState = computed(() => JSON.stringify({ name: name.value, snapshot: { ...snapshot.value, name: name.value } }))
const isDirty = computed(() => Boolean(cleanState && currentState.value !== cleanState))
const selectedSticker = computed(() => snapshot.value.stickers?.find((item) => item.id === selection.value.id))
const selectedStickerPartId = computed(() => {
  const sticker = selectedSticker.value
  return sticker ? (sticker.target.kind === 'lathe' ? sticker.target.segId : sticker.target.faceId) : null
})
const selectedPartId = computed(() => selection.value.kind === 'part' && selection.value.id && parts.value.some((item) => item.id === selection.value.id)
  ? selection.value.id
  : propertyPartId.value || (selection.value.kind === 'sticker' ? selectedStickerPartId.value : null))
const selectedPart = computed(() => parts.value.find((item) => item.id === selectedPartId.value))
const selectedPartDimensions = computed(() => {
  const part = selectedPart.value
  if (!part) return []
  if ('a0' in part) {
    const diameter = numberValue(Math.max(part.r0, part.r1) * 2)
    return [
      { label: '长度', value: `${numberValue(part.a1 - part.a0)} mm` },
      { label: '宽度', value: `${diameter} mm` },
      { label: '高度', value: `${diameter} mm` }
    ]
  }
  const diameter = numberValue(part.radius * 2)
  return [
    { label: '轴向位置', value: `${numberValue(part.a)} mm` },
    { label: '宽度', value: `${diameter} mm` },
    { label: '高度', value: `${diameter} mm` }
  ]
})
const selectedOverride = computed(() => snapshot.value.partOverrides?.[selectedPartId.value] || {})
const wrapColorOpacity = computed(() => selectedOverride.value.colorOpacity ?? 1)
const sortedStickers = computed(() => [...(snapshot.value.stickers || [])].sort((a, b) => b.z - a.z))
const selectedStickerPart = computed(() => {
  const sticker = selectedSticker.value
  if (!sticker) return undefined
  const id = sticker.target.kind === 'lathe' ? sticker.target.segId : sticker.target.faceId
  return parts.value.find((item) => item.id === id)
})
const selectionLabel = computed(() => {
  if (selectedSticker.value) return `已选中 · ${selectedSticker.value.name}`
  if (selectedPart.value) return `已选中 · ${partLabel(selectedPart.value.name)}`
  return ''
})
const toolsContextLabel = computed(() => selectedSticker.value ? '花纹调整' : selectedPart.value ? `部件调整 · ${partLabel(selectedPart.value.name)}` : '精细调整')
const patternPickerAssets = computed(() => [
  ...BUILTIN_PATTERNS,
  ...assets.value
    .filter((item) => item.kind === 'pattern')
    .map((item) => ({ ...item, previewUrl: assetPreviews[item.id] || '' }))
])
const wrapOptions = computed(() => assets.value
  .filter((item) => item.kind === 'wrap')
  .map((item) => ({ label: item.name, value: item.id })))
const canWrapSelectedPart = computed(() => Boolean(selectedPart.value && 'a0' in selectedPart.value))

function partLabel(value) { return value.replace(/（.*?）/g, '') }
function partRangeLabel(part) {
  if ('a0' in part) return `${part.a0}–${part.a1} mm`
  return `位于 ${part.a} mm · 半径 ${part.radius} mm`
}
function numberValue(value) { return Number(Number(value).toFixed(1)) }
function setBackground(mode) {
  stageBgMode.value = mode
  engine?.setBgMode(mode)
}
function toggleAutoRotate() {
  autoRotate.value = !autoRotate.value
  engine?.setAutoRotate(autoRotate.value)
}
function setSelectionToast(kind) {
  clearTimeout(selectionTimer)
  selectionToastVisible.value = kind !== 'global' && kind !== null
  if (selectionToastVisible.value) selectionTimer = setTimeout(() => { selectionToastVisible.value = false }, 2000)
}
function selectPart(id) {
  if (watching.value) return
  propertyPartId.value = id
  view.value = 'focus'
  rightTab.value = 'design'
  engine?.focusPart(id)
}
function selectSticker(id) {
  if (watching.value) return
  engine?.selectSticker(id)
}
function setPart(patch) { if (selectedPart.value) engine?.setPartOverride(selectedPart.value.id, patch) }
function setSticker(patch) { if (selectedSticker.value) engine?.updateSticker(selectedSticker.value.id, patch) }
function updateStickerTarget(patch) {
  const sticker = selectedSticker.value
  if (!sticker) return
  engine?.updateSticker(sticker.id, { target: { ...sticker.target, ...patch } })
}
function setStickerWidth(value) {
  const sticker = selectedSticker.value
  if (!sticker) return
  const width = Math.max(1, Number(value) || sticker.w)
  setSticker(lockAspect.value ? { w: width, h: Math.max(1, width * sticker.h / sticker.w) } : { w: width })
}
function setStickerHeight(value) {
  const sticker = selectedSticker.value
  if (!sticker) return
  const height = Math.max(1, Number(value) || sticker.h)
  setSticker(lockAspect.value ? { h: height, w: Math.max(1, height * sticker.w / sticker.h) } : { h: height })
}
function zoomSticker(factor) {
  const sticker = selectedSticker.value
  if (!sticker) return
  setSticker({ w: Math.max(1, sticker.w * factor), h: Math.max(1, sticker.h * factor) })
}
function setStickerHidden(sticker, hidden) { engine?.updateSticker(sticker.id, { hidden }) }
function wrapStickersForPart(part) {
  const wrapAssetIds = new Set(assets.value.filter((asset) => asset.kind === 'wrap').map((asset) => asset.id))
  return snapshot.value.stickers.filter((sticker) => {
    if (sticker.target.kind !== 'lathe' || !('a0' in part)) return false
    if (sticker.target.segId !== part.id) return false
    return wrapAssetIds.has(sticker.assetId)
  })
}
function syncWrapConfig() {
  if (!selectedPart.value || !('a0' in selectedPart.value)) {
    selectedWrapAssetId.value = ''
    wrapColor.value = selectedOverride.value.color || '#ffffff'
    return
  }
  const wrap = wrapStickersForPart(selectedPart.value).at(-1)
  selectedWrapAssetId.value = wrap?.assetId || ''
  wrapColor.value = selectedOverride.value.color || '#ffffff'
}
function setWrapColor(value) {
  wrapColor.value = value
  if (selectedPart.value && 'a0' in selectedPart.value) {
    engine?.setWrapColor(selectedPart.value.id, value, wrapColorOpacity.value)
  }
}
function setWrapColorOpacity(value) {
  if (selectedPart.value && 'a0' in selectedPart.value) {
    engine?.setWrapColor(selectedPart.value.id, wrapColor.value, Number(value) / 100)
  }
}
async function applyWrapAsset() {
  const part = selectedPart.value
  const asset = assets.value.find((item) => item.id === selectedWrapAssetId.value && item.kind === 'wrap')
  if (!engine || !part || !asset || !('a0' in part)) {
    message.warning('请选择球杆部位和包裹素材')
    return
  }
  error.value = ''
  try {
    await ensureAssetBlob(asset)
    const metrics = partMetrics(part)
    const sticker = {
      id: crypto.randomUUID(),
      name: asset.name,
      assetId: asset.id,
      processedRev: 0,
      target: { kind: 'lathe', segId: part.id, a: (part.a0 + part.a1) / 2, angDeg: 0 },
      w: metrics.width,
      h: metrics.height,
      rotDeg: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
      z: Math.max(0, ...snapshot.value.stickers.map((item) => item.z)) + 1,
      hidden: false,
      locked: false
    }
    engine.applyWrapSticker(part.id, sticker)
    message.success(`${asset.name} 已包裹${partLabel(part.name)}`)
  } catch (cause) {
    error.value = cause.message || '包裹素材应用失败'
  }
}
function clearWrap() {
  const part = selectedPart.value
  if (!part || !('a0' in part)) return
  engine?.clearWrapAppearance(part.id)
  selectedWrapAssetId.value = ''
  wrapColor.value = '#ffffff'
  message.success('已移除当前部位的包裹')
}
function beginLayerDrag(event, id) {
  if (watching.value) {
    event.preventDefault()
    return
  }
  draggedLayerId.value = id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', id)
}
function allowLayerDrop(event, id) {
  if (!draggedLayerId.value || draggedLayerId.value === id) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  const rect = event.currentTarget.getBoundingClientRect()
  dropTarget.value = { id, position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' }
}
function dropLayer(event, targetId) {
  event.preventDefault()
  const activeId = draggedLayerId.value || event.dataTransfer.getData('text/plain')
  if (activeId && dropTarget.value?.id === targetId) {
    const ids = sortedStickers.value.map((sticker) => sticker.id)
    const nextOrder = moveStickerInOrder(ids, activeId, targetId, dropTarget.value.position)
    engine?.setStickerOrder(nextOrder)
  }
  endLayerDrag()
}
function endLayerDrag() {
  draggedLayerId.value = null
  dropTarget.value = null
}
function stickerTargetName(sticker) {
  const id = sticker.target.kind === 'lathe' ? sticker.target.segId : sticker.target.faceId
  return parts.value.find((item) => item.id === id)?.name || id
}
function removeSelectedSticker() {
  if (!selectedSticker.value) return
  engine?.removeSticker(selectedSticker.value.id)
}
function showWhole() {
  view.value = 'whole'
  propertyPartId.value = null
  rightTab.value = 'design'
  engine?.setSelection('global')
  engine?.setView('whole')
}
const preWatchView = ref('whole')
const nativeFullscreen = ref(false)
async function setMode(next) {
  if (next === interactionMode.value) return
  if (next === 'watch') {
    preWatchView.value = view.value === 'focus' ? 'whole' : view.value
  }
  interactionMode.value = next
  view.value = next === 'watch' ? 'whole' : preWatchView.value || 'butt'
  engine?.setReadOnly(next === 'watch')
  engine?.setView(view.value)
  if (next === 'watch') {
    try {
      await canvasAreaEl.value?.requestFullscreen?.()
      nativeFullscreen.value = document.fullscreenElement === canvasAreaEl.value
    } catch {
      nativeFullscreen.value = false
    }
  } else if (document.fullscreenElement === canvasAreaEl.value) {
    nativeFullscreen.value = false
    await document.exitFullscreen?.()
  } else {
    nativeFullscreen.value = false
  }
}
function resetView() {
  view.value = watching.value ? 'whole' : 'butt'
  propertyPartId.value = null
  engine?.setSelection('global')
  engine?.setReadOnly(watching.value)
  engine?.setView(view.value)
}
function fullScreenChanged() {
  if (nativeFullscreen.value && document.fullscreenElement !== canvasAreaEl.value && watching.value) {
    nativeFullscreen.value = false
    void setMode('design')
  }
}
function freshSnapshot() {
  return {
    name: '未命名球杆', cueTemplateId: 'nineball', blankAssetId: 'builtin-cue-nineball',
    partOverrides: {}, globalFinish: 'gloss', stickers: []
  }
}

function activateBlankAsset(asset) {
  const specification = asset.specification || {}
  const isBuiltInNineball = specification.cue_template_id === 'nineball'
  const cueTemplate = isBuiltInNineball ? null : templateFromSpecification(specification, asset.name)
  if (cueTemplate) {
    cueTemplate.sizeStatus = specification.size_status === '示意尺寸' ? '示意尺寸' : '用户指定尺寸'
    cueTemplate.sizeSource = specification.size_source || (asset.source === 'ai' ? 'AI 尺寸草案' : '素材库尺寸')
  }
  designId.value = null
  name.value = `${asset.name} · 新设计`
  snapshot.value = {
    ...freshSnapshot(),
    name: name.value,
    cueTemplateId: cueTemplate?.id || 'nineball',
    ...(cueTemplate ? { cueTemplate } : {}),
    blankAssetId: asset.id
  }
  engine?.setSnapshot(snapshot.value)
  propertyPartId.value = null
  selection.value = { kind: 'global' }
  setSelectionToast('global')
  view.value = 'butt'
  rightTab.value = 'design'
  engine?.setView('butt')
  cleanState = currentState.value
}

async function changeBlankAsset(id) {
  const asset = assets.value.find((item) => item.id === id && item.kind === 'blank')
  if (!asset || id === activeBlankAssetId.value || !(await confirmUnsavedChanges())) return
  activateBlankAsset(asset)
  const query = asset.id === 'builtin-cue-nineball' ? {} : { asset: asset.id }
  skipNextRouteLoad = true
  await router.replace({ path: '/cue/design', query })
}

async function newDesign() {
  if (!(await confirmUnsavedChanges())) return
  const defaultAsset = assets.value.find((item) => item.id === 'builtin-cue-nineball')
  if (defaultAsset) activateBlankAsset(defaultAsset)
  else {
    designId.value = null
    name.value = '未命名球杆'
    snapshot.value = freshSnapshot()
    engine?.setSnapshot(snapshot.value)
    cleanState = currentState.value
  }
  interactionMode.value = 'design'
  engine?.setReadOnly(false)
  skipNextRouteLoad = true
  await router.replace('/cue/design')
}

function confirmUnsavedChanges() {
  if (!isDirty.value) return Promise.resolve(true)
  return new Promise((resolve) => {
    pendingSavePrompt.value = resolve
    savePromptOpen.value = true
  })
}

function finishSavePrompt(continueEditing) {
  savePromptOpen.value = false
  pendingSavePrompt.value?.(continueEditing)
  pendingSavePrompt.value = null
}

async function saveAndContinue() {
  const saved = await save()
  if (saved) finishSavePrompt(true)
}

function discardAndContinue() { finishSavePrompt(true) }
function cancelPendingChange() { finishSavePrompt(false) }

function chatContext() {
  const part = selectedPart.value
  return {
    cue_name: name.value,
    cue_type: templateName.value,
    part_name: part?.name || '',
    part_length_mm: part && 'a0' in part ? numberValue(part.a1 - part.a0) : '',
    part_diameter_mm: part && 'a0' in part ? numberValue(Math.max(part.r0, part.r1) * 2) : part?.radius ? numberValue(part.radius * 2) : ''
  }
}

function attachChatImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    message.error('请选择图片文件')
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    message.error('图片大小不能超过 10 MB')
    return
  }
  if (chatImage.value?.url) URL.revokeObjectURL(chatImage.value.url)
  chatImage.value = { file, name: file.name, url: URL.createObjectURL(file) }
}

function removeChatImage() {
  if (chatImage.value?.url) URL.revokeObjectURL(chatImage.value.url)
  chatImage.value = null
}

async function sendCueMessage() {
  const content = chatDraft.value.trim()
  if (!content || chatSending.value) return
  const attachment = chatImage.value
  chatMessages.value.push({ role: 'user', content, imageUrl: attachment?.url, imageName: attachment?.name })
  chatDraft.value = ''
  chatImage.value = null
  chatSending.value = true
  try {
    const response = await chatCueAi({
      messages: chatMessages.value.filter((item) => item.role === 'user' || item.role === 'assistant').slice(-24)
        .map(({ role, content: messageContent }) => ({ role, content: messageContent })),
      context: chatContext()
    })
    chatMessages.value.push({ role: 'assistant', content: response.message })
  } catch (cause) {
    chatMessages.value.push({ role: 'assistant', content: cause.message || 'AI 暂时无法回复，请稍后再试。', error: true })
  } finally {
    chatSending.value = false
  }
}

async function ensureAssetBlob(asset) {
  if (!engine) throw new Error('三维画布尚未就绪')
  if (asset.source === 'builtin') {
    const url = builtinPatternUrl(asset.blobKey)
    if (!url) throw new Error('系统素材文件不存在')
    const response = await fetch(url)
    if (!response.ok) throw new Error('系统素材载入失败')
    await engine.cacheAssetImage(asset.id, await response.blob())
    return
  }
  await engine.cacheAssetImage(asset.id, await fetchCueAssetImage(asset.id))
}

async function loadAssets() {
  const apiAssets = await listCueAssets()
  assets.value = apiAssets
  const engineAssets = [
    ...BUILTIN_ASSETS,
    ...apiAssets
      .filter((item) => item.kind !== 'blank')
      .map((item) => ({
        id: item.id, name: item.name, source: item.source, kind: item.kind, tags: item.tags || [],
        category: item.category, description: item.description,
        w: item.width_px || 0, h: item.height_px || 0, blobKey: `blob:${item.id}`,
        createdAt: Date.parse(item.created_at) || Date.now()
      }))
  ]
  engine?.setAssets(engineAssets)

  await Promise.all(apiAssets
    .filter((item) => item.has_image && (item.kind === 'pattern' || item.kind === 'sticker') && !assetPreviews[item.id])
    .map(async (item) => {
      const blob = await fetchCueAssetImage(item.id)
      assetPreviews[item.id] = URL.createObjectURL(blob)
    }))

  const usedIds = new Set(snapshot.value.stickers.map((item) => item.assetId))
  await Promise.all([...usedIds].map(async (id) => {
    const asset = [...BUILTIN_ASSETS, ...apiAssets].find((item) => item.id === id)
    if (asset) await ensureAssetBlob(asset)
  }))
}

function partMetrics(part) {
  if ('a0' in part) {
    return { kind: 'lathe', width: 2 * Math.PI * (part.r0 + part.r1) / 2, height: part.a1 - part.a0 }
  }
  return { kind: 'face', width: part.radius * 2, height: part.radius * 2 }
}

function openPatternPicker() {
  if (!selectedPart.value || watching.value) return
  patternDraftId.value = ''
  patternPickerOpen.value = true
}

async function applySelectedPattern() {
  const asset = patternPickerAssets.value.find((item) => item.id === patternDraftId.value)
  const part = selectedPart.value
  if (!engine || !asset || !part) {
    message.warning('请先选择球杆部位和素材')
    return
  }
  applyingPattern.value = true
  error.value = ''
  try {
    await ensureAssetBlob(asset)
    const metrics = partMetrics(part)
    const { width, height } = patternSurfaceSize(metrics)
    const sticker = {
      id: crypto.randomUUID(),
      name: asset.name,
      assetId: asset.id,
      processedRev: 0,
      target: metrics.kind === 'face'
        ? { kind: 'face', faceId: part.id, fx: 0, fz: 0 }
        : { kind: 'lathe', segId: part.id, a: (part.a0 + part.a1) / 2, angDeg: 70 },
      w: width,
      h: height,
      rotDeg: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
      z: Math.max(0, ...snapshot.value.stickers.map((item) => item.z)) + 1,
      hidden: false,
      locked: false
    }
    engine.addSticker(sticker)
    engine.selectSticker(sticker.id)
    patternPickerOpen.value = false
    message.success(`${asset.name} 已应用到${partLabel(part.name)}`)
  } catch (cause) {
    error.value = cause.message || '素材应用失败'
  } finally {
    applyingPattern.value = false
  }
}

async function preparePatternFromRoute(patternId) {
  const asset = patternPickerAssets.value.find((item) => item.id === patternId)
  if (!asset) return
  patternDraftId.value = asset.id
  patternPickerOpen.value = true
  rightTab.value = 'design'
  if (!selectedPart.value) {
    const defaultPart = parts.value.find((item) => item.id === 'butt-forearm') || parts.value.find((item) => item.printEnabled)
    if (defaultPart) {
      view.value = 'focus'
      engine?.focusPart(defaultPart.id)
    }
  }
}

async function loadRoute() {
  if (!engine) return
  propertyPartId.value = null
  engine.setSelection('global')
  loading.value = true
  error.value = ''
  interactionMode.value = 'design'
  engine.setReadOnly(false)
  engine.setPlacementAsset(null)
  try {
    if (route.query.id) {
      const work = await getCueDesign(String(route.query.id))
      designId.value = work.id
      name.value = work.name
      snapshot.value = work.snapshot
      engine.setSnapshot(work.snapshot)
    } else if (route.query.proposal) {
      const proposal = await getCueProposal(String(route.query.proposal), Number(route.query.variant || 0))
      designId.value = null
      name.value = proposal.title
      snapshot.value = await hydrateProposalSnapshot(proposal.snapshot)
      engine.setSnapshot(snapshot.value)
    } else if (route.query.sku) {
      const skus = await listCueSkus(String(route.query.sku))
      const sku = skus.find((item) => item.code === route.query.sku)
      if (!sku) throw new Error('SKU 不存在')
      designId.value = null
      name.value = `${sku.name} · 新设计`
      const template = templateFromSpecification(sku.specification || {}, sku.name)
      snapshot.value = { ...freshSnapshot(), name: name.value, cueTemplateId: template.id, cueTemplate: template, sourceSku: sku.code, skuSpecification: sku.specification }
      engine.setSnapshot(snapshot.value)
    } else if (route.query.asset) {
      const catalogue = await listCueAssets('blank')
      const blank = catalogue.find((item) => item.id === route.query.asset)
      if (!blank) throw new Error('光杆素材不存在')
      const specification = blank.specification || {}
      const template = specification.cue_template_id === 'nineball'
        ? null
        : templateFromSpecification(specification, blank.name)
      if (template) {
        template.sizeStatus = specification.size_status === '示意尺寸' ? '示意尺寸' : '用户指定尺寸'
        template.sizeSource = specification.size_source || (blank.source === 'ai' ? 'AI 尺寸草案' : '素材库尺寸')
      }
      designId.value = null
      name.value = `${blank.name} · 新设计`
      snapshot.value = {
        ...freshSnapshot(), name: name.value,
        cueTemplateId: template?.id || 'nineball',
        ...(template ? { cueTemplate: template } : {}),
        blankAssetId: blank.id
      }
      engine.setSnapshot(snapshot.value)
    } else {
      designId.value = null
      name.value = '未命名球杆'
      engine.setSnapshot(freshSnapshot())
    }
    view.value = 'butt'
    rightTab.value = 'design'
    engine.setView('butt')
    await loadAssets()
    if (route.query.pattern) await preparePatternFromRoute(String(route.query.pattern))
    cleanState = currentState.value
  } catch (cause) { error.value = cause.message || '加载设计失败' }
  finally { loading.value = false }
}

async function save() {
  if (!engine) return false
  saving.value = true
  error.value = ''
  try {
    const payload = { name: name.value, snapshot: { ...engine.getSnapshot(), name: name.value } }
    const work = designId.value ? await updateCueDesign(designId.value, payload) : await createCueDesign(payload)
    designId.value = work.id
    snapshot.value = payload.snapshot
    cleanState = currentState.value
    message.success(`作品已保存 · 版本 ${work.version}`)
    if (route.query.id !== work.id) {
      skipNextRouteLoad = true
      await router.replace({ path: '/cue/design', query: { id: work.id } })
    }
    return true
  } catch (cause) { error.value = cause.message || '保存失败'; return false }
  finally { saving.value = false }
}

onMounted(async () => {
  await nextTick()
  engine = mountCueCanvas(canvasEl.value, {
    onChange: (value) => { snapshot.value = value },
    onSelection: (kind, id) => {
      selection.value = { kind, id }
      const faceIndex = kind === 'part' ? template.value.faces.findIndex((face) => face.id === id) : -1
      const displayId = faceIndex >= 0
        ? (faceIndex === 0 ? parts.value[0]?.id : parts.value.at(-1)?.id)
        : id
      propertyPartId.value = propertyPartAfterSelection(propertyPartId.value, { kind, id: displayId })
      setSelectionToast(kind)
      if (kind === 'part' && id) {
        view.value = 'focus'
        rightTab.value = 'design'
      }
    },
    onReady: () => { ready.value = true }
  })
  document.addEventListener('fullscreenchange', fullScreenChanged)
  await loadRoute()
})
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', fullScreenChanged)
  clearTimeout(selectionTimer)
  if (document.fullscreenElement === canvasAreaEl.value) void document.exitFullscreen?.()
  if (chatImage.value?.url) URL.revokeObjectURL(chatImage.value.url)
  chatMessages.value.forEach((item) => { if (item.imageUrl) URL.revokeObjectURL(item.imageUrl) })
  engine?.setAutoRotate(false)
  engine?.dispose()
  engine = null
  Object.values(assetPreviews).forEach((url) => URL.revokeObjectURL(url))
})
watch(() => route.fullPath, async (current, previous) => {
  if (current === previous) return
  if (skipNextRouteLoad) {
    skipNextRouteLoad = false
    return
  }
  const nextRoute = router.resolve(current)
  const previousRoute = router.resolve(previous)
  // The cached designer remains mounted while other pages are active. Those
  // pages may change their own query parameters without leaving the draft.
  if (nextRoute.path !== '/cue/design') return
  if (previousRoute.path !== '/cue/design') {
    // Keep the editable draft alive while the cached designer is temporarily
    // deactivated for read-only pages such as My Works.
    const nextDesignId = nextRoute.query.id ? String(nextRoute.query.id) : null
    const activeDesignId = designId.value ? String(designId.value) : null
    if (nextDesignId === activeDesignId) return
  }
  const shouldContinue = await confirmUnsavedChanges()
  if (!shouldContinue) {
    skipNextRouteLoad = true
    await router.replace(previous)
    return
  }
  await loadRoute()
})
watch(
  () => [selection.value.kind, selection.value.id, snapshot.value.stickers, selectedOverride.value.color, selectedOverride.value.colorOpacity],
  syncWrapConfig,
  { immediate: true }
)
</script>

<style scoped>
.cue-design-page {
  --cue-line: var(--gray-200);
  --cue-soft-line: #dfe4d8;
  --cue-stage: #e8eae2;
  --cue-accent: var(--main-700);
  --cue-motion: 160ms cubic-bezier(.22, 1, .36, 1);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--gray-25);
}
.cue-name { width: 180px; }
.cue-alert { margin: 8px var(--page-padding) 0; }
.cue-design-shell {
  display: grid;
  grid-template-columns: minmax(150px, 168px) minmax(0, 1fr) minmax(280px, 330px);
  gap: 12px;
  flex: 1;
  min-height: 0;
  padding: 8px 12px 12px;
}
.cue-panel {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--cue-line);
  border-radius: 14px;
  background: var(--main-1);
  box-shadow: 0 6px 20px color-mix(in srgb, var(--main-900) 5%, transparent);
}
.cue-panel-left,
.cue-panel-right { display: flex; flex-direction: column; }
.cue-panel-left[aria-disabled='true'],
.cue-panel-right[aria-disabled='true'] { opacity: .55; }
.cue-panel-head { flex: 0 0 auto; padding: 14px 13px 10px; border-bottom: 1px solid var(--gray-100); }
.cue-panel-head h2 { margin: 0; color: var(--gray-1000); font-size: 14px; font-weight: 650; }
.cue-panel-head p { margin: 5px 0 0; color: var(--gray-600); font-size: 11px; }
.cue-overview-button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  min-height: 40px;
  margin: 8px 10px 2px;
  padding: 9px 10px;
  border: 1px solid var(--gray-150);
  border-radius: 8px;
  background: transparent;
  color: #607457;
  font-size: 12px;
  transition: background-color var(--cue-motion), border-color var(--cue-motion), color var(--cue-motion);
}
.cue-overview-button:hover,
.cue-overview-button[aria-pressed='true'] { border-color: #aebfa9; background: var(--gray-25); color: #294f36; }
.cue-part-list {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  padding: 8px 10px;
}
.cue-part-list > button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 9px 10px;
  border: 1px solid var(--gray-150);
  border-radius: 8px;
  background: transparent;
  color: #63765b;
  font-size: 12px;
  text-align: left;
  transition: background-color var(--cue-motion), border-color var(--cue-motion), color var(--cue-motion);
}
.cue-part-list > button:hover { border-color: var(--gray-300); background: var(--gray-25); color: #315838; }
.cue-part-list > button[aria-pressed='true'] { border-color: #aebfa9; background: var(--gray-25); color: #244c33; font-weight: 600; }
.cue-list-index { flex: 0 0 auto; min-width: 20px; color: #91a089; font-size: 10px; font-variant-numeric: tabular-nums; }
.cue-list-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cue-part-list > button > svg { flex: 0 0 auto; }
.cue-parts-hint { flex: 0 0 auto; padding: 10px 12px 12px; border-top: 1px solid var(--gray-100); color: #86927e; font-size: 10px; line-height: 1.65; }
.cue-canvas-area {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--cue-line);
  border-radius: 14px;
  background: var(--main-1);
  box-shadow: 0 6px 20px color-mix(in srgb, var(--main-900) 5%, transparent);
}
.cue-preview-toolbar {
  display: flex;
  z-index: 2;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  min-height: 42px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--cue-soft-line);
  background: #fdfefa;
}
.cue-preview-title { display: flex; min-width: 0; align-items: center; gap: 9px; color: var(--gray-800); font-size: 12px; }
.cue-preview-title strong { flex: 0 0 auto; font-weight: 600; }
.cue-preview-title > span:last-child { max-width: 210px; overflow: hidden; border-left: 1px solid #d7ded2; padding-left: 16px; color: #7b8678; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.cue-live-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: #55916d; box-shadow: 0 0 0 4px #edf2e8; }
.cue-model-select { min-width: 150px; max-width: min(250px, 35vw); margin-left: auto; }
.cue-model-select :deep(.ant-select-selector) { height: 32px; border-color: #dfe5d8 !important; border-radius: 8px !important; font-size: 11px; }
.cue-background-switch { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; }
.cue-background-switch button { display: grid; width: 27px; height: 27px; padding: 3px; place-items: center; border: 1px solid transparent; border-radius: 50%; background: transparent; cursor: pointer; }
.cue-background-switch button[aria-pressed='true'] { border-color: #65866a; }
.cue-background-switch button span { width: 17px; height: 17px; border: 1px solid #aab1a2; border-radius: 50%; }
.cue-preview-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--cue-stage); }
.cue-canvas { position: absolute; inset: 0; z-index: 1; }
.cue-stage-watermark { position: absolute; top: 64px; left: 30px; z-index: 2; pointer-events: none; color: #cbd2c5; font-size: clamp(17px, 2vw, 30px); font-weight: 250; letter-spacing: 4px; opacity: .48; }
.cue-stage-label { position: absolute; top: 24px; left: 28px; z-index: 2; pointer-events: none; line-height: 1.25; }
.cue-stage-label span { color: #71806e; font-size: 10px; letter-spacing: 2px; }
.cue-stage-label p { margin-top: 3px; color: #929b8b; font-size: 9px; line-height: 1.25; }
.cue-stage-tip { position: absolute; bottom: 87px; left: 24px; z-index: 3; display: flex; max-width: min(320px, calc(100% - 48px)); align-items: flex-start; gap: 10px; padding: 12px 10px 12px 14px; border: 1px solid #fff; border-radius: 12px; background: #fdfefaeb; box-shadow: 0 4px 16px color-mix(in srgb, var(--main-900) 6%, transparent); color: #4e654e; font-size: 12px; line-height: 1.8; }
.cue-stage-tip > svg { margin-top: 5px; flex: 0 0 auto; }
.cue-stage-tip small { color: #85917e; font-size: 10px; }
.cue-stage-tip button { display: grid; width: 28px; height: 32px; flex: 0 0 auto; place-items: center; color: #839079; }
.cue-selection-note { position: absolute; right: auto; bottom: 87px; left: 50%; z-index: 3; display: flex; width: max-content; max-width: calc(100% - 48px); align-items: center; gap: 8px; padding: 5px 7px 5px 12px; transform: translateX(-50%); border: 1px solid #d8dfd0; border-radius: 10px; background: #fffef7f5; box-shadow: 0 4px 20px color-mix(in srgb, var(--main-900) 7%, transparent); color: #425840; font-size: 11px; }
.cue-selection-note > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cue-selection-note button { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; margin-left: auto; color: var(--cue-accent); }
.cue-studio-views { position: absolute; right: 0; bottom: 24px; left: 0; z-index: 3; display: flex; align-items: center; justify-content: center; gap: 9px; pointer-events: none; }
.cue-mode-switch { display: flex; padding: 4px; border: 1px solid #fff; border-radius: 12px; background: #fdfefaeb; box-shadow: 0 3px 12px color-mix(in srgb, var(--main-900) 5%, transparent); pointer-events: auto; transition: background-color var(--cue-motion), border-color var(--cue-motion), box-shadow var(--cue-motion); }
.cue-mode-switch button { display: flex; min-height: 40px; align-items: center; justify-content: center; gap: 6px; padding: 8px 18px; border: 0; border-radius: 8px; background: transparent; color: #718169; font-family: inherit; font-size: 12px; cursor: pointer; transition: background-color var(--cue-motion), color var(--cue-motion); }
.cue-mode-switch button[aria-pressed='true'] { background: #294b35; color: white; }
.cue-preview-stage[data-bg-mode='dark'] .cue-mode-switch { border-color: #59635d; background: rgb(28 33 37 / 90%); box-shadow: 0 4px 18px rgb(0 0 0 / 24%); }
.cue-preview-stage[data-bg-mode='dark'] .cue-mode-switch button { color: #eef2ed; }
.cue-preview-stage[data-bg-mode='dark'] .cue-mode-switch button[aria-pressed='true'] { background: #527c60; color: #fff; }
.cue-auto-rotate,
.cue-reset-view,
.cue-watch-exit { display: flex; min-height: 42px; align-items: center; justify-content: center; gap: 7px; padding: 7px 13px; border: 1px solid white; border-radius: 10px; background: #fdfefaeb; color: #718169; box-shadow: 0 3px 12px color-mix(in srgb, var(--main-900) 5%, transparent); font-family: inherit; font-size: 11px; cursor: pointer; pointer-events: auto; }
.cue-auto-rotate,
.cue-reset-view,
.cue-watch-exit { transition: background-color var(--cue-motion), border-color var(--cue-motion), color var(--cue-motion), box-shadow var(--cue-motion); }
.cue-auto-rotate[aria-pressed='true'] { border-color: #436a4d; background: #294b35; color: white; }
.cue-preview-stage[data-bg-mode='dark'] .cue-auto-rotate,
.cue-preview-stage[data-bg-mode='dark'] .cue-reset-view,
.cue-preview-stage[data-bg-mode='dark'] .cue-watch-exit { border-color: #59635d; background: rgb(28 33 37 / 90%); color: #f3f5f2; box-shadow: 0 4px 18px rgb(0 0 0 / 24%); }
.cue-preview-stage[data-bg-mode='dark'] .cue-auto-rotate[aria-pressed='true'] { border-color: #73957a; background: #527c60; color: #fff; }
.cue-reset-view { font-weight: 600; }
.cue-watch-exit { position: absolute; top: 16px; right: 16px; z-index: 5; }
.cue-watch-fullscreen { position: fixed !important; inset: 0; z-index: 10000; width: 100vw; height: 100dvh; border: 0; border-radius: 0; }
.cue-watch-fullscreen:fullscreen { width: 100vw; height: 100dvh; border: 0; border-radius: 0; }
.cue-watch-fullscreen .cue-preview-tools { display: none; }
.cue-canvas-loading { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; background: color-mix(in srgb, var(--cue-stage) 80%, transparent); pointer-events: none; }
.cue-preview-tools { display: flex; flex: 0 0 140px; height: 140px; min-width: 0; flex-direction: column; gap: 8px; overflow: hidden; padding: 8px 14px; border-top: 1px solid var(--gray-150); background: #fdfefa; box-sizing: border-box; }
.cue-preview-tools[aria-disabled='true'] { opacity: .55; }
.cue-tools-context { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 14px; font-size: 12px; }
.cue-tools-context strong { overflow: hidden; color: var(--gray-900); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.cue-tools-content { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 8px; overflow: auto; }
.cue-tool-row { display: flex; min-width: 0; align-items: flex-end; gap: 12px; overflow-x: auto; padding: 0 0 3px; }
.cue-tool-field { display: flex; flex: 0 0 auto; flex-direction: column; gap: 5px; color: #77866d; font-size: 10px; }
.cue-tool-field > span { white-space: nowrap; }
.cue-tool-field :deep(.ant-input-number) { width: 76px; height: 30px; }
.cue-tool-field :deep(.ant-input-number-input) { height: 28px; padding: 0 7px; font-size: 11px; }
.cue-tool-opacity { width: 150px; }
.cue-tool-opacity :deep(.ant-slider) { min-width: 140px; margin: 6px 4px; }
.cue-tool-actions { display: flex; flex: 0 0 auto; flex-wrap: nowrap; align-items: center; gap: 7px; overflow-x: auto; padding-bottom: 3px; }
.cue-tool-actions :deep(.ant-btn) { flex: 0 0 auto; }
.cue-tool-actions :deep(.ant-btn) { height: 30px; min-height: 30px; padding: 3px 7px; border-color: #e1e7dc; border-radius: 6px; color: #607657; font-size: 11px; }
.cue-tool-actions :deep(.ant-btn:hover) { border-color: #b8c9b4; color: #285c38; }
.cue-part-tools-hint { display: flex; min-height: 0; flex-direction: column; align-items: flex-start; gap: 6px; color: var(--gray-600); font-size: 11px; }
.cue-part-dimensions { display: flex; width: 100%; align-items: center; gap: 8px; }
.cue-part-dimensions > div { display: flex; min-width: 72px; flex: 0 1 110px; flex-direction: column; gap: 3px; padding: 6px 9px; border: 1px solid #e3e8df; border-radius: 7px; background: #fff; }
.cue-part-dimensions span { color: #87917f; font-size: 10px; }
.cue-part-dimensions strong { color: #394c3c; font-size: 12px; font-variant-numeric: tabular-nums; }
.cue-tools-hint { margin: 0; color: var(--gray-500); font-size: 11px; }
.cue-right-tabs { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.cue-right-tabs :deep(.ant-tabs-nav) { flex: 0 0 auto; margin: 0; padding: 0 12px; }
.cue-right-tabs :deep(.ant-tabs-content-holder) { min-height: 0; flex: 1; overflow: hidden; }
.cue-right-tabs :deep(.ant-tabs-content),
.cue-right-tabs :deep(.ant-tabs-tabpane) { height: 100%; }
.cue-panel-body { min-height: 0; padding: 16px 14px; }
.cue-design-tab-layout { height: 100%; min-height: 0; }
.cue-design-tab-layout > .cue-panel-body { height: 100%; overflow: auto; }
.cue-ai-design { display: flex; flex: 0 0 252px; min-height: 200px; flex-direction: column; overflow: hidden; border-top: 1px solid var(--gray-150); background: #fbfcf9; }
.cue-ai-design > header { display: flex; flex: 0 0 auto; align-items: center; gap: 7px; padding: 10px 14px 7px; color: #385a40; font-size: 12px; }
.cue-ai-messages { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 7px; overflow: auto; padding: 4px 12px; }
.cue-ai-message { max-width: 94%; align-self: flex-start; padding: 7px 10px; border-radius: 10px 10px 10px 3px; background: #edf1e9; color: #465346; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.cue-ai-message.is-user { align-self: flex-end; border-radius: 10px 10px 3px 10px; background: #e0ece0; color: #294832; }
.cue-ai-message p { margin: 0; white-space: pre-wrap; }
.cue-ai-message img { display: block; max-width: 160px; max-height: 120px; margin-bottom: 5px; border-radius: 6px; object-fit: contain; }
.cue-ai-status { margin: 0; color: var(--gray-500); font-size: 10px; }
.cue-ai-attachment { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; padding: 4px 12px; color: var(--gray-600); font-size: 10px; }
.cue-ai-attachment img { width: 36px; height: 30px; border-radius: 4px; object-fit: cover; }
.cue-ai-attachment span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cue-ai-attachment button { display: grid; width: 26px; height: 26px; place-items: center; }
.cue-ai-composer { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; margin: 6px 10px 4px; padding: 5px 6px 5px 10px; border: 1px solid #dfe5da; border-radius: 10px; background: #fff; box-shadow: 0 2px 8px rgb(40 65 44 / 5%); }
.cue-ai-composer input[type='text'] { min-width: 0; height: 32px; flex: 1; padding: 0 4px 0 0; border: 0; outline: 0; background: transparent; color: var(--gray-900); font: inherit; font-size: 11px; }
.cue-ai-composer input[type='text']::placeholder { color: var(--gray-400); }
.cue-ai-composer-actions { display: flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: 4px; }
.cue-ai-file { display: none; }
.cue-ai-upload,
.cue-ai-send { display: grid; width: 30px; height: 30px; place-items: center; border: 0; border-radius: 7px; background: transparent; color: #6f806a; cursor: pointer; }
.cue-ai-upload:hover { background: #edf2e9; color: #315a3c; }
.cue-ai-send { background: #315a3c; color: #fff; }
.cue-ai-send:disabled { background: #d7ded3; cursor: not-allowed; }
.cue-ai-footnote { flex: 0 0 auto; margin: 0; padding: 0 12px 7px; color: #9aa391; font-size: 9px; }
.cue-layers-tab { position: relative; }
.cue-layers-count { position: absolute; top: -9px; right: -18px; display: grid; min-width: 15px; height: 14px; padding: 0 3px; place-items: center; border-radius: 2px; background: #c83b36; color: white; font-size: 9px; line-height: 1; }
.cue-save-prompt-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 22px; }
.cue-muted { margin: 0 0 14px; color: var(--gray-600); font-size: 12px; line-height: 1.7; }
.cue-pattern-action { margin-bottom: 16px; }
.cue-color-input { width: 100%; height: 36px; border: 1px solid var(--gray-200); border-radius: 6px; background: transparent; }
.cue-wrap-config { margin: 4px 0 16px; padding: 12px; border: 1px solid var(--gray-150); border-radius: 8px; background: var(--gray-0); }
.cue-wrap-config h3 { margin: 0 0 10px; color: var(--gray-900); font-size: 13px; font-weight: 600; }
.cue-wrap-config :deep(.ant-form-item) { margin-bottom: 10px; }
.cue-wrap-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.cue-wrap-config > p { margin: 9px 0 0; color: var(--gray-600); font-size: 10px; line-height: 1.7; }
.cue-panel-body :deep(.ant-form-item) { margin-bottom: 14px; }
.cue-panel-body :deep(.ant-form-item-label > label) { color: var(--gray-700); font-size: 12px; }
.cue-layer-panel { display: flex; flex: 1; min-height: 0; flex-direction: column; overflow: hidden; border-radius: 16px; background: #fff; }
.cue-layer-header { padding: 20px 18px 16px; border-bottom: 1px solid #e9ede4; }
.cue-layer-header h3 { margin: 0; color: #2c573c; font-size: 15px; font-weight: 600; }
.cue-layer-header p { margin: 6px 0 0; color: #829078; font-size: 11px; line-height: 1.8; }
.cue-layer-list { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 4px; overflow: auto; padding: 8px; }
.cue-layer-row { display: flex; min-width: 0; min-height: 44px; align-items: center; gap: 4px; padding: 6px 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; font-size: 14px; transition: background-color var(--cue-motion), color var(--cue-motion), box-shadow var(--cue-motion); }
.cue-layer-row:hover { background: #e8ede4; }
.cue-layer-row.is-selected { background: rgb(36 107 80 / 15%); box-shadow: 0 0 0 1px rgb(36 107 80 / 40%); }
.cue-layer-row[draggable='true'] { cursor: grab; }
.cue-layer-row.is-dragging { opacity: .55; }
.cue-layer-row.is-drop-before { box-shadow: inset 0 2px 0 #246b50; }
.cue-layer-row.is-drop-after { box-shadow: inset 0 -2px 0 #246b50; }
.cue-layer-drag-handle { display: grid; width: 12px; flex: 0 0 auto; place-items: center; color: #829078; cursor: grab; }
.cue-layer-eye,
.cue-layer-action { display: grid; width: 24px; height: 24px; flex: 0 0 auto; padding: 2px; place-items: center; border: 0; border-radius: 4px; background: transparent; color: #56695c; cursor: pointer; transition: background-color var(--cue-motion), color var(--cue-motion); }
.cue-layer-eye:hover,
.cue-layer-action:hover { background: #dce3d8; color: #182f22; }
.cue-layer-action.is-danger:hover { background: #fce8e5; color: #a43e36; }
.cue-layer-main { display: flex; min-width: 0; min-height: 30px; flex: 1; flex-direction: column; justify-content: center; gap: 1px; padding: 0; border: 0; background: transparent; color: #293f31; font: inherit; text-align: left; cursor: pointer; }
.cue-layer-main span { overflow: hidden; color: inherit; font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.cue-layer-main small { overflow: hidden; color: #6c7b60; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.cue-layer-row.is-hidden .cue-layer-main,
.cue-layer-row.is-hidden .cue-layer-eye { color: #b6c3b8; }
.cue-layer-row.is-hidden .cue-layer-main span { text-decoration: line-through; }
.cue-layer-panel button:focus-visible { outline: 2px solid #246b50; outline-offset: 2px; }

@media (max-width: 1200px) {
  .cue-design-shell { grid-template-columns: minmax(142px, 156px) minmax(0, 1fr) minmax(260px, 300px); gap: 9px; padding-right: 9px; padding-left: 9px; }
  .cue-preview-title > span:last-child { max-width: 130px; }
}
@media (max-width: 980px) {
  .cue-design-shell { grid-template-columns: minmax(142px, 170px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .cue-panel-right { grid-column: 1 / -1; min-height: 380px; max-height: 440px; }
}
@media (max-width: 700px) {
  .cue-design-shell { grid-template-columns: 1fr; grid-template-rows: minmax(440px, 58vh) auto auto; overflow: auto; padding: 8px; }
  .cue-canvas-area { grid-row: 1; }
  .cue-panel-left { min-height: 260px; max-height: 460px; }
  .cue-panel-right { min-height: 420px; max-height: 72vh; }
  .cue-preview-toolbar { align-items: center; }
  .cue-preview-title { flex: 1 1 100%; }
  .cue-model-select { max-width: calc(100% - 80px); margin-left: 0; }
  .cue-stage-watermark,
  .cue-stage-label p { display: none; }
  .cue-stage-label { top: 20px; left: 18px; }
  .cue-stage-tip { right: 12px; bottom: 76px; left: 12px; max-width: none; }
  .cue-selection-note { bottom: 76px; max-width: calc(100% - 24px); }
  .cue-studio-views { bottom: 14px; gap: 5px; }
  .cue-mode-switch button { min-height: 38px; padding: 7px 12px; font-size: 11px; }
  .cue-auto-rotate, .cue-reset-view { min-height: 38px; padding: 6px 9px; }
  .cue-preview-tools { padding: 8px; }
  .cue-tool-opacity { width: 128px; }
}
@media (prefers-reduced-motion: reduce) {
  .cue-overview-button,
  .cue-part-list > button,
  .cue-mode-switch button,
  .cue-mode-switch,
  .cue-auto-rotate,
  .cue-reset-view,
  .cue-watch-exit,
  .cue-layer-row,
  .cue-layer-eye,
  .cue-layer-action { transition: none; }
}
</style>
