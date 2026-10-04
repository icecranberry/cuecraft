<template>
  <main class="public-customer-service" :class="{ embedded: embed }">
    <section class="public-chat-card" aria-label="智能客服对话">
      <header class="public-chat-header">
        <div class="public-bot-icon"><Bot :size="21" /></div>
        <div class="public-header-copy"><strong>{{ info?.name || '智能客服' }}</strong><span>{{ info?.agent_name || 'Yuxi 客服助手' }}</span></div>
        <a-button v-if="info && !error" size="small" @click="resetConversation">新对话</a-button>
      </header>
      <div ref="messagesEl" class="public-chat-messages" aria-live="polite">
        <div v-if="loading" class="public-chat-loading"><a-spin /><span>正在连接客服…</span></div>
        <div v-else-if="error" class="public-chat-error"><CircleAlert :size="22" /><strong>暂时无法打开客服</strong><span>{{ error }}</span></div>
        <template v-else>
          <article v-if="!messages.length" class="public-welcome">{{ info.welcome_message }}</article>
          <article v-for="(item, index) in messages" :key="`${index}-${item.role}`" class="public-message" :class="`public-message-${item.role}`">
            <div class="public-message-avatar"><UserRound v-if="item.role === 'user'" :size="15" /><Bot v-else :size="15" /></div>
            <div class="public-message-content">{{ item.content }}</div>
          </article>
          <div v-if="sending" class="public-replying"><span></span><span></span><span></span><em>正在回复</em></div>
        </template>
      </div>
      <form class="public-composer" @submit.prevent="sendMessage">
        <a-textarea v-model:value="draft" :disabled="loading || !!error || sending" :auto-size="{ minRows: 2, maxRows: 5 }" placeholder="请输入您的问题…" @keydown.enter.exact.prevent="sendMessage" />
        <div class="public-composer-footer"><span>发送即表示你同意对话内容用于客服响应。</span><a-button type="primary" html-type="submit" :disabled="!draft.trim() || !!error" :loading="sending"><template #icon><Send :size="15" /></template>发送</a-button></div>
      </form>
      <footer class="public-chat-footer">由 Yuxi 智能客服提供</footer>
    </section>
  </main>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Bot, CircleAlert, Send, UserRound } from '@lucide/vue'
import { getPublicCustomerService, sendPublicCustomerServiceMessage } from '@/apis/customer_service_api'

const route = useRoute()
const info = ref(null)
const messages = ref([])
const draft = ref('')
const loading = ref(true)
const sending = ref(false)
const error = ref('')
const sessionId = ref('')
const messagesEl = ref(null)
const token = computed(() => String(route.params.token || ''))
const embed = computed(() => route.query.embed === '1')
const mode = computed(() => embed.value ? 'iframe' : 'share')

function storageKey() { return `yuxi:customer-service:${token.value}:history` }
function createSession() { sessionId.value = crypto.randomUUID(); messages.value = []; persistHistory() }
function persistHistory() {
  if (!token.value || !sessionId.value) return
  try { localStorage.setItem(storageKey(), JSON.stringify({ session_id: sessionId.value, messages: messages.value.slice(-60) })) } catch { /* local history is optional */ }
}
function restoreHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()) || 'null')
    if (saved?.session_id && Array.isArray(saved.messages)) {
      sessionId.value = saved.session_id
      messages.value = saved.messages
      return
    }
  } catch { /* corrupt browser history is ignored */ }
  createSession()
}
function resetConversation() { createSession() }
async function load() {
  loading.value = true
  error.value = ''
  info.value = null
  messages.value = []
  try {
    info.value = await getPublicCustomerService(token.value, mode.value)
    restoreHistory()
  } catch (cause) { error.value = cause.message || '分享链接无效或已撤销。' }
  finally { loading.value = false }
}
async function sendMessage() {
  const text = draft.value.trim()
  if (!text || !info.value || sending.value) return
  draft.value = ''
  messages.value.push({ role: 'user', content: text })
  persistHistory()
  sending.value = true
  await scrollToBottom()
  try {
    const result = await sendPublicCustomerServiceMessage(token.value, {
      message: text,
      session_id: sessionId.value,
      idempotency_key: crypto.randomUUID(),
      mode: mode.value
    })
    messages.value.push({ role: 'assistant', content: result.answer || '客服暂时没有返回文字内容。' })
    persistHistory()
  } catch (cause) {
    messages.value.push({ role: 'assistant', content: cause.message || '发送失败，请稍后重试。', error: true })
    persistHistory()
  } finally { sending.value = false; await scrollToBottom() }
}
async function scrollToBottom() { await nextTick(); if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight }

