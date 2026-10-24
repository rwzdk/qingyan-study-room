# 清砚自习室独立版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:dispatching-parallel-agents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `E:\projects\study-room` 创建不依赖 qc-student 后端的自习室纯前端项目，并发布到 Qoder Sites。

**Architecture:** Vue 3 + TypeScript + Vite 单页应用，单路由 `/`，`?tab=` 控制五个页签。所有状态写入 localStorage；图标、用户资料、偏好全部本地化；静态构建后由 Qoder Sites 托管。

**Tech Stack:** Vue 3.5、vue-router 4、Element Plus、Three.js、lucide-vue-next、Vitest、jsdom、pnpm。

**Spec:** `E:\projects\study-room\docs\specs\2026-10-24-study-room-standalone-design.md`

## Global Constraints

- Node >= 22，使用 pnpm。
- 项目根目录固定为 `E:\projects\study-room`。
- 源码别名 `#/` 指向 `src/`。
- 不请求 qc-student 后端、`/api`、`api.iconify.design` 或任何在线图标服务。
- 不复制 `public/audio`；白噪音由 `ambient-audio.ts` 实时合成。
- 不复制 `ChatRoom.vue`、`AnnouncementHub.vue`、learningSpace 组件。
- 不自动 commit / push；仅在用户明确要求时提交。
- 所有面向用户的文案保持中文。
- 构建产物目录必须是 `dist`，Qoder Sites 以 `spa: true` 发布。

---

## 文件所有权与并行策略

| Agent | 负责文件 | 依赖 |
| --- | --- | --- |
| A（基础） | 配置、`src/lib/*`、`src/components/IconifyIcon.vue`、`src/views/studyRoom/study-room-types.ts`、`study-room-state-store.ts`、`study-room-store.ts`、`study-room-scene.ts`、`src/lib/backup.ts`、测试、`src/main.ts`、`src/App.vue`、`src/router/index.ts`、占位 `index.vue` | 无 |
| D（资源） | `public/images/study-room/*`、`src/assets/defaultUserAvatar.png`、`src/style.css`、`README.md` | 无，可与 A 并行 |
| B（外壳） | `src/views/studyRoom/index.vue`、`RoomTopBar.vue`、`TabErrorBoundary.vue` | A 完成后 |
| C（页签） | `AmbientSound.vue`、`ambient-audio.ts`、`FocusRoom.vue`、`FocusTimer.vue`、`ImmersiveOverlay.vue`、`LocalTodoPanel.vue`、`IslandCheckin.vue`、`LearningIsland.vue`、`StudyPlans.vue`、`StudyDocs.vue`、`StudyHome.vue`、`study-room-extension.css` | A 完成后，与 B 并行 |

B 与 C 不修改对方文件；`index.vue` 只由 B 修改，`StudyHome.vue` 只由 C 修改。B/C 都依赖对方负责的组件时，不要各自运行完整 `pnpm typecheck`，由主 Agent 在两者完成后统一执行。`study-room-scene.ts` 归 A，保证 A 的场景测试可独立运行。

---

## Task 1: 项目骨架与本地运行时（Agent A）

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `.gitignore`
- Create: `src/env.d.ts`
- Create: `src/main.ts`
- Create: `src/App.vue`
- Create: `src/router/index.ts`
- Create: `src/components/IconifyIcon.vue`
- Create: `src/lib/icons.ts`
- Create: `src/lib/preferences.ts`
- Create: `src/lib/storage.ts`
- Create: `src/lib/local-user.ts`
- Create: `src/lib/backup.ts`
- Create: `src/views/studyRoom/study-room-types.ts`
- Create: `src/views/studyRoom/study-room-state-store.ts`
- Create: `src/views/studyRoom/study-room-store.ts`
- Create: `src/views/studyRoom/study-room-scene.ts`
- Create: `src/views/studyRoom/index.vue`（占位，Task 2 覆盖）
- Test: `src/views/studyRoom/__tests__/study-room-state.test.ts`
- Test: `src/views/studyRoom/__tests__/study-room-utils.test.ts`

**Interfaces:**
- Produces: `useStudyRoomState()`, `loadStudyRoomState()`, `scheduleSaveStudyRoom()`, `flushStudyRoom()`, `exportStudyRoomState()`, `importStudyRoomState(raw: string)`
- Produces: `useLocalUser()`, `saveLocalUser(patch)`, `fileToAvatarDataUrl(file)`
- Produces: `IconifyIcon.vue`，props `{ icon: string; size?: string | number }`
- Produces: `StudyRoomState`、`StudyRoomCheckin` 等类型
- Produces: `calcStreak`、`dateKeyOf`、`todayKey`、`daysOfYear`

- [ ] **Step 1: 创建目录并初始化 Git（不提交）**

```bash
cd /e/projects/study-room
mkdir -p src/components src/lib src/router src/views/studyRoom/__tests__ src/assets public/images/study-room
git init
```

- [ ] **Step 2: 写 `package.json` 与安装依赖**

```json
{
  "name": "qingyan-study-room",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "vue-tsc --noEmit",
    "test": "vitest run"
  }
}
```

```bash
pnpm add vue vue-router element-plus three lucide-vue-next
pnpm add -D vite @vitejs/plugin-vue typescript vue-tsc vitest jsdom @types/three @types/node
```

- [ ] **Step 3: 写配置文件**

`vite.config.ts`:

```ts
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
```

`vitest.config.ts`:

```ts
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": {
      "#/*": ["src/*"]
    }
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.d.ts",
    "src/**/*.vue",
    "vite.config.ts",
    "vitest.config.ts"
  ]
}
```

`src/env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>清砚自习室</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`.gitignore`:

```text
node_modules
dist
.DS_Store
*.local
```

- [ ] **Step 4: 写应用入口与占位页**

`src/main.ts`:

```ts
import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';

