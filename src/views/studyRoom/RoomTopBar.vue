<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { ElMessageBox } from 'element-plus';

import defaultAvatar from '#/assets/defaultUserAvatar.png';
import IconifyIcon from '#/components/IconifyIcon.vue';
import { useLocalUser } from '#/lib/local-user';
import { logoutLocal } from '#/session/session-gate';
import { account } from '#/session/session-state';

import AmbientSound from './AmbientSound.vue';
import type { StudyRoomScene } from './study-room-scene';
import { STUDY_ROOM_SCENES } from './study-room-scene';
import { retrySync, useStudyRoomState, type SyncStatus } from './study-room-state-store';

defineProps<{
  scene: StudyRoomScene;
  activeTab: string;
  tabItems: { key: string; icon: string; label: string }[];
}>();

const emit = defineEmits<{
  'switch-scene': [scene: StudyRoomScene];
  'switch-tab': [tab: string];
}>();

const { profile } = useLocalUser();
const { syncStatus, error: syncError } = useStudyRoomState();

const menuOpen = ref(false);
const retrying = ref(false);

/** 头像优先级：自选头像 → Qoder 头像 → 内置默认头像。 */
const avatar = computed(
  () => profile.avatar || account.value?.picture || defaultAvatar,
);
const nickname = computed(
  () => profile.nickname || account.value?.name || '学习者',
);
const qoderAvatar = computed(
  () => account.value?.picture || profile.avatar || defaultAvatar,
);
const qoderName = computed(
  () => account.value?.name || profile.nickname || 'Qoder 用户',
);

const SYNC_LABEL: Record<SyncStatus, string> = {
  idle: '等待同步',
  saving: '同步中',
  synced: '已同步',
  error: '同步失败',
  conflict: '数据冲突',
};
const SYNC_ICON: Record<SyncStatus, string> = {
  idle: 'lucide:clock',
  saving: 'lucide:rotate-ccw',
  synced: 'lucide:check-circle',
  error: 'lucide:triangle-alert',
  conflict: 'lucide:triangle-alert',
};

const syncLabel = computed(() => SYNC_LABEL[syncStatus.value]);
const syncIcon = computed(() => SYNC_ICON[syncStatus.value]);
const syncDetail = computed(() => {
  switch (syncStatus.value) {
    case 'saving':
      return '正在保存你的修改…';
    case 'synced':
      return '修改会自动同步到云端';
    case 'error':
      return syncError.value || '云端暂时不可用，请稍后重试';
    case 'conflict':
      return '云端已在其他设备更新，请选择保留的版本';
    default:
      return '开始编辑后会同步到云端';
  }
});

const sceneOptions = Object.entries(STUDY_ROOM_SCENES).map(
  ([value, copy]) => ({ value: value as StudyRoomScene, copy }),
);

function closeMenu() {
  menuOpen.value = false;
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

function openProfile() {
  closeMenu();
  emit('switch-tab', 'home');
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && menuOpen.value) {
    event.preventDefault();
    closeMenu();
  }
}

async function handleRetry() {
  if (retrying.value) return;
  retrying.value = true;
  try {
    await retrySync();
  } catch {
    // 失败原因由 store 的 syncStatus / error 展示。
  } finally {
    retrying.value = false;
  }
}