watch([token, mode], load)
onMounted(load)
</script>

<style scoped>
.public-customer-service { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f4f7f6; color: #29352f; }
.public-chat-card { width: min(760px, 100%); height: min(860px, calc(100vh - 48px)); min-height: 460px; display: flex; flex-direction: column; overflow: hidden; border: 1px solid #e0e7e3; border-radius: 16px; background: #fff; box-shadow: 0 12px 40px rgb(28 58 42 / 8%); }
.public-chat-header { display: flex; align-items: center; gap: 11px; padding: 15px 18px; border-bottom: 1px solid #edf1ef; }
.public-bot-icon { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; color: #276944; background: #edf6ef; }
.public-header-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }.public-header-copy strong { color: #24352c; font-size: 14px; }.public-header-copy span { color: #75817a; font-size: 12px; }
.public-chat-messages { flex: 1; min-height: 0; overflow: auto; padding: 22px clamp(12px, 5vw, 48px); }
.public-chat-loading, .public-chat-error { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 11px; color: #7a8780; text-align: center; }.public-chat-error strong { color: #34443a; }.public-chat-error span { max-width: 440px; font-size: 13px; }
.public-welcome { width: fit-content; max-width: 80%; margin: 22px auto 32px; padding: 13px 16px; border-radius: 12px; background: #f3f7f4; color: #4d5d53; font-size: 13px; line-height: 1.6; text-align: center; }
.public-message { display: flex; align-items: flex-start; gap: 9px; margin: 17px auto; max-width: 650px; }.public-message-user { flex-direction: row-reverse; }
.public-message-avatar { flex: 0 0 30px; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; color: #65736a; background: #eff2f0; }.public-message-assistant .public-message-avatar { color: #286b45; background: #edf6ef; }
.public-message-content { max-width: min(78%, 570px); white-space: pre-wrap; overflow-wrap: anywhere; padding: 11px 14px; border-radius: 12px; background: #f4f6f5; color: #35443b; font-size: 13px; line-height: 1.65; }.public-message-user .public-message-content { background: #eaf5ed; }
.public-replying { display: flex; align-items: center; justify-content: center; gap: 5px; margin: 20px; color: #7a8780; font-size: 12px; }.public-replying span { width: 5px; height: 5px; border-radius: 50%; background: #6b8d74; animation: reply 1.2s infinite ease-in-out; }.public-replying span:nth-child(2) { animation-delay: .12s; }.public-replying span:nth-child(3) { animation-delay: .24s; }.public-replying em { margin-left: 5px; font-style: normal; }
@keyframes reply { 0%, 60%, 100% { opacity: .32; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
.public-composer { padding: 13px 16px; border-top: 1px solid #edf1ef; }.public-composer-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 8px; }.public-composer-footer span { color: #89938d; font-size: 10px; }
.public-chat-footer { padding: 8px 14px 11px; color: #a0aaa4; font-size: 10px; text-align: center; }
.embedded { min-height: 100vh; padding: 0; background: transparent; }.embedded .public-chat-card { width: 100%; height: 100vh; min-height: 360px; border: 0; border-radius: 0; box-shadow: none; }
@media (max-width: 560px) { .public-customer-service { padding: 0; background: #fff; }.public-chat-card { width: 100%; height: 100dvh; min-height: 360px; border: 0; border-radius: 0; box-shadow: none; }.public-composer-footer span { max-width: 180px; line-height: 1.35; } }
@media (prefers-reduced-motion: reduce) { .public-replying span { animation: none; } }
</style>
