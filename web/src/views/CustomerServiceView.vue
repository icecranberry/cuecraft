<template>
  <div class="customer-service-page">
    <PageHeader title="AI 客服" :loading="loading">
      <template #actions>
        <a-button :disabled="!agents.length" @click="createDraft">新建客服部署</a-button>
        <a-button type="primary" :loading="publishing" :disabled="!selected" @click="publishDraft">发布当前配置</a-button>
      </template>
    </PageHeader>

    <a-alert v-if="error" class="cs-error" type="error" show-icon closable :message="error" @close="error = ''" />

    <div class="cs-workspace">
      <section class="cs-chat-panel" aria-label="客服测试对话">
        <header class="cs-chat-heading">
          <div class="cs-heading-icon"><MessageCircle :size="18" /></div>
          <div class="cs-heading-copy">
            <strong>{{ selected?.name || '智能客服测试' }}</strong>
            <span>{{ selected ? `草稿 Agent：${agentName(draft.agent_slug)}` : '创建部署后可测试智能客服' }}</span>
          </div>
          <a-button v-if="selected" size="small" @click="resetTestChat">新建测试会话</a-button>
        </header>

        <div ref="messagesEl" class="cs-messages" aria-live="polite">
          <div v-if="!selected" class="cs-chat-empty">
            <MessageCircle :size="30" />
            <strong>先创建一个客服部署</strong>
            <span>选择现有 Yuxi Agent 后，可以在这里模拟客户提问。</span>
          </div>
          <template v-else>
            <div v-if="!messages.length" class="cs-welcome-message">
              这是一条内部测试会话。测试记录会与分享链接、Webhook 和 MCP 的客户会话分开保存。
            </div>
            <article v-for="(item, index) in messages" :key="`${index}-${item.role}`" class="cs-message" :class="`cs-message-${item.role}`">
              <div class="cs-message-avatar"><UserRound v-if="item.role === 'user'" :size="15" /><Bot v-else :size="15" /></div>
              <div class="cs-message-content">{{ item.content }}</div>
            </article>
            <div v-if="sending" class="cs-pending"><span></span><span></span><span></span><em>客服正在回复</em></div>
          </template>
        </div>

        <form class="cs-composer" @submit.prevent="sendTestMessage">
          <a-textarea v-model:value="messageDraft" :disabled="!selected || sending" :auto-size="{ minRows: 2, maxRows: 5 }" placeholder="输入客户可能提出的问题…" @keydown.enter.exact.prevent="sendTestMessage" />
          <div class="cs-composer-footer">
            <span>按 Enter 发送，Shift + Enter 换行</span>
            <a-button type="primary" html-type="submit" :disabled="!messageDraft.trim() || !selected" :loading="sending"><template #icon><Send :size="15" /></template>发送</a-button>
          </div>
        </form>
      </section>

      <aside class="cs-publish-panel" aria-label="客服发布工作面板">
        <div class="cs-panel-title">
          <div><strong>工作面板</strong><span>测试配置和发布入口</span></div>
          <a-tag v-if="selected" :color="selected.is_live ? 'green' : 'default'">{{ selected.is_live ? `线上 v${selected.published_revision}` : '未发布' }}</a-tag>
        </div>
        <a-tabs v-model:activeKey="activeTab" size="small" :animated="false">
          <a-tab-pane key="config" tab="配置">
            <a-form layout="vertical" class="cs-config-form">
              <a-form-item label="客服名称"><a-input v-model:value="draft.name" :disabled="!selected" maxlength="255" placeholder="例如：品牌售前客服" /></a-form-item>
              <a-form-item label="使用的智能体"><a-select v-model:value="draft.agent_slug" :disabled="!selected" :options="agents.map((agent) => ({ value: agent.slug, label: agent.name }))" placeholder="选择 Yuxi 智能体" /></a-form-item>
              <a-form-item label="发布方式">
                <a-checkbox-group v-model:value="draft.modes" :disabled="!selected" :options="modeOptions" />
              </a-form-item>
              <a-form-item v-if="draft.modes.includes('iframe')" label="允许嵌入的站点 Origin">
                <a-textarea v-model:value="originsText" :disabled="!selected" :auto-size="{ minRows: 2, maxRows: 4 }" placeholder="每行一个，例如 https://shop.example.com" />
                <span class="cs-field-hint">填写完整来源（协议、域名和可选端口），不带路径。</span>
              </a-form-item>
              <div class="cs-config-actions">
                <a-button :disabled="!selected" :loading="saving" @click="saveDraft">保存草稿</a-button>
                <a-button danger :disabled="!selected?.is_live" @click="confirmRevoke">撤销发布</a-button>
              </div>
              <div v-if="selected" class="cs-revision-note">
                <CheckCircle2 :size="15" />
                草稿改动只有再次发布后才会影响客户。当前测试区始终使用草稿配置。
              </div>
            </a-form>
          </a-tab-pane>
          <a-tab-pane key="share" tab="分享链接">
            <div class="cs-integration-card">
              <h3><Link2 :size="16" />匿名客服链接</h3>
              <p>访客无需登录即可对话。链接使用已发布的 Agent 配置。</p>
              <a-input-group compact v-if="shareUrl"><a-input :value="shareUrl" readonly /><a-button @click="copy(shareUrl)"><Copy :size="14" /></a-button></a-input-group>
              <a-empty v-else description="发布后生成分享链接" :image-style="{ height: '46px' }" />
              <a-button v-if="shareUrl" block class="cs-copy-wide" @click="copy(shareUrl)">复制分享链接</a-button>
            </div>
            <div class="cs-integration-card">
              <h3><Code :size="16" />iframe 嵌入</h3>
              <p>嵌入地址由服务端的 Origin 白名单保护。</p>
              <pre v-if="token">{{ iframeSnippet }}</pre>
              <a-empty v-else description="发布并配置允许的站点 Origin 后可用" :image-style="{ height: '46px' }" />
              <a-button v-if="token" block class="cs-copy-wide" @click="copy(iframeSnippet)">复制嵌入代码</a-button>
            </div>
          </a-tab-pane>
          <a-tab-pane key="api" tab="Webhook / MCP">
            <div class="cs-integration-card">
              <h3><Webhook :size="16" />Webhook 入站接口</h3>
              <p>服务端向该地址提交客户消息；Bearer token 与分享凭据一致，可随时轮换。</p>
              <code>{{ getCustomerServiceWebhookUrl() }}</code>
              <pre v-if="token">{{ webhookExample }}</pre>
              <a-button v-if="token" block class="cs-copy-wide" @click="copy(webhookExample)">复制 Webhook 示例</a-button>
            </div>
            <div class="cs-integration-card">
              <h3><Cable :size="16" />MCP 服务</h3>
              <p>Streamable HTTP 服务端，暴露 <code>customer_service_chat</code> 工具。</p>
              <code>{{ getCustomerServiceMcpUrl() }}</code>
              <pre v-if="token">{{ mcpExample }}</pre>
              <a-button v-if="token" block class="cs-copy-wide" @click="copy(mcpExample)">复制 MCP 配置</a-button>
            </div>
            <div class="cs-token-actions">
              <span>{{ selected?.token_configured ? '凭据只在生成或轮换时显示。' : '发布后生成凭据。' }}</span>
              <a-button size="small" :disabled="!selected?.is_live" @click="rotateToken">{{ token ? '重新生成凭据' : '轮换凭据' }}</a-button>
            </div>
          </a-tab-pane>
        </a-tabs>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { Bot, Cable, CheckCircle2, Code, Copy, Link2, MessageCircle, Send, UserRound, Webhook } from '@lucide/vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import {
  createCustomerServiceDeployment,
  getCustomerServiceEmbedUrl,
  getCustomerServiceMcpUrl,
  getCustomerServiceWebhookUrl,
  listCustomerServiceAgents,
  listCustomerServiceDeployments,
  publishCustomerServiceDeployment,
  revokeCustomerServiceDeployment,
  rotateCustomerServiceToken,
  sendCustomerServiceTestMessage,
  updateCustomerServiceDeployment
} from '@/apis/customer_service_api'