async function confirmLogout() {
  try {
    await ElMessageBox.confirm(
      '退出后会清除本机缓存、旧版本地数据和计时状态，并回到登录页。Qoder 登录会话由 Qoder 管理。',
      '退出并清除本机数据？',
      {
        confirmButtonText: '退出并清除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );
  } catch {
    return;
  }
  closeMenu();
  logoutLocal();
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="room-top-bar">
    <div class="top-bar-side top-bar-left" />

    <!-- 顶部居中悬浮胶囊导航（对齐原项目 dashboard-nav） -->
    <nav class="nav-capsule" aria-label="自习室导航">
      <div class="nav-brand">
        <span class="nav-brand-icon"><IconifyIcon icon="lucide:leaf" /></span>
        <span class="nav-brand-name">清砚自习室</span>
      </div>

      <button
        v-for="option in sceneOptions"
        :key="`scene-${option.value}`"
        type="button"
        class="nav-item"
        :class="{ active: scene === option.value }"
        :title="`切换到${option.copy.labelLong}`"
        @click="emit('switch-scene', option.value)"
      >
        {{ option.copy.labelShort }}
      </button>

      <span class="nav-divider" aria-hidden="true" />

      <button
        v-for="item in tabItems"
        :key="item.key"
        type="button"
        class="nav-item"
        :class="{ active: activeTab === item.key }"
        @click="emit('switch-tab', item.key)"
      >
        {{ item.label }}
      </button>
    </nav>

    <div class="top-bar-side top-bar-right">
      <AmbientSound :scene="scene" />
      <div class="user-menu-wrap">
        <button
          type="button"
          class="user-avatar-btn"
          :aria-label="`${nickname}的账号菜单`"
          :title="`${nickname} · 账号与同步`"
          aria-haspopup="dialog"
          :aria-expanded="menuOpen"
          @click="toggleMenu"
        >
          <img
            :src="avatar"
            alt="头像"
            class="user-avatar-img"
            referrerpolicy="no-referrer"
          />
        </button>

        <div
          v-if="menuOpen"
          class="user-menu-backdrop"
          aria-hidden="true"
          @click="closeMenu"
        />

        <div
          v-if="menuOpen"
          id="study-room-account-menu"
          class="user-menu"
          role="dialog"
          aria-label="账号与同步"
        >
          <div class="user-menu-head">
            <img
              :src="qoderAvatar"
              alt=""
              class="user-menu-avatar"
              referrerpolicy="no-referrer"
            />
            <div class="user-menu-head-copy">
              <strong>{{ qoderName }}</strong>
              <span>Qoder 账号</span>
            </div>
          </div>

          <div class="user-menu-sync" :class="`is-${syncStatus}`">
            <span class="user-menu-sync-icon">
              <IconifyIcon
                :icon="syncIcon"
                :class="{ 'is-spinning': syncStatus === 'saving' }"
              />
            </span>
            <div class="user-menu-sync-copy">
              <strong>{{ syncLabel }}</strong>
              <span>{{ syncDetail }}</span>
            </div>
            <button
              v-if="syncStatus === 'error'"
              type="button"
              class="user-menu-retry"
              :disabled="retrying"
              @click="handleRetry"
            >
              {{ retrying ? '同步中' : '立即同步' }}
            </button>
          </div>

          <div class="user-menu-divider" aria-hidden="true" />

          <button type="button" class="user-menu-item" @click="openProfile">
            <IconifyIcon icon="lucide:user" />
            个人主页
          </button>
          <button
            type="button"
            class="user-menu-item is-danger"
            @click="confirmLogout"
          >
            <IconifyIcon icon="lucide:log-out" />
            退出并清除本机数据
          </button>

          <p class="user-menu-note">
            退出只清除本机数据，Qoder 登录会话由 Qoder 管理。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.room-top-bar {
  position: relative;
  z-index: 20;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  padding: 14px 24px 0;
  flex-shrink: 0;
}

.top-bar-left {
  display: flex;
  justify-content: flex-start;
}

.top-bar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.github-link {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 10px;
  color: rgb(255 255 255 / 0.65);
  background: rgb(15 23 20 / 0.55);
  backdrop-filter: blur(16px);
  transition: all 0.18s ease;
}

.github-link:hover {
  color: #fff;
  background: rgb(15 23 20 / 0.75);
}

.user-menu-wrap {
  position: relative;
}

.user-avatar-btn {
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 50%;
  overflow: hidden;
  padding: 0;
  background: rgb(15 23 20 / 0.55);
  cursor: pointer;
  transition: all 0.18s ease;
}

.user-avatar-btn:hover {
  border-color: var(--study-room-primary);
}

.user-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: transparent;
}

.user-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 100;
  width: 264px;
  max-width: calc(100vw - 24px);
  max-height: min(72vh, 420px);
  overflow-y: auto;
  padding: 6px;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 14px;
  background: rgb(14 22 18 / 0.96);
  box-shadow: 0 16px 44px rgb(0 0 0 / 0.4);
  backdrop-filter: blur(24px);
}

.user-menu-head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}

.user-menu-head-copy {
  min-width: 0;
}

.user-menu-avatar {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
}

.user-menu-head strong {
  display: block;
  overflow: hidden;
  color: #fff;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-menu-head span {
  display: block;
  margin-top: 2px;
  color: rgb(255 255 255 / 0.45);
  font-size: 11px;
}

