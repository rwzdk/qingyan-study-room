<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import IconifyIcon from '#/components/IconifyIcon.vue';

import {
  dateKeyOf,
  isDateKey,
  isTodoVisibleOn,
  todoDateFromId,
  todayKey,
} from './study-room-store';
import type { StudyRoomTodo } from './study-room-types';
import { scheduleSaveStudyRoom, useStudyRoomState } from './study-room-state-store';

interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  date: string;
  completedOn?: string;
}

const { state } = useStudyRoomState();

const todos = ref<TodoItem[]>([]);
const value = ref('');
const loaded = ref(false);
const today = ref(todayKey());

function loadTodos(): TodoItem[] {
  const parsed = state.value.todos ?? [];
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is StudyRoomTodo =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.title === 'string',
    )
    .map((item) => ({
      id: item.id,
      title: item.title,
      completed: Boolean(item.completed),
      date: isDateKey(item.date)
        ? item.date
        : (todoDateFromId(item.id) ?? today.value),
      completedOn: isDateKey(item.completedOn) ? item.completedOn : undefined,
    }));
}

function needsDateMigration(): boolean {
  const parsed = state.value.todos ?? [];
  if (!Array.isArray(parsed)) return false;
  return parsed.some(
    (item) =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.title === 'string' &&
      !isDateKey(item.date),
  );
}

function saveTodos() {
  state.value.todos = todos.value;
  scheduleSaveStudyRoom();
}

