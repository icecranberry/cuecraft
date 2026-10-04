<template>
  <div class="cue-pattern-picker">
    <div class="cue-pattern-toolbar">
      <a-input-search v-model:value="query" allow-clear placeholder="搜索名称、分类、标签" aria-label="搜索花纹" />
      <a-select v-model:value="category" :options="categoryOptions" aria-label="素材分类" />
    </div>
    <div v-if="filtered.length" class="cue-pattern-grid">
      <button
        v-for="item in filtered"
        :key="item.id"
        type="button"
        class="cue-pattern-card"
        :aria-pressed="modelValue === item.id"
        :aria-label="`选择花纹 ${item.name}`"
        @click="choose(item.id)"
      >
        <span class="cue-pattern-art">
          <img v-if="previewUrl(item)" :src="previewUrl(item)" :alt="item.name" loading="lazy" />
          <Check v-if="modelValue === item.id" :size="14" />
        </span>
        <strong>{{ item.name }}</strong>
        <small>花纹 · {{ item.category }}</small>
      </button>
    </div>
    <ResourceEmptyState v-else size="compact" title="没有匹配素材" description="换个关键词或清除筛选后再试。" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Check } from '@lucide/vue'
import ResourceEmptyState from '@/components/shared/ResourceEmptyState.vue'
import { builtinPatternUrl } from '@/cue-engine/materials/patterns'

const props = defineProps({
  assets: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'select'])

const query = ref('')
const category = ref('all')
const categoryOptions = computed(() => {
  const values = [...new Set(props.assets
    .map((item) => item.category)
    .filter(Boolean))]
  return [{ label: '全部分类', value: 'all' }, ...values.map((value) => ({ label: value, value }))]
})
const filtered = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return props.assets.filter((item) => {
    if (category.value !== 'all' && item.category !== category.value) return false
    const haystack = [item.name, item.category, item.description, ...(item.tags || [])]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
})

function previewUrl(item) {
  if (item.source === 'builtin') return builtinPatternUrl(item.blobKey)
  return item.previewUrl || ''
}
function choose(id) {
  emit('update:modelValue', id)
  emit('select', id)
}
</script>

<style scoped>
.cue-pattern-picker { display: flex; min-height: 0; flex-direction: column; gap: 14px; }
.cue-pattern-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 160px; gap: 8px; align-items: center; }
.cue-pattern-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; max-height: min(58vh, 560px); overflow: auto; padding-right: 4px; }
.cue-pattern-card { min-width: 0; overflow: hidden; border: 1px solid var(--gray-150); border-radius: 8px; background: var(--gray-0); padding: 0 0 10px; text-align: left; transition: border-color 160ms cubic-bezier(.22, 1, .36, 1), background-color 160ms cubic-bezier(.22, 1, .36, 1); }
.cue-pattern-card:hover { border-color: var(--gray-300); background: var(--gray-25); }
.cue-pattern-card[aria-pressed='true'] { border-color: #8bb397; background: #f7fbf7; }
.cue-pattern-art { position: relative; display: grid; place-items: center; box-sizing: border-box; height: 130px; margin-bottom: 8px; overflow: hidden; padding: 8px; background: var(--gray-50); }
.cue-pattern-art img { position: absolute; inset: 8px; display: block; width: calc(100% - 16px); height: calc(100% - 16px); max-width: 100%; max-height: 100%; object-fit: contain; }
.cue-pattern-art svg { position: absolute; top: 7px; right: 7px; border-radius: 50%; background: #2f7654; color: #fff; }
.cue-pattern-card strong,
.cue-pattern-card small { display: block; margin: 0 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cue-pattern-card strong { color: var(--gray-900); font-size: 12px; font-weight: 600; }
.cue-pattern-card small { margin-top: 4px; color: var(--gray-600); font-size: 10px; }
@media (max-width: 900px) {
  .cue-pattern-toolbar { grid-template-columns: 1fr; }
  .cue-pattern-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 600px) { .cue-pattern-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
