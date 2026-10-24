import { reactive } from 'vue';

import defaultAvatar from '#/assets/defaultUserAvatar.png';

export interface LocalProfile {
  nickname: string;
  avatar: string;
  joinedAt: string;
}

export const DEFAULT_NICKNAME = '学习者';
export const NICKNAME_MAX_BYTES = 64;
export const AVATAR_MAX_CHARS = 200_000;

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** 按 UTF-8 字节数截断，保证不会切断代理对。 */
export function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  for (const char of value) {
    const size = utf8ByteLength(char);
    if (bytes + size > maxBytes) break;
    bytes += size;
    result += char;
  }
  return result;
}

export function isValidJoinedAt(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/**
 * 云端只接受空、https:// 或 data:image/ 头像。
 * 本机默认头像资源路径（/assets/...、/src/assets/...）和其他值统一转为空，
 * 由界面回退到 Qoder 头像或内置头像。
 */
export function sanitizeAvatar(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > AVATAR_MAX_CHARS) return '';
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('https://')) return trimmed;
  if (lower.startsWith('data:image/')) return trimmed;
  return '';
}

export function sanitizeNickname(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return truncateUtf8(trimmed, NICKNAME_MAX_BYTES);
}

export const profile = reactive<LocalProfile>({
  nickname: DEFAULT_NICKNAME,
  avatar: defaultAvatar,
  joinedAt: todayKey(),
});

export function setProfile(next: Partial<LocalProfile>): void {
  profile.nickname = sanitizeNickname(next.nickname, '');
  // 空或本机默认头像路径都保持为空，由界面回退到 Qoder 头像/内置头像。
  profile.avatar =
    next.avatar === undefined
      ? sanitizeAvatar(profile.avatar)
      : sanitizeAvatar(next.avatar);
  profile.joinedAt = isValidJoinedAt(next.joinedAt)
    ? next.joinedAt
    : isValidJoinedAt(profile.joinedAt)
      ? profile.joinedAt
      : todayKey();
}

export function resetProfile(): void {
  profile.nickname = DEFAULT_NICKNAME;
  profile.avatar = defaultAvatar;
  profile.joinedAt = todayKey();
}

/** 提交给云端的资料：头像保证不会出现本机资源路径或非法协议。 */
export function profilePayload(): LocalProfile {
  return {
    nickname: sanitizeNickname(profile.nickname, DEFAULT_NICKNAME),
    avatar: sanitizeAvatar(profile.avatar),
    joinedAt: isValidJoinedAt(profile.joinedAt) ? profile.joinedAt : todayKey(),
  };
}
