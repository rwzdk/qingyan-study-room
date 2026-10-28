<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import {
  ChatApiError,
  fetchChatMessages,
  sendChatMessage,
  type ChatMessage,
} from '#/api/chat';
import IconifyIcon from '#/components/IconifyIcon.vue';

const props = defineProps<{
  authorId: string;
  authorName: string;
  authorAvatar?: string;
}>();

const POLL_INTERVAL = 5000;
const MAX_MESSAGE_LENGTH = 500;
const MAX_KEPT_MESSAGES = 200;
const SEND_COOLDOWN = 1200;
const AVATAR_COLORS = [
  '#D7EF83',
  '#8FD46A',
  '#67E2D1',
  '#B9C6FF',
  '#FFD39B',
  '#F2C66D',
];

const open = ref(false);
const messages = ref<ChatMessage[]>([]);
const draft = ref('');
const loading = ref(false);
const sending = ref(false);
const error = ref('');
const triggerRef = ref<HTMLButtonElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

let pollTimer: number | null = null;
let requestToken = 0;
let disposed = false;
let lastSentAt = 0;

const canSend = computed(
  () => draft.value.trim().length > 0 && !sending.value,
);
const messageSummary = computed(() =>
  messages.value.length
    ? `共 ${messages.value.length} 条消息`
    : '一起聊聊',
);

function initials(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('') || '友';
}

function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  if (date.toDateString() === now.toDateString()) return time;
  const day = new Intl.DateTimeFormat(
    'zh-CN',
    date.getFullYear() === now.getFullYear()
      ? { month: 'numeric', day: 'numeric' }
      : { year: 'numeric', month: 'numeric', day: 'numeric' },
  ).format(date);
  return `${day} ${time}`;
}

function errorMessage(caught: unknown): string {
  if (caught instanceof ChatApiError) {
    switch (caught.code) {
      case 'invalid_input':
        return '这条消息无法发送，请检查内容。';
      case 'slow_down':
        return '说慢一点，刚发过一条。';
      case 'unauthorized':
        return '登录状态已失效，请重新登录。';
      default:
        return '对话室暂时连不上，稍后再试。';
    }
  }
  return '对话室暂时连不上，稍后再试。';
}

function isNearBottom(): boolean {
  const list = listRef.value;
  if (!list) return true;
  return list.scrollHeight - list.scrollTop - list.clientHeight < 80;
}

function scrollToBottom(): void {
  void nextTick(() => {
    const list = listRef.value;
    if (list) list.scrollTop = list.scrollHeight;
  });
}

function mergeMessages(incoming: ChatMessage[]): void {
  const byId = new Map<string, ChatMessage>();
  for (const message of messages.value) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  messages.value = Array.from(byId.values())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-MAX_KEPT_MESSAGES);
}

async function loadMessages(initial = false): Promise<void> {
  const token = ++requestToken;
  if (initial) loading.value = true;
  try {
    const incoming = await fetchChatMessages(100);
    if (disposed || token !== requestToken) return;
    const nearBottom = isNearBottom();
    mergeMessages(incoming);
    error.value = '';
    if (initial || nearBottom) scrollToBottom();
  } catch (caught) {
    if (disposed || token !== requestToken) return;
    error.value = errorMessage(caught);
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

async function sendMessage(): Promise<void> {
  const content = draft.value.replace(/\r\n?/g, '\n').trim();
  if (!content || content.length > MAX_MESSAGE_LENGTH || sending.value) {
    return;
  }
  const now = Date.now();
  if (now - lastSentAt < SEND_COOLDOWN) {
    error.value = '说慢一点，刚发过一条。';
    return;
  }

  sending.value = true;
  error.value = '';
  try {
    const message = await sendChatMessage({
      authorId: props.authorId,
      authorName: props.authorName,
      content,
    });
    if (disposed) return;
    lastSentAt = Date.now();
    mergeMessages([message]);
    draft.value = '';
    scrollToBottom();
  } catch (caught) {
    if (!disposed) error.value = errorMessage(caught);
  } finally {
    if (!disposed) sending.value = false;
  }
}

function startPolling(): void {
  stopPolling();
  pollTimer = window.setInterval(() => {
    void loadMessages(false);
  }, POLL_INTERVAL);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function setBodyLock(locked: boolean): void {
  document.body.classList.toggle('chat-room-open', locked);
}

function openChat(): void {
  if (open.value) return;
  open.value = true;
  error.value = '';
  setBodyLock(true);
  startPolling();
  void loadMessages(messages.value.length === 0);
  void nextTick(() => {
    inputRef.value?.focus();
    scrollToBottom();
  });
}

function closeChat(): void {
  if (!open.value) return;
  open.value = false;
  requestToken += 1;
  stopPolling();
  setBodyLock(false);
  void nextTick(() => triggerRef.value?.focus());
}

function toggleOpen(): void {
  if (open.value) closeChat();
  else openChat();
}

function onComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey) return;
  if (event.isComposing) return;
  event.preventDefault();
  void sendMessage();
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) return;
  event.preventDefault();
  closeChat();
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
});