.user-menu-sync {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 2px 6px 6px;
  padding: 9px 10px;
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.04);
}

.user-menu-sync-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  color: rgb(255 255 255 / 0.55);
  font-size: 15px;
}

.user-menu-sync.is-synced .user-menu-sync-icon {
  color: var(--study-room-primary);
}

.user-menu-sync.is-error .user-menu-sync-icon,
.user-menu-sync.is-conflict .user-menu-sync-icon {
  color: #ffb45f;
}

.user-menu-sync-copy {
  min-width: 0;
  flex: 1;
}

.user-menu-sync-copy strong {
  display: block;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.user-menu-sync-copy span {
  display: block;
  margin-top: 2px;
  overflow-wrap: anywhere;
  color: rgb(255 255 255 / 0.45);
  font-size: 11px;
  line-height: 1.5;
}

.user-menu-retry {
  flex-shrink: 0;
  align-self: center;
  padding: 5px 9px;
  border: 1px solid color-mix(in srgb, var(--study-room-primary) 45%, transparent);
  border-radius: 999px;
  color: var(--study-room-primary);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.user-menu-retry:hover:not(:disabled) {
  background: color-mix(in srgb, var(--study-room-primary) 14%, transparent);
}

.user-menu-retry:disabled {
  cursor: default;
  opacity: 0.6;
}

.is-spinning {
  animation: user-menu-spin 0.9s linear infinite;
}

@keyframes user-menu-spin {
  to {
    transform: rotate(360deg);
  }
}

.user-menu-divider {
  height: 1px;
  margin: 2px 8px 4px;
  background: rgb(255 255 255 / 0.08);
}

.user-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-radius: 9px;
  color: rgb(255 255 255 / 0.78);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: all 0.15s ease;
}

.user-menu-item:hover {
  color: #fff;
  background: rgb(255 255 255 / 0.07);
}

.user-menu-item.is-danger:hover {
  color: #ff8f8f;
  background: rgb(255 90 90 / 0.1);
}

.user-menu-note {
  margin: 6px 12px 6px;
  color: rgb(255 255 255 / 0.32);
  font-size: 10px;
  line-height: 1.6;
}

.back-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 999px;
  color: rgb(255 255 255 / 0.8);
  background: rgb(15 23 20 / 0.55);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  backdrop-filter: blur(16px);
  transition: all 0.18s ease;
}

.back-button:hover {
  color: #fff;
  background: rgb(15 23 20 / 0.75);
}

/* 居中悬浮胶囊导航 */
.nav-capsule {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 6px;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 999px;
  background: rgb(10 18 15 / 0.62);
  box-shadow: 0 10px 34px rgb(0 0 0 / 0.28);
  backdrop-filter: blur(20px);
}

.nav-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px 0 6px;
}

.nav-brand-icon {
  display: flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #051612;
  background: var(--study-room-primary);
}

.nav-brand-name {
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}

.nav-item {
  padding: 8px 14px;
  border: 0;
  border-radius: 999px;
  color: rgb(255 255 255 / 0.62);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.18s ease;
}

.nav-item:hover {
  color: #fff;
  background: rgb(255 255 255 / 0.07);
}

.nav-item.active {
  color: #051612;
  background: var(--study-room-primary);
}

.nav-divider {
  width: 1px;
  height: 18px;
  margin: 0 6px;
  background: rgb(255 255 255 / 0.12);
}

@media (max-width: 1100px) {
  .room-top-bar {
    grid-template-columns: auto 1fr auto;
  }

  .nav-brand-name {
    display: none;
  }
}

@media (max-width: 720px) {
  .room-top-bar {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 12px 0;
  }

  .top-bar-left {
    display: none;
  }

  .top-bar-right {
    order: -1;
    justify-content: flex-end;
  }

  .nav-capsule {
    width: 100%;
    max-width: 100%;
    justify-content: flex-start;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .nav-capsule::-webkit-scrollbar {
    display: none;
  }

  .user-menu {
    position: fixed;
    top: 64px;
    right: 12px;
    left: auto;
    width: min(264px, calc(100vw - 24px));
    max-height: calc(100dvh - 80px);
    overflow-y: auto;
  }
}
</style>
