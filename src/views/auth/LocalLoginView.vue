<script lang="ts" setup>
import {
  cloudBindEmail,
  cloudEnabled,
  cloudResetPassword,
  cloudSendEmailCode,
  CloudError,
  type EmailCodePurpose,
} from '#/api/study-cloud';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import BrandMark from '#/components/BrandMark.vue';
import {
  canPersistLocalData,
  hasLocalAccounts,
  loginLocalUser,
  refreshLocalStorageSupport,
  registerLocalUser,
} from '#/lib/local-auth';
import SceneAtmosphere from '#/views/studyRoom/SceneAtmosphere.vue';
import {
  STUDY_ROOM_DEFAULT_SCENE,
  STUDY_ROOM_SCENE_STORAGE_KEY,
  asStudyRoomScene,
  getStudyRoomSceneCopy,
  type StudyRoomScene,
} from '#/views/studyRoom/study-room-scene';

type AuthMode = 'login' | 'register' | 'reset' | 'bind';

const cloud = cloudEnabled();
const mode = ref<AuthMode>(hasLocalAccounts.value ? 'login' : 'register');
const username = ref('');
const email = ref('');
const code = ref('');
const password = ref('');
const confirmPassword = ref('');
const error = ref('');
const notice = ref('');
const busy = ref(false);
const sendingCode = ref(false);
const codeCountdown = ref(0);
const scene = ref<StudyRoomScene>(STUDY_ROOM_DEFAULT_SCENE);
const sceneCopy = computed(() => getStudyRoomSceneCopy(scene.value));
const emailCodePurpose = computed<EmailCodePurpose>(() => {
  if (mode.value === 'reset') return 'reset';
  if (mode.value === 'bind') return 'bind';
  return 'register';
});
const codeButtonLabel = computed(() => {
  if (sendingCode.value) return '发送中…';
  if (codeCountdown.value > 0) return `${codeCountdown.value} 秒后重发`;
  return '发送验证码';
});
const title = computed(() => {
  if (mode.value === 'reset') return '重置密码';
  if (mode.value === 'bind') return '绑定邮箱';
  return mode.value === 'register' ? '创建你的自习账号' : '回到你的自习室';
});
const subtitle = computed(() => {
  if (mode.value === 'reset') return '用邮箱验证码重置密码，重置后其他设备需要重新登录。';
  if (mode.value === 'bind') {
    return '先用原账号的用户名和密码验证身份，再绑定 QQ 邮箱；已经绑过邮箱的账号可以直接用邮箱登录。';
  }
  return mode.value === 'register'
    ? cloud
      ? '用 QQ 邮箱验证后开始，记录每一天的专注。'
      : '从这里开始，记录每一天的专注。'
    : '登录后继续你的打卡、计划、笔记与专注记录。';
});

let countdownTimer: ReturnType<typeof setInterval> | null = null;

function stopCountdown(): void {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

function startCountdown(seconds: number): void {
  stopCountdown();
  codeCountdown.value = Math.max(1, Math.ceil(seconds));
  countdownTimer = setInterval(() => {
    codeCountdown.value -= 1;
    if (codeCountdown.value <= 0) {
      codeCountdown.value = 0;
      stopCountdown();
    }
  }, 1000);
}

onMounted(() => {
  try {
    scene.value = asStudyRoomScene(
      window.localStorage.getItem(STUDY_ROOM_SCENE_STORAGE_KEY),
    );
  } catch {
    scene.value = STUDY_ROOM_DEFAULT_SCENE;
  }
  refreshLocalStorageSupport();
});

onBeforeUnmount(stopCountdown);

function switchMode(next: AuthMode): void {
  if (busy.value || sendingCode.value) return;
  mode.value = next;
  error.value = '';
  notice.value = '';
  code.value = '';
  password.value = '';
  confirmPassword.value = '';
  stopCountdown();
  codeCountdown.value = 0;
}

function emailError(): string | null {
  const value = email.value.trim();
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)) {
    return '请输入正确的邮箱地址';
  }
  return null;
}

function passwordError(value: string): string | null {
  if (value.length < 8) return '密码至少 8 位';
  if (value.length > 128) return '密码最多 128 位';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return '密码需同时包含字母和数字';
  }
  if (/\s/.test(value)) return '密码不能包含空格';
  return null;
}