const agents = ref([])
const deployments = ref([])
const selectedId = ref('')
const draft = reactive({ name: '', agent_slug: '', modes: ['share', 'webhook', 'mcp'] })
const originsText = ref('')
const messages = ref([])
const messageDraft = ref('')
const sessionId = ref(crypto.randomUUID())
const token = ref('')
const error = ref('')
const loading = ref(false)
const saving = ref(false)
const publishing = ref(false)
const sending = ref(false)
const activeTab = ref('config')
const messagesEl = ref(null)

const selected = computed(() => deployments.value.find((item) => item.id === selectedId.value) || null)
const modeOptions = [
  { label: '分享链接', value: 'share' }, { label: 'iframe', value: 'iframe' },
  { label: 'Webhook', value: 'webhook' }, { label: 'MCP', value: 'mcp' }
]
const shareUrl = computed(() => token.value ? `${window.location.origin}/support/${token.value}` : '')
const iframeSnippet = computed(() => token.value
  ? `<iframe src="${getCustomerServiceEmbedUrl(token.value)}" title="${draft.name || '智能客服'}" style="width:100%;height:640px;border:0;border-radius:12px" loading="lazy"></iframe>`
  : '')
const webhookExample = computed(() => token.value
  ? [
      `curl -X POST '${getCustomerServiceWebhookUrl()}' \\`,
      `  -H 'Authorization: Bearer ${token.value}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -d '{"message":"请问球杆有哪些材质？","session_id":"customer-123","idempotency_key":"order-20261004-001"}'`,
    ].join('\n')
  : '')
