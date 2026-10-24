import { ref } from 'vue';

import {
  bootstrapStudyRoom,
  emptyStudyRoomState,
  hasStudyRoomStateArrays,
  isSameUpdatedAt,
  normalizeStudyRoomState,
  saveStudyRoom,
  SyncApiError,
  type CloudSnapshot,
} from '#/api/study-room-sync';
import {
  isValidJoinedAt,
  profilePayload,
  sanitizeAvatar,
  sanitizeNickname,
  setProfile,
  todayKey,
  type LocalProfile,
} from '#/lib/profile-state';
import { readJson, writeJson } from '#/lib/storage';
import { clearSession } from '#/session/session-state';
import type { StudyRoomState } from './study-room-types';

export type SyncStatus = 'idle' | 'saving' | 'synced' | 'error' | 'conflict';

export interface StudyRoomCache {
  userId: string;
  profile: LocalProfile;
  state: StudyRoomState;
  updatedAt: string | null;
  pending: boolean;
  baseUpdatedAt: string | null;
}

export interface HydrateStudyRoomInput {
  userId: string;
  profile: LocalProfile;
  state: StudyRoomState;
  updatedAt: string | null;
  pending: boolean;
  /** 只在恢复 pending 缓存时传入，保留上一次成功写入的 base。 */
  baseUpdatedAt?: string | null;
}

export interface LegacyLocalData {
  state: StudyRoomState;
  profile: LocalProfile;
}

export type MigrationDecision = 'imported' | 'empty';

const CACHE_KEY = 'qingyan-study-room:cache:v1';
export const LEGACY_STATE_KEY = 'qingyan-study-room:state:v1';
export const LEGACY_PROFILE_KEY = 'qingyan-study-room:profile:v1';
const LEGACY_BACKUP_PREFIX = 'qingyan-study-room:legacy-backup:v1:';
const MIGRATION_DECISION_PREFIX = 'qingyan-study-room:migrated:v1:';

const SAVE_DEBOUNCE_MS = 800;
const MAX_SYNC_BYTES = 900 * 1024;

const state = ref<StudyRoomState>(emptyStudyRoomState());
const loaded = ref(false);
const loading = ref(false);
const error = ref('');
const syncStatus = ref<SyncStatus>('idle');
const conflict = ref<CloudSnapshot | null>(null);
const userId = ref<string | null>(null);
const updatedAt = ref<string | null>(null);

let generation = 0;
let epoch = 0;
let requestSeq = 0;
let pending = false;
let queued = false;
let unknownOutcome = false;
let inFlight: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 与对象键顺序无关的序列化，用于判断云端快照是否就是本地内容。 */
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

function jsonByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