import App from './App.vue';
import router from './router';
import './style.css';

createApp(App).use(router).use(ElementPlus).mount('#app');
```

`src/App.vue`:

```vue
<template>
  <router-view />
</template>
```

`src/router/index.ts`:

```ts
import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'StudyRoom',
      component: () => import('#/views/studyRoom/index.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
});

export default router;
```

`src/views/studyRoom/index.vue`（占位，Task 2 覆盖）:

```vue
<template>
  <main style="padding: 40px; color: #fff">清砚自习室加载中…</main>
</template>
```

- [ ] **Step 5: 写本地图标层**

`src/lib/icons.ts`:

```ts
import type { Component } from 'vue';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  CalendarCheck,
  ChartLine,
  Check,
  CheckCircle,
  ChevronDown,
  CircleCheck,
  Clock,
  FileText,
  Flag,
  Flame,
  Github,
  History,
  Leaf,
  ListChecks,
  LogOut,
  MapPin,
  Maximize2,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  SkipForward,
  Sparkles,
  Target,
  Timer,
  TimerReset,
  Trash2,
  TrendingUp,
  TriangleAlert,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-vue-next';

export const icons: Record<string, Component> = {
  'lucide:arrow-left': ArrowLeft,
  'lucide:book-open': BookOpen,
  'lucide:calendar': Calendar,
  'lucide:calendar-check': CalendarCheck,
  'lucide:chart-line-up': ChartLine,
  'lucide:check': Check,
  'lucide:check-circle': CheckCircle,
  'lucide:chevron-down': ChevronDown,
  'lucide:circle-check': CircleCheck,
  'lucide:clock': Clock,
  'lucide:file-text': FileText,
  'lucide:flag': Flag,
  'lucide:flame': Flame,
  'lucide:github': Github,
  'lucide:history': History,
  'lucide:leaf': Leaf,
  'lucide:list-checks': ListChecks,
  'lucide:log-out': LogOut,
  'lucide:map-pin': MapPin,
  'lucide:maximize-2': Maximize2,
  'lucide:message-circle': MessageCircle,
  'lucide:pause': Pause,
  'lucide:pencil': Pencil,
  'lucide:play': Play,
  'lucide:plus': Plus,
  'lucide:rotate-ccw': RotateCcw,
  'lucide:send': Send,
  'lucide:skip-forward': SkipForward,
  'lucide:sparkles': Sparkles,
  'lucide:target': Target,
  'lucide:timer': Timer,
  'lucide:timer-reset': TimerReset,
  'lucide:trash-2': Trash2,
  'lucide:trending-up': TrendingUp,
  'lucide:triangle-alert': TriangleAlert,
  'lucide:user': User,
  'lucide:volume-2': Volume2,
  'lucide:volume-x': VolumeX,
  'lucide:x': X,
};
```

`src/components/IconifyIcon.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';

import { icons } from '#/lib/icons';

const props = defineProps<{
  icon: string;
  size?: string | number;
}>();

const resolved = computed(() => icons[props.icon]);
</script>

<template>
  <component
    :is="resolved"
    v-if="resolved"
    :size="size ?? '1em'"
    aria-hidden="true"
  />
  <span v-else aria-hidden="true" />
</template>
```

- [ ] **Step 6: 写偏好、存储与本地用户**

`src/lib/preferences.ts`:

```ts
import defaultUserAvatar from '#/assets/defaultUserAvatar.png';

export const defaultAvatar = defaultUserAvatar;
```

`src/lib/storage.ts`:

```ts
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
```

`src/lib/local-user.ts`:

```ts
import { reactive } from 'vue';

import defaultUserAvatar from '#/assets/defaultUserAvatar.png';
import { readJson, writeJson } from './storage';

export interface LocalUserProfile {
  nickname: string;
  avatar: string;
  joinedAt: string;
}

const STORAGE_KEY = 'qingyan-study-room:profile:v1';

const fallback: LocalUserProfile = {
  nickname: '学习者',
  avatar: defaultUserAvatar,
  joinedAt: new Date().toISOString().slice(0, 10),
};

const storedRaw = readJson<unknown>(STORAGE_KEY, {});
const stored =
  storedRaw && typeof storedRaw === 'object'
    ? (storedRaw as Partial<LocalUserProfile>)
    : {};
const profile = reactive<LocalUserProfile>({
  nickname:
    typeof stored.nickname === 'string' && stored.nickname.trim()
      ? stored.nickname.trim()
      : fallback.nickname,
  avatar: typeof stored.avatar === 'string' && stored.avatar ? stored.avatar : fallback.avatar,
  joinedAt:
    typeof stored.joinedAt === 'string' && stored.joinedAt
      ? stored.joinedAt
      : fallback.joinedAt,
});

export function useLocalUser() {
  return { profile };
}

export function saveLocalUser(patch: Partial<LocalUserProfile>): void {
  Object.assign(profile, patch);
  writeJson(STORAGE_KEY, profile);
}

