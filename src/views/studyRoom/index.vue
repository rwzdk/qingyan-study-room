<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import FocusRoom from './FocusRoom.vue';
import IslandCheckin from './IslandCheckin.vue';
import RoomTopBar from './RoomTopBar.vue';
import SceneAtmosphere from './SceneAtmosphere.vue';
import StudyDocs from './StudyDocs.vue';
import StudyHome from './StudyHome.vue';
import StudyPlans from './StudyPlans.vue';
import TabErrorBoundary from './TabErrorBoundary.vue';
import { flushStudyRoom } from './study-room-state-store';
import './study-room-extension.css';
import {
  STUDY_ROOM_DEFAULT_SCENE,
  STUDY_ROOM_SCENE_STORAGE_KEY,
  asStudyRoomScene,
  getStudyRoomSceneCopy,
  type StudyRoomScene,
} from './study-room-scene';

const route = useRoute();
const router = useRouter();

type RoomTab = 'focus' | 'island' | 'plans' | 'docs' | 'home';

const TAB_ITEMS: { key: RoomTab; icon: string; label: string }[] = [
  { key: 'island', icon: 'lucide:mountain', label: '小岛' },
  { key: 'focus', icon: 'lucide:timer', label: '专注室' },
  { key: 'plans', icon: 'lucide:list-checks', label: '计划' },
  { key: 'docs', icon: 'lucide:book-open', label: '阅读' },
  { key: 'home', icon: 'lucide:chart-line-up', label: '主页' },
];

function readScene(): StudyRoomScene {
  if (typeof window === 'undefined') return STUDY_ROOM_DEFAULT_SCENE;
  try {
    return asStudyRoomScene(window.localStorage.getItem(STUDY_ROOM_SCENE_STORAGE_KEY));
  } catch {
    return STUDY_ROOM_DEFAULT_SCENE;
  }
}

function persistScene(scene: StudyRoomScene) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STUDY_ROOM_SCENE_STORAGE_KEY, scene);
  } catch {
    // 本地存储不可用时静默降级，不阻断专注体验。
  }
}

const scene = ref<StudyRoomScene>(readScene());
const sceneCopy = computed(() => getStudyRoomSceneCopy(scene.value));

function getTab(value: unknown): RoomTab {
  const tabs: RoomTab[] = ['focus', 'island', 'plans', 'docs', 'home'];
  return tabs.includes(value as RoomTab) ? (value as RoomTab) : 'island';
}

const currentTab = ref<RoomTab>(getTab(route.query.tab));

watch(
  () => route.query.tab,
  (tab) => {
    currentTab.value = getTab(tab);
  },
);

function switchTab(tab: string) {
  currentTab.value = getTab(tab);
  router.replace({ path: '/', query: { ...route.query, tab: currentTab.value } });
}

function switchScene(next: StudyRoomScene) {
  scene.value = next;
  persistScene(next);
}

function applySceneToDom(next: StudyRoomScene) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.studyRoomScene = next;
}

watch(
  scene,
  (next) => applySceneToDom(next),
  { immediate: true },
);

// 云端/缓存状态由 SessionGate 在进入页面前注入，这里不再自行加载。
onBeforeUnmount(() => {
  void flushStudyRoom();
  // 清掉全局标记：该属性是"当前在自习室"的开关，
  // 用于给 teleport 到 body 的 Element Plus 浮层换深色皮肤。
  // 不清理会导致离开自习室后其他页面的弹窗也变成深色。
  if (typeof document !== 'undefined') {
    delete document.documentElement.dataset.studyRoomScene;
  }
});
</script>