const mcpExample = computed(() => token.value
  ? JSON.stringify({ mcpServers: { yuxiCustomerService: { type: 'http', url: getCustomerServiceMcpUrl(), headers: { Authorization: `Bearer ${token.value}` } } } }, null, 2)
  : '')

function agentName(slug) { return agents.value.find((item) => item.slug === slug)?.name || '未选择' }
function restoreDraft(item) {
  if (!item) return
  draft.name = item.name
  draft.agent_slug = item.draft_agent_slug
  draft.modes = [...(item.draft_modes || [])]
  originsText.value = (item.draft_iframe_origins || []).join('\n')
  messages.value = []
  token.value = ''
  sessionId.value = crypto.randomUUID()
}
async function refreshDeployments() {
  deployments.value = await listCustomerServiceDeployments()
  if (selectedId.value && !deployments.value.some((item) => item.id === selectedId.value)) selectedId.value = ''
  if (!selectedId.value && deployments.value.length) selectedId.value = deployments.value[0].id
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [agentResponse] = await Promise.all([listCustomerServiceAgents()])
    agents.value = agentResponse
    await refreshDeployments()
    restoreDraft(selected.value)
  } catch (cause) { error.value = cause.message || 'AI 客服配置加载失败' }
  finally { loading.value = false }
}
async function createDraft() {
  if (!agents.value.length) { error.value = '请先创建可用的 Yuxi 智能体'; return }
  saving.value = true
  error.value = ''
  try {
    const item = await createCustomerServiceDeployment({ name: '智能客服', agent_slug: agents.value[0].slug })
    await refreshDeployments()
    selectedId.value = item.id
    restoreDraft(item)
  } catch (cause) { error.value = cause.message || '客服部署创建失败' }
  finally { saving.value = false }
}
function draftPayload() {
  return {
    name: draft.name,
    agent_slug: draft.agent_slug,
    modes: draft.modes,
    iframe_origins: originsText.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  }
}
async function saveDraft() {
  if (!selected.value) return false
  saving.value = true
  error.value = ''
  try {
    const item = await updateCustomerServiceDeployment(selected.value.id, draftPayload())
    deployments.value = deployments.value.map((current) => current.id === item.id ? item : current)
    message.success('草稿已保存；线上版本尚未改变')
    return true
  } catch (cause) { error.value = cause.message || '客服草稿保存失败'; return false }
  finally { saving.value = false }
}
async function publishDraft() {
  if (!selected.value) return
  publishing.value = true
  error.value = ''
  try {
    const saved = await updateCustomerServiceDeployment(selected.value.id, draftPayload())
    deployments.value = deployments.value.map((item) => item.id === saved.id ? saved : item)
    const result = await publishCustomerServiceDeployment(selected.value.id)
    deployments.value = deployments.value.map((item) => item.id === result.deployment.id ? result.deployment : item)
    if (result.public_token) token.value = result.public_token
    activeTab.value = 'share'
    message.success(`已发布版本 ${result.deployment.published_revision}`)
  } catch (cause) { error.value = cause.message || '客服发布失败' }
  finally { publishing.value = false }
}
async function rotateToken() {
  if (!selected.value) return
  try {
    const result = await rotateCustomerServiceToken(selected.value.id)
    token.value = result.public_token
    deployments.value = deployments.value.map((item) => item.id === result.deployment.id ? result.deployment : item)
    message.success('凭据已轮换，旧链接和旧凭据已失效')
  } catch (cause) { error.value = cause.message || '凭据轮换失败' }
}
function confirmRevoke() {
  if (!selected.value) return
  Modal.confirm({
    title: '撤销当前客服发布？',
    content: '分享链接、Webhook 和 MCP 凭据会立即停止工作。',
    okText: '撤销发布',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const item = await revokeCustomerServiceDeployment(selected.value.id)
      deployments.value = deployments.value.map((current) => current.id === item.id ? item : current)
      token.value = ''
      message.success('客服发布已撤销')
    }
  })
}
function resetTestChat() { messages.value = []; sessionId.value = crypto.randomUUID() }
async function sendTestMessage() {
  const text = messageDraft.value.trim()
  if (!text || !selected.value || sending.value) return
  messageDraft.value = ''
  messages.value.push({ role: 'user', content: text })
  sending.value = true
  await scrollMessages()
  try {
    const result = await sendCustomerServiceTestMessage({
      deployment_id: selected.value.id,
      message: text,
      session_id: sessionId.value,
      idempotency_key: crypto.randomUUID()
    })
    messages.value.push({ role: 'assistant', content: result.answer || '客服未返回文字内容。' })
  } catch (cause) { messages.value.push({ role: 'assistant', content: cause.message || '测试请求失败，请检查 Agent 配置。', error: true }) }
  finally { sending.value = false; await scrollMessages() }
}
async function scrollMessages() { await nextTick(); if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight }
async function copy(value) {
  if (!value) return
  try { await navigator.clipboard.writeText(value); message.success('已复制') }
  catch { error.value = '无法访问剪贴板，请手动复制内容' }
}

