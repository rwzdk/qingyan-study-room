<script lang="ts" setup>
import { ref } from 'vue';

import {
  resolveConflictKeepLocal,
  resolveConflictUseCloud,
  useStudyRoomState,
} from '#/views/studyRoom/study-room-state-store';

const { conflict } = useStudyRoomState();
const busy = ref(false);
const actionError = ref('');

function formatCloudTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function useCloud() {
  busy.value = true;
  actionError.value = '';
  try {
    resolveConflictUseCloud();
  } catch {
    actionError.value = '使用云端数据失败，请重试';
  } finally {
    busy.value = false;
  }
}

async function keepLocal() {
  busy.value = true;
  actionError.value = '';
  try {
    await resolveConflictKeepLocal();
  } catch {
    actionError.value = '覆盖云端失败，请重试';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div
    v-if="conflict"
    class="conflict-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="conflict-title"
  >
    <div class="conflict-card">
      <p class="conflict-eyebrow">Sync conflict</p>
      <h1 id="conflict-title">数据已在其他设备更新</h1>
      <p class="conflict-text">
        云端保存了比本机更新的数据。请选择保留哪一份；本机未同步的修改不会自动丢失。
      </p>

      <div class="conflict-time">
        <span>云端更新时间</span>
        <strong>{{ formatCloudTime(conflict.updatedAt) }}</strong>
      </div>

      <p v-if="actionError" class="conflict-error" role="alert">
        {{ actionError }}
      </p>

      <div class="conflict-actions">
        <button
          type="button"
          class="conflict-btn conflict-btn--ghost"
          :disabled="busy"
          @click="useCloud"
        >
          使用云端
        </button>
        <button
          type="button"
          class="conflict-btn conflict-btn--primary"
          :disabled="busy"
          @click="keepLocal"
        >
          {{ busy ? '正在保存…' : '保留本地并覆盖' }}
        </button>
      </div>

      <p class="conflict-note">
        选择“使用云端”会丢弃本机未同步修改；选择“保留本地”会把本机当前内容作为新版本写入云端。
      </p>
    </div>
  </div>
</template>

<style scoped>
.conflict-overlay {
  position: fixed;
  inset: 0;
  z-index: 2300;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  background: rgb(3 9 7 / 0.72);
  backdrop-filter: blur(10px);
}

.conflict-card {
  width: min(440px, 92vw);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  padding: 30px 28px 24px;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 20px;
  color: #fff;
  background: rgb(9 20 15 / 0.94);
  box-shadow: 0 28px 80px rgb(0 0 0 / 0.5);
}

.conflict-eyebrow {
  margin: 0;
  color: rgb(255 196 120 / 0.88);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.conflict-card h1 {
  margin: 10px 0 0;
  font-size: 25px;
  font-weight: 800;
  line-height: 1.3;
}

.conflict-text {
  margin: 12px 0 0;
  color: rgb(255 255 255 / 0.64);
  font-size: 13px;
  line-height: 1.8;
}

.conflict-time {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 18px;
  padding: 12px 14px;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.04);
}

.conflict-time span {
  color: rgb(255 255 255 / 0.45);
  font-size: 12px;
}

.conflict-time strong {
  color: #fff;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.conflict-error {
  margin: 14px 0 0;
  padding: 10px 12px;
  border: 1px solid rgb(255 120 120 / 0.28);
  border-radius: 9px;
  color: #ffb4b4;
  background: rgb(255 80 80 / 0.1);
  font-size: 12px;
  line-height: 1.6;
}

.conflict-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 20px;
}

.conflict-btn {
  width: 100%;
  min-height: 44px;
  padding: 10px 18px;
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  transition: background 0.18s ease, transform 0.18s ease;
}

.conflict-btn:disabled {
  cursor: wait;
  opacity: 0.62;
}

.conflict-btn--primary {
  color: #051612;
  background: var(--study-room-primary, #d7ef83);
}

.conflict-btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--study-room-primary, #d7ef83) 90%, white);
}

.conflict-btn--ghost {
  border-color: rgb(255 255 255 / 0.16);
  color: rgb(255 255 255 / 0.8);
  background: rgb(255 255 255 / 0.04);
}

.conflict-btn--ghost:hover:not(:disabled) {
  color: #fff;
  background: rgb(255 255 255 / 0.08);
}

.conflict-note {
  margin: 16px 0 0;
  color: rgb(255 255 255 / 0.36);
  font-size: 11px;
  line-height: 1.7;
}

@media (max-width: 420px) {
  .conflict-card {
    padding: 26px 20px 20px;
  }
}
</style>