async function loadImageSource(
  file: File,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('无法读取图片'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const source = await loadImageSource(file);
  const sourceWidth =
    source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const sourceHeight =
    source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法处理图片');
  const scale = Math.max(size / sourceWidth, size / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  ctx.drawImage(source, (size - width) / 2, (size - height) / 2, width, height);
  if (!(source instanceof HTMLImageElement)) source.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
```

- [ ] **Step 7: 写类型、纯函数与本地状态层**

`src/views/studyRoom/study-room-types.ts`:

```ts
export interface StudyRoomCheckin {
  date: string;
  hours: number;
  mood?: string;
}

export interface StudyRoomPlan {
  id: string;
  name: string;
  goal: string;
  tasks: { id: string; title: string; done: boolean }[];
  createdAt: string;
}

export interface StudyRoomDoc {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export interface StudyRoomTodo {
  id: string;
  title: string;
  completed: boolean;
}

export interface StudyRoomFocusSession {
  minutes: number;
  sessionId: string;
  createdAt: string;
}

export interface StudyRoomState {
  checkins: StudyRoomCheckin[];
  plans: StudyRoomPlan[];
  docs: StudyRoomDoc[];
  todos: StudyRoomTodo[];
  focus_sessions: StudyRoomFocusSession[];
}
```

`src/views/studyRoom/study-room-store.ts`：复制原文件后删除 `getStudyRoomUserKey`，并改为从类型文件导入：

```ts
import type { StudyRoomCheckin } from './study-room-types';

export type { StudyRoomCheckin } from './study-room-types';

export function todayKey(): string { /* 原实现不变 */ }
export function dateKeyOf(date: Date): string { /* 原实现不变 */ }
export function calcStreak(dates: Set<string>): number { /* 原实现不变 */ }
export function daysOfYear(year: number): string[] { /* 原实现不变 */ }
```

原文件：`E:\projects\qc-student\frontend\app\src\views\studyRoom\study-room-store.ts`。

`src/views/studyRoom/study-room-state-store.ts`:

```ts
import { ref } from 'vue';

import { readJson, writeJson } from '#/lib/storage';
import type {
  StudyRoomCheckin,
  StudyRoomDoc,
  StudyRoomFocusSession,
  StudyRoomPlan,
  StudyRoomState,
  StudyRoomTodo,
} from './study-room-types';

const STORAGE_KEY = 'qingyan-study-room:state:v1';

function emptyState(): StudyRoomState {
  return {
    checkins: [],
    plans: [],
    docs: [],
    todos: [],
    focus_sessions: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isCheckin(value: unknown): value is StudyRoomCheckin {
  return (
    isRecord(value) &&
    typeof value.date === 'string' &&
    typeof value.hours === 'number'
  );
}

function isPlanTask(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.done === 'boolean'
  );
}

function isPlan(value: unknown): value is StudyRoomPlan {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.goal === 'string' &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isPlanTask)
  );
}

function isDoc(value: unknown): value is StudyRoomDoc {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.content === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isTodo(value: unknown): value is StudyRoomTodo {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.completed === 'boolean'
  );
}

function isFocusSession(value: unknown): value is StudyRoomFocusSession {
  return (
    isRecord(value) &&
    typeof value.minutes === 'number' &&
    typeof value.sessionId === 'string' &&
    typeof value.createdAt === 'string'
  );
}

function normalize(raw: unknown): StudyRoomState {
  if (!isRecord(raw)) return emptyState();
  const list = <T>(candidate: unknown, guard: (item: unknown) => item is T): T[] =>
    Array.isArray(candidate) ? candidate.filter(guard) : [];
  return {
    checkins: list(raw.checkins, isCheckin),
    plans: list(raw.plans, isPlan),
    docs: list(raw.docs, isDoc),
    todos: list(raw.todos, isTodo),
    focus_sessions: list(raw.focus_sessions, isFocusSession),
  };
}

function hasArrayFields(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return [
    'checkins',
    'plans',
    'docs',
    'todos',
    'focus_sessions',
  ].every((key) => Array.isArray(raw[key]));
}

const state = ref<StudyRoomState>(normalize(readJson(STORAGE_KEY, emptyState())));
const loaded = ref(true);
const loading = ref(false);
const error = ref('');

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

export async function loadStudyRoomState(): Promise<StudyRoomState> {
  loading.value = true;
  state.value = normalize(readJson(STORAGE_KEY, emptyState()));
  loaded.value = true;
  dirty = false;
  loading.value = false;
  return state.value;
}

export function scheduleSaveStudyRoom(): void {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushStudyRoom();
  }, 500);
}

export async function flushStudyRoom(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dirty) return;
  dirty = false;
  const ok = writeJson(STORAGE_KEY, state.value);
  error.value = ok ? '' : '自习室数据保存失败';
}

export function exportStudyRoomState(): string {
  return JSON.stringify(state.value, null, 2);
}

export function importStudyRoomState(raw: string): StudyRoomState {
  const parsed: unknown = JSON.parse(raw);
  if (!hasArrayFields(parsed)) {
    throw new Error('文件格式不正确');
  }
  state.value = normalize(parsed);
  dirty = true;
  void flushStudyRoom();
  return state.value;
}

export function useStudyRoomState() {
  return { state, loaded, loading, error };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      state.value = normalize(JSON.parse(event.newValue));
      dirty = false;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
    } catch {
      // 其他标签页写入坏数据时忽略，保留当前状态。
    }
  });
  window.addEventListener('beforeunload', () => {
    void flushStudyRoom();
  });
}
```

`src/views/studyRoom/study-room-scene.ts`：复制原文件，并把存储键改为新命名空间：

```bash
cp /e/projects/qc-student/frontend/app/src/views/studyRoom/study-room-scene.ts \
   /e/projects/study-room/src/views/studyRoom/study-room-scene.ts
```

```ts
export const STUDY_ROOM_SCENE_STORAGE_KEY = 'qingyan-study-room:scene:v1';
```

`src/lib/backup.ts`（备份状态、个人资料与场景，导入后由调用方刷新页面）：

```ts
import { asStudyRoomScene, STUDY_ROOM_SCENE_STORAGE_KEY } from '#/views/studyRoom/study-room-scene';
import {
  exportStudyRoomState,
  importStudyRoomState,
} from '#/views/studyRoom/study-room-state-store';
import { saveLocalUser, useLocalUser } from './local-user';

