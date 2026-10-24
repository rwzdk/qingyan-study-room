import type { AccountInfo } from '#/api/study-room-sync';
import { scheduleSaveStudyRoom } from '#/views/studyRoom/study-room-state-store';

import {
  DEFAULT_NICKNAME,
  NICKNAME_MAX_BYTES,
  isValidJoinedAt,
  profile,
  profilePayload,
  sanitizeAvatar,
  sanitizeNickname,
  setProfile,
  todayKey,
  truncateUtf8,
  utf8ByteLength,
  type LocalProfile,
} from './profile-state';

export type LocalUserProfile = LocalProfile;

export { profilePayload, sanitizeAvatar };

export function useLocalUser() {
  return { profile };
}

/**
 * 资料不再写 localStorage；修改后进入云端同步队列。
 * 昵称超过 64 UTF-8 bytes 时抛出错误，由调用方提示用户。
 */
export function saveLocalUser(patch: Partial<LocalUserProfile>): void {
  if (patch.nickname !== undefined) {
    const nickname = patch.nickname.trim();
    if (utf8ByteLength(nickname) > NICKNAME_MAX_BYTES) {
      throw new Error('昵称过长，最多 64 个 UTF-8 字节');
    }
  }

  const nextNickname =
    patch.nickname !== undefined
      ? sanitizeNickname(patch.nickname, DEFAULT_NICKNAME)
      : sanitizeNickname(profile.nickname, DEFAULT_NICKNAME);
  const nextAvatar =
    patch.avatar !== undefined
      ? sanitizeAvatar(patch.avatar)
      : sanitizeAvatar(profile.avatar);
  const nextJoinedAt = isValidJoinedAt(patch.joinedAt)
    ? patch.joinedAt
    : profile.joinedAt;

  setProfile({
    nickname: nextNickname,
    avatar: nextAvatar,
    joinedAt: nextJoinedAt,
  });
  scheduleSaveStudyRoom();
}

/**
 * 登录成功后用 Qoder 资料补齐空白项，不覆盖用户自己设置的内容。
 */
export function applyQoderUser(user: AccountInfo): void {
  const nicknameFallback =
    !profile.nickname.trim() || profile.nickname.trim() === DEFAULT_NICKNAME;
  const qoderName = sanitizeNickname(user.name, '');
  if (nicknameFallback && qoderName) {
    profile.nickname = truncateUtf8(qoderName, NICKNAME_MAX_BYTES);
  }

  if (!sanitizeAvatar(profile.avatar) && /^https:\/\//i.test(user.picture)) {
    profile.avatar = user.picture;
  }

  if (!isValidJoinedAt(profile.joinedAt)) {
    profile.joinedAt = todayKey();
  }
}

/** 补一次资料 payload，方便调用方交给 API 前做最终校验。 */
export function localUserPayload(): LocalProfile {
  return profilePayload();
}

async function loadImageSource(
  file: File,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('无法读取图片'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const source = await loadImageSource(file);
  const sourceWidth =
    source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const sourceHeight =
    source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法处理图片');
  const scale = Math.max(size / sourceWidth, size / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  ctx.drawImage(source, (size - width) / 2, (size - height) / 2, width, height);
  if (!(source instanceof HTMLImageElement)) source.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
