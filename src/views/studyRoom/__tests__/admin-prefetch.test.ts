import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cachedAdminStats } from '#/api/study-cloud';
import { prefetchAdminStats } from '../admin-prefetch';

const SESSION_KEY = 'qingyan-study-room:cloud-session:v1';

const statsPayload = {
  now: '2026-10-30T10:00:00.000Z',
  runtime: {
    colo: 'LAX',
    region: '',
    city: '',
    country: '',
    timezone: 'Asia/Shanghai',
    onlineWindowMinutes: 5,
  },
  users: { total: 7, today: 1, week: 3, online: 2 },
  sessions: { active: 9, onlineSessions: 2 },
  storage: { rows: 5, bytes: 12345, updatedToday: 2, lastUpdatedAt: null },
  chat: { messages: 12, authorsToday: 1 },
  activity: [],
  locations: [],
  recentLogins: [],
  online: [],
  recent: [],
};

function seedSession(isAdmin: boolean): void {
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: 'token-1',
      userId: 'user-1',
      username: '管理员',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      isAdmin,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prefetchAdminStats', () => {
  it('非管理员与未登录都不发请求', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    prefetchAdminStats();
    seedSession(false);
    prefetchAdminStats();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('管理员空闲预取一次，结果进缓存且不重复拉', async () => {
    seedSession(true);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(statsPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    prefetchAdminStats();
    prefetchAdminStats();
    await vi.waitFor(() => expect(cachedAdminStats()).toMatchObject({ users: { total: 7 } }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    prefetchAdminStats();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
