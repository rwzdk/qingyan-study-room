import { afterEach, describe, expect, it, vi } from 'vitest';

import { calcStreak, dateKeyOf, todayKey } from '../study-room-store';
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
});