<template>
  <div
    class="study-room-page"
    :data-scene="scene"
    :style="{
      '--study-room-primary': sceneCopy.primary,
      '--study-room-secondary': sceneCopy.secondary,
    }"
  >
    <SceneAtmosphere :scene="scene" />
    <RoomTopBar
      :scene="scene"
      :active-tab="currentTab"
      :tab-items="TAB_ITEMS"
      @switch-scene="switchScene"
      @switch-tab="switchTab"
    />

    <main class="study-room-body">
      <!-- 每个 tab 都包一层错误边界：单个 tab 渲染出错时只影响自己那块，
           不会因为异常冒泡把整个自习室（含顶栏导航）卸载掉。 -->
      <TabErrorBoundary :reset-key="currentTab" class="study-room-tab-boundary">
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
      </TabErrorBoundary>
    </main>
  </div>
</template>

<style scoped>
.study-room-page {
  position: relative;
  min-height: 100vh;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: var(--qc-ink);
  background-color: #1b2019;
}

.study-room-page > :not(.scene-atmosphere) {
  position: relative;
  z-index: 1;
}

.study-room-page > .scene-atmosphere {
  position: absolute;
  z-index: 0;
}

.study-room-page > .room-top-bar {
  z-index: 20;
}

.study-room-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: auto;
}

/* 错误边界容器：撑满滚动区并纵向排列，内部 section 通过 flex:1 继续占满 */
.study-room-tab-boundary {
  display: flex;
  min-height: 100%;
  flex-direction: column;
}

.study-room-tab-boundary > .study-room-panel {
  flex: 1;
  min-height: 0;
}

.study-room-tab-boundary > .tab-error-boundary {
  flex: 1;
}

.study-room-panel {
  min-height: 100%;
  padding: 24px;
}

/* 小岛页：热力图贴住页面下边界，因此取消底部内边距 */
.study-room-island-panel {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 24px 24px 0;
  display: flex;
  flex-direction: column;
}

.panel-heading {
  text-align: center;
  padding: 32px 0 8px;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--study-room-primary);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.panel-heading h1 {
  margin: 0;
  color: #fff;
  font-size: 32px;
  font-weight: 800;
}

.subtitle {
  margin: 10px 0 0;
  color: rgb(255 255 255 / 0.72);
  font-size: 15px;
}

.panel-placeholder {
  display: grid;
  place-items: center;
  min-height: 260px;
  margin-top: 24px;
  border: 1px dashed rgb(255 255 255 / 0.22);
  border-radius: 14px;
  color: rgb(255 255 255 / 0.5);
  background: rgb(0 0 0 / 0.2);
  font-size: 14px;
}

.study-room-focus-panel {
  display: flex;
  flex-direction: column;
}

/* 错题复习/复习加强：玻璃化，透出场景背景。
 * 通过重定义 --qc-* 变量让复用组件继承暗色玻璃皮肤，而非逐一覆盖。
 */
.study-room-review-panel {
  --qc-page: transparent;
  --qc-surface: rgb(0 0 0 / 0.28);
  --qc-card: rgb(255 255 255 / 0.05);
  --qc-hover: rgb(255 255 255 / 0.06);
  --qc-border: rgb(255 255 255 / 0.14);
  --qc-ink: #fff;
  --qc-muted: rgb(255 255 255 / 0.62);
  --qc-accent: var(--study-room-primary);
  /* 全局主题用 header[class*='header'] + !important 强加 var(--qc-bar) 白底；
     重定义 qc-bar 才能让含 header 的元素透出暗色玻璃。 */
  --qc-bar: rgb(0 0 0 / 0.28);
  --qc-bar-border: rgb(255 255 255 / 0.14);
  /* Element Plus 文本色令牌同步为亮色，覆盖 select/table/分页等组件默认深色字 */
  --el-text-color-primary: #fff;
  --el-text-color-regular: rgb(255 255 255 / 0.86);
  --el-text-color-secondary: rgb(255 255 255 / 0.6);
  --el-text-color-placeholder: rgb(255 255 255 / 0.4);
  --el-text-color-disabled: rgb(255 255 255 / 0.3);
  --el-bg-color: rgb(0 0 0 / 0.28);
  --el-bg-color-overlay: rgb(20 28 24 / 0.96);
  --el-fill-color: rgb(255 255 255 / 0.06);
  --el-fill-color-light: rgb(255 255 255 / 0.05);
  --el-fill-color-blank: transparent;
  --el-border-color: rgb(255 255 255 / 0.16);
  --el-border-color-light: rgb(255 255 255 / 0.12);
  --el-border-color-lighter: rgb(255 255 255 / 0.1);
}

