import { ref } from 'vue';

import type { AccountInfo } from '#/api/study-room-sync';

export type SessionStatus =
  | 'loading'
  | 'unauthenticated'
  | 'forbidden'
  | 'error'
  | 'ready';

const LOCK_KEY = 'qingyan-study-room:locked:v1';

function readLocked(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LOCK_KEY) === '1';
  } catch {
    return false;
  }
}

function writeLocked(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(LOCK_KEY, '1');
    else window.localStorage.removeItem(LOCK_KEY);
  } catch {
    // 本地存储不可用时只影响跨标签同步，不阻断登录流程。
  }
}

export const sessionStatus = ref<SessionStatus>('loading');
export const account = ref<AccountInfo | null>(null);
export const sessionError = ref('');
export const locked = ref(readLocked());

/**
 * session-state 不直接依赖 session-gate（否则形成循环）。
 * session-gate 在加载时注册恢复逻辑，解锁后立即重新校验 Qoder 会话。
 */
let resumeSession: (() => void | Promise<void>) | null = null;

export function registerSessionResume(
  handler: (() => void | Promise<void>) | null,
): void {
  resumeSession = handler;
}

export function setSession(next: AccountInfo): void {
  account.value = next;
  sessionStatus.value = 'ready';
  sessionError.value = '';
}

export function clearSession(
  status: SessionStatus = 'unauthenticated',
  message = '',
): void {
  account.value = null;
  sessionStatus.value = status;
  sessionError.value = message;
}

export function lockLocalSession(): void {
  locked.value = true;
  writeLocked(true);
  clearSession('unauthenticated');
}

/**
 * 清除本机锁标记后必须重新走 bootstrapSession 验证 Qoder 会话，
 * 不能只把内存里的状态改成已登录。
 */
export function unlockLocalSession(): void {
  locked.value = false;
  writeLocked(false);
  sessionError.value = '';
  sessionStatus.value = 'loading';
  if (resumeSession) {
    void resumeSession();
  }
}

export function loginUrl(): string {
  if (typeof window === 'undefined') return '/__qoder_auth/start';
  const returnPath = `${window.location.pathname}${window.location.search}`;
  return `/__qoder_auth/start?return_path=${encodeURIComponent(returnPath)}`;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== LOCK_KEY) return;
    if (event.newValue === '1') {
      // 任一标签页退出后，其他标签页也回到未登录状态。
      locked.value = true;
      account.value = null;
      sessionStatus.value = 'unauthenticated';
      sessionError.value = '';
    } else if (event.newValue === null) {
      locked.value = false;
    }
  });
}