onBeforeUnmount(() => {
  disposed = true;
  requestToken += 1;
  stopPolling();
  window.removeEventListener('keydown', onWindowKeydown);
  setBodyLock(false);
});
</script>

<template>
  <div class="chat-room">
    <button
      ref="triggerRef"
      type="button"
      class="chat-trigger"
      :class="{ active: open }"
      :aria-label="open ? '关闭对话室' : '打开对话室'"
      aria-haspopup="dialog"
      :aria-expanded="open"
      title="对话室"
      @click="toggleOpen"
    >
      <IconifyIcon icon="lucide:message-circle" class="chat-trigger-icon" />
    </button>

    <Teleport to="body">
      <template v-if="open">
        <div
          class="chat-backdrop"
          aria-hidden="true"
          @click="closeChat"
        />
        <section
          class="chat-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="study-room-chat-title"
        >
          <header class="chat-header">
            <div class="chat-heading">
              <span class="chat-live-dot" aria-hidden="true" />
              <div>
                <h2 id="study-room-chat-title">对话室</h2>
                <p>{{ messageSummary }}</p>
              </div>
            </div>
            <button
              type="button"
              class="chat-close"
              aria-label="关闭对话室"
              @click="closeChat"
            >
              <IconifyIcon icon="lucide:x" />
            </button>
          </header>

          <div
            ref="listRef"
            class="chat-list"
            role="log"
            aria-live="polite"
          >
            <div
              v-if="loading && !messages.length"
              class="chat-state"
            >
              <span class="chat-loading-dot" aria-hidden="true" />
              正在进入对话室…
            </div>
            <div
              v-else-if="error && !messages.length"
              class="chat-state chat-state-error"
            >
              <p>{{ error }}</p>
              <button
                type="button"
                class="chat-retry"
                @click="loadMessages(true)"
              >
                重试
              </button>
            </div>
            <div
              v-else-if="!messages.length"
              class="chat-empty"
            >
              <IconifyIcon icon="lucide:message-circle" class="chat-empty-icon" />
              <p>还没有消息，来聊第一句吧。</p>
            </div>
            <template v-else>
              <article
                v-for="message in messages"
                :key="message.id"
                class="chat-row"
                :class="{ mine: message.authorId === authorId }"
              >
                <span
                  v-if="message.authorId === authorId && authorAvatar"
                  class="chat-avatar"
                  aria-hidden="true"
                >
                  <img
                    :src="authorAvatar"
                    alt=""
                    class="chat-avatar-img"
                    referrerpolicy="no-referrer"
                  />
                </span>
                <span
                  v-else
                  class="chat-avatar"
                  :style="{ background: avatarColor(message.authorName) }"
                  aria-hidden="true"
                >
                  {{ initials(message.authorName) }}
                </span>
                <div class="chat-body">
                  <div class="chat-meta">
                    <strong>{{
                      message.authorId === authorId ? '我' : message.authorName
                    }}</strong>
                    <time :datetime="message.createdAt">{{
                      formatTime(message.createdAt)
                    }}</time>
                  </div>
                  <p class="chat-bubble">{{ message.content }}</p>
                </div>
              </article>
            </template>
          </div>

          <p
            v-if="error && messages.length"
            class="chat-sync-error"
            role="status"
          >
            {{ error }}
          </p>

          <form class="chat-composer" @submit.prevent="sendMessage">
            <textarea
              ref="inputRef"
              v-model="draft"
              class="chat-input"
              rows="2"
              maxlength="500"
              placeholder="说点什么…"
              :disabled="sending"
              @keydown="onComposerKeydown"
            />
            <div class="chat-composer-footer">
              <span class="chat-count">{{ draft.length }}/500</span>
              <button
                type="submit"
                class="chat-send"
                :disabled="!canSend"
              >
                <IconifyIcon icon="lucide:send" class="chat-send-icon" />
                发送
              </button>
            </div>
          </form>
        </section>
      </template>
    </Teleport>
  </div>