.study-room-review-panel :deep(.history-review-page),
.study-room-review-panel :deep(.strengthen-page) {
  background: transparent;
  color: #fff;
}

/* Element Plus 控件玻璃化（输入框/下拉框/分页/标签） */
.study-room-review-panel :deep(.el-input__wrapper),
.study-room-review-panel :deep(.el-textarea__inner),
.study-room-review-panel :deep(.el-select__wrapper) {
  background-color: rgb(0 0 0 / 0.3) !important;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.14) inset !important;
}

/* ─────────────────────────────────────────────────────────────
 * 状态标签统一：错题复习/复习加强原本用「浅色底 + 深色字」
 * （#dcfce7 绿 / #fee2e2 红 / #fef3c7 黄），在自习室的深色玻璃面板里
 * 是一块块刺眼的亮斑，和整体风格不搭。
 * 这里统一改成「半透明色底 + 亮色字」，保留红/绿/黄的状态语义。
 * ───────────────────────────────────────────────────────────── */
.study-room-review-panel :deep(.result-correct),
.study-room-review-panel :deep(.status-mastered) {
  color: #86efac !important;
  background: rgb(34 197 94 / 0.18) !important;
  box-shadow: inset 0 0 0 1px rgb(134 239 172 / 0.3);
}

.study-room-review-panel :deep(.result-wrong),
.study-room-review-panel :deep(.status-review) {
  color: #fca5a5 !important;
  background: rgb(239 68 68 / 0.18) !important;
  box-shadow: inset 0 0 0 1px rgb(252 165 165 / 0.3);
}

.study-room-review-panel :deep(.result-pending),
.study-room-review-panel :deep(.status-pending) {
  color: #fcd34d !important;
  background: rgb(245 158 11 / 0.18) !important;
  box-shadow: inset 0 0 0 1px rgb(252 211 77 / 0.3);
}

/* 复习加强页里的「已完成/已掌握」提示条同样是浅色底，统一成暗色玻璃 */
.study-room-review-panel :deep(.round-done),
.study-room-review-panel :deep(.mastered-banner) {
  border-color: rgb(134 239 172 / 0.3) !important;
  background: rgb(34 197 94 / 0.12) !important;
  color: #86efac !important;
}

/* 主按钮在深色面板上用自习室主色，而非 Element Plus 的默认蓝/绿 */
.study-room-review-panel :deep(.el-button--primary) {
  border-color: transparent !important;
  color: #051612 !important;
  background-color: var(--study-room-primary) !important;
  box-shadow: 0 0 18px color-mix(in srgb, var(--study-room-primary) 26%, transparent);
}

.study-room-review-panel :deep(.el-button--primary:hover) {
  color: #051612 !important;
  background-color: color-mix(in srgb, var(--study-room-primary) 88%, white) !important;
}

.study-room-review-panel :deep(.el-button--success) {
  border-color: transparent !important;
  color: #051612 !important;
  background-color: var(--study-room-primary) !important;
}

/* 危险按钮（删除）保持红色语义，但改成暗色系的亮红，不用 EP 默认的亮粉底 */
.study-room-review-panel :deep(.el-button--danger.is-link),
.study-room-review-panel :deep(.el-button--danger.is-text) {
  color: #fca5a5 !important;
}

.study-room-review-panel :deep(.el-input__inner),
.study-room-review-panel :deep(.el-textarea__inner),
.study-room-review-panel :deep(.el-select__placeholder),
.study-room-review-panel :deep(.el-select__selected-item),
.study-room-review-panel :deep(.el-select__placeholder span),
.study-room-review-panel :deep(.el-select__selected-item span),
.study-room-review-panel :deep(.el-select__input) {
  color: #fff !important;
}

