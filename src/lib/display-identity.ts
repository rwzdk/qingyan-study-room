import { account } from '#/session/session-state';

import { currentUser } from './local-auth';
import { DEFAULT_NICKNAME, profile } from './profile-state';

/**
 * 界面统一显示的用户名。
 * 资料昵称（用户自己改过的）→ 本地账号用户名 → Qoder 账号昵称 → 默认名。
 * 各处都走这里，避免顶栏、资料弹窗、对话室各显示各的。
 */
export function displayNickname(): string {
  const profileName = profile.nickname.trim();
  if (profileName && profileName !== DEFAULT_NICKNAME) return profileName;
  return (
    currentUser.value?.username ||
    account.value?.name ||
    profileName ||
    DEFAULT_NICKNAME
  );
}

/** 界面统一显示的头像：自选头像 → Qoder 头像 → 内置默认头像。 */
export function displayAvatar(fallback: string): string {
  return profile.avatar || account.value?.picture || fallback;
}