export const BACKUP_VERSION = 1;

export function exportBackup(): string {
  const { profile } = useLocalUser();
  return JSON.stringify(
    {
      version: BACKUP_VERSION,
      state: JSON.parse(exportStudyRoomState()),
      profile: {
        nickname: profile.nickname,
        avatar: profile.avatar,
        joinedAt: profile.joinedAt,
      },
      scene: asStudyRoomScene(
        window.localStorage.getItem(STUDY_ROOM_SCENE_STORAGE_KEY),
      ),
    },
    null,
    2,
  );
}

export function importBackup(raw: string): void {
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { version?: unknown }).version !== BACKUP_VERSION
  ) {
    throw new Error('文件格式不正确');
  }
  const data = parsed as {
    state?: unknown;
    profile?: { nickname?: unknown; avatar?: unknown };
    scene?: unknown;
  };
  if (!data.state) throw new Error('文件格式不正确');

  importStudyRoomState(JSON.stringify(data.state));

  const { profile } = useLocalUser();
  const nickname =
    typeof data.profile?.nickname === 'string' && data.profile.nickname.trim()
      ? data.profile.nickname.trim()
      : profile.nickname;
  const avatar =
    typeof data.profile?.avatar === 'string' && data.profile.avatar
      ? data.profile.avatar
      : profile.avatar;
  saveLocalUser({ nickname, avatar });

  window.localStorage.setItem(
    STUDY_ROOM_SCENE_STORAGE_KEY,
    asStudyRoomScene(data.scene),
  );
}
```

- [ ] **Step 8: 写测试**

`src/views/studyRoom/__tests__/study-room-state.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  exportStudyRoomState,
  flushStudyRoom,
  importStudyRoomState,
  loadStudyRoomState,
  scheduleSaveStudyRoom,
  useStudyRoomState,
} from '../study-room-state-store';

const STORAGE_KEY = 'qingyan-study-room:state:v1';

describe('study room local state', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.useRealTimers();
    await loadStudyRoomState();
  });

  it('returns empty arrays when storage is empty', async () => {
    const { state } = useStudyRoomState();
    await loadStudyRoomState();
    expect(state.value).toEqual({
      checkins: [],
      plans: [],
      docs: [],
      todos: [],
      focus_sessions: [],
    });
  });

  it('persists after the debounce delay', async () => {
    vi.useFakeTimers();
    const { state } = useStudyRoomState();
    state.value.checkins = [{ date: '2026-10-24', hours: 1 }];
    scheduleSaveStudyRoom();
    await vi.advanceTimersByTimeAsync(500);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).checkins).toHaveLength(1);
  });

  it('falls back to empty state when stored JSON is corrupt', async () => {
    localStorage.setItem(STORAGE_KEY, '{bad json');
    const { state } = useStudyRoomState();
    await loadStudyRoomState();
    expect(state.value.checkins).toEqual([]);
  });

  it('drops invalid items instead of crashing the page', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        checkins: [null, { date: '2026-10-24', hours: 2 }],
        plans: [],
        docs: [],
        todos: [],
        focus_sessions: [],
      }),
    );
    const { state } = useStudyRoomState();
    await loadStudyRoomState();
    expect(state.value.checkins).toEqual([
      { date: '2026-10-24', hours: 2 },
    ]);
  });

  it('syncs state written by another tab', () => {
    const { state } = useStudyRoomState();
    const payload = {
      checkins: [{ date: '2026-10-24', hours: 3 }],
      plans: [],
      docs: [],
      todos: [],
      focus_sessions: [],
    };
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: STORAGE_KEY,
        newValue: JSON.stringify(payload),
      }),
    );
    expect(state.value.checkins).toEqual(payload.checkins);
  });

  it('rejects import payloads with non-array fields', () => {
    expect(() =>
      importStudyRoomState(JSON.stringify({ checkins: {} })),
    ).toThrow('文件格式不正确');
  });

  it('exports and re-imports state', async () => {
    const { state } = useStudyRoomState();
    state.value.todos = [{ id: 't1', title: '复习', completed: false }];
    await flushStudyRoom();
    const exported = exportStudyRoomState();
    state.value.todos = [];
    importStudyRoomState(exported);
    expect(state.value.todos).toEqual([
      { id: 't1', title: '复习', completed: false },
    ]);
  });
});
```

`src/views/studyRoom/__tests__/study-room-utils.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { calcStreak, dateKeyOf, todayKey } from '../study-room-store';
import { asStudyRoomScene, STUDY_ROOM_DEFAULT_SCENE } from '../study-room-scene';

