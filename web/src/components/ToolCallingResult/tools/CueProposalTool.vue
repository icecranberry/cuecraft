<template>
  <BaseToolCall :tool-call="toolCall" :hide-params="true">
    <template #header><span>球杆方案 · {{ proposals.length ? '已生成三套候选' : '生成中' }}</span></template>
    <template #result="{}">
      <a-alert v-if="result?.error" type="error" :message="result.error" show-icon />
      <div v-else class="cue-proposal-cards">
        <div v-for="(item, index) in proposals" :key="index" class="cue-proposal-card">
          <strong>{{ item.title }}</strong>
          <p>{{ item.reason }}</p>
          <a-space>
            <RouterLink :to="item.preview_url"><a-button size="small">查看 3D</a-button></RouterLink>
            <RouterLink :to="item.edit_url"><a-button size="small" type="primary">继续设计</a-button></RouterLink>
          </a-space>
        </div>
      </div>
    </template>
  </BaseToolCall>
</template>

<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import BaseToolCall from '../BaseToolCall.vue'
import { parseToolCallResult } from '../toolRegistry'

const props = defineProps({ toolCall: { type: Object, required: true } })
const result = computed(() => parseToolCallResult(props.toolCall))
const proposals = computed(() => Array.isArray(result.value?.variants) ? result.value.variants : [])
</script>

<style scoped>
.cue-proposal-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.cue-proposal-card { padding: 12px; border: 1px solid var(--gray-150); border-radius: 8px; background: var(--gray-25); }
.cue-proposal-card strong { color: var(--gray-900); }
.cue-proposal-card p { min-height: 48px; color: var(--gray-600); }
@media (max-width: 760px) { .cue-proposal-cards { grid-template-columns: 1fr; } }
</style>
