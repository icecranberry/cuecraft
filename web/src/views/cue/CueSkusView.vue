<template>
  <div class="cue-skus-page">
    <PageHeader title="球杆 SKU" :loading="loading" :show-border="true">
      <template #actions><a-button v-if="userStore.isAdmin" type="primary" @click="importOpen = true">批量导入</a-button></template>
    </PageHeader>
    <PageShoulder v-model:search="search" search-placeholder="搜索 SKU 编号或名称" />
    <a-alert v-if="error" class="cue-alert" type="error" :message="error" show-icon closable @close="error = ''" />
    <div class="cue-skus-content">
      <ResourceEmptyState v-if="!loading && !rows.length" title="暂无 SKU" description="管理员可通过 CSV 或 Excel 导入厂家球杆目录。" />
      <a-table v-else :data-source="rows" :columns="columns" row-key="code" :loading="loading" :pagination="{ pageSize: 20 }" :scroll="{ x: 820 }">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'"><a-button type="link" @click="router.push({ path: '/cue/design', query: { sku: record.code } })">以此杆开稿</a-button></template>
          <template v-else-if="column.key === 'dimension'">{{ record.specification?.length_mm || '—' }}</template>
        </template>
      </a-table>
    </div>
    <a-modal v-model:open="importOpen" title="批量导入 SKU" width="min(900px, 96vw)" :ok-text="'确认导入'" :ok-button-props="{ disabled: !previewRows.length || previewRows.some((row) => row.errors.length) }" :confirm-loading="importing" @ok="commitImport">
      <a-alert type="info" message="支持 UTF-8 CSV 或 XLSX。必填列：SKU编号、名称、类别；可选列：系列、材质、尺寸JSON。重复编号将更新现有 SKU。" show-icon />
      <a-upload :before-upload="previewFile" :max-count="1" accept=".csv,.xlsx" class="cue-upload"><a-button :loading="previewing">选择 CSV / Excel</a-button></a-upload>
      <a-table v-if="previewRows.length" :data-source="previewRows" :columns="previewColumns" row-key="row" size="small" :pagination="{ pageSize: 8 }" :scroll="{ x: 700 }">
        <template #bodyCell="{ column, record }"><template v-if="column.key === 'errors'"><a-tag :color="record.errors.length ? 'error' : 'success'">{{ record.errors.join('；') || '通过' }}</a-tag></template></template>
      </a-table>
    </a-modal>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import PageShoulder from '@/components/shared/PageShoulder.vue'
import ResourceEmptyState from '@/components/shared/ResourceEmptyState.vue'
import { useUserStore } from '@/stores/user'
import { listCueSkus, previewCueSkuImport, commitCueSkuImport } from '@/apis/cue_api'

const router = useRouter()
const userStore = useUserStore()
const search = ref('')
const rows = ref([])
const previewRows = ref([])
const loading = ref(false)
const previewing = ref(false)
const importing = ref(false)
const importOpen = ref(false)
const error = ref('')
const columns = [
  { title: 'SKU 编号', dataIndex: 'code', key: 'code' },
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '类别', dataIndex: 'category', key: 'category' },
  { title: '系列', dataIndex: 'series', key: 'series' },
  { title: '材质', dataIndex: 'material', key: 'material' },
  { title: '长度 mm', key: 'dimension' },
  { title: '操作', key: 'action', fixed: 'right' }
]
const previewColumns = [
  { title: '行', dataIndex: 'row', key: 'row' }, { title: '编号', dataIndex: 'code', key: 'code' },
  { title: '名称', dataIndex: 'name', key: 'name' }, { title: '类别', dataIndex: 'category', key: 'category' },
  { title: '校验', key: 'errors' }
]
let timer

async function refresh() {
  loading.value = true
  error.value = ''
  try { rows.value = await listCueSkus(search.value) }
  catch (cause) { error.value = cause.message || 'SKU 加载失败' }
  finally { loading.value = false }
}
async function previewFile(file) {
  previewing.value = true
  previewRows.value = []
  error.value = ''
  try { previewRows.value = await previewCueSkuImport(file) }
  catch (cause) { error.value = cause.message || '文件解析失败' }
  finally { previewing.value = false }
  return false
}
async function commitImport() {
  importing.value = true
  error.value = ''
  try {
    const result = await commitCueSkuImport(previewRows.value)
    message.success(`导入完成：新增 ${result.created}，更新 ${result.updated}`)
    importOpen.value = false
    previewRows.value = []
    await refresh()
  } catch (cause) { error.value = cause.message || '导入失败' }
  finally { importing.value = false }
}
watch(search, () => { clearTimeout(timer); timer = setTimeout(refresh, 250) })
onMounted(refresh)
</script>

<style scoped>
.cue-skus-page { height: 100%; overflow: auto; background: var(--gray-25); }
.cue-skus-content { padding: 20px var(--page-padding); }
.cue-alert { margin: 12px var(--page-padding); }
.cue-upload { display: block; margin: 16px 0; }
</style>
