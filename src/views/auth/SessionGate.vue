<script lang="ts" setup>
import { onMounted } from 'vue';

import IconifyIcon from '#/components/IconifyIcon.vue';
import { bootstrapSession, migrationNeeded, retryBootstrap } from '#/session/session-gate';
import {
  loginUrl,
  sessionError,
  sessionStatus,
} from '#/session/session-state';
import { useStudyRoomState } from '#/views/studyRoom/study-room-state-store';

import LoginView from './LoginView.vue';
import MigrationDialog from './MigrationDialog.vue';
import SyncConflictDialog from './SyncConflictDialog.vue';

const { conflict } = useStudyRoomState();

onMounted(() => {
  if (sessionStatus.value !== 'ready') {
    void bootstrapSession();
  }
});

function retry() {
  void retryBootstrap();
}
</script>

<template>
  <div v-if="sessionStatus === 'loading'" class="auth-page session-status-page">
    <div class="session-status-card">
      <span class="status-spinner" aria-hidden="true" />
      <p class="status-eyebrow">Connecting</p>
      <h1>正在连接云端自习室</h1>
      <p class="status-text">正在校验 Qoder 账号并读取你的云端数据…</p>
    </div>
  </div>

  <LoginView v-else-if="sessionStatus === 'unauthenticated'" />

  <div
    v-else-if="sessionStatus === 'forbidden'"
    class="auth-page session-status-page"
  >
    <div class="session-status-card">
      <span class="status-icon">
        <IconifyIcon icon="lucide:triangle-alert" />
      </span>
      <p class="status-eyebrow">Access denied</p>
      <h1>没有访问权限</h1>
      <p class="status-text">
        {{ sessionError || '当前 Qoder 账号无法访问这个自习室。' }}
      </p>
      <div class="status-actions">
        <button type="button" class="auth-btn auth-btn--primary" @click="retry">
          <IconifyIcon icon="lucide:rotate-ccw" />
          重新检查
        </button>
        <a class="status-link" :href="loginUrl()">切换 Qoder 账号</a>
      </div>
    </div>
  </div>

  <div
    v-else-if="sessionStatus === 'error'"
    class="auth-page session-status-page"
  >
    <div class="session-status-card">
      <span class="status-icon">
        <IconifyIcon icon="lucide:triangle-alert" />
      </span>
      <p class="status-eyebrow">Connection lost</p>
      <h1>暂时无法连接云端</h1>
      <p class="status-text">
        {{ sessionError || '请检查网络后重试。为避免共享设备泄露，未登录成功前不会展示本机缓存。' }}
      </p>
      <div class="status-actions">
        <button type="button" class="auth-btn auth-btn--primary" @click="retry">
          <IconifyIcon icon="lucide:rotate-ccw" />
          重试
        </button>
        <a class="status-link" :href="loginUrl()">重新登录 Qoder</a>
      </div>
    </div>
  </div>

  <template v-else>
    <MigrationDialog v-if="migrationNeeded" />
    <slot v-else />
    <SyncConflictDialog v-if="!migrationNeeded && conflict" />
  </template>
</template>

<style scoped>
.auth-page {
  position: relative;
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 32px 20px;
  color: #fff;
  background-color: #101814;
}

.session-status-page {
  background-image:
    linear-gradient(180deg, rgb(4 12 9 / 0.78), rgb(4 12 9 / 0.9)),
    url('/images/study-room/rain.webp');
  background-position: center;
  background-size: cover;
}

.session-status-card {
  width: min(440px, 92vw);
  padding: 34px 30px 30px;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 22px;
  background: rgb(9 20 15 / 0.68);
  box-shadow: 0 28px 80px rgb(0 0 0 / 0.45);
  backdrop-filter: blur(22px);
  text-align: center;
}

.status-spinner {
  display: inline-block;
  width: 34px;
  height: 34px;
  border: 2px solid rgb(255 255 255 / 0.16);
  border-top-color: var(--study-room-primary, #d7ef83);
  border-radius: 50%;
  animation: status-spin 0.9s linear infinite;
}

.status-icon {
  display: inline-flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 50%;
  color: var(--study-room-primary, #d7ef83);
  font-size: 20px;
}

.status-eyebrow {
  margin: 22px 0 0;
  color: rgb(215 239 131 / 0.82);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.session-status-card h1 {
  margin: 10px 0 0;
  color: #fff;
  font-size: 26px;
  font-weight: 800;
  line-height: 1.3;
}

.status-text {
  margin: 12px auto 0;
  max-width: 320px;
  color: rgb(255 255 255 / 0.62);
  font-size: 13px;
  line-height: 1.8;
}

.status-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-top: 24px;
}

.auth-btn {
  display: inline-flex;
  width: 100%;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 11px 22px;
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  transition: transform 0.18s ease, background 0.18s ease;
}

.auth-btn--primary {
  color: #051612;
  background: var(--study-room-primary, #d7ef83);
  box-shadow: 0 0 26px rgb(215 239 131 / 0.24);
}

.auth-btn--primary:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--study-room-primary, #d7ef83) 90%, white);
}

.status-link {
  margin-top: 10px;
  color: rgb(255 255 255 / 0.6);
  font-size: 12px;
  text-decoration: none;
}

.status-link:hover {
  color: #fff;
  text-decoration: underline;
}

@keyframes status-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 480px) {
  .session-status-card {
    padding: 28px 22px 24px;
  }

  .session-status-card h1 {
    font-size: 23px;
  }
}
</style>
