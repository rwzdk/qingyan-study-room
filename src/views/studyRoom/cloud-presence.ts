import { cloudEnabled, cloudPresence, readCloudSession } from '#/api/study-cloud';

const INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let visibilityBound = false;

function ping(): void {
  const session = readCloudSession();
  if (!session) return;
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  void cloudPresence(session.token, ua.slice(0, 200)).catch(() => {
    // 心跳失败不打扰用户，下一轮再试。
  });
}

function onVisibility(): void {
  if (!document.hidden) ping();
}

/** 会话期间每分钟上报一次活跃，管理端的「在线用户」靠它统计。 */
export function startCloudPresence(): void {
  if (!cloudEnabled() || timer) return;
  ping();
  timer = setInterval(ping, INTERVAL_MS);
  if (!visibilityBound && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    visibilityBound = true;
  }
}

export function stopCloudPresence(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (visibilityBound && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility);
    visibilityBound = false;
  }
}