describe('study room date helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats local dates as YYYY-MM-DD', () => {
    expect(dateKeyOf(new Date(2026, 9, 24))).toBe('2026-10-24');
  });

  it('counts a streak including today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 12));
    expect(todayKey()).toBe('2026-10-24');
    const dates = new Set(['2026-10-24', '2026-10-23', '2026-10-22']);
    expect(calcStreak(dates)).toBe(3);
  });

  it('starts from yesterday when today has no check-in', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 12));
    const dates = new Set(['2026-10-23', '2026-10-22']);
    expect(calcStreak(dates)).toBe(2);
  });

  it('falls back to the default scene for unknown values', () => {
    expect(asStudyRoomScene('unknown')).toBe(STUDY_ROOM_DEFAULT_SCENE);
    expect(asStudyRoomScene('snow')).toBe('snow');
  });
});
```

- [ ] **Step 9: 运行测试与类型检查**

```bash
pnpm test
pnpm typecheck
```

预期：测试全部通过；类型检查通过（`style.css` 由 Agent D 提供，TypeScript 不会检查 CSS 内容）。

---

## Task 2: 项目外壳与本地化改造（Agent B）

**Files:**
- Modify: `src/views/studyRoom/index.vue`（覆盖 Task 1 占位）
- Create: `src/views/studyRoom/RoomTopBar.vue`
- Create: `src/views/studyRoom/TabErrorBoundary.vue`

**Interfaces:**
- Consumes: `IconifyIcon.vue`、`useLocalUser`、`loadStudyRoomState`、`flushStudyRoom`
- Produces: 路由页面 `index.vue`，页签 `island | focus | plans | docs | home`

- [ ] **Step 1: 复制源文件**

```bash
SRC=/e/projects/qc-student/frontend/app/src/views/studyRoom
DST=/e/projects/study-room/src/views/studyRoom
cp "$SRC/index.vue" "$DST/index.vue"
cp "$SRC/RoomTopBar.vue" "$DST/RoomTopBar.vue"
cp "$SRC/TabErrorBoundary.vue" "$DST/TabErrorBoundary.vue"
```

`study-room-scene.ts` 已由 Task 1 创建，不要在 Task 2 覆盖。

- [ ] **Step 2: 改造 `index.vue`**

删除以下导入：

```ts
import PracticeHistoryReview from '#/views/learningSpace/PracticeHistoryReview.vue';
import ReviewStrengthen from '#/views/learningSpace/ReviewStrengthen.vue';
```

`RoomTab` 改为：

```ts
type RoomTab = 'focus' | 'island' | 'plans' | 'docs' | 'home';
```

`TAB_ITEMS` 删除 `practiceHistory` 和 `reviewStrengthen` 两行，只保留：

```ts
const TAB_ITEMS: { key: RoomTab; icon: string; label: string }[] = [
  { key: 'island', icon: 'lucide:map-pin', label: '小岛' },
  { key: 'focus', icon: 'lucide:timer', label: '专注室' },
  { key: 'plans', icon: 'lucide:list-checks', label: '计划' },
  { key: 'docs', icon: 'lucide:file-text', label: '阅读' },
  { key: 'home', icon: 'lucide:chart-line-up', label: '主页' },
];
```

`getTab` 的允许列表删除 `practiceHistory`、`reviewStrengthen`。`switchTab` 中路径改为 `/`：

```ts
router.replace({ path: '/', query: { ...route.query, tab: currentTab.value } });
```

模板删除 `practiceHistory` 和 `reviewStrengthen` 两个 `<section>`，把 `home` 改成最后一个 `v-else`：

```vue
<section v-if="currentTab === 'focus'" class="study-room-panel study-room-focus-panel">
  <FocusRoom :scene="scene" :scene-copy="sceneCopy" />
</section>
<section v-else-if="currentTab === 'island'" class="study-room-panel study-room-island-panel">
  <IslandCheckin :scene="scene" />
</section>
<section v-else-if="currentTab === 'plans'" class="study-room-panel">
  <StudyPlans />
</section>
<section v-else-if="currentTab === 'docs'" class="study-room-panel">
  <StudyDocs />
</section>
<section v-else class="study-room-panel">
  <StudyHome />
</section>
```

保留 `index.vue` 末尾所有 `html[data-study-room-scene]` 的全局 Element Plus 样式。

- [ ] **Step 3: 改造 `RoomTopBar.vue`**

把 `<script setup>` 整体替换为下面的内容（不要保留 `loginName`、`userMenuOpen`、`ref`、`useRouter` 等旧引用）：

```ts
import { computed } from 'vue';

import { IconifyIcon } from '#/components/IconifyIcon.vue';
import { useLocalUser } from '#/lib/local-user';

import AmbientSound from './AmbientSound.vue';
import type { StudyRoomScene } from './study-room-scene';
import { STUDY_ROOM_SCENES } from './study-room-scene';

defineProps<{
  scene: StudyRoomScene;
  activeTab: string;
  tabItems: { key: string; icon: string; label: string }[];
}>();

const emit = defineEmits<{
  'switch-scene': [scene: StudyRoomScene];
  'switch-tab': [tab: string];
}>();

const { profile } = useLocalUser();
const avatar = computed(() => profile.avatar);
const nickname = computed(() => profile.nickname);

const sceneOptions = Object.entries(STUDY_ROOM_SCENES).map(
  ([value, copy]) => ({ value: value as StudyRoomScene, copy }),
);

function openProfile() {
  emit('switch-tab', 'home');
}
```

模板左侧清空：

```vue
<div class="top-bar-side top-bar-left" />
```

右侧改为：

```vue
<div class="top-bar-side top-bar-right">
  <AmbientSound :scene="scene" />
  <button
    type="button"
    class="user-avatar-btn"
    :aria-label="`${nickname}的本地资料`"
    :title="`${nickname} · 回到主页编辑资料`"
    @click="openProfile"
  >
    <img :src="avatar" alt="头像" class="user-avatar-img" />
  </button>