</template>

<style scoped>
.chat-room {
  display: inline-flex;
}

.chat-trigger {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 10px;
  color: rgb(255 255 255 / 0.65);
  background: rgb(15 23 20 / 0.55);
  backdrop-filter: blur(16px);
  cursor: pointer;
  transition:
    color 0.18s ease,
    background 0.18s ease,
    border-color 0.18s ease;
}

.chat-trigger:hover,
.chat-trigger.active {
  border-color: color-mix(
    in srgb,
    var(--study-room-primary, #d7ef83) 48%,
    transparent
  );
  color: #fff;
  background: rgb(15 23 20 / 0.78);
}

.chat-trigger:focus-visible {
  outline: 2px solid var(--study-room-primary, #d7ef83);
  outline-offset: 2px;
}

.chat-trigger-icon {
  width: 18px;
  height: 18px;
}

.chat-backdrop {
  position: fixed;
  z-index: 90;
  inset: 0;
  background: rgb(0 0 0 / 0.18);
  backdrop-filter: blur(1px);
}

.chat-panel {
  position: fixed;
  z-index: 100;
  top: 64px;
  right: 24px;
  display: flex;
  width: min(380px, calc(100vw - 48px));
  height: min(560px, calc(100dvh - 88px));
  min-height: 320px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 22%, transparent);
  border-radius: 18px;
  background: color-mix(
    in srgb,
    var(--study-room-secondary, #5ab8b0) 8%,
    rgb(10 18 15 / 0.97)
  );
  box-shadow: 0 24px 70px rgb(0 0 0 / 0.5);
  color: #fff;
  backdrop-filter: blur(24px);
}

.chat-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 13px;
  border-bottom: 1px solid rgb(255 255 255 / 0.08);
}

.chat-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.chat-heading h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  line-height: 1.3;
}

.chat-heading p {
  margin: 2px 0 0;
  color: rgb(255 255 255 / 0.42);
  font-size: 10px;
}

.chat-live-dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--study-room-primary, #d7ef83);
  box-shadow: 0 0 0 3px
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 16%, transparent);
  animation: chat-pulse 2.4s ease-in-out infinite;
}

.chat-close {
  display: grid;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  place-items: center;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 50%;
  color: rgb(255 255 255 / 0.55);
  background: transparent;
  cursor: pointer;
  transition:
    color 0.18s ease,
    background 0.18s ease;
}

.chat-close:hover {
  color: #fff;
  background: rgb(255 255 255 / 0.08);
}