function clearSaveTimer(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function readRaw(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeRaw(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 本地存储不可用时忽略。
  }
}

function parseCachedProfile(raw: unknown): LocalProfile | null {
  if (!isRecord(raw)) return null;
  const joinedAt =
    typeof raw.joinedAt === 'string' && isValidJoinedAt(raw.joinedAt)
      ? raw.joinedAt
      : todayKey();
  return {
    nickname: sanitizeNickname(
      typeof raw.nickname === 'string' ? raw.nickname : '',
      '',
    ),
    avatar: sanitizeAvatar(
      typeof raw.avatar === 'string' ? raw.avatar : '',
    ),
    joinedAt,
  };
}

export function readStudyRoomCache(): StudyRoomCache | null {
  const raw = readJson<unknown>(CACHE_KEY, null);
  if (!isRecord(raw)) return null;
  if (typeof raw.userId !== 'string' || !raw.userId) return null;
  const cachedState = normalizeStudyRoomState(raw.state);
  const cachedProfile = parseCachedProfile(raw.profile);
  if (!cachedState || !cachedProfile) return null;
  return {
    userId: raw.userId,
    profile: cachedProfile,
    state: cachedState,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    pending: raw.pending === true,
    baseUpdatedAt:
      typeof raw.baseUpdatedAt === 'string' ? raw.baseUpdatedAt : null,
  };
}

export function clearStudyRoomCache(): void {
  removeRaw(CACHE_KEY);
}

function writeCache(pendingFlag: boolean, baseUpdatedAt: string | null): void {
  const currentUserId = userId.value;
  if (!currentUserId) return;
  const cache: StudyRoomCache = {
    userId: currentUserId,
    profile: profilePayload(),
    state: normalizeStudyRoomState(state.value) ?? emptyStudyRoomState(),
    updatedAt: updatedAt.value,
    pending: pendingFlag,
    baseUpdatedAt,
  };
  writeJson(CACHE_KEY, cache);
}

function markSyncError(message: string, outcomeUnknown: boolean): void {
  error.value = message;
  syncStatus.value = 'error';
  unknownOutcome = outcomeUnknown;
  if (userId.value) writeCache(true, updatedAt.value);
}

function handleSessionError(status: number): boolean {
  if (status === 401) {
    clearSession('unauthenticated');
    return true;
  }
  if (status === 403) {
    clearSession('forbidden');
    return true;
  }
  return false;
}

export function setSyncConflict(current: CloudSnapshot | null): void {
  conflict.value = current;
  if (current) {
    syncStatus.value = 'conflict';
    error.value = '';
  } else if (syncStatus.value === 'conflict') {
    syncStatus.value = pending ? 'saving' : 'synced';
  }
}

export function hydrateStudyRoom(input: HydrateStudyRoomInput): void {
  const previousCache = readStudyRoomCache();
  clearSaveTimer();
  epoch += 1;
  requestSeq += 1;
  generation += 1;
  inFlight = null;
  queued = false;
  unknownOutcome = false;

  userId.value = input.userId;
  const normalized = normalizeStudyRoomState(input.state) ?? emptyStudyRoomState();
  state.value = normalized;
  setProfile(input.profile);
  updatedAt.value = input.updatedAt;
  pending = input.pending;
  conflict.value = null;
  error.value = '';
  loaded.value = true;
  loading.value = false;

  let baseUpdatedAt: string | null;
  if (input.baseUpdatedAt !== undefined) {
    baseUpdatedAt = input.baseUpdatedAt;
  } else if (
    input.pending &&
    previousCache &&
    previousCache.userId === input.userId &&
    previousCache.pending
  ) {
    baseUpdatedAt = previousCache.baseUpdatedAt;
  } else {
    baseUpdatedAt = input.updatedAt;
  }

  syncStatus.value = input.pending ? 'saving' : 'synced';
  writeCache(input.pending, baseUpdatedAt);
}

/** 返回当前状态，不发起任何网络请求（SessionGate 负责注入云端/缓存状态）。 */
export async function loadStudyRoomState(): Promise<StudyRoomState> {
  loading.value = false;
  loaded.value = true;
  return state.value;
}

export function scheduleSaveStudyRoom(): void {
  if (!userId.value) return;
  generation += 1;
  pending = true;
  unknownOutcome = false;
  error.value = '';
  if (syncStatus.value !== 'conflict') syncStatus.value = 'saving';
  writeCache(true, updatedAt.value);
  if (conflict.value) return;
  clearSaveTimer();
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void pushStudyRoom();
  }, SAVE_DEBOUNCE_MS);
}

async function sendSnapshot(): Promise<boolean> {
  if (!userId.value || !loaded.value) return false;

  const userIdAtSend = userId.value;
  const epochAtSend = epoch;
  const generationAtSend = generation;
  const snapshotState = normalizeStudyRoomState(state.value);
  if (!snapshotState) {
    markSyncError('自习室数据格式异常，暂时无法同步', false);
    return false;
  }
  const snapshotProfile = profilePayload();
  const base = updatedAt.value;
  const serialized = JSON.stringify({
    profile: snapshotProfile,
    state: snapshotState,
    baseUpdatedAt: base,
  });
  if (jsonByteLength(serialized) > MAX_SYNC_BYTES) {
    markSyncError('内容过大，无法同步', false);
    return false;
  }

  if (syncStatus.value !== 'conflict') syncStatus.value = 'saving';

  try {
    const saved = await saveStudyRoom({
      profile: snapshotProfile,
      state: snapshotState,
      baseUpdatedAt: base,
    });
    if (epoch !== epochAtSend || userId.value !== userIdAtSend) return false;

    updatedAt.value = saved.updatedAt;
    if (generation === generationAtSend) {
      pending = false;
      unknownOutcome = false;
      error.value = '';
      syncStatus.value = 'synced';
      writeCache(false, saved.updatedAt);
      return true;
    }

    // 保存期间又有新编辑：以服务端新时间作为下一次 base，继续推送最新快照。
    pending = true;
    syncStatus.value = 'saving';
    writeCache(true, saved.updatedAt);
    queued = true;
    return true;
  } catch (caught) {
    if (epoch !== epochAtSend || userId.value !== userIdAtSend) return false;

    if (caught instanceof SyncApiError) {
      if (handleSessionError(caught.status)) {
        writeCache(true, updatedAt.value);
        return false;
      }
      if (caught.code === 'conflict') {
        if (generation !== generationAtSend) {
          // 过期快照的冲突不弹窗；让队列用最新状态再尝试。
          queued = true;
          return true;
        }
        if (caught.current) {
          conflict.value = caught.current;
          syncStatus.value = 'conflict';
          error.value = '';
        } else {
          markSyncError('云端返回的冲突数据不完整，请重试', true);
          return false;
        }
        pending = true;
        writeCache(true, updatedAt.value);
        return false;
      }

      const definiteRejection =
        caught.status === 400 || caught.status === 413;
      const outcomeUnknown =
        !definiteRejection &&
        (caught.status === 0 ||
          caught.status >= 500 ||
          caught.code === 'invalid_response');
      markSyncError(
        caught.status === 413 ? '内容过大，无法同步' : caught.message,
        outcomeUnknown,
      );
      return false;
    }

    markSyncError('云端同步失败，请稍后重试', true);
    return false;
  }
}