.study-room-review-panel :deep(.el-select__placeholder.is-transparent),
.study-room-review-panel :deep(.el-select__placeholder.is-transparent span) {
  color: rgb(255 255 255 / 0.42) !important;
}

/* select 内部所有文本节点强制亮色（EP 内部有更高优先级选择器） */
.study-room-review-panel :deep(.el-select) .el-select__wrapper .el-select__selection,
.study-room-review-panel :deep(.el-select) .el-select__wrapper .el-select__selection * {
  color: rgb(255 255 255 / 0.86) !important;
}

.study-room-review-panel :deep(.el-input__inner::placeholder),
.study-room-review-panel :deep(.el-textarea__inner::placeholder) {
  color: rgb(255 255 255 / 0.35) !important;
}

.study-room-review-panel :deep(.el-select__caret),
.study-room-review-panel :deep(.el-input__prefix),
.study-room-review-panel :deep(.el-input__suffix) {
  color: rgb(255 255 255 / 0.45) !important;
}

.study-room-review-panel :deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: transparent;
  --el-table-border-color: rgb(255 255 255 / 0.1);
  --el-table-text-color: #fff;
  --el-table-header-text-color: rgb(255 255 255 / 0.75);
  background-color: transparent !important;
  color: #fff;
}

.study-room-review-panel :deep(.el-pagination) {
  --el-pagination-bg-color: transparent;
  --el-pagination-text-color: #fff;
  --el-pagination-button-bg-color: rgb(255 255 255 / 0.06);
  --el-pagination-button-color: #fff;
  --el-pagination-hover-color: var(--study-room-primary);
  color: #fff;
}

.study-room-review-panel :deep(.el-tag) {
  border-color: rgb(255 255 255 / 0.18);
  color: #fff;
  background-color: rgb(255 255 255 / 0.06);
}

.study-room-review-panel :deep(.el-button) {
  border-color: rgb(255 255 255 / 0.18);
  color: #fff;
  background-color: rgb(255 255 255 / 0.06);
}

.study-room-review-panel :deep(.el-button:hover) {
  border-color: var(--study-room-primary);
  color: var(--study-room-primary);
  background-color: rgb(255 255 255 / 0.1);
}
</style>

<style>
/* 沉浸模式下锁定 body 滚动，退出后解锁（作用于全局 body，需非 scoped）。 */
body.study-room-immersive {
  overflow: hidden;
}

/* 沉浸时彻底隐藏自习室顶栏导航，避免透过半透明遮罩露底。 */
body.study-room-immersive .study-room-page > .room-top-bar {
  display: none !important;
}

/* ─────────────────────────────────────────────────────────────
 * 自习室内的 Element Plus 浮层皮肤（Dialog / MessageBox / Select 下拉 / Message）。
 *
 * 这些浮层由组件内部 teleport 到 body，**不在 .study-room-review-panel 的作用域内**，
 * 所以上面 scoped 里的覆盖一条都不生效 —— 这就是"查看解析"弹窗文字看不清的根因：
 *   .el-overlay 只有 rgba(0,0,0,.5) 的淡黑遮罩，
 *   .el-dialog 自身底色是 rgba(255,255,255,.05)（几乎全透明），
 *   于是下面表格的文字直接透上来和弹窗内容叠在一起。
 *
 * 修复思路：用 html[data-study-room-scene] 作为"当前在自习室"的全局标记
 * （该属性由 studyRoom/index.vue 的 watch(scene) 写在 <html> 上），
 * 只在这种状态下给浮层换成不透明深色玻璃皮肤，不影响其他页面。
 * ───────────────────────────────────────────────────────────── */

html[data-study-room-scene] .el-overlay {
  backdrop-filter: blur(2px);
}

html[data-study-room-scene] .el-overlay .el-dialog__header {
  border-bottom: 1px solid rgb(255 255 255 / 0.1);
  background: transparent;
  color: #fff;
}

html[data-study-room-scene] .el-overlay .el-dialog__title {
  color: #fff;
  font-weight: 700;
}

