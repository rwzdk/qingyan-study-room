<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue';

import IconifyIcon from '#/components/IconifyIcon.vue';

import { scheduleSaveStudyRoom, useStudyRoomState } from './study-room-state-store';

interface DocItem {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

const { state } = useStudyRoomState();

const docs = ref<DocItem[]>([]);
const loaded = ref(false);
const activeId = ref('');
const editing = ref(false);
const draftTitle = ref('');
const draftContent = ref('');
const editorRef = ref<HTMLTextAreaElement | null>(null);

const activeDoc = computed(() => docs.value.find((item) => item.id === activeId.value) || null);

const sortedDocs = computed(() =>
  [...docs.value].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
);

function formatTime(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function commit() {
  if (!activeId.value) return;
  const doc = docs.value.find((item) => item.id === activeId.value);
  if (!doc) return;
  const title = draftTitle.value.trim() || '未命名文档';
  const content = draftContent.value;
  if (doc.title === title && doc.content === content) {
    editing.value = false;
    return;
  }
  docs.value = docs.value.map((item) =>
    item.id === activeId.value ? { ...item, title, content, updatedAt: new Date().toISOString() } : item,
  );
  state.value.docs = docs.value;
  scheduleSaveStudyRoom();
  editing.value = false;
}

function cancelEdit() {
  editing.value = false;
}

function onEditorBlur(event: FocusEvent) {
  const next = event.relatedTarget as HTMLElement | null;
  if (next?.closest('.docs-editor')) return;
  commit();
}

function beginEdit() {
  if (!activeDoc.value) return;
  draftTitle.value = activeDoc.value.title;
  draftContent.value = activeDoc.value.content;
  editing.value = true;
  nextTick(() => editorRef.value?.focus());
}

function selectDoc(doc: DocItem) {
  if (doc.id === activeId.value) return;
  if (editing.value) commit();
  activeId.value = doc.id;
  editing.value = false;
  draftTitle.value = doc.title;
  draftContent.value = doc.content;
}

function createDoc() {
  const doc: DocItem = {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: '未命名文档',
    content: '',
    updatedAt: new Date().toISOString(),
  };
  docs.value = [doc, ...docs.value];
  state.value.docs = docs.value;
  scheduleSaveStudyRoom();
  activeId.value = doc.id;
  draftTitle.value = doc.title;
  draftContent.value = doc.content;
  editing.value = true;
  nextTick(() => editorRef.value?.focus());
}

function removeDoc(id: string) {
  docs.value = docs.value.filter((item) => item.id !== id);
  state.value.docs = docs.value;
  scheduleSaveStudyRoom();
  if (activeId.value === id) {
    const next = docs.value[0] || null;
    activeId.value = next?.id ?? '';
    editing.value = false;
    if (next) {
      draftTitle.value = next.title;
      draftContent.value = next.content;
    }
  }
}

// 本地状态加载完成后再同步（避免竞态读到空数组）
watch(
  () => state.value.docs,
  (next) => {
    docs.value = Array.isArray(next) ? next : [];
    loaded.value = true;
    // 首次有数据且未选中时，自动选中第一篇
    if (!activeId.value) {
      const first = docs.value[0];
      if (first) {
        activeId.value = first.id;
        draftTitle.value = first.title;
        draftContent.value = first.content;
      }
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="study-room-extension docs-root">
    <div class="sr-ext-header">
      <div>
        <p class="eyebrow">Doc studio</p>
        <h1>阅读</h1>
        <p class="subtitle">写作、阅读与记录集中在一个安静的工作空间。</p>
      </div>
      <button type="button" class="sr-btn" @click="createDoc">
        <IconifyIcon icon="lucide:plus" />
        新建文档
      </button>
    </div>

    <div v-if="!loaded" class="docs-loading">
      <div class="spinner" />
    </div>

    <div v-else-if="docs.length === 0" class="sr-empty docs-empty">
      <IconifyIcon icon="lucide:book-open" class="docs-empty-icon" />
      <h3>还没有文档</h3>
      <p>点击右上角「新建文档」，写下你的第一篇笔记。</p>
    </div>

    <div v-else class="docs-layout">
      <aside class="sr-panel docs-list">
        <div class="docs-list-head">
          <span>{{ docs.length }} 篇文档</span>
        </div>
        <div class="docs-list-body">
          <button
            v-for="doc in sortedDocs"
            :key="doc.id"
            type="button"
            class="docs-item"
            :class="{ active: doc.id === activeId }"
            @click="selectDoc(doc)"
          >
            <span class="docs-item-icon"><IconifyIcon icon="lucide:file-text" /></span>
            <span class="docs-item-main">
              <span class="docs-item-title">{{ doc.title || '未命名文档' }}</span>
              <span class="docs-item-time">{{ formatTime(doc.updatedAt) }}</span>
            </span>
          </button>
        </div>
      </aside>

      <section class="sr-panel docs-editor">
        <div v-if="!activeDoc" class="docs-editor-placeholder">
          <IconifyIcon icon="lucide:book-open" class="docs-empty-icon" />
          <p>选择左侧文档开始阅读或编辑</p>
        </div>

        <template v-else>
          <div class="docs-editor-head">
            <input
              v-if="editing"
              v-model="draftTitle"
              class="sr-input docs-title-input"
              aria-label="文档标题"
              @keydown.enter.prevent="commit"
            />
            <h2 v-else class="docs-editor-title">{{ activeDoc.title || '未命名文档' }}</h2>

            <div class="docs-editor-actions">
              <template v-if="editing">
                <button type="button" class="sr-btn sr-btn--ghost" @mousedown.prevent @click="commit">
                  保存
                </button>
                <button type="button" class="sr-btn sr-btn--ghost" @mousedown.prevent @click="cancelEdit">
                  取消
                </button>
              </template>
              <button v-else type="button" class="sr-btn sr-btn--ghost" @click="beginEdit">
                <IconifyIcon icon="lucide:pencil" />
                编辑
              </button>
              <button
                type="button"
                class="sr-btn sr-btn--ghost docs-delete"
                :aria-label="`删除文档：${activeDoc.title}`"
                @mousedown.prevent
                @click="removeDoc(activeDoc.id)"
              >
                <IconifyIcon icon="lucide:trash-2" />
              </button>
            </div>
          </div>

          <div class="docs-editor-meta">
            <IconifyIcon icon="lucide:clock" />
            <span>更新于 {{ formatTime(activeDoc.updatedAt) }}</span>
          </div>

          <div class="docs-editor-body">
            <textarea
              v-if="editing"
              ref="editorRef"
              v-model="draftContent"
              class="sr-input docs-textarea"
              placeholder="在这里书写你的想法…"
              aria-label="文档内容"
              @blur="onEditorBlur"
              @keydown.esc="cancelEdit"
            />
            <div v-else class="docs-content">{{ activeDoc.content || '（空白文档）' }}</div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.docs-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.docs-loading {
  display: flex;
  min-height: 240px;
  align-items: center;
  justify-content: center;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid color-mix(in srgb, var(--study-room-primary) 25%, transparent);
  border-top-color: var(--study-room-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.docs-empty-icon {
  color: var(--study-room-primary);
  font-size: 30px;
}

.docs-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  min-height: 480px;
}

.docs-list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.docs-list-head {
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgb(255 255 255 / 0.08);
  font-size: 12px;
  color: rgb(255 255 255 / 0.5);
}

.docs-list-body {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  overflow-y: auto;
}

.docs-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: #fff;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.docs-item:hover {
  background: rgb(255 255 255 / 0.05);
}

.docs-item.active {
  border-color: color-mix(in srgb, var(--study-room-primary) 35%, transparent);
  background: color-mix(in srgb, var(--study-room-primary) 12%, transparent);
}

.docs-item-icon {
  display: flex;
  flex-shrink: 0;
  color: var(--study-room-primary);
}

.docs-item-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.docs-item-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.docs-item-time {
  font-size: 11px;
  color: rgb(255 255 255 / 0.45);
}

.docs-editor {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.docs-editor-placeholder {
  display: flex;
  flex: 1;
  min-height: 300px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgb(255 255 255 / 0.45);
}

.docs-editor-placeholder p {
  margin: 0;
  font-size: 13px;
}

.docs-editor-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 0;
}

.docs-editor-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  word-break: break-word;
}

.docs-title-input {
  flex: 1;
  min-width: 0;
  font-size: 18px;
  font-weight: 700;
}

.docs-editor-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.docs-editor-actions .sr-btn {
  padding: 8px 16px;
  font-size: 13px;
}

.docs-delete {
  color: rgb(255 255 255 / 0.7) !important;
}

.docs-delete:hover {
  color: #ff7a7a !important;
}

.docs-editor-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px 0;
  font-size: 12px;
  color: rgb(255 255 255 / 0.45);
}

.docs-editor-body {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  padding: 12px 18px 18px;
}

.docs-textarea {
  flex: 1;
  min-height: 320px;
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.7;
}

.docs-content {
  flex: 1;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.8;
  color: rgb(255 255 255 / 0.85);
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 768px) {
  .docs-layout {
    grid-template-columns: 1fr;
  }
}
</style>
