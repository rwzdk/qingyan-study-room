/**
 * 自习室扩展模块（小岛/计划/阅读/主页）的共享工具。
 * 数据由本地状态层（study-room-state-store）持久化。
 */

import type { StudyRoomCheckin } from './study-room-types';

export type { StudyRoomCheckin } from './study-room-types';

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 计算连续活跃天数（从今天往回数） */
export function calcStreak(dates: Set<string>): number {
  let streak = 0;
  const now = new Date();
  // 若今天未活跃，从昨天开始数
  if (!dates.has(todayKey())) {
    now.setDate(now.getDate() - 1);
  }
  while (true) {
    if (dates.has(dateKeyOf(now))) {
      streak += 1;
      now.setDate(now.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/** 生成某一年每一天的 key 列表 */
export function daysOfYear(year: number): string[] {
  const result: string[] = [];
  const d = new Date(year, 0, 1);
  while (d.getFullYear() === year) {
    result.push(dateKeyOf(d));
    d.setDate(d.getDate() + 1);
  }
  return result;
}
