<script lang="ts" setup>
import { computed } from 'vue';

import {
  migrationBusy,
  migrationError,
  resolveMigration,
} from '#/session/session-gate';
import { readLegacyLocalData } from '#/views/studyRoom/study-room-state-store';

const legacy = readLegacyLocalData();

const summary = computed(() => {
  const data = legacy;
  if (!data) return [];
  return [
    { label: '打卡', value: data.state.checkins.length, unit: '次' },
    { label: '计划', value: data.state.plans.length, unit: '个' },
    { label: '文档', value: data.state.docs.length, unit: '篇' },
    { label: '待办', value: data.state.todos.length, unit: '项' },
    { label: '专注记录', value: data.state.focus_sessions.length, unit: '条' },
  ];
});

const nickname = computed(() => legacy?.profile.nickname?.trim() ?? '');

function choose(kind: 'import' | 'empty') {
  void resolveMigration(kind);
}
</script>

<template>
  <div class="migration-overlay" role="dialog" aria-modal="true" aria-labelledby="migration-title">
    <div class="migration-card">
      <p class="migration-eyebrow">One-time import</p>
      <h1 id="migration-title">发现本机旧数据</h1>
      <p class="migration-text">
        这台浏览器里还保存着登录前的自习室数据。选择如何开始，本机数据只有在你确认后才会上传。
      </p>

      <div v-if="nickname" class="migration-profile">
        本机昵称：<strong>{{ nickname }}</strong>
      </div>

      <ul class="migration-stats">
        <li v-for="item in summary" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}<em>{{ item.unit }}</em></strong>
        </li>
      </ul>

      <p v-if="migrationError" class="migration-error" role="alert">
        {{ migrationError }}
      </p>

      <div class="migration-actions">
        <button
          type="button"
          class="migration-btn migration-btn--primary"
          :disabled="migrationBusy"
          @click="choose('import')"
        >
          {{ migrationBusy ? '正在上传…' : '导入本机数据' }}
        </button>
        <button
          type="button"
          class="migration-btn migration-btn--ghost"
          :disabled="migrationBusy"
          @click="choose('empty')"
        >
          {{ migrationBusy ? '处理中…' : '从空数据开始' }}
        </button>
      </div>

      <p class="migration-note">
        导入成功后，旧数据会归档到本机备份，再删除活动旧键；选择空数据也会保留归档。
      </p>
    </div>
  </div>
</template>

<style scoped>
.migration-overlay {
  position: fixed;
  inset: 0;
  z-index: 2200;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  background: rgb(3 9 7 / 0.72);
  backdrop-filter: blur(10px);
}

.migration-card {
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

.migration-eyebrow {
  margin: 0;
  color: rgb(215 239 131 / 0.82);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.migration-card h1 {
  margin: 10px 0 0;
  font-size: 25px;
  font-weight: 800;
  line-height: 1.3;
}

.migration-text {
  margin: 12px 0 0;
  color: rgb(255 255 255 / 0.64);
  font-size: 13px;
  line-height: 1.8;
}

.migration-profile {
  margin-top: 16px;
  padding: 10px 14px;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 10px;
  color: rgb(255 255 255 / 0.58);
  font-size: 12px;
  background: rgb(255 255 255 / 0.04);
}

.migration-profile strong {
  color: #fff;
  font-weight: 700;
}

.migration-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}

.migration-stats li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 10px 8px;
  border: 1px solid rgb(255 255 255 / 0.09);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.04);
}

.migration-stats span {
  color: rgb(255 255 255 / 0.45);
  font-size: 11px;
}

.migration-stats strong {
  color: #fff;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.migration-stats em {
  margin-left: 2px;
  color: rgb(255 255 255 / 0.4);
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
}

.migration-error {
  margin: 14px 0 0;
  padding: 10px 12px;
  border: 1px solid rgb(255 120 120 / 0.28);
  border-radius: 9px;
  color: #ffb4b4;
  background: rgb(255 80 80 / 0.1);
  font-size: 12px;
  line-height: 1.6;
}

.migration-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 20px;
}

.migration-btn {
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

.migration-btn:disabled {
  cursor: wait;
  opacity: 0.62;
}

.migration-btn--primary {
  color: #051612;
  background: var(--study-room-primary, #d7ef83);
}

.migration-btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--study-room-primary, #d7ef83) 90%, white);
}

.migration-btn--ghost {
  border-color: rgb(255 255 255 / 0.16);
  color: rgb(255 255 255 / 0.8);
  background: rgb(255 255 255 / 0.04);
}

.migration-btn--ghost:hover:not(:disabled) {
  color: #fff;
  background: rgb(255 255 255 / 0.08);
}

.migration-note {
  margin: 16px 0 0;
  color: rgb(255 255 255 / 0.36);
  font-size: 11px;
  line-height: 1.7;
}

@media (max-width: 420px) {
  .migration-card {
    padding: 26px 20px 20px;
  }

  .migration-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
