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

/** 校验本地日期 key，排除 2026-02-31 这类会被自动进位的值。 */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && dateKeyOf(parsed) === value;
}

/** 旧待办没有日期字段时，从 `todo-<13 位毫秒时间戳>-...` 的 id 反推创建日。 */
export function todoDateFromId(id: string): string | null {
  const stamp = Number(id.split('-')[1]);
  if (!Number.isFinite(stamp) || stamp < 1e12) return null;
  const date = new Date(stamp);
  return Number.isNaN(date.getTime()) ? null : dateKeyOf(date);
}

/** 今日列表：当天创建的待办 + 之前未完成而顺延的待办；旧任务完成当天仍然可见。 */
export function isTodoVisibleOn(
  todo: { date?: string; completed: boolean; completedOn?: string },
  day: string,
): boolean {
  if (todo.date === day) return true;
  if (!todo.completed) return !!todo.date && todo.date < day;
  return todo.completedOn === day;
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