html[data-study-room-scene] .el-overlay .el-dialog__body {
  color: rgb(255 255 255 / 0.88);
  background: transparent;
}

html[data-study-room-scene] .el-overlay .el-dialog__headerbtn .el-dialog__close {
  color: rgb(255 255 255 / 0.7);
}

html[data-study-room-scene] .el-overlay .el-dialog__headerbtn:hover .el-dialog__close {
  color: var(--study-room-primary, #d7ef83);
}

/* 弹窗内所有 Element Plus 文本令牌改为亮色 */
html[data-study-room-scene] .el-overlay .el-dialog,
html[data-study-room-scene] .el-overlay .el-message-box {
  --el-text-color-primary: #fff;
  --el-text-color-regular: rgb(255 255 255 / 0.88);
  --el-text-color-secondary: rgb(255 255 255 / 0.65);
  --el-text-color-placeholder: rgb(255 255 255 / 0.45);
  --el-bg-color: rgb(22 30 26 / 0.98);
  --el-bg-color-overlay: rgb(22 30 26 / 0.98);
  --el-fill-color-blank: transparent;
  --el-border-color: rgb(255 255 255 / 0.18);
  --el-border-color-light: rgb(255 255 255 / 0.14);
  --el-border-color-lighter: rgb(255 255 255 / 0.1);
}

/* MessageBox（删除确认等）同样需要不透明底色 */
html[data-study-room-scene] .el-overlay .el-message-box {
  border: 1px solid rgb(255 255 255 / 0.16);
  background: rgb(22 30 26 / 0.98);
  color: #fff;
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.6);
}

html[data-study-room-scene] .el-overlay .el-message-box__title,
html[data-study-room-scene] .el-overlay .el-message-box__message,
html[data-study-room-scene] .el-overlay .el-message-box__message p {
  color: #fff;
}

/* 弹窗内的按钮、标签在深色底上重设一次 */
html[data-study-room-scene] .el-overlay .el-dialog .el-button,
html[data-study-room-scene] .el-overlay .el-message-box .el-button {
  border-color: rgb(255 255 255 / 0.2);
  color: #fff;
  background-color: rgb(255 255 255 / 0.08);
}

