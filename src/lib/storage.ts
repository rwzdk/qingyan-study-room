export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const PROBE_KEY = 'qingyan-study-room:storage-probe';

/** 浏览器是否允许写入本地存储（无痕模式、内嵌预览窗口等环境会拒绝写入）。 */
export function canWriteLocalStorage(): boolean {
  try {
    window.localStorage.setItem(PROBE_KEY, '1');
    window.localStorage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}
