<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import IconifyIcon from '#/components/IconifyIcon.vue';

import { createAmbientEngine, type AmbientEngine } from './ambient-audio';
import { getStudyRoomSceneCopy, type StudyRoomScene } from './study-room-scene';

const props = defineProps<{
  scene: StudyRoomScene;
}>();

const sceneCopy = computed(() => getStudyRoomSceneCopy(props.scene));

const volume = ref(0.3);
const open = ref(false);
const volumeRef = ref(0.3);
const dragging = ref(false);
const trackRef = ref<HTMLDivElement | null>(null);
const pressedPoint = ref<{ x: number; y: number } | null>(null);

let engine: AmbientEngine | null = null;
let gestureCleanup: (() => void) | null = null;

watch(volume, (v) => {
  volumeRef.value = v;
  engine?.setVolume(v);
});

onMounted(() => {
  engine = createAmbientEngine(props.scene, volumeRef.value);

  // 浏览器自动播放策略：必须先有用户手势才能起 AudioContext。
  // 首屏静默等待首次点击/按键，之后环境音自然接入。
  const unlock = () => {
    void engine?.resume();
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  gestureCleanup = () => {
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };

  document.addEventListener('visibilitychange', onVisibility);
});

onBeforeUnmount(() => {
  gestureCleanup?.();
  document.removeEventListener('visibilitychange', onVisibility);
  engine?.dispose();
  engine = null;
});

watch(
  () => props.scene,
  (next) => {
    void engine?.setPreset(next);
  },
);

// 离开页面静音，回来恢复
function onVisibility() {
  if (document.hidden) {
    if (engine?.isRunning()) {
      engine.setVolume(0);
    }
  } else {
    engine?.setVolume(volumeRef.value);
  }
}

function toggleOpen() {
  if (pressedPoint.value) return;
  open.value = !open.value;
  // 首次点击属用户手势，借机启动环境音
  void engine?.resume();
}

const isSilent = computed(() => volume.value === 0);
const fillPercent = computed(() => Math.round(volume.value * 100));

function updateFromEvent(event: MouseEvent) {
  const el = trackRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const y = event.clientY;
  const ratio = Math.max(0, Math.min(1, (rect.bottom - y) / rect.height));
  volume.value = ratio;
}

function handleMouseDown(event: MouseEvent) {
  dragging.value = true;
  pressedPoint.value = { x: event.clientX, y: event.clientY };
  updateFromEvent(event);
  const onMove = (ev: MouseEvent) => updateFromEvent(ev);
  const onUp = () => {
    dragging.value = false;
    pressedPoint.value = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
</script>

<template>
  <div class="ambient-sound-control">
    <div
      class="ambient-sound-shell"
      :class="{ silent: isSilent, open }"
    >
      <button
        type="button"
        class="ambient-sound-btn"
        :aria-label="`调节音量，当前环境音：${sceneCopy.soundLabel}`"
        :title="`环境音：${sceneCopy.soundLabel}`"
        :aria-expanded="open"
        @click="toggleOpen"
      >
        <IconifyIcon :icon="isSilent ? 'lucide:volume-x' : 'lucide:volume-2'" />
      </button>
      <div class="ambient-sound-slider" :class="{ open }">
        <div
          ref="trackRef"
          class="ambient-sound-track"
          role="slider"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="fillPercent"
          aria-label="音量"
          @mousedown="handleMouseDown"
        >
          <div class="ambient-sound-fill" :style="{ height: `${fillPercent}%` }" />
          <div class="ambient-sound-handle" :style="{ bottom: `calc(${fillPercent}% - 7px)` }" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ambient-sound-control {
  display: flex;
  align-items: center;
}

.ambient-sound-shell {
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 999px;
  background: rgb(255 255 255 / 0.05);
  backdrop-filter: blur(24px);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.15);
  transition: all 0.5s ease-out;
}

.ambient-sound-shell.open {
  border-radius: 28px;
}

.ambient-sound-shell.silent {
  border-color: rgb(255 255 255 / 0.1);
  background: rgb(255 255 255 / 0.05);
}

.ambient-sound-btn {
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  color: rgb(255 255 255 / 0.4);
  background: transparent;
  cursor: pointer;
  transition: all 0.3s ease;
}

.ambient-sound-shell:not(.silent) .ambient-sound-btn {
  color: var(--study-room-primary);
}

.ambient-sound-btn:hover {
  color: rgb(255 255 255 / 0.7);
  background: rgb(255 255 255 / 0.08);
}

.ambient-sound-slider {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-height: 0;
  padding: 0 10px;
  overflow: hidden;
  opacity: 0;
  transition: all 0.5s ease-out;
}

.ambient-sound-slider.open {
  max-height: 192px;
  padding-top: 12px;
  padding-bottom: 16px;
  opacity: 1;
}

.ambient-sound-track {
  position: relative;
  width: 14px;
  height: 112px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.08);
  cursor: pointer;
  overflow: hidden;
}

.ambient-sound-fill {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  border-radius: 999px;
  background: linear-gradient(to top, var(--study-room-primary), var(--study-room-primary));
  transition: height 0.075s;
}

.ambient-sound-handle {
  position: absolute;
  left: 50%;
  width: 14px;
  height: 14px;
  border: 1px solid rgb(255 255 255 / 0.25);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.3);
  transform: translateX(-50%);
  transition: all 0.075s;
}
</style>