html[data-study-room-scene] .el-overlay .el-dialog .el-button--primary {
  border-color: transparent;
  color: #051612;
  background-color: var(--study-room-primary, #d7ef83);
}

html[data-study-room-scene] .el-overlay .el-dialog .el-button:hover {
  border-color: var(--study-room-primary, #d7ef83);
  color: var(--study-room-primary, #d7ef83);
  background-color: rgb(255 255 255 / 0.12);
}

html[data-study-room-scene] .el-overlay .el-dialog .el-button--primary:hover {
  border-color: transparent;
  color: #051612;
  background-color: color-mix(in srgb, var(--study-room-primary, #d7ef83) 88%, white);
}

/* Select 下拉面板 / Dropdown 菜单同样 teleport 到 body，需要单独给深色底 */
html[data-study-room-scene] .el-select-dropdown,
html[data-study-room-scene] .el-dropdown__popper {
  border: 1px solid rgb(255 255 255 / 0.14) !important;
  background: rgb(22 30 26 / 0.98) !important;
  color: #fff;
}

html[data-study-room-scene] .el-select-dropdown__item {
  color: rgb(255 255 255 / 0.82) !important;
}

html[data-study-room-scene] .el-select-dropdown__item.is-hovering {
  background: rgb(255 255 255 / 0.1) !important;
}

html[data-study-room-scene] .el-select-dropdown__item.is-selected {
  color: var(--study-room-primary, #d7ef83) !important;
  font-weight: 700;
}

html[data-study-room-scene] .el-select-dropdown__empty {
  color: rgb(255 255 255 / 0.5) !important;
}

html[data-study-room-scene] .el-popper__arrow::before {
  border-color: rgb(255 255 255 / 0.14) !important;
  background: rgb(22 30 26 / 0.98) !important;
}

/* 全局提示条（ElMessage）在深色场景下保持可读 */
html[data-study-room-scene] .el-message {
  border-color: rgb(255 255 255 / 0.16);
  background: rgb(22 30 26 / 0.98);
  color: #fff;
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.45);
}

html[data-study-room-scene] .el-message .el-message__content {
  color: #fff;
}

html[data-study-room-scene] .el-message--success .el-message__content,
html[data-study-room-scene] .el-message--success .el-message-icon--success {
  color: var(--study-room-primary, #d7ef83);
}

html[data-study-room-scene] .el-message--error .el-message__content,
html[data-study-room-scene] .el-message--error .el-message-icon--error {
  color: #ff8a8a;
}

html[data-study-room-scene] .el-message--warning .el-message__content,
html[data-study-room-scene] .el-message--warning .el-message-icon--warning {
  color: #ffd54a;
}

/* ─────────────────────────────────────────────────────────────
 * 主页「编辑资料」弹窗（append-to-body，挂在 body 上）
 * 用 .study-home-profile-dialog 类名精确命中，避免污染其它弹窗。
 *
 * 重要：.el-dialog__header 渲染成 <header> 元素，会被全局主题
 * html.qc-mimo-theme :is(... header[class*='header'] ...):not(...):not(...)...
 * 用 !important 强制刷成 var(--qc-bar) 米白底 —— 那条选择器特异性极高
 * （html + 伪类 + 6 个 :not），硬拼 !important 压不住。
 * 正确解法：在这个弹窗作用域内把 --qc-bar 重定义成透明，
 * 让那条全局规则"自己"算出我们想要的结果。
 * ───────────────────────────────────────────────────────────── */
.study-home-profile-dialog {
  --qc-bar: transparent;
  --qc-bar-border: rgb(255 255 255 / 0.1);

  border: 1px solid rgb(255 255 255 / 0.16) !important;
  border-radius: 16px !important;
  background: rgb(22 30 26 / 0.98) !important;
  background-color: rgb(22 30 26 / 0.98) !important;
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.6) !important;
  color: #fff !important;
}

.study-home-profile-dialog .el-dialog__header {
  border-bottom: 1px solid rgb(255 255 255 / 0.1) !important;
  color: #fff !important;
}

.study-home-profile-dialog .el-dialog__title {
  color: #fff !important;
  font-weight: 700 !important;
}

.study-home-profile-dialog .el-dialog__body {
  padding-top: 12px !important;
  color: rgb(255 255 255 / 0.88) !important;
  background: transparent !important;
}

.study-home-profile-dialog .el-dialog__headerbtn .el-dialog__close {
  color: rgb(255 255 255 / 0.7) !important;
}

.study-home-profile-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: var(--study-room-primary, #d7ef83) !important;
}

.study-home-profile-dialog .el-input__wrapper {
  background-color: rgb(0 0 0 / 0.32) !important;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.16) inset !important;
}

.study-home-profile-dialog .el-input__inner {
  color: #fff !important;
}

.study-home-profile-dialog .el-input__inner::placeholder {
  color: rgb(255 255 255 / 0.35) !important;
}

.study-home-profile-dialog .el-button {
  border-color: rgb(255 255 255 / 0.2) !important;
  color: #fff !important;
  background-color: rgb(255 255 255 / 0.08) !important;
}

.study-home-profile-dialog .el-button:hover {
  border-color: var(--study-room-primary, #d7ef83) !important;
  color: var(--study-room-primary, #d7ef83) !important;
  background-color: rgb(255 255 255 / 0.14) !important;
}

.study-home-profile-dialog .el-button--primary {
  border-color: transparent !important;
  color: #051612 !important;
  background-color: var(--study-room-primary, #d7ef83) !important;
}

.study-home-profile-dialog .el-button--primary:hover {
  color: #051612 !important;
  background-color: color-mix(in srgb, var(--study-room-primary, #d7ef83) 88%, white) !important;
}
</style>
