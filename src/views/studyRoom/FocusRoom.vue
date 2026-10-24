<script lang="ts" setup>
import { ref } from 'vue';

import IconifyIcon from '#/components/IconifyIcon.vue';

import FocusTimer from './FocusTimer.vue';
import ImmersiveOverlay from './ImmersiveOverlay.vue';
import LocalTodoPanel from './LocalTodoPanel.vue';
import type { StudyRoomScene, StudyRoomSceneCopy } from './study-room-scene';

const props = defineProps<{
  scene: StudyRoomScene;
  sceneCopy: StudyRoomSceneCopy;
}>();

const focusPresets = [25, 45, 60];
const focusMinutes = ref(25);
const breakMinutes = 5;
const immersive = ref(false);

function enterImmersive() {
  if (typeof document !== 'undefined') {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
  immersive.value = true;
}

function exitImmersive() {
  immersive.value = false;
}
</script>

<template>
  <div class="focus-room" :class="{ 'is-immersive': immersive }">
    <!-- 常规视图：沉浸时整体淡出隐藏，避免与沉浸层重复 -->
    <div v-show="!immersive" class="focus-room-normal">
      <!-- 布局对齐原项目：标题左上、沉浸按钮右上；标题与按钮同一行且不设背景 -->
      <div class="focus-room-toolbar">
        <div class="focus-room-title">
          <p class="eyebrow">Deep focus</p>
          <h1>{{ props.sceneCopy.roomTitle }}</h1>
          <p class="subtitle">{{ props.sceneCopy.roomSlogan }}</p>
        </div>
        <button type="button" class="immersive-entry-btn" @click="enterImmersive">
          <IconifyIcon icon="lucide:maximize-2" />
          沉浸模式
        </button>
      </div>

      <div class="focus-room-grid">
        <div class="focus-timer-column">
          <div class="preset-bar">
            <button
              v-for="minutes in focusPresets"
              :key="minutes"
              type="button"
              :class="{ active: focusMinutes === minutes }"
              @click="focusMinutes = minutes"
            >
              {{ minutes }} 分钟
            </button>
          </div>
          <FocusTimer
            :focus-minutes="focusMinutes"
            :break-minutes="breakMinutes"
          />
        </div>

        <div class="focus-side-column">
          <LocalTodoPanel />
        </div>
      </div>
    </div>

    <!-- 沉浸层：复用同一计时器，仅切换展示形态 -->
    <ImmersiveOverlay
      v-if="immersive"
      :scene="scene"
      :quotes="props.sceneCopy.quotes"
      @exit="exitImmersive"
    >
      <FocusTimer
        :focus-minutes="focusMinutes"
        :break-minutes="breakMinutes"
        immersive
      />
    </ImmersiveOverlay>
  </div>
</template>

<style scoped>
.focus-room {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.focus-room-normal {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.focus-room-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0 8px;
}

.focus-room-title h1 {
  margin: 4px 0 0;
  color: #fff;
  font-size: 30px;
  font-weight: 800;
  line-height: 1.25;
}

/* 「Deep focus」小标题：原先没有本地样式，继承了全局主题的深色文字
 * （实测 rgb(31,26,21) 落在深色背景上，对比度仅 1.04，几乎看不见）。
 * 统一到自习室色板：主色 + 字间距，和「计划/阅读」页的 eyebrow 保持一致。 */
.focus-room-title .eyebrow {
  margin: 0 0 6px;
  color: var(--study-room-primary);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.focus-room-title .subtitle {
  margin: 8px 0 0;
  color: rgb(255 255 255 / 0.72);
  font-size: 15px;
}

.immersive-entry-btn {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border: 0;
  border-radius: 999px;
  color: #051612;
  background: var(--study-room-primary);
  box-shadow: 0 0 24px color-mix(in srgb, var(--study-room-primary) 30%, transparent);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.18s ease;
}

.immersive-entry-btn:hover {
  transform: scale(1.03);
  background: color-mix(in srgb, var(--study-room-primary) 90%, black);
}

.focus-room-grid {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 32px;
}

.focus-timer-column {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.preset-bar {
  display: inline-flex;
  gap: 4px;
  margin-bottom: 20px;
  padding: 4px;
  border: 1px solid
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 14%, transparent);
  border-radius: 8px;
  background: color-mix(
    in srgb,
    var(--study-room-secondary, #5ab8b0) 7%,
    rgb(0 0 0 / 0.12)
  );
}

.preset-bar button {
  padding: 6px 14px;
  border: 0;
  border-radius: 6px;
  color: rgb(255 255 255 / 0.55);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.18s ease;
}

.preset-bar button.active {
  color: #051612;
  background: var(--study-room-primary);
}

.focus-side-column {
  display: flex;
  width: 320px;
  flex-shrink: 0;
  justify-content: flex-end;
}

@media (max-width: 900px) {
  .focus-room-grid {
    flex-direction: column;
    gap: 24px;
  }

  .focus-side-column {
    width: 100%;
    justify-content: center;
  }
}
</style>
