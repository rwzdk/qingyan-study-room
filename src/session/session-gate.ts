import { ref } from 'vue';

import {
  bootstrapStudyRoom,
  emptyStudyRoomState,
  isSameUpdatedAt,
  SyncApiError,
} from '#/api/study-room-sync';
import { applyQoderUser } from '#/lib/local-user';
import {
  profilePayload,
  resetProfile,
  setProfile,
  todayKey,
} from '#/lib/profile-state';
import {
  account,
  clearSession,
  lockLocalSession,
  locked,
  registerSessionResume,
  sessionError,
  sessionStatus,
  setSession,
} from '#/session/session-state';
import {
  LEGACY_PROFILE_KEY,
  LEGACY_STATE_KEY,
  archiveLegacyLocalData,
  clearStudyRoomCache,
  flushStudyRoom,
  hasLegacyLocalData,
  hydrateStudyRoom,
  isStudyRoomSyncPending,
  pushInitialState,
  readLegacyLocalData,
  readMigrationDecision,
  readStudyRoomCache,
  resetForLogout,
  setSyncConflict,
  writeMigrationDecision,
} from '#/views/studyRoom/study-room-state-store';

const POMODORO_KEY = 'qingyan-study-room:pomodoro:v1';
const REMINDER_KEY = 'qingyan-study-room:focus-reminder:v1';

export const migrationNeeded = ref(false);
export const migrationBusy = ref(false);
export const migrationError = ref('');

// 方便 UI 只从 session-gate 引入会话 API；底层状态仍由 session-state 维护。
export {
  account,
  clearSession,
  locked,
  loginUrl,
  sessionError,
  sessionStatus,
  unlockLocalSession,
} from './session-state';

let bootstrapPromise: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 与对象键顺序无关的比较，避免 Postgres jsonb 重排键导致误判冲突。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function finishReady(): void {
  if (sessionStatus.value === 'loading') {
    // account 已提前写入；setSession 同时把状态切到 ready。
    const current = account.value;
    if (!current) {
      clearSession('error', '登录信息丢失，请重试');
      return;
    }
    setSession(current);
  }
}

async function runBootstrap(): Promise<void> {
  sessionStatus.value = 'loading';
  sessionError.value = '';
  migrationNeeded.value = false;
  migrationError.value = '';

  if (locked.value) {
    clearSession('unauthenticated');
    return;
  }

  let data;
  try {
    data = await bootstrapStudyRoom();
  } catch (caught) {
    if (locked.value) {
      clearSession('unauthenticated');
      return;
    }
    if (caught instanceof SyncApiError) {
      if (caught.status === 401) {
        clearSession('unauthenticated');
        return;
      }
      if (caught.status === 403) {
        clearSession('forbidden', '当前账号无权访问该站点');
        return;
      }
      clearSession('error', caught.message);
      return;
    }
    clearSession('error', '无法连接云端服务，请检查网络后重试');
    return;
  }

  if (locked.value) {
    clearSession('unauthenticated');
    return;
  }

  account.value = data.user;

  let cache = readStudyRoomCache();
  if (cache && cache.userId !== data.user.id) {
    clearStudyRoomCache();
    cache = null;
  }

  const hasCloud = data.state !== null && data.updatedAt !== null;
  const baseProfile = cache?.pending
    ? cache.profile
    : (data.profile ?? cache?.profile ?? null);
  setProfile(
    baseProfile ?? {
      nickname: '',
      avatar: '',
      joinedAt: todayKey(),
    },
  );
  applyQoderUser(data.user);

  if (cache?.pending) {
    const sameBase =
      !hasCloud ||
      (data.updatedAt !== null &&
        isSameUpdatedAt(cache.baseUpdatedAt, data.updatedAt));

    if (sameBase) {
      hydrateStudyRoom({
        userId: data.user.id,
        profile: profilePayload(),
        state: cache.state,
        updatedAt: hasCloud ? data.updatedAt : null,
        pending: true,
        baseUpdatedAt: hasCloud ? data.updatedAt : null,
      });
      // 启动时立刻重推 pending 缓存，绝不静默丢弃本地未同步修改。
      await flushStudyRoom();
      if (!locked.value && !isStudyRoomSyncPending()) {
        archiveLegacyLocalData(data.user.id);
      }
      finishReady();
      return;
    }

    const sameContent =
      hasCloud &&
      data.updatedAt !== null &&
      data.state !== null &&
      stableStringify(data.state) === stableStringify(cache.state) &&
      stableStringify(data.profile) === stableStringify(cache.profile);

    if (sameContent && data.updatedAt !== null && data.state !== null) {
      // 上一次“写结果未知”的请求其实已经成功落地。
      hydrateStudyRoom({
        userId: data.user.id,
        profile: profilePayload(),
        state: data.state,
        updatedAt: data.updatedAt,
        pending: false,
      });
      archiveLegacyLocalData(data.user.id);
      finishReady();
      return;
    }

    // 云端已更新且内容不同：保留本地 pending（含旧 base），交给用户选择。
    // 不能把 base 改成云端时间，否则刷新后会误以为自己已同步并覆盖云端。
    hydrateStudyRoom({
      userId: data.user.id,
      profile: profilePayload(),
      state: cache.state,
      updatedAt: data.updatedAt,
      pending: true,
      baseUpdatedAt: cache.baseUpdatedAt,
    });
    setSyncConflict({
      profile: data.profile ?? profilePayload(),
      state: data.state ?? emptyStudyRoomState(),
      updatedAt: data.updatedAt ?? new Date().toISOString(),
    });
    archiveLegacyLocalData(data.user.id);
    finishReady();
    return;
  }

  // 没有 pending 缓存：云端有数据用云端，没有则用空状态。
  hydrateStudyRoom({
    userId: data.user.id,
    profile: profilePayload(),
    state: hasCloud && data.state ? data.state : emptyStudyRoomState(),
    updatedAt: hasCloud ? data.updatedAt : null,
    pending: false,
  });

  if (!hasCloud) {
    if (hasLegacyLocalData() && !readMigrationDecision(data.user.id)) {
      migrationNeeded.value = true;
    } else if (hasLegacyLocalData()) {
      archiveLegacyLocalData(data.user.id);
    }
  } else {
    archiveLegacyLocalData(data.user.id);
  }

  finishReady();
}