export async function pushStudyRoom(): Promise<void> {
  if (!userId.value || !loaded.value) return;
  if (conflict.value) return;
  if (!pending && !queued) return;
  if (inFlight) {
    queued = true;
    await inFlight;
    return;
  }

  const seq = ++requestSeq;
  const running = (async () => {
    while (pending && userId.value) {
      const shouldContinue = await sendSnapshot();
      if (!shouldContinue) break;
      if (!queued) break;
      queued = false;
    }
  })();
  inFlight = running;

  try {
    await running;
  } finally {
    if (requestSeq === seq) {
      inFlight = null;
      queued = false;
    }
  }
}

export async function flushStudyRoom(): Promise<void> {
  clearSaveTimer();
  await pushStudyRoom();
}

export async function pushInitialState(): Promise<boolean> {
  if (!userId.value) return false;
  if (inFlight) await inFlight;
  if (!userId.value) return false;

  conflict.value = null;
  error.value = '';
  updatedAt.value = null;
  pending = true;
  queued = false;
  unknownOutcome = false;
  generation += 1;
  syncStatus.value = 'saving';
  writeCache(true, null);

  await pushStudyRoom();
  return !conflict.value && !pending;
}

export async function retrySync(): Promise<void> {
  if (!userId.value || !loaded.value || conflict.value) return;

  if (!unknownOutcome) {
    if (!pending) {
      syncStatus.value = 'synced';
      error.value = '';
      return;
    }
    await pushStudyRoom();
    return;
  }

  const userIdBefore = userId.value;
  try {
    const cloud = await bootstrapStudyRoom();
    if (userId.value !== userIdBefore) return;
    if (cloud.user.id !== userId.value) {
      clearSession('unauthenticated');
      return;
    }

    const cloudState = cloud.state;
    const cloudUpdatedAt = cloud.updatedAt;
    if (cloudState !== null && cloudUpdatedAt !== null) {
      const cloudProfile = cloud.profile;
      const sameContent =
        !!cloudProfile &&
        stableStringify(cloudState) === stableStringify(state.value) &&
        stableStringify(cloudProfile) === stableStringify(profilePayload());

      if (isSameUpdatedAt(cloudUpdatedAt, updatedAt.value)) {
        // 云端 base 未变，说明上次未知结果的写入没有生效，直接重推。
        updatedAt.value = cloudUpdatedAt;
      } else if (sameContent) {
        // 上次 503/网络中断其实已经写入成功。
        updatedAt.value = cloudUpdatedAt;
        pending = false;
        unknownOutcome = false;
        error.value = '';
        syncStatus.value = 'synced';
        writeCache(false, cloudUpdatedAt);
        return;
      } else {
        conflict.value = {
          profile: cloud.profile ?? profilePayload(),
          state: cloudState,
          updatedAt: cloudUpdatedAt,
        };
        syncStatus.value = 'conflict';
        error.value = '';
        pending = true;
        writeCache(true, updatedAt.value);
        return;
      }
    } else if (updatedAt.value !== null) {
      // 云端没有数据，重新以 base=null 插入。
      updatedAt.value = null;
    }

    unknownOutcome = false;
    pending = true;
    syncStatus.value = 'saving';
    error.value = '';
    writeCache(true, updatedAt.value);
    await pushStudyRoom();
  } catch (caught) {
    if (caught instanceof SyncApiError) {
      if (handleSessionError(caught.status)) return;
      markSyncError(caught.message, true);
      return;
    }
    markSyncError('核对云端数据失败，请稍后重试', true);
  }
}

export function resolveConflictUseCloud(): void {
  const snapshot = conflict.value;
  if (!snapshot) return;
  clearSaveTimer();
  epoch += 1;
  generation += 1;
  inFlight = null;
  queued = false;
  unknownOutcome = false;

  state.value = normalizeStudyRoomState(snapshot.state) ?? emptyStudyRoomState();
  setProfile(snapshot.profile);
  updatedAt.value = snapshot.updatedAt;
  pending = false;
  conflict.value = null;
  error.value = '';
  syncStatus.value = 'synced';
  loaded.value = true;
  writeCache(false, snapshot.updatedAt);
}