</div>
```

删除整个 `user-menu-wrap`、GitHub 链接、`AnnouncementHub`、`ChatRoom` 相关模板。未使用的 `.github-link`、`.user-menu*` 样式可保留，不影响构建；集成阶段可清理。

在 `RoomTopBar.vue` 的 scoped 样式末尾加入移动端折叠规则：

```css
@media (max-width: 720px) {
  .room-top-bar {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 12px 0;
  }

  .top-bar-left {
    display: none;
  }

  .top-bar-right {
    order: -1;
    justify-content: flex-end;
  }

  .nav-capsule {
    width: 100%;
    max-width: 100%;
    justify-content: flex-start;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .nav-capsule::-webkit-scrollbar {
    display: none;
  }
}
```

- [ ] **Step 4: 改造 `TabErrorBoundary.vue`**

把：

```ts
import { IconifyIcon } from '@qc-student/icons';
```

改为：

```ts
import { IconifyIcon } from '#/components/IconifyIcon.vue';
```

- [ ] **Step 5: 静态检查**

```bash
cd /e/projects/study-room
grep -rnE "@qc-student|#/api|#/store|learningSpace|AnnouncementHub|ChatRoom" src/views/studyRoom/index.vue src/views/studyRoom/RoomTopBar.vue src/views/studyRoom/TabErrorBoundary.vue
```

预期：无输出。不要在本任务运行完整 `pnpm typecheck`，因为 Task 3 的页签组件可能尚未完成。

---

## Task 3: 页签组件与主页本地化（Agent C）

**Files:**
- Create: `src/views/studyRoom/AmbientSound.vue`
- Create: `src/views/studyRoom/ambient-audio.ts`
- Create: `src/views/studyRoom/FocusRoom.vue`
- Create: `src/views/studyRoom/FocusTimer.vue`
- Create: `src/views/studyRoom/ImmersiveOverlay.vue`
- Create: `src/views/studyRoom/LocalTodoPanel.vue`
- Create: `src/views/studyRoom/IslandCheckin.vue`
- Create: `src/views/studyRoom/LearningIsland.vue`
- Create: `src/views/studyRoom/StudyPlans.vue`
- Create: `src/views/studyRoom/StudyDocs.vue`
- Create: `src/views/studyRoom/StudyHome.vue`
- Create: `src/views/studyRoom/study-room-extension.css`

**Interfaces:**
- Consumes: `IconifyIcon.vue`、`useLocalUser`、`fileToAvatarDataUrl`、`useStudyRoomState`、`scheduleSaveStudyRoom`、`exportBackup`、`importBackup`
- Produces: 五个页签所需的全部子组件

- [ ] **Step 1: 复制源文件（不复制 `ChatRoom.vue`）**

```bash
SRC=/e/projects/qc-student/frontend/app/src/views/studyRoom
DST=/e/projects/study-room/src/views/studyRoom
for f in AmbientSound.vue ambient-audio.ts FocusRoom.vue FocusTimer.vue ImmersiveOverlay.vue LocalTodoPanel.vue IslandCheckin.vue LearningIsland.vue StudyPlans.vue StudyDocs.vue StudyHome.vue study-room-extension.css; do
  cp "$SRC/$f" "$DST/$f"
done
```

- [ ] **Step 2: 批量替换图标导入**

在 `AmbientSound.vue`、`FocusRoom.vue`、`FocusTimer.vue`、`ImmersiveOverlay.vue`、`LocalTodoPanel.vue`、`IslandCheckin.vue`、`LearningIsland.vue`、`StudyPlans.vue`、`StudyDocs.vue`、`StudyHome.vue` 中，把：

```ts
import { IconifyIcon } from '@qc-student/icons';
```

替换为：

```ts
import { IconifyIcon } from '#/components/IconifyIcon.vue';
```

检查是否还有 `@qc-student` 残留：

```bash
grep -rn "@qc-student" src/views/studyRoom
```

预期：只在 `RoomTopBar.vue` 的旧导入中出现（Task 2 已处理），最终应无输出。

- [ ] **Step 3: 改造 `StudyHome.vue` 的脚本**

删除以下导入：

```ts
import { ElUpload } from 'element-plus';
import { preferences } from '@qc-student/preferences';
import { useAccessStore, useUserStore } from '@qc-student/stores';
import { studentApi } from '#/api/request';
import { studentApiBase } from '#/api/student-http';
import { useAuthStore } from '#/store';
```

改为：

```ts
import { ElButton, ElDialog, ElInput, ElMessage } from 'element-plus';
import { IconifyIcon } from '#/components/IconifyIcon.vue';
import {
  fileToAvatarDataUrl,
  saveLocalUser,
  useLocalUser,
} from '#/lib/local-user';
import defaultAvatarImg from '#/assets/defaultUserAvatar.png';
import { exportBackup, importBackup } from '#/lib/backup';
import { useStudyRoomState } from './study-room-state-store';
```

保留 `import type { StudyRoomFocusSession } from './study-room-types';`（把原来的 `#/api/study-room` 导入改成本地类型文件）。

把：

```ts
const userStore = useUserStore();
const authStore = useAuthStore();
const accessStore = useAccessStore();
```

改为：

```ts
const { profile } = useLocalUser();
```

`profileForm` 只保留 `nickname` 和 `avatar`，删除 `mobile`。

`openProfileEditor` 改为：

```ts
function openProfileEditor() {
  profileForm.nickname = profile.nickname;
  profileForm.avatar = profile.avatar;
  profileEditVisible.value = true;
}
```

删除 `handleAvatarUpload`，新增：

```ts
async function onAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请选择图片文件');
    input.value = '';
    return;
  }
  try {
    profileForm.avatar = await fileToAvatarDataUrl(file);
  } catch {
    ElMessage.error('头像处理失败，请换一张图片');
  } finally {
    input.value = '';
  }
}
```

`saveProfile` 改为同步函数：

```ts
function saveProfile() {
  if (!profileForm.nickname.trim()) {
    ElMessage.warning('请输入昵称');
    return;
  }
  saveLocalUser({
    nickname: profileForm.nickname.trim(),
    avatar: profileForm.avatar || defaultAvatarImg,
  });
  profileEditVisible.value = false;
  ElMessage.success('个人资料已保存');
}
```

删除 `profileSaving` 或保留为 `false`（推荐删除相关模板引用）。

用户信息 computed 改为：

```ts
const userAvatar = computed(() => profile.avatar || defaultAvatarImg);
const userNickname = computed(() => profile.nickname || '学习者');
```

删除 `userEmail` computed；模板中的 `profile-email` 行不要删除，按 Step 4 改为本地模式提示。

新增导出/导入：

```ts
const importInput = ref<HTMLInputElement | null>(null);

function handleExport() {
  const blob = new Blob([exportBackup()], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `清砚自习室-${todayKey()}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerImport() {
  importInput.value?.click();
}

async function handleImport(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    importBackup(await file.text());
    ElMessage.success('数据已导入，页面即将刷新');
    window.setTimeout(() => window.location.reload(), 400);
  } catch {
    ElMessage.error('导入失败：文件格式不正确');
  } finally {
    input.value = '';
  }
}
```

- [ ] **Step 4: 改造 `StudyHome.vue` 的模板**

把「编辑资料」按钮旁增加导出/导入：

```vue
<div class="profile-actions">
  <button type="button" class="profile-action" @click="openProfileEditor">
    <IconifyIcon icon="lucide:pencil" />
    编辑资料
  </button>
  <button type="button" class="profile-action" @click="handleExport">
    导出数据
  </button>
  <button type="button" class="profile-action" @click="triggerImport">
    导入数据
  </button>
  <input
    ref="importInput"
    type="file"
    accept="application/json,.json"
    hidden
    @change="handleImport"
  />
