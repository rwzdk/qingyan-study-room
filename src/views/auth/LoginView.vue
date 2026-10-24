<script lang="ts" setup>
import IconifyIcon from '#/components/IconifyIcon.vue';
import {
  locked,
  loginUrl,
  unlockLocalSession,
} from '#/session/session-state';

function continueWithCurrentAccount() {
  unlockLocalSession();
}

function switchAccount() {
  // 先清掉本机锁，避免登录回调后又被锁在登录页。
  unlockLocalSession();
}
</script>

<template>
  <div class="auth-page login-page">
    <div class="auth-backdrop" aria-hidden="true" />
    <main class="auth-card login-card">
      <div class="login-brand">
        <span class="login-brand-mark">
          <IconifyIcon icon="lucide:leaf" />
        </span>
        <span>清砚自习室</span>
      </div>

      <p class="auth-eyebrow">Quiet focus, synced</p>
      <h1>回到你的雨林自习室</h1>
      <p class="auth-lead">
        使用 Qoder 账号登录，打卡、计划、文档与专注记录会自动同步到云端。
      </p>

      <button
        v-if="locked"
        type="button"
        class="auth-btn auth-btn--primary"
        @click="continueWithCurrentAccount"
      >
        <IconifyIcon icon="lucide:user" />
        继续使用当前 Qoder 账号
      </button>
      <a v-else class="auth-btn auth-btn--primary" :href="loginUrl()">
        <IconifyIcon icon="lucide:user" />
        使用 Qoder 账号登录
      </a>

      <a
        v-if="locked"
        class="auth-link"
        :href="loginUrl()"
        @click="switchAccount"
      >
        使用其他 Qoder 账号
      </a>

      <p class="auth-note">
        退出登录只会清除本机数据；Qoder 登录会话由 Qoder 管理。
      </p>
    </main>

    <footer class="auth-footer">清砚 · 安静专注</footer>
  </div>
</template>

<style scoped>
.auth-page {
  position: relative;
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 32px 20px 56px;
  color: #fff;
  background-color: #101814;
}

.login-page {
  background-image: url('/images/study-room/rain.webp');
  background-position: center;
  background-size: cover;
}

.auth-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 30%, rgb(0 0 0 / 0.18), transparent 55%),
    linear-gradient(180deg, rgb(4 12 9 / 0.72) 0%, rgb(4 12 9 / 0.42) 45%, rgb(4 12 9 / 0.82) 100%);
  pointer-events: none;
}

.auth-card {
  position: relative;
  z-index: 1;
  width: min(440px, 92vw);
  padding: 34px 30px 28px;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 22px;
  background: rgb(9 20 15 / 0.62);
  box-shadow: 0 28px 80px rgb(0 0 0 / 0.45);
  backdrop-filter: blur(22px);
  text-align: center;
}

.login-brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.login-brand-mark {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #051612;
  background: var(--study-room-primary, #d7ef83);
  box-shadow: 0 0 24px rgb(215 239 131 / 0.28);
}

.auth-eyebrow {
  margin: 26px 0 0;
  color: rgb(215 239 131 / 0.82);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.auth-card h1 {
  margin: 10px 0 0;
  color: #fff;
  font-size: 28px;
  font-weight: 800;
  line-height: 1.28;
}

.auth-lead {
  margin: 12px auto 24px;
  max-width: 320px;
  color: rgb(255 255 255 / 0.66);
  font-size: 13px;
  line-height: 1.8;
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
  transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
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

.auth-btn--primary:active {
  transform: translateY(0);
}

.auth-link {
  display: inline-block;
  margin-top: 16px;
  color: rgb(255 255 255 / 0.62);
  font-size: 12px;
  text-decoration: none;
}

.auth-link:hover {
  color: #fff;
  text-decoration: underline;
}

.auth-note {
  margin: 22px 0 0;
  padding-top: 18px;
  border-top: 1px solid rgb(255 255 255 / 0.09);
  color: rgb(255 255 255 / 0.38);
  font-size: 11px;
  line-height: 1.7;
}

.auth-footer {
  position: absolute;
  bottom: 22px;
  z-index: 1;
  color: rgb(255 255 255 / 0.32);
  font-size: 11px;
  letter-spacing: 0.08em;
}

@media (max-width: 480px) {
  .auth-page {
    padding: 24px 14px 48px;
  }

  .auth-card {
    padding: 28px 22px 24px;
  }

  .auth-card h1 {
    font-size: 25px;
  }
}
</style>