function validate(): string | null {
  if (mode.value === 'reset') {
    const emailProblem = emailError();
    if (emailProblem) return emailProblem;
    if (!/^\d{6}$/.test(code.value.trim())) return '请输入 6 位邮箱验证码';
    const passwordProblem = passwordError(password.value);
    if (passwordProblem) return passwordProblem;
    if (password.value !== confirmPassword.value) return '两次输入的密码不一致';
    return null;
  }

  if (mode.value === 'bind') {
    if (!username.value.trim()) return '请输入原账号用户名';
    if (!password.value) return '请输入当前密码';
    const emailProblem = emailError();
    if (emailProblem) return emailProblem;
    if (!/^\d{6}$/.test(code.value.trim())) return '请输入 6 位邮箱验证码';
    return null;
  }

  if (mode.value === 'register') {
    const name = username.value.trim();
    if (name.length < 2) return '用户名至少 2 个字符';
    if (name.length > 24) return '用户名最多 24 个字符';
    if (!/^[\p{L}\p{N}_-]+$/u.test(name)) {
      return '用户名只能包含文字、数字、下划线或短横线';
    }
    if (cloud) {
      const emailProblem = emailError();
      if (emailProblem) return emailProblem;
      if (!/^\d{6}$/.test(code.value.trim())) return '请输入 6 位邮箱验证码';
    }
    const passwordProblem = passwordError(password.value);
    if (passwordProblem) return passwordProblem;
    if (password.value !== confirmPassword.value) return '两次输入的密码不一致';
    return null;
  }

  if (!username.value.trim()) return cloud ? '请输入用户名或邮箱' : '请输入用户名';
  if (!password.value) return '请输入密码';
  return null;
}

async function sendCode(): Promise<void> {
  if (busy.value || sendingCode.value || codeCountdown.value > 0) return;
  error.value = '';
  notice.value = '';
  if (!cloud) {
    error.value = '当前版本未连接云端，暂时不能发送邮箱验证码';
    return;
  }
  const emailProblem = emailError();
  if (emailProblem) {
    error.value = emailProblem;
    return;
  }
  sendingCode.value = true;
  try {
    const result = await cloudSendEmailCode(
      email.value.trim().toLowerCase(),
      emailCodePurpose.value,
    );
    startCountdown(result.retryAfter);
    notice.value = `验证码已发送到 ${email.value.trim()}，10 分钟内有效`;
  } catch (cause) {
    if (cause instanceof CloudError && cause.retryAfter) {
      startCountdown(cause.retryAfter);
    }
    error.value = cause instanceof Error ? cause.message : '验证码发送失败，请稍后重试';
  } finally {
    sendingCode.value = false;
  }
}