.chat-close:focus-visible,
.chat-retry:focus-visible,
.chat-send:focus-visible {
  outline: 2px solid var(--study-room-primary, #d7ef83);
  outline-offset: 2px;
}

.chat-list {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 15px 16px;
  scrollbar-color: rgb(255 255 255 / 0.18) transparent;
  scrollbar-width: thin;
}

.chat-state,
.chat-empty {
  display: flex;
  min-height: 100%;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 28px 18px;
  color: rgb(255 255 255 / 0.46);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

.chat-state p,
.chat-empty p {
  margin: 0;
}

.chat-state-error {
  color: #ffb4b4;
}

.chat-empty-icon {
  width: 30px;
  height: 30px;
  color: var(--study-room-primary, #d7ef83);
  opacity: 0.8;
}

.chat-loading-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--study-room-primary, #d7ef83);
  animation: chat-pulse 1.2s ease-in-out infinite;
}

.chat-retry {
  margin-top: 4px;
  padding: 6px 12px;
  border: 1px solid
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 45%, transparent);
  border-radius: 999px;
  color: var(--study-room-primary, #d7ef83);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
}

.chat-retry:hover {
  background: color-mix(
    in srgb,
    var(--study-room-primary, #d7ef83) 12%,
    transparent
  );
}

.chat-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.chat-row.mine {
  flex-direction: row-reverse;
}

.chat-avatar {
  display: grid;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 50%;
  color: #051612;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  user-select: none;
  overflow: hidden;
}

.chat-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.chat-body {
  display: flex;
  min-width: 0;
  max-width: 80%;
  flex-direction: column;
  gap: 4px;
}

.chat-row.mine .chat-body {
  align-items: flex-end;
}

.chat-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  color: rgb(255 255 255 / 0.38);
  font-size: 10px;
}

.chat-meta strong {
  overflow: hidden;
  max-width: 160px;
  color: rgb(255 255 255 / 0.72);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-meta time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.chat-bubble {
  margin: 0;
  padding: 8px 11px;
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 12px 12px 12px 4px;
  color: rgb(255 255 255 / 0.9);
  background: rgb(255 255 255 / 0.07);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.chat-row.mine .chat-bubble {
  border-color: transparent;
  border-radius: 12px 12px 4px 12px;
  color: #051612;
  background: var(--study-room-primary, #d7ef83);
}

.chat-sync-error {
  flex-shrink: 0;
  margin: 0;
  padding: 7px 16px;
  border-top: 1px solid rgb(255 255 255 / 0.06);
  color: #ffd48a;
  background: rgb(120 80 20 / 0.1);
  font-size: 11px;
  line-height: 1.5;
}

.chat-composer {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  gap: 7px;
  padding: 11px 14px 13px;
  border-top: 1px solid rgb(255 255 255 / 0.08);
  background: rgb(0 0 0 / 0.14);
}

.chat-input {
  width: 100%;
  min-height: 44px;
  max-height: 96px;
  resize: none;
  padding: 9px 11px;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 11px;
  outline: none;
  color: #fff;
  background: rgb(0 0 0 / 0.24);
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.chat-input::placeholder {
  color: rgb(255 255 255 / 0.32);
}

.chat-input:focus {
  border-color: color-mix(
    in srgb,
    var(--study-room-primary, #d7ef83) 55%,
    transparent
  );
  box-shadow: 0 0 0 3px
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 10%, transparent);
}

.chat-composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.chat-count {
  color: rgb(255 255 255 / 0.3);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.chat-send {
  display: inline-flex;
  min-width: 70px;
  height: 32px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  color: #051612;
  background: var(--study-room-primary, #d7ef83);
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  transition:
    filter 0.18s ease,
    opacity 0.18s ease;
}

.chat-send:hover:not(:disabled) {
  filter: brightness(1.06);
}

.chat-send:disabled {
  cursor: default;
  opacity: 0.36;
}

.chat-send-icon {
  width: 14px;
  height: 14px;
}

@keyframes chat-pulse {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (max-width: 720px) {
  .chat-backdrop {
    background: rgb(0 0 0 / 0.32);
  }

  .chat-panel {
    top: 12px;
    right: 12px;
    bottom: 12px;
    left: 12px;
    width: auto;
    height: auto;
    min-height: 0;
    border-radius: 20px;
  }

  .chat-list {
    padding: 13px 13px;
  }

  .chat-bubble {
    font-size: 13px;
  }

  .chat-composer {
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-live-dot,
  .chat-loading-dot {
    animation: none;
  }
}
</style>

<style>
body.chat-room-open {
  overflow: hidden;
}
</style>