</div>
```

把资料卡中的邮箱行改为本地模式提示：

```vue
<p class="profile-email">本地模式 · 数据只保存在当前浏览器</p>
```

把 `<ElUpload ...>` 块替换为：

```vue
<label class="avatar-uploader">
  <input type="file" accept="image/*" hidden @change="onAvatarChange" />
  <img
    :src="profileForm.avatar || defaultAvatar"
    class="editable-avatar"
    alt="用户头像"
  />
</label>
```

删除手机号输入：

```vue
<ElInput v-model="profileForm.mobile" placeholder="请输入手机号" />
```

保存按钮去掉 `:loading="profileSaving"`：

```vue
<ElButton type="primary" @click="saveProfile">保存</ElButton>
```

把资料弹窗宽度改为移动端安全值：

```vue
<ElDialog
  v-model="profileEditVisible"
  title="编辑资料"
  width="min(440px, 92vw)"
  class="study-home-profile-dialog"
  append-to-body
>
```

- [ ] **Step 5: 统一专注计时器的本地存储键**

把 `FocusTimer.vue` 中的：

```ts
'qcstudent-study-room-pomodoro'
```

改为：

```ts
'qingyan-study-room:pomodoro:v1'
```

- [ ] **Step 6: 检查其他组件的本地依赖**

```bash
grep -rnE "@qc-student|#/api|#/store|learningSpace|AnnouncementHub|ChatRoom|public/audio" src/views/studyRoom
```

预期：无输出（`RoomTopBar` 由 Task 2 处理）。

- [ ] **Step 7: 检查白噪音是否仍为合成实现**

```bash
grep -nE "fetch|new Audio|decodeAudioData|\.mp3|\.wav" src/views/studyRoom/ambient-audio.ts
```

预期：无输出（注释中的 mp3/wav 说明可保留，但不应有加载代码）。

---

## Task 4: 资源与基础样式（Agent D）

**Files:**
- Create: `public/images/study-room/rain.webp`
- Create: `public/images/study-room/snow.webp`
- Create: `public/images/study-room/cloud.webp`
- Create: `src/assets/defaultUserAvatar.png`
- Create: `src/style.css`
- Create: `README.md`

- [ ] **Step 1: 复制图片与头像**

```bash
SRC=/e/projects/qc-student/frontend/app
DST=/e/projects/study-room
cp "$SRC/public/images/study-room/rain.webp" "$DST/public/images/study-room/rain.webp"
cp "$SRC/public/images/study-room/snow.webp" "$DST/public/images/study-room/snow.webp"
cp "$SRC/public/images/study-room/cloud.webp" "$DST/public/images/study-room/cloud.webp"
cp "$SRC/src/assets/defaultUserAvatar.png" "$DST/src/assets/defaultUserAvatar.png"
```

- [ ] **Step 2: 写 `src/style.css`**

```css
:root {
  --qc-ink: #18181b;
  --qc-muted: #52525b;
  --qc-bar: transparent;
  --qc-bar-border: rgb(255 255 255 / 0.12);
  --study-room-primary: #d7ef83;
  color-scheme: dark;
  font-family:
    'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system,
    'Segoe UI', sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  height: 100%;
  margin: 0;
}

body {
  background: #1b2019;
  color: var(--qc-ink);
}

button,
input,
textarea {
  font: inherit;
}
```

- [ ] **Step 3: 写 `README.md`**

```markdown
# 清砚自习室

独立版自习室，纯前端运行，数据保存在浏览器 localStorage。

## 开发

```bash
pnpm install
pnpm dev
```

## 检查

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 数据

- 状态键：`qingyan-study-room:state:v1`
- 个人资料键：`qingyan-study-room:profile:v1`
- 场景键：`qingyan-study-room:scene:v1`

主页提供导出/导入 JSON，清理浏览器数据前请先导出。

## 部署