export async function resolveConflictKeepLocal(): Promise<void> {
  const snapshot = conflict.value;
  if (!snapshot) return;
  clearSaveTimer();
  conflict.value = null;
  updatedAt.value = snapshot.updatedAt;
  pending = true;
  queued = false;
  unknownOutcome = false;
  error.value = '';
  syncStatus.value = 'saving';
  generation += 1;
  writeCache(true, snapshot.updatedAt);
  await pushStudyRoom();
}

export function exportStudyRoomState(): string {
  return JSON.stringify(state.value, null, 2);
}

export function importStudyRoomState(raw: string): StudyRoomState {
  const parsed: unknown = JSON.parse(raw);
  if (!hasStudyRoomStateArrays(parsed)) {
    throw new Error('文件格式不正确');
  }
  state.value = normalizeStudyRoomState(parsed) ?? emptyStudyRoomState();
  loaded.value = true;
  scheduleSaveStudyRoom();
  return state.value;
}

export function useStudyRoomState() {
  return {
    state,
    loaded,
    loading,
    error,
    syncStatus,
    conflict,
    userId,
    updatedAt,
  };
}

export function isStudyRoomSyncPending(): boolean {
  return pending;
}

export function resetForLogout(): void {
  clearSaveTimer();
  epoch += 1;
  generation += 1;
  requestSeq += 1;
  pending = false;
  queued = false;
  unknownOutcome = false;
  inFlight = null;

  userId.value = null;
  loaded.value = false;
  loading.value = false;
  error.value = '';
  syncStatus.value = 'idle';
  conflict.value = null;
  updatedAt.value = null;
  state.value = emptyStudyRoomState();
  clearStudyRoomCache();
}

export function hasLegacyLocalData(): boolean {
  const rawState = readRaw(LEGACY_STATE_KEY);
  const rawProfile = readRaw(LEGACY_PROFILE_KEY);
  return !!(
    (rawState && rawState.trim()) ||
    (rawProfile && rawProfile.trim())
  );
}

export function readLegacyLocalData(): LegacyLocalData | null {
  if (!hasLegacyLocalData()) return null;
  const rawState = readRaw(LEGACY_STATE_KEY);
  const rawProfile = readRaw(LEGACY_PROFILE_KEY);

  let parsedState: unknown = null;
  if (rawState) {
    try {
      parsedState = JSON.parse(rawState);
    } catch {
      parsedState = null;
    }
  }

  let parsedProfile: unknown = null;
  if (rawProfile) {
    try {
      parsedProfile = JSON.parse(rawProfile);
    } catch {
      parsedProfile = null;
    }
  }

  const cachedProfile = parseCachedProfile(parsedProfile);
  return {
    state: normalizeStudyRoomState(parsedState) ?? emptyStudyRoomState(),
    profile: cachedProfile ?? {
      nickname: '',
      avatar: '',
      joinedAt: todayKey(),
    },
  };
}

/**
 * 旧键归档成功之前绝不删除活动旧键，避免迁移中途丢数据。
 */
export function archiveLegacyLocalData(userIdValue: string): boolean {
  if (!userIdValue) return false;
  const rawState = readRaw(LEGACY_STATE_KEY);
  const rawProfile = readRaw(LEGACY_PROFILE_KEY);
  if (!rawState && !rawProfile) return true;

  const readParsed = (raw: string | null): unknown => {
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  const backup = {
    archivedAt: new Date().toISOString(),
    userId: userIdValue,
    state: readParsed(rawState),
    profile: readParsed(rawProfile),
  };
  const written = writeJson(`${LEGACY_BACKUP_PREFIX}${userIdValue}`, backup);
  if (!written) return false;

  try {
    if (rawState !== null) window.localStorage.removeItem(LEGACY_STATE_KEY);
    if (rawProfile !== null) window.localStorage.removeItem(LEGACY_PROFILE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function migrationDecisionKey(userIdValue: string): string {
  return `${MIGRATION_DECISION_PREFIX}${userIdValue}`;
}

/** Plan 中使用的常量式别名，便于 UI 侧按 userId 读取决定。 */
export const MIGRATION_DECISION_KEY = migrationDecisionKey;

export function readMigrationDecision(
  userIdValue: string,
): MigrationDecision | null {
  const raw = readJson<unknown>(migrationDecisionKey(userIdValue), null);
  return raw === 'imported' || raw === 'empty' ? raw : null;
}

export function writeMigrationDecision(
  userIdValue: string,
  decision: MigrationDecision,
): void {
  if (!userIdValue) return;
  writeJson(migrationDecisionKey(userIdValue), decision);
}

// 云端是唯一权威，跨标签只同步“已退出”锁标记（见 session-state）。
// beforeunload 的异步写入不保证成功，仅作为尽力而为的收尾。
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void flushStudyRoom();
  });
}