async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = '';
  notice.value = '';
  const validationError = validate();
  if (validationError) {
    error.value = validationError;
    return;
  }
  if (mode.value === 'login' && !cloud && !hasLocalAccounts.value) {
    error.value = '当前浏览器没有找到账号数据，请先注册';
    return;
  }
  busy.value = true;
  try {
    if (mode.value === 'register') {
      await registerLocalUser(username.value, password.value, {
        email: cloud ? email.value.trim().toLowerCase() : undefined,
        code: cloud ? code.value.trim() : undefined,
      });
    } else if (mode.value === 'reset') {
      await cloudResetPassword(
        email.value.trim().toLowerCase(),
        code.value.trim(),
        password.value,
      );
      username.value = email.value.trim().toLowerCase();
      mode.value = 'login';
      code.value = '';
      password.value = '';
      confirmPassword.value = '';
      notice.value = '密码已重置，请用新密码登录';
    } else if (mode.value === 'bind') {
      await cloudBindEmail({
        username: username.value.trim(),
        password: password.value,
        email: email.value.trim().toLowerCase(),
        code: code.value.trim(),
      });
      username.value = email.value.trim().toLowerCase();
      mode.value = 'login';
      code.value = '';
      password.value = '';
      confirmPassword.value = '';
      notice.value = '邮箱绑定成功，可以用邮箱或用户名登录';
    } else {
      await loginLocalUser(username.value, password.value);
    }
  } catch (cause) {
    refreshLocalStorageSupport();
    const message = cause instanceof Error ? cause.message : '操作失败，请重试';
    error.value =
      mode.value === 'login' && message === '用户名或密码不正确'
        ? '用户名、邮箱或密码不正确；第一次使用云端版请先在「注册」页创建账号'
        : message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div
    class="local-login-page"
    :style="{
      '--study-room-primary': sceneCopy.primary,
      '--study-room-secondary': sceneCopy.secondary,
    }"
  >
    <SceneAtmosphere :scene="scene" />

    <main class="local-login-card" aria-labelledby="local-login-title">
      <div class="local-login-brand">
        <span class="local-login-brand-icon">
          <BrandMark />
        </span>
        <span>栖心自习室</span>
      </div>

      <p class="local-login-eyebrow">QUIET FOCUS</p>
      <h1 id="local-login-title">{{ title }}</h1>
      <p class="local-login-subtitle">{{ subtitle }}</p>

      <p v-if="!canPersistLocalData" class="local-login-warning" role="alert">
        当前浏览器无法保存登录状态，请换用普通浏览器窗口（不要用无痕模式或内嵌预览）打开。
      </p>

      <div
        v-if="mode === 'login' || mode === 'register'"
        class="local-login-tabs"
        role="tablist"
        aria-label="登录方式"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'login'"
          :class="{ active: mode === 'login' }"
          :disabled="busy || sendingCode"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'register'"
          :class="{ active: mode === 'register' }"
          :disabled="busy || sendingCode"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>

      <form class="local-login-form" @submit.prevent="submit">
        <label v-if="mode !== 'reset'" class="local-login-field">
          <span>
            {{
              mode === 'bind'
                ? '原账号用户名'
                : mode === 'login' && cloud
                  ? '用户名或邮箱'
                  : '用户名'
            }}
          </span>
          <input
            v-model="username"
            type="text"
            name="username"
            autocomplete="username"
            maxlength="64"
            :placeholder="
              mode === 'bind'
                ? '输入原账号用户名'
                : mode === 'login' && cloud
                  ? '用户名，或 you@qq.com'
                  : '给自己取一个名字'
            "
            :disabled="busy"
          />
        </label>

        <label
          v-if="cloud && (mode === 'register' || mode === 'reset' || mode === 'bind')"
          class="local-login-field"
        >
          <span>QQ 邮箱</span>
          <input
            v-model="email"
            type="email"
            name="email"
            autocomplete="email"
            maxlength="320"
            placeholder="you@qq.com"
            :disabled="busy || sendingCode"
          />
        </label>

        <div
          v-if="cloud && (mode === 'register' || mode === 'reset' || mode === 'bind')"
          class="local-login-field"
        >
          <span>邮箱验证码</span>
          <div class="local-login-code-row">
            <input
              v-model="code"
              type="text"
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="6 位验证码"
              :disabled="busy || sendingCode"
            />
            <button
              type="button"
              class="local-login-code-btn"
              :disabled="busy || sendingCode || codeCountdown > 0"
              @click="sendCode"
            >
              {{ codeButtonLabel }}
            </button>
          </div>
          <small class="local-login-hint">验证码会发送到你的 QQ 邮箱，10 分钟内有效</small>
        </div>

        <label class="local-login-field">
          <span>
            {{
              mode === 'reset'
                ? '新密码'
                : mode === 'bind'
                  ? '当前密码'
                  : '密码'
            }}
          </span>
          <input
            v-model="password"
            type="password"
            name="password"
            :autocomplete="
              mode === 'login' || mode === 'bind' ? 'current-password' : 'new-password'
            "
            maxlength="128"
            :placeholder="
              mode === 'login'
                ? '输入密码'
                : mode === 'bind'
                  ? '输入当前密码'
                  : '至少 8 位，含字母和数字'
            "
            :disabled="busy"
          />
        </label>

        <label
          v-if="mode === 'register' || mode === 'reset'"
          class="local-login-field"
        >
          <span>确认密码</span>
          <input
            v-model="confirmPassword"
            type="password"
            name="confirm-password"
            autocomplete="new-password"
            maxlength="128"
            placeholder="再输入一次密码"
            :disabled="busy"
          />
        </label>

        <p v-if="notice" class="local-login-notice" role="status">{{ notice }}</p>
        <p v-if="error" class="local-login-error" role="alert">{{ error }}</p>

        <button class="local-login-submit" type="submit" :disabled="busy">
          {{
            busy
              ? '处理中…'
              : mode === 'register'
                ? '创建账号'
                : mode === 'reset'
                  ? '重置密码'
                  : mode === 'bind'
                    ? '绑定邮箱'
                    : '登录'
          }}
        </button>

        <div class="local-login-links">
          <button
            v-if="mode === 'login' && cloud"
            type="button"
            class="local-login-link"
            :disabled="busy"
            @click="switchMode('reset')"
          >
            忘记密码？
          </button>
          <button
            v-if="mode === 'login' && cloud"
            type="button"
            class="local-login-link"
            :disabled="busy"
            @click="switchMode('bind')"
          >
            老账号绑定邮箱
          </button>
          <button
            v-if="mode === 'reset' || mode === 'bind'"
            type="button"
            class="local-login-link"
            :disabled="busy"
            @click="switchMode('login')"
          >
            返回登录
          </button>
        </div>
      </form>
    </main>
  </div>
</template>

<style scoped>
.local-login-page {
  position: relative;
  display: grid;
  min-height: 100vh;
  overflow-x: hidden;
  place-items: center;
  padding: 24px;
  background: #141b16;
  color: #fff;
}