watch(selectedId, (id) => restoreDraft(deployments.value.find((item) => item.id === id)))
onMounted(load)
</script>

<style scoped>
.customer-service-page { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--gray-25); }
.cs-error { margin: 12px var(--page-padding) 0; }
.cs-workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 18px; padding: 18px var(--page-padding); }
.cs-chat-panel, .cs-publish-panel { min-height: 0; background: var(--white, #fff); border: 1px solid var(--gray-200); border-radius: 12px; }
.cs-chat-panel { display: flex; flex-direction: column; overflow: hidden; }
.cs-chat-heading { display: flex; align-items: center; gap: 11px; padding: 14px 16px; border-bottom: 1px solid var(--gray-150); }
.cs-heading-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: var(--primary-700, #16734a); background: var(--primary-50, #edf8f1); }
.cs-heading-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cs-heading-copy strong { color: var(--gray-900); font-size: 14px; }
.cs-heading-copy span, .cs-panel-title span { color: var(--gray-500); font-size: 12px; }
.cs-messages { flex: 1; min-height: 0; overflow: auto; padding: 20px clamp(12px, 4vw, 44px); }
.cs-chat-empty { min-height: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--gray-500); text-align: center; }
.cs-chat-empty strong { color: var(--gray-800); }
.cs-welcome-message { max-width: 560px; margin: 20px auto 30px; padding: 12px 14px; border-radius: 10px; background: var(--gray-50); color: var(--gray-600); font-size: 12px; text-align: center; }
.cs-message { display: flex; align-items: flex-start; gap: 10px; max-width: 820px; margin: 18px auto; }
.cs-message-user { flex-direction: row-reverse; }
.cs-message-avatar { flex: 0 0 30px; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; color: var(--gray-600); background: var(--gray-100); }
.cs-message-assistant .cs-message-avatar { color: var(--primary-700, #16734a); background: var(--primary-50, #edf8f1); }
.cs-message-content { max-width: min(78%, 700px); white-space: pre-wrap; overflow-wrap: anywhere; padding: 11px 14px; border-radius: 12px; background: var(--gray-50); color: var(--gray-800); line-height: 1.65; font-size: 13px; }
.cs-message-user .cs-message-content { background: var(--primary-50, #edf8f1); }
.cs-message-assistant .cs-message-content:has(+ .error) { color: #b42318; }
.cs-pending { width: max-content; display: flex; align-items: center; gap: 5px; margin: 20px auto; color: var(--gray-500); font-size: 12px; }
.cs-pending span { width: 5px; height: 5px; border-radius: 50%; background: #7a9681; animation: cs-pulse 1.2s infinite ease-in-out; }
.cs-pending span:nth-child(2) { animation-delay: .12s; }.cs-pending span:nth-child(3) { animation-delay: .24s; }.cs-pending em { margin-left: 5px; font-style: normal; }
@keyframes cs-pulse { 0%, 60%, 100% { opacity: .32; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
.cs-composer { padding: 12px 16px 14px; border-top: 1px solid var(--gray-150); }
.cs-composer-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.cs-composer-footer span { color: var(--gray-500); font-size: 11px; }
.cs-publish-panel { display: flex; flex-direction: column; overflow: auto; padding: 14px 16px; }
.cs-panel-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cs-panel-title > div { display: flex; flex-direction: column; gap: 4px; }.cs-panel-title strong { color: var(--gray-900); font-size: 15px; }
.cs-config-form { padding-top: 10px; }.cs-config-actions { display: flex; gap: 8px; }
.cs-field-hint { display: block; margin-top: 5px; color: var(--gray-500); font-size: 11px; }
.cs-revision-note { display: flex; gap: 7px; margin-top: 16px; padding: 10px; border-radius: 8px; background: var(--gray-50); color: var(--gray-600); font-size: 11px; line-height: 1.55; }
.cs-revision-note svg { flex: 0 0 auto; color: #31835a; }
.cs-integration-card { padding: 12px 0 16px; border-bottom: 1px solid var(--gray-150); }
.cs-integration-card h3 { display: flex; align-items: center; gap: 7px; margin: 0 0 7px; color: var(--gray-800); font-size: 13px; }
.cs-integration-card h3 svg { color: #347a56; }.cs-integration-card p { margin: 0 0 10px; color: var(--gray-500); font-size: 11px; line-height: 1.55; }
.cs-integration-card code { display: block; overflow-wrap: anywhere; padding: 8px 9px; border-radius: 6px; background: var(--gray-50); color: var(--gray-700); font-size: 11px; }
.cs-integration-card pre { max-height: 190px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px; border-radius: 7px; background: #202a27; color: #e2eee7; font-size: 10px; line-height: 1.5; }
.cs-copy-wide { margin-top: 7px; }.cs-token-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 14px; color: var(--gray-500); font-size: 11px; }
@media (max-width: 1050px) { .cs-workspace { grid-template-columns: minmax(0, 1fr) 330px; } }
@media (max-width: 780px) { .customer-service-page { height: auto; min-height: 100%; }.cs-workspace { grid-template-columns: 1fr; }.cs-chat-panel { min-height: 58vh; }.cs-publish-panel { min-height: 360px; } }
@media (prefers-reduced-motion: reduce) { .cs-pending span { animation: none; } }
</style>
