import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  calcStreak,
  dateKeyOf,
  isDateKey,
  isTodoVisibleOn,
  todoDateFromId,
  todayKey,
} from '../study-room-store';
import { asStudyRoomScene, STUDY_ROOM_DEFAULT_SCENE } from '../study-room-scene';

describe('study room date helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats local dates as YYYY-MM-DD', () => {
    expect(dateKeyOf(new Date(2026, 9, 24))).toBe('2026-10-24');
  });

  it('counts a streak including today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 12));
    expect(todayKey()).toBe('2026-10-24');
    const dates = new Set(['2026-10-24', '2026-10-23', '2026-10-22']);
    expect(calcStreak(dates)).toBe(3);
  });

  it('starts from yesterday when today has no check-in', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 12));
    const dates = new Set(['2026-10-23', '2026-10-22']);
    expect(calcStreak(dates)).toBe(2);
  });

  it('falls back to the default scene for unknown values', () => {
    expect(asStudyRoomScene('unknown')).toBe(STUDY_ROOM_DEFAULT_SCENE);
    expect(asStudyRoomScene('snow')).toBe('snow');
  });

  it('supports all nine scene backgrounds', () => {
    for (const scene of [
      'rain',
      'snow',
      'cloud',
      'starry',
      'coast',
      'dawn',
      'summer',
      'pool',
      'wheat',
    ]) {
      expect(asStudyRoomScene(scene)).toBe(scene);
    }
  });
});

describe('study room todo dates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recognizes only real local date keys', () => {
    expect(isDateKey('2026-10-24')).toBe(true);
    expect(isDateKey('2026-02-31')).toBe(false);
    expect(isDateKey('2026-2-4')).toBe(false);
    expect(isDateKey('')).toBe(false);
    expect(isDateKey(undefined)).toBe(false);
  });

  it('infers the created day from a todo timestamp id', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 23, 23, 30));
    expect(todoDateFromId(`todo-${Date.now()}-abc`)).toBe('2026-10-23');
    expect(todoDateFromId('todo-1')).toBeNull();
    expect(todoDateFromId('t1')).toBeNull();
  });

  it('shows today todos, carries unfinished older ones, hides finished old ones', () => {
    const day = '2026-10-24';
    expect(isTodoVisibleOn({ date: day, completed: false }, day)).toBe(true);
    expect(isTodoVisibleOn({ date: '2026-10-23', completed: false }, day)).toBe(
      true,
    );
    expect(isTodoVisibleOn({ date: '2026-10-23', completed: true }, day)).toBe(
      false,
    );
    expect(
      isTodoVisibleOn(
        { date: '2026-10-23', completed: true, completedOn: day },
        day,
      ),
    ).toBe(true);
    expect(isTodoVisibleOn({ date: '2026-10-25', completed: false }, day)).toBe(
      false,
    );
  });
});
