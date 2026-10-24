<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';

import BrandMark from '#/components/BrandMark.vue';
import {
  hasLocalAccounts,
  loginLocalUser,
  localAccounts,
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
import { hasLegacyLocalData } from '#/views/studyRoom/study-room-state-store';

type AuthMode = 'login' | 'register';

const mode = ref<AuthMode>(hasLocalAccounts.value ? 'login' : 'register');
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const error = ref('');
const busy = ref(false);
const legacyAvailable = ref(false);
const scene = ref<StudyRoomScene>(STUDY_ROOM_DEFAULT_SCENE);
const sceneCopy = computed(() => getStudyRoomSceneCopy(scene.value));

onMounted(() => {
  legacyAvailable.value = hasLegacyLocalData();
  try {
    scene.value = asStudyRoomScene(
      window.localStorage.getItem(STUDY_ROOM_SCENE_STORAGE_KEY),
    );
  } catch {
    scene.value = STUDY_ROOM_DEFAULT_SCENE;
  }
});

function switchMode(next: AuthMode): void {
  if (busy.value) return;
  mode.value = next;
  error.value = '';
  confirmPassword.value = '';
}

function validate(): string | null {
  const name = username.value.trim();
  if (name.length < 2) return '用户名至少 2 个字符';
  if (name.length > 24) return '用户名最多 24 个字符';
  if (!/^[\p{L}\p{N}_-]+$/u.test(name)) {
    return '用户名只能包含文字、数字、下划线或短横线';
  }
  if (password.value.length < 6) return '密码至少 6 位';
  if (mode.value === 'register' && password.value !== confirmPassword.value) {
    return '两次输入的密码不一致';
  }
  return null;
}

async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = '';
  const validationError = validate();
  if (validationError) {
    error.value = validationError;
    return;
  }
  busy.value = true;
  try {
    if (mode.value === 'register') {
      await registerLocalUser(username.value, password.value);
    } else {
      await loginLocalUser(username.value, password.value);
    }
    // LocalAuthGate 会监听 currentUser 并加载对应账号数据。
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}

const accountCount = computed(() => localAccounts.value.length);
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
        <span>清砚自习室</span>
        <span class="local-login-brand-tag">LOCAL</span>
      </div>

      <p class="local-login-eyebrow">QUIET FOCUS, LOCAL FIRST</p>
      <h1 id="local-login-title">
        {{ mode === 'register' ? '创建你的本地自习账号' : '回到你的自习室' }}
      </h1>
      <p class="local-login-subtitle">
        {{
          mode === 'register'
            ? '账号与自习数据只保存在当前浏览器，用于区分本机不同的使用者。'
            : '登录后继续你的打卡、计划、笔记与专注记录。'
        }}
      </p>

      <div class="local-login-tabs" role="tablist" aria-label="登录方式">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'login'"
          :class="{ active: mode === 'login' }"
          :disabled="busy"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'register'"
          :class="{ active: mode === 'register' }"
          :disabled="busy"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>

      <form class="local-login-form" @submit.prevent="submit">
        <label class="local-login-field">
          <span>用户名</span>
          <input
            v-model="username"
            type="text"
            name="username"
            autocomplete="username"
            maxlength="24"
            placeholder="给自己取一个名字"
            :disabled="busy"
          />
        </label>

        <label class="local-login-field">
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            name="password"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            maxlength="128"
            placeholder="至少 6 位"
            :disabled="busy"
          />
        </label>

        <label v-if="mode === 'register'" class="local-login-field">
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

        <p v-if="error" class="local-login-error" role="alert">{{ error }}</p>

        <button class="local-login-submit" type="submit" :disabled="busy">
          {{
            busy
              ? '处理中…'
              : mode === 'register'
                ? '创建本地账号'
                : '登录'
          }}
        </button>
      </form>

      <p
        v-if="legacyAvailable && mode === 'register' && !hasLocalAccounts"
        class="local-login-note local-login-note--accent"
      >
        首次创建账号时，会把本机已有的自习数据归入此账号。
      </p>
      <p class="local-login-note">
        本地账号仅用于本机数据隔离，不是服务端安全认证。清除浏览器数据或更换设备会丢失，
        请在主页定期导出备份。
        <span v-if="accountCount > 0">本机已有 {{ accountCount }} 个账号。</span>
      </p>
    </main>
  </div>
</template>

<style scoped>
.local-login-page {
  position: relative;
  display: grid;
  min-height: 100vh;
  height: 100vh;
  overflow: hidden;
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

.local-login-brand-tag {
  margin-left: auto;
  padding: 3px 7px;
  border: 1px solid
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 30%, transparent);
  border-radius: 999px;
  color: var(--study-room-primary, #d7ef83);
  font-size: 9px;
  letter-spacing: 0.12em;
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

.local-login-field span {
  color: rgb(255 255 255 / 0.62);
  font-size: 11px;
  font-weight: 600;
}

.local-login-field input {
  width: 100%;
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

.local-login-error {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgb(255 120 120 / 0.3);
  border-radius: 9px;
  color: #ffb4b4;
  background: rgb(120 20 20 / 0.18);
  font-size: 11px;
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

.local-login-note {
  margin: 16px 0 0;
  color: rgb(255 255 255 / 0.38);
  font-size: 10px;
  line-height: 1.65;
}

.local-login-note--accent {
  color: color-mix(
    in srgb,
    var(--study-room-primary, #d7ef83) 72%,
    white
  );
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