export function bootstrapSession(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = runBootstrap().finally(() => {
    bootstrapPromise = null;
  });
  return bootstrapPromise;
}

export function retryBootstrap(): Promise<void> {
  return bootstrapSession();
}

export async function resolveMigration(
  kind: 'import' | 'empty',
): Promise<void> {
  const currentUserId = account.value?.id;
  if (!currentUserId || migrationBusy.value) return;

  migrationBusy.value = true;
  migrationError.value = '';

  try {
    if (kind === 'import') {
      const legacy = readLegacyLocalData();
      if (!legacy) {
        throw new Error('没有检测到可导入的本机数据');
      }
      setProfile(legacy.profile);
      if (account.value) applyQoderUser(account.value);
      hydrateStudyRoom({
        userId: currentUserId,
        profile: profilePayload(),
        state: legacy.state,
        updatedAt: null,
        pending: true,
        baseUpdatedAt: null,
      });
    } else {
      resetProfile();
      if (account.value) applyQoderUser(account.value);
      hydrateStudyRoom({
        userId: currentUserId,
        profile: profilePayload(),
        state: emptyStudyRoomState(),
        updatedAt: null,
        pending: true,
        baseUpdatedAt: null,
      });
    }

    setSyncConflict(null);
    const saved = await pushInitialState();
    if (!saved) {
      migrationError.value = isStudyRoomSyncPending()
        ? '云端保存失败，请检查网络后重试'
        : '迁移未完成，请重试';
      return;
    }

    // 先写用户专属备份，成功后才删除活动旧键（见 archiveLegacyLocalData）。
    archiveLegacyLocalData(currentUserId);
    writeMigrationDecision(
      currentUserId,
      kind === 'import' ? 'imported' : 'empty',
    );
    migrationNeeded.value = false;
  } catch (caught) {
    migrationError.value =
      caught instanceof Error ? caught.message : '迁移失败，请重试';
  } finally {
    migrationBusy.value = false;
  }
}

export function logoutLocal(options: { redirect?: boolean } = {}): void {
  clearStudyRoomCache();

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(LEGACY_STATE_KEY);
      window.localStorage.removeItem(LEGACY_PROFILE_KEY);
      window.localStorage.removeItem(POMODORO_KEY);
    window.localStorage.removeItem(REMINDER_KEY);
    } catch {
      // 本地存储不可用时继续退出流程。
    }
  }

  resetForLogout();
  resetProfile();
  migrationNeeded.value = false;
  migrationBusy.value = false;
  migrationError.value = '';
  lockLocalSession();

  if (options.redirect !== false && typeof window !== 'undefined') {
    try {
      window.location.assign('/');
    } catch {
      try {
        window.location.href = '/';
      } catch {
        // 某些嵌入式浏览器禁止跳转；锁标记已经写入，刷新后会回到登录页。
      }
    }
  }
}

registerSessionResume(() => bootstrapSession());