`pnpm build` 后得到 `dist/`，通过 Qoder Sites 以 SPA 方式托管。
```

---

## Task 5: 集成与静态验证（主 Agent）

**Files:**
- Modify: any integration files as needed.

- [ ] **Step 1: 安装依赖并检查残留引用**

```bash
cd /e/projects/study-room
pnpm install
grep -rnE "@qc-student|#/api|#/store|learningSpace|AnnouncementHub|ChatRoom|public/audio|api\.iconify" src package.json
```

预期：无输出。

- [ ] **Step 2: 类型检查**

```bash
pnpm typecheck
```

修复所有类型错误，重点检查：

- `StudyHome.vue` 是否仍引用 `studentApi`、`preferences`、`ElUpload`。
- `RoomTopBar.vue` 是否仍引用 `useRouter`、`AnnouncementHub`、`ChatRoom`。
- `index.vue` 是否仍引用已删除的复习组件。
- `lucide-vue-next` 图标导出名是否全部存在。

- [ ] **Step 3: 单元测试**

```bash
pnpm test
```

预期：全部通过。

- [ ] **Step 4: 生产构建**

```bash
pnpm build
```

预期：`dist/index.html` 与 `dist/assets/*` 生成；无构建警告级别的缺失资源。

- [ ] **Step 5: 离线依赖检查**

```bash
grep -rnE "https?://" src dist/index.html dist/assets/*.js | grep -vE "vue|element|three|lucide" | head -20
```

预期：没有 qc-student、iconify API 或后端域名。

---

## Task 6: 浏览器实测（主 Agent）

- [ ] **Step 1: 启动开发服务器**

```bash
cd /e/projects/study-room
pnpm dev
```

- [ ] **Step 2: 桌面端检查**

用 Chrome DevTools MCP 打开 `http://127.0.0.1:5173/`，逐项检查：

1. 五个页签：小岛、专注室、计划、阅读、主页均可切换，URL 出现 `?tab=`。
2. 小岛：3D 场景渲染，打卡按钮可用，打卡后热力图/统计变化。
3. 专注室：开始/暂停番茄钟，完成一次后主页累计分钟数增加。
4. 计划：新建计划、添加任务、勾选完成、刷新后保留。
5. 阅读：新建文档、编辑内容、刷新后保留。
6. 主页：修改昵称、上传头像、刷新后保留；导出 JSON 包含 state/profile/scene；导入后页面刷新且三部分数据恢复。
7. 场景：雨林/雪日/暖云切换，背景与主色变化，刷新后保留。
8. 白噪音：开启/关闭不产生音频文件网络请求。
9. 双标签页：在两个标签页打开站点，A 修改计划并保存，B 应通过 storage 事件同步；关闭旧标签页不会覆盖新数据。
10. Console 无未捕获异常。
11. Network 无 `/api`、qc-student 域名、`api.iconify.design` 请求。

- [ ] **Step 3: 移动端检查**

用 DevTools 设置 375×812 视口，检查：

- 顶部导航可横向滚动或折叠，白噪音按钮和头像不被裁切。
- 五个页签均可点击。
- 主页编辑资料弹窗宽度不超过 92vw，内容可操作。
- 计划/阅读表单、主页资料卡无横向滚动。

- [ ] **Step 4: 数据持久化检查**

刷新页面后确认打卡、计划、文档、待办、专注记录、昵称、头像、场景均保留。

---

## Task 7: Qoder Sites 发布（主 Agent）

- [ ] **Step 1: 重新构建**

```bash
cd /e/projects/study-room
pnpm build
```

- [ ] **Step 2: 生成发布 actionId**

```bash
node -e "console.log(crypto.randomUUID())"
```

记录该 UUID，后续重试必须复用。

- [ ] **Step 3: 检查本地站点上下文**

先加载 `sites:sites-building` / `sites:sites-hosting` 技能并遵循其步骤，然后调用：

```text
mcp__plugin_sites_qoder_sites__get_local_context({})
```

该工具从当前工作目录读取本地上下文。确认 `E:\projects\study-room` 没有已有绑定或描述文件。由于这是用户明确要求的新站点，且目录还没有 `.qoder.site`，准备草稿时传 `createNewSite: true`，不要传 `projectId`。

- [ ] **Step 4: 调用 Sites 准备草稿**

```text
mcp__plugin_sites_qoder_sites__prepare_site({
  actionId: "<UUID>",
  projectRoot: "E:\\projects\\study-room",
  webDirectory: "dist",
  spa: true,
  displayName: "清砚自习室",
  slug: "qingyan-study-room",
  createNewSite: true
})
```

检查返回的 `descriptorStatus` 与 `descriptorPath`；不要手写或修改生成的 `.qoder.site` 文件。若 `descriptorStatus` 为 `pending`，按工具说明用同一 actionId 重试。

- [ ] **Step 5: 发布**

```text
mcp__plugin_sites_qoder_sites__publish_site({ actionId: "<UUID>" })
```

按技能要求检查发布状态，必要时调用 `get_publish_status` / `get_deployment`，发布完成后调用 `show_publish_confirmation` 展示发布确认。

- [ ] **Step 6: 线上验证**

用浏览器打开返回的 URL，重复 Task 6 的核心检查：五个页签、刷新持久化、无后端请求、无控制台错误。

- [ ] **Step 7: 汇报**

记录并汇报：

- 项目路径
- 本地启动命令
- 线上 URL
- 已验证项与已知限制（localStorage 单浏览器、无登录同步）

---

## 自检结果

- 规格覆盖：功能范围、数据、依赖替换、资源、样式、测试、部署均有对应任务。
- 并行冲突：A 与 D 文件不重叠；B 与 C 文件不重叠；`index.vue` 只由 B 改，`StudyHome.vue` 只由 C 改。
- 类型一致性：`StudyRoomState` 由 `study-room-types.ts` 提供，状态层与主页共用；`useStudyRoomState` 返回 `state/loaded/loading/error`。
- 无占位符：所有新文件给出完整代码；复制文件给出精确源路径与改造点。
- 部署参数：`dist` + `spa: true` + `createNewSite: true` + 固定 slug，符合 `prepare_site` 接口。
- 复核修复：`study-room-scene.ts` 归 A；RoomTopBar 完整替换脚本消除 `loginName` 残留；状态层增加逐项校验、dirty 标记和跨标签同步；备份包含 profile/scene；移动端导航和弹窗宽度有明确规则；补充 `@types/node` 与 Sites 建站/确认步骤。