.local-login-card {
  position: relative;
  z-index: 1;
  width: min(430px, 100%);
  padding: 28px;
  border: 1px solid
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 22%, transparent);
  border-radius: 24px;
  background: color-mix(
    in srgb,
    var(--study-room-secondary, #5ab8b0) 9%,
    rgb(8 14 11 / 0.78)
  );
  box-shadow: 0 28px 80px rgb(0 0 0 / 0.48);
  backdrop-filter: blur(24px);
}

.local-login-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 22px;
  font-size: 13px;
  font-weight: 700;
}

.local-login-brand-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  overflow: hidden;
  border-radius: 9px;
  box-shadow:
    0 4px 14px rgb(0 0 0 / 0.24),
    0 0 0 1px rgb(255 255 255 / 0.08) inset;
}

.local-login-eyebrow {
  margin: 0 0 8px;
  color: var(--study-room-primary, #d7ef83);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.local-login-card h1 {
  margin: 0;
  font-size: 25px;
  font-weight: 800;
  line-height: 1.3;
}

.local-login-subtitle {
  margin: 9px 0 20px;
  color: rgb(255 255 255 / 0.56);
  font-size: 12px;
  line-height: 1.7;
}

.local-login-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-bottom: 18px;
  padding: 4px;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 12px;
  background: rgb(0 0 0 / 0.18);
}

.local-login-tabs button {
  padding: 8px 12px;
  border: 0;
  border-radius: 9px;
  color: rgb(255 255 255 / 0.58);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.local-login-tabs button.active {
  color: #051612;
  background: var(--study-room-primary, #d7ef83);
}

.local-login-form {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.local-login-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.local-login-field > span {
  color: rgb(255 255 255 / 0.62);
  font-size: 11px;
  font-weight: 600;
}

.local-login-field input {
  width: 100%;
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 18%, transparent);
  border-radius: 10px;
  outline: none;
  color: #fff;
  background: rgb(0 0 0 / 0.24);
  font-size: 13px;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.local-login-field input::placeholder {
  color: rgb(255 255 255 / 0.32);
}

.local-login-field input:focus {
  border-color: color-mix(
    in srgb,
    var(--study-room-primary, #d7ef83) 62%,
    transparent
  );
  box-shadow: 0 0 0 3px
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 12%, transparent);
}

.local-login-code-row {
  display: flex;
  gap: 8px;
}

.local-login-code-row input {
  flex: 1;
}

.local-login-code-btn {
  flex: none;
  padding: 0 14px;
  border: 1px solid
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 32%, transparent);
  border-radius: 10px;
  color: var(--study-room-primary, #d7ef83);
  background: color-mix(
    in srgb,
    var(--study-room-primary, #d7ef83) 10%,
    transparent
  );
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.local-login-code-btn:disabled {
  cursor: default;
  opacity: 0.5;
}

.local-login-hint {
  color: rgb(255 255 255 / 0.38);
  font-size: 10px;
  line-height: 1.5;
}

.local-login-error,
.local-login-notice {
  margin: 0;
  padding: 8px 10px;
  border-radius: 9px;
  font-size: 11px;
  line-height: 1.6;
}

.local-login-error {
  border: 1px solid rgb(255 120 120 / 0.3);
  color: #ffb4b4;
  background: rgb(120 20 20 / 0.18);
}

.local-login-notice {
  border: 1px solid
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 24%, transparent);
  color: color-mix(in srgb, var(--study-room-primary, #d7ef83) 82%, white);
  background: color-mix(
    in srgb,
    var(--study-room-primary, #d7ef83) 8%,
    transparent
  );
}

.local-login-warning {
  margin: 0 0 16px;
  padding: 9px 11px;
  border: 1px solid rgb(255 186 92 / 0.32);
  border-radius: 10px;
  color: #ffd79a;
  background: rgb(120 70 10 / 0.2);
  font-size: 11px;
  line-height: 1.7;
}

.local-login-submit {
  margin-top: 3px;
  padding: 12px 16px;
  border: 0;
  border-radius: 11px;
  color: #051612;
  background: var(--study-room-primary, #d7ef83);
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
  transition:
    transform 0.18s ease,
    filter 0.18s ease;
}

.local-login-submit:hover:not(:disabled) {
  filter: brightness(1.05);
  transform: translateY(-1px);
}

.local-login-submit:disabled {
  cursor: wait;
  opacity: 0.65;
}

.local-login-links {
  display: flex;
  min-height: 16px;
  justify-content: flex-end;
  gap: 14px;
}

.local-login-link {
  padding: 0;
  border: 0;
  color: rgb(255 255 255 / 0.52);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
}

.local-login-link:hover:not(:disabled) {
  color: #fff;
  text-decoration: underline;
}

@media (max-width: 480px) {
  .local-login-page {
    padding: 14px;
  }

  .local-login-card {
    padding: 22px 20px;
    border-radius: 20px;
  }

  .local-login-card h1 {
    font-size: 22px;
  }
}
</style>
