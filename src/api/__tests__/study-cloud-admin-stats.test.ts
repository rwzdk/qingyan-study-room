import { afterEach, describe, expect, it, vi } from 'vitest';

import { cachedAdminStats, cloudAdminStats } from '../study-cloud';

const statsPayload = {
  now: '2026-10-30T10:00:00.000Z',
  runtime: {
    colo: 'LAX',
    onlineWindowMinutes: 5,
    stateBytes: 1024,
    lastStateAt: null,
  },
  users: { total: 5, today: 1, week: 2 },
  sessions: { active: 6, online: 2 },
  state: { rows: 5, today: 1 },
  chat: { messages: 30, authorsToday: 2 },
  activity: [{ date: '2026-10-30', logins: 3, users: 2, registrations: 1 }],
  locations: [],
  recentLogins: [],
  online: [],
  recent: [],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloudAdminStats', () => {
  it('只重试一次，不把慢连接乘成四次六秒', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(jsonResponse(statsPayload));
    vi.stubGlobal('fetch', fetchMock);

    // 统计请求最多两次尝试：第三次不再等待，避免 6s×4 的等待叠加。
    await expect(cloudAdminStats('token-1')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('成功后留下快照，失败时不覆盖上一次的数据', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(statsPayload)));
    await cloudAdminStats('token-1');
    expect(cachedAdminStats()).toMatchObject({ users: { total: 5 } });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(cloudAdminStats('token-1')).rejects.toThrow();
    expect(cachedAdminStats()).toMatchObject({ users: { total: 5 } });
  });
});
