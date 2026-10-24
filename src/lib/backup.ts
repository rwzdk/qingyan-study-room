import { asStudyRoomScene, STUDY_ROOM_SCENE_STORAGE_KEY } from '#/views/studyRoom/study-room-scene';
import {
  exportStudyRoomState,
  flushStudyRoom,
  importStudyRoomState,
  isStudyRoomSyncPending,
} from '#/views/studyRoom/study-room-state-store';
import { saveLocalUser, useLocalUser } from './local-user';

export const BACKUP_VERSION = 1;

export function exportBackup(): string {
  const { profile } = useLocalUser();
  return JSON.stringify(
    {
      version: BACKUP_VERSION,
      state: JSON.parse(exportStudyRoomState()),
      profile: {
        nickname: profile.nickname,
        avatar: profile.avatar,
        joinedAt: profile.joinedAt,
      },
      scene: asStudyRoomScene(
        window.localStorage.getItem(STUDY_ROOM_SCENE_STORAGE_KEY),
      ),
    },
    null,
    2,
  );
}

/**
 * 导入后必须等云端保存结束才允许刷新页面：
 * 调用方应 await 本函数；同步未完成时抛错，缓存中的 pending 会保留。
 */
export async function importBackup(raw: string): Promise<void> {
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { version?: unknown }).version !== BACKUP_VERSION
  ) {
    throw new Error('文件格式不正确');
  }
  const data = parsed as {
    state?: unknown;
    profile?: { nickname?: unknown; avatar?: unknown };
    scene?: unknown;
  };
  if (!data.state) throw new Error('文件格式不正确');

  importStudyRoomState(JSON.stringify(data.state));

  const { profile } = useLocalUser();
  const nickname =
    typeof data.profile?.nickname === 'string' && data.profile.nickname.trim()
      ? data.profile.nickname.trim()
      : profile.nickname;
  const avatar =
    typeof data.profile?.avatar === 'string' && data.profile.avatar
      ? data.profile.avatar
      : profile.avatar;
  saveLocalUser({ nickname, avatar });

  window.localStorage.setItem(
    STUDY_ROOM_SCENE_STORAGE_KEY,
    asStudyRoomScene(data.scene),
  );

  await flushStudyRoom();
  if (isStudyRoomSyncPending()) {
    throw new Error('数据已导入本机，但云端同步未完成，请保持网络连接后重试');
  }
}
