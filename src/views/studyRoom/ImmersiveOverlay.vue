<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

import type { StudyRoomScene } from './study-room-scene';

const props = defineProps<{
  scene: StudyRoomScene;
  quotes: string[];
}>();

const emit = defineEmits<{
  exit: [];
}>();

const HOLD_MS = 1400;

const holding = ref(false);
const quote = ref(pickQuote(props.quotes));

let holdTimer: ReturnType<typeof setTimeout> | null = null;

function pickQuote(quotes: string[]) {
  if (!quotes.length) return '';
  return quotes[Math.floor(Math.random() * quotes.length)] ?? '';
}

function cancelHold() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

function startHold() {
  holding.value = true;
  cancelHold();
  holdTimer = setTimeout(() => {
    holdTimer = null;
    holding.value = false;
    emit('exit');
  }, HOLD_MS);
}

function endHold() {
  holding.value = false;
  cancelHold();
}

onMounted(() => {
  document.body.classList.add('study-room-immersive');
});

onBeforeUnmount(() => {
  document.body.classList.remove('study-room-immersive');
  cancelHold();
});
</script>

<template>
  <div class="immersive-overlay">
    <div class="immersive-timer-slot">
      <slot />
    </div>
    <p class="immersive-quote">「{{ quote }}」</p>
    <button
      type="button"
      class="immersive-exit"
      :class="{ 'is-holding': holding }"
      @pointerdown="startHold"
      @pointerup="endHold"
      @pointerleave="endHold"
      @pointercancel="endHold"
    >
      <span>长按退出</span>
    </button>
  </div>
</template>

<style scoped>
.immersive-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
  padding: 24px;
  user-select: none;
  /* 背景图清晰透出：轻蒙层保证文字可读（底下常规视图已通过 v-show 隐藏） */
  background: rgb(0 0 0 / 0.35);
}

.immersive-quote {
  max-width: 480px;
  margin: 0;
  text-align: center;
  font-size: 14px;
  font-weight: 300;
  line-height: 1.8;
  color: color-mix(in srgb, var(--study-room-primary) 55%, transparent);
  cursor: default;
}

.immersive-exit {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 180px;
  padding: 12px 24px;
  border: 1px solid rgb(255 255 255 / 0.25);
  border-radius: 999px;
  overflow: hidden;
  color: rgb(255 255 255 / 0.7);
  background: rgb(0 0 0 / 0.3);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  touch-action: none;
}

.immersive-exit::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--study-room-primary);
  transform: scaleX(0);
  transform-origin: left center;
}

.immersive-exit.is-holding::before {
  animation: immersive-hold 1.4s linear forwards;
}

.immersive-exit span {
  position: relative;
  z-index: 1;
}

@keyframes immersive-hold {
  to {
    transform: scaleX(1);
  }
}
</style>