function addTodo() {
  const trimmed = value.value.trim();
  if (!trimmed) return;
  todos.value = [
    ...todos.value,
    {
      id: `todo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: trimmed,
      completed: false,
      date: today.value,
    },
  ];
  value.value = '';
  saveTodos();
}

function toggleTodo(id: string) {
  todos.value = todos.value.map((item) => {
    if (item.id !== id) return item;
    const completed = !item.completed;
    return {
      ...item,
      completed,
      completedOn: completed ? today.value : undefined,
    };
  });
  saveTodos();
}

function removeTodo(id: string) {
  todos.value = todos.value.filter((item) => item.id !== id);
  saveTodos();
}

const editingId = ref('');
const editValue = ref('');

function startEdit(todo: TodoItem) {
  editingId.value = todo.id;
  editValue.value = todo.title;
}

function saveEdit(todo: TodoItem) {
  const trimmed = editValue.value.trim();
  editingId.value = '';
  if (trimmed && trimmed !== todo.title) {
    todos.value = todos.value.map((item) =>
      item.id === todo.id ? { ...item, title: trimmed } : item,
    );
    saveTodos();
  }
}

function cancelEdit() {
  editingId.value = '';
  editValue.value = '';
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    addTodo();
  }
}

const visibleTodos = computed(() =>
  todos.value.filter((item) => isTodoVisibleOn(item, today.value)),
);
const activeTodos = computed(() => visibleTodos.value.filter((item) => !item.completed));
const doneTodos = computed(() => visibleTodos.value.filter((item) => item.completed));
const orderedTodos = computed(() => [...activeTodos.value, ...doneTodos.value]);
const total = computed(() => visibleTodos.value.length);
const completedCount = computed(() => doneTodos.value.length);
const progress = computed(() =>
  total.value > 0 ? Math.round((completedCount.value / total.value) * 100) : 0,
);

const yesterday = computed(() => {
  const [year = 1970, month = 1, day = 1] = today.value.split('-').map(Number);
  return dateKeyOf(new Date(year, month - 1, day - 1));
});

function carryLabel(item: TodoItem): string {
  if (item.date >= today.value) return '';
  return item.date === yesterday.value ? '昨日' : item.date.slice(5);
}

let dayTimer: ReturnType<typeof setInterval> | null = null;

function syncToday() {
  const next = todayKey();
  if (next !== today.value) today.value = next;
}

onMounted(() => {
  dayTimer = setInterval(syncToday, 30_000);
  document.addEventListener('visibilitychange', syncToday);
});

onUnmounted(() => {
  if (dayTimer) clearInterval(dayTimer);
  dayTimer = null;
  document.removeEventListener('visibilitychange', syncToday);
});

// 本地状态加载完成后再同步（避免竞态读到空数组）
watch(
  () => state.value.todos,
  () => {
    const migrateDates = needsDateMigration();
    todos.value = loadTodos();
    loaded.value = true;
    if (migrateDates) saveTodos();
  },
  { immediate: true },
);
</script>

<template>
  <section class="todo-panel">
    <div v-if="!loaded" class="todo-loading">
      <div class="spinner" />
    </div>

    <template v-else>
      <div class="todo-header">
        <div class="todo-title">
          <span class="todo-icon"><IconifyIcon icon="lucide:list-checks" /></span>
          <div>
            <h3>今日待办</h3>
            <p>{{ total === 0 ? '从一件小事开始' : activeTodos.length > 0 ? `${activeTodos.length} 件等待完成` : '清单已经完成' }}</p>
          </div>
        </div>
        <div class="todo-count">
          <strong>{{ completedCount }}</strong><span>/ {{ total }}</span>
        </div>
      </div>

      <div class="todo-progress">
        <div class="todo-progress-fill" :style="{ width: `${progress}%` }" />
      </div>

      <div class="todo-add">
        <span class="todo-add-icon"><IconifyIcon icon="lucide:plus" /></span>
        <input
          v-model="value"
          type="text"
          placeholder="添加一件要做的事"
          aria-label="添加待办"
          @keydown="handleKeydown"
        />
        <button type="button" aria-label="添加到清单" :disabled="!value.trim()" @click="addTodo">
          <IconifyIcon icon="lucide:check" />
        </button>
      </div>

      <div class="todo-list">
        <div v-if="total === 0" class="todo-empty">
          <span class="todo-empty-icon"><IconifyIcon icon="lucide:sparkles" /></span>
          <p>留一点空间给今天</p>
          <span>写下一件事，然后专心完成它</span>
        </div>
        <div
          v-for="item in orderedTodos"
          :key="item.id"
          class="todo-item"
          :class="{ done: item.completed, editing: editingId === item.id }"
          role="checkbox"
          :aria-checked="item.completed"
          tabindex="0"
          @click="editingId !== item.id && toggleTodo(item.id)"
          @keydown.enter="editingId !== item.id && toggleTodo(item.id)"
          @keydown.space.prevent="editingId !== item.id && toggleTodo(item.id)"
        >
          <span class="todo-check" :class="{ checked: item.completed }">
            <IconifyIcon v-if="item.completed" icon="lucide:check" />
          </span>

          <input
            v-if="editingId === item.id"
            v-model="editValue"
            class="todo-edit-input"
            :aria-label="`编辑待办：${item.title}`"
            @click.stop
            @keydown.enter.stop.prevent="saveEdit(item)"
            @keydown.escape.stop.prevent="cancelEdit"
            @keydown.space.stop
            @blur="saveEdit(item)"
          />
          <span v-else class="todo-item-title">{{ item.title }}</span>
          <span v-if="carryLabel(item)" class="todo-carry" :title="item.date">
            {{ carryLabel(item) }}
          </span>

          <button
            v-if="editingId !== item.id"
            type="button"
            class="todo-edit"
            :aria-label="`编辑待办：${item.title}`"
            @click.stop="startEdit(item)"
          >
            <IconifyIcon icon="lucide:pencil" />
          </button>

          <button type="button" class="todo-remove" :aria-label="`删除待办：${item.title}`" @click.stop="removeTodo(item.id)">
            <IconifyIcon icon="lucide:trash-2" />
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.todo-panel {
  position: relative;
  display: flex;
  width: 100%;
  max-height: 62dvh;
  height: 520px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 16%, transparent);
  border-radius: 14px;
  background: color-mix(
    in srgb,
    var(--study-room-secondary, #5ab8b0) 7%,
    rgb(20 26 20 / 0.58)
  );
  box-shadow: 0 18px 55px rgb(0 0 0 / 0.16);
  backdrop-filter: blur(24px);
}

.todo-loading {
  display: flex;
  flex: 1;
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
  to { transform: rotate(360deg); }
}

.todo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
}

.todo-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.todo-icon {
  display: flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--study-room-primary) 15%, transparent);
  border-radius: 8px;
  color: var(--study-room-primary);
  background: color-mix(in srgb, var(--study-room-primary) 10%, transparent);
}

.todo-title h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}

.todo-title p {
  margin: 2px 0 0;
  font-size: 10px;
  color: rgb(255 255 255 / 0.5);
}

.todo-count {
  display: flex;
  align-items: baseline;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

.todo-count strong {
  font-size: 14px;
  font-weight: 600;
  color: rgb(255 255 255 / 0.8);
}

.todo-count span {
  font-size: 10px;
  color: rgb(255 255 255 / 0.4);
}

.todo-progress {
  height: 1px;
  margin: 0 16px;
  overflow: hidden;
  background: rgb(255 255 255 / 0.07);
}

.todo-progress-fill {
  height: 100%;
  background: var(--study-room-primary);
  transition: width 0.3s ease;
}

.todo-add {
  display: flex;
  height: 40px;
  align-items: center;
  gap: 8px;
  margin: 12px 12px 8px;
  padding: 0 12px;
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 8px;
  background: rgb(0 0 0 / 0.08);
}

.todo-add-icon {
  color: rgb(255 255 255 / 0.4);
}

.todo-add input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  color: #fff;
  background: transparent;
  font-size: 12px;
}

.todo-add input::placeholder {
  color: rgb(255 255 255 / 0.35);
}

.todo-add button {
  display: flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  color: #051612;
  background: var(--study-room-primary);
  cursor: pointer;
  transition: all 0.18s ease;
}

.todo-add button:disabled {
  opacity: 0;
  transform: scale(0.9);
  pointer-events: none;
}

.todo-list {
  flex: 1;
  min-height: 0;
  padding: 0 10px 12px;
  overflow-y: auto;
}

.todo-empty {
  display: flex;
  height: 100%;
  min-height: 176px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
}

.todo-empty-icon {
  display: flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--study-room-primary) 10%, transparent);
  border-radius: 50%;
  color: color-mix(in srgb, var(--study-room-primary) 55%, transparent);
}

.todo-empty p {
  margin: 12px 0 4px;
  font-size: 12px;
  color: rgb(255 255 255 / 0.65);
}

.todo-empty span {
  font-size: 10px;
  color: rgb(255 255 255 / 0.4);
}

.todo-item {
  display: flex;
  min-height: 36px;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.todo-item:hover {
  background: rgb(255 255 255 / 0.045);
}

.todo-check {
  display: flex;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 0.35);
  border-radius: 50%;
  color: #051612;
  transition: all 0.15s ease;
}

.todo-check.checked {
  border-color: var(--study-room-primary);
  background: var(--study-room-primary);
}

.todo-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 20px;
  color: rgb(255 255 255 / 0.82);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-item.done .todo-item-title {
  color: rgb(255 255 255 / 0.45);
  text-decoration: line-through;
}

.todo-carry {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  color: color-mix(in srgb, var(--study-room-primary) 78%, #fff);
  background: color-mix(in srgb, var(--study-room-primary) 12%, transparent);
  font-size: 9px;
  line-height: 16px;
}

.todo-edit-input {
  flex: 1;
  min-width: 0;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--study-room-primary) 30%, transparent);
  border-radius: 6px;
  outline: none;
  color: #fff;
  background: rgb(0 0 0 / 0.12);
  font-size: 12px;
  line-height: 20px;
}

.todo-edit {
  display: flex;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  color: rgb(255 255 255 / 0.2);
  background: transparent;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
}

.todo-item:hover .todo-edit {
  opacity: 1;
}

.todo-edit:hover {
  color: rgb(255 255 255 / 0.6);
  background: rgb(255 255 255 / 0.05);
}

.todo-remove {
  display: flex;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  color: rgb(255 255 255 / 0.2);
  background: transparent;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
}

.todo-item:hover .todo-remove {
  opacity: 1;
}

.todo-remove:hover {
  color: rgb(255 255 255 / 0.6);
  background: rgb(255 255 255 / 0.05);
}
</style>
