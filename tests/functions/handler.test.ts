// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createFakeSupabase } from '../../dev/fake-supabase.mjs';
import { handleStudyRoom } from '../../functions/handler.mjs';

const USER_ID = 'fixture-user';
const OTHER_USER_ID = 'other-user';
const BASE_TIME = '2026-10-24T05:00:00.000Z';

const profile = () => ({ nickname: '小明', avatar: '', joinedAt: '2026-10-24' });

const emptyState = () => ({
  checkins: [],
  plans: [],
  docs: [],
  todos: [],
  focus_sessions: [],
});

function userContext(overrides = {}) {
  return Buffer.from(
    JSON.stringify({
      user_id: USER_ID,
      name: '测试同学',
      picture: '',
      site_id: 'fixture',
      host_id: 'fixture',
      session_expires_at: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    }),
  ).toString('base64url');
}

function makeRequest(action, options: any = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.context !== null) {
    headers.set('x-qoder-user-context', options.context ?? userContext());
  }
  if (options.body !== undefined && options.contentType !== null) {
    headers.set('content-type', options.contentType ?? 'application/json');
  }
  return new Request(`http://local/functions/v1/app?action=${action}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
}

async function call(supabase, action, options: any = {}) {
  const response = await handleStudyRoom({
    request: makeRequest(action, options),
    supabase,
  });
  const body = await response.json();
  return { response, body };
}

function putPayload(overrides: any = {}) {
  return JSON.stringify({
    profile: profile(),
    state: emptyState(),
    baseUpdatedAt: null,
    ...overrides,
  });
}

function seedRow(supabase, row = {}) {
  supabase.seed(USER_ID, {
    profile: profile(),
    state: emptyState(),
    updated_at: BASE_TIME,
    ...row,
  });
}

describe('study room function handler', () => {
  it('returns 401 when the user context is missing', async () => {
    const supabase = createFakeSupabase();
    const { response, body } = await call(supabase, 'bootstrap', {
      context: null,
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toEqual({ error: 'login_required' });
  });

  it('returns 403 when the user context is malformed', async () => {
    const supabase = createFakeSupabase();
    const { response, body } = await call(supabase, 'bootstrap', {
      context: 'not_base64!',
    });
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'invalid_user_context' });
  });

  it('returns 404 for unknown actions', async () => {
    const supabase = createFakeSupabase();
    const { response, body } = await call(supabase, 'delete');
    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'not_found' });
  });

  it('returns 405 with an allow header for wrong methods', async () => {
    const supabase = createFakeSupabase();
    const getState = await call(supabase, 'state', { method: 'GET' });
    expect(getState.response.status).toBe(405);
    expect(getState.response.headers.get('allow')).toBe('PUT');
    expect(getState.body).toEqual({ error: 'method_not_allowed' });

    const putBootstrap = await call(supabase, 'bootstrap', {
      method: 'PUT',
      body: '{}',
    });
    expect(putBootstrap.response.status).toBe(405);
    expect(putBootstrap.response.headers.get('allow')).toBe('GET');
    expect(putBootstrap.body).toEqual({ error: 'method_not_allowed' });
  });

  it('returns 415 for a non-JSON content type', async () => {
    const supabase = createFakeSupabase();
    const { response, body } = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload(),
      contentType: 'text/plain',
    });
    expect(response.status).toBe(415);
    expect(body).toEqual({ error: 'invalid_input' });
    expect(supabase.rows()).toHaveLength(0);
  });

  it('returns null data on the first bootstrap', async () => {
    const supabase = createFakeSupabase();
    const { response, body } = await call(supabase, 'bootstrap');
    expect(response.status).toBe(200);
    expect(body).toEqual({
      user: { id: USER_ID, name: '测试同学', picture: '' },
      profile: null,
      state: null,
      updatedAt: null,
    });
  });

  it('inserts on the first PUT and returns the server timestamp', async () => {
    const supabase = createFakeSupabase();
    const nextState = {
      ...emptyState(),
      todos: [{ id: 't1', title: '复习', completed: false }],
    };
    const { response, body } = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload({ state: nextState }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body.profile).toEqual(profile());
    expect(body.state).toEqual(nextState);
    expect(typeof body.updatedAt).toBe('string');

    const rows = supabase.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: USER_ID,
      profile: profile(),
      state: nextState,
      updated_at: body.updatedAt,
    });
  });

  it('preserves todo dates and drops malformed ones', async () => {
    const supabase = createFakeSupabase();
    const nextState = {
      ...emptyState(),
      todos: [
        {
          id: 't1',
          title: '复习',
          completed: false,
          date: '2026-10-23',
        },
        {
          id: 't2',
          title: '做题',
          completed: true,
          date: '2026-10-23',
          completedOn: '2026-10-24',
        },
        { id: 't3', title: '无日期', completed: false, date: '10/23' },
      ],
    };
    const { response, body } = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload({ state: nextState }),
    });

    expect(response.status).toBe(200);
    expect(body.state.todos).toEqual([
      nextState.todos[0],
      nextState.todos[1],
      { id: 't3', title: '无日期', completed: false },
    ]);
    expect(supabase.rows()[0].state.todos).toEqual(body.state.todos);
  });

  it('returns saved data on a later bootstrap', async () => {
    const supabase = createFakeSupabase();
    const nextState = {
      ...emptyState(),
      checkins: [{ date: '2026-10-24', hours: 2, mood: '专注' }],
    };
    const saved = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload({
        profile: { nickname: '小红', avatar: '', joinedAt: '2026-10-24' },
        state: nextState,
      }),
    });
    const bootstrapped = await call(supabase, 'bootstrap');
    expect(bootstrapped.response.status).toBe(200);
    expect(bootstrapped.body).toEqual({
      user: { id: USER_ID, name: '测试同学', picture: '' },
      profile: { nickname: '小红', avatar: '', joinedAt: '2026-10-24' },
      state: nextState,
      updatedAt: saved.body.updatedAt,
    });
  });

  it('updates when baseUpdatedAt matches the stored row', async () => {
    const supabase = createFakeSupabase();
    seedRow(supabase);
    const nextState = {
      ...emptyState(),
      docs: [
        { id: 'd1', title: '笔记', content: '内容', updatedAt: BASE_TIME },
      ],
    };
    const { response, body } = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload({
        profile: { nickname: '新昵称', avatar: '', joinedAt: '2026-10-24' },
        state: nextState,
        baseUpdatedAt: BASE_TIME,
      }),
    });
    expect(response.status).toBe(200);
    expect(body.profile.nickname).toBe('新昵称');
    expect(body.state).toEqual(nextState);
    expect(body.updatedAt).not.toBe(BASE_TIME);
    expect(supabase.rows()[0].state).toEqual(nextState);
    expect(supabase.rows()[0].updated_at).toBe(body.updatedAt);
  });

  it('accepts application/json with a charset parameter', async () => {
    const supabase = createFakeSupabase();
    const { response } = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload(),
      contentType: 'application/json; charset=utf-8',
    });
    expect(response.status).toBe(200);
  });

  it('returns 409 with the current row for a stale baseUpdatedAt', async () => {
    const supabase = createFakeSupabase();
    const cloudState = {
      ...emptyState(),
      todos: [{ id: 'cloud', title: '云端待办', completed: false }],
    };
    seedRow(supabase, { state: cloudState });

    const { response, body } = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload({
        state: {
          ...emptyState(),
          todos: [{ id: 'local', title: '本地待办', completed: false }],
        },
        baseUpdatedAt: '2026-10-23T00:00:00.000Z',
      }),
    });
    expect(response.status).toBe(409);
    expect(body.error).toBe('conflict');
    expect(body.current.state).toEqual(cloudState);
    expect(body.current.updatedAt).toBe(BASE_TIME);
    expect(supabase.rows()[0].state).toEqual(cloudState);
  });

  it('returns 409 when a first insert races with an existing row', async () => {
    const supabase = createFakeSupabase();
    const cloudState = {
      ...emptyState(),
      plans: [
        {
          id: 'p1',
          name: '云端计划',
          goal: '',
          tasks: [],
          createdAt: BASE_TIME,
        },
      ],
    };
    seedRow(supabase, { state: cloudState });

    const { response, body } = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload(),
    });
    expect(response.status).toBe(409);
    expect(body.error).toBe('conflict');
    expect(body.current.state).toEqual(cloudState);
    expect(supabase.rows()).toHaveLength(1);
  });

  it('ignores a forged user_id in the request body', async () => {
    const supabase = createFakeSupabase();
    const { response } = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload({ user_id: OTHER_USER_ID, owner_id: OTHER_USER_ID }),
    });
    expect(response.status).toBe(200);
    const rows = supabase.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(USER_ID);

    const other = await call(supabase, 'bootstrap', {
      context: userContext({ user_id: OTHER_USER_ID, name: '另一个人' }),
    });
    expect(other.body.profile).toBeNull();
    expect(other.body.state).toBeNull();
  });

  it('rejects invalid JSON and non-array state fields', async () => {
    const supabase = createFakeSupabase();
    const invalidJson = await call(supabase, 'state', {
      method: 'PUT',
      body: '{bad json',
    });
    expect(invalidJson.response.status).toBe(400);
    expect(invalidJson.body).toEqual({ error: 'invalid_input' });

    const nonArray = await call(supabase, 'state', {
      method: 'PUT',
      body: JSON.stringify({
        profile: profile(),
        state: { ...emptyState(), todos: {} },
        baseUpdatedAt: null,
      }),
    });
    expect(nonArray.response.status).toBe(400);
    expect(nonArray.body).toEqual({ error: 'invalid_input' });
    expect(supabase.rows()).toHaveLength(0);
  });

  it('rejects invalid or missing baseUpdatedAt values', async () => {
    const supabase = createFakeSupabase();
    for (const baseUpdatedAt of [
      'not-a-date',
      '2026-10-24',
      '',
      123,
      undefined,
    ]) {
      const { response, body } = await call(supabase, 'state', {
        method: 'PUT',
        body: putPayload({ baseUpdatedAt }),
      });
      expect(response.status).toBe(400);
      expect(body).toEqual({ error: 'invalid_input' });
    }
    expect(supabase.rows()).toHaveLength(0);
  });

  it('rejects invalid profile fields', async () => {
    const supabase = createFakeSupabase();
    const invalidProfiles = [
      {},
      { nickname: 'a'.repeat(65), avatar: '', joinedAt: '2026-10-24' },
      { nickname: 'ok', avatar: 'http://example.com/a.png', joinedAt: '' },
      { nickname: 'ok', avatar: 'javascript:alert(1)', joinedAt: '' },
      { nickname: 'ok', avatar: '', joinedAt: '2026/10/24' },
      {
        nickname: 'ok',
        avatar: `data:image/png;base64,${'a'.repeat(200001)}`,
        joinedAt: '',
      },
    ];
    for (const invalid of invalidProfiles) {
      const { response, body } = await call(supabase, 'state', {
        method: 'PUT',
        body: putPayload({ profile: invalid }),
      });
      expect(response.status).toBe(400);
      expect(body).toEqual({ error: 'invalid_input' });
    }
    expect(supabase.rows()).toHaveLength(0);
  });

  it('accepts empty, https and data:image avatars', async () => {
    for (const avatar of [
      '',
      'https://example.com/avatar.png',
      'data:image/png;base64,AAAA',
    ]) {
      const supabase = createFakeSupabase();
      const { response } = await call(supabase, 'state', {
        method: 'PUT',
        body: putPayload({
          profile: { nickname: '小明', avatar, joinedAt: '' },
        }),
      });
      expect(response.status).toBe(200);
    }
  });

  it('rejects malformed state items and over-long moods', async () => {
    const supabase = createFakeSupabase();
    const invalidStates = [
      { ...emptyState(), checkins: [{ date: '2026-10-24', hours: '1' }] },
      {
        ...emptyState(),
        checkins: [{ date: '2026-10-24', hours: 1, mood: 'm'.repeat(51) }],
      },
      {
        ...emptyState(),
        plans: [
          {
            id: 'p1',
            name: '计划',
            goal: '',
            tasks: [{ id: 't1', title: '任务', done: 'yes' }],
            createdAt: BASE_TIME,
          },
        ],
      },
      {
        ...emptyState(),
        docs: [{ id: 'd1', title: '文档', content: 1, updatedAt: BASE_TIME }],
      },
      {
        ...emptyState(),
        todos: [{ id: 't1', title: '待办', completed: 'no' }],
      },
      {
        ...emptyState(),
        focus_sessions: [
          { minutes: '25', sessionId: 's1', createdAt: BASE_TIME },
        ],
      },
    ];
    for (const state of invalidStates) {
      const { response, body } = await call(supabase, 'state', {
        method: 'PUT',
        body: putPayload({ state }),
      });
      expect(response.status).toBe(400);
      expect(body).toEqual({ error: 'invalid_input' });
    }
    expect(supabase.rows()).toHaveLength(0);
  });

  it('accepts a mood of exactly 50 characters', async () => {
    const supabase = createFakeSupabase();
    const state = {
      ...emptyState(),
      checkins: [{ date: '2026-10-24', hours: 1, mood: 'm'.repeat(50) }],
    };
    const { response } = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload({ state }),
    });
    expect(response.status).toBe(200);
    expect(supabase.rows()[0].state).toEqual(state);
  });

  it('returns 413 and does not write when the body exceeds 1 MiB', async () => {
    const supabase = createFakeSupabase();
    const payload = JSON.stringify({
      profile: profile(),
      state: {
        ...emptyState(),
        docs: [
          {
            id: 'd1',
            title: 'x'.repeat(1024 * 1024),
            content: '',
            updatedAt: BASE_TIME,
          },
        ],
      },
      baseUpdatedAt: null,
    });
    expect(new TextEncoder().encode(payload).length).toBeGreaterThan(
      1024 * 1024,
    );
    const { response, body } = await call(supabase, 'state', {
      method: 'PUT',
      body: payload,
    });
    expect(response.status).toBe(413);
    expect(body).toEqual({ error: 'invalid_input' });
    expect(supabase.rows()).toHaveLength(0);
  });

  describe('array count limits', () => {
    const limits = {
      checkins: 4000,
      plans: 500,
      docs: 500,
      todos: 2000,
      focus_sessions: 20000,
    };
    const minimalItem = {
      checkins: { date: '', hours: 0 },
      plans: { id: '', name: '', goal: '', tasks: [], createdAt: '' },
      docs: { id: '', title: '', content: '', updatedAt: '' },
      todos: { id: '', title: '', completed: false },
      focus_sessions: { minutes: 0, sessionId: '', createdAt: '' },
    };

    it.each(Object.entries(limits))(
      'rejects %s above its limit',
      async (key, limit) => {
        const supabase = createFakeSupabase();
        const state = {
          ...emptyState(),
          [key]: Array.from({ length: limit + 1 }, () => minimalItem[key]),
        };
        const payload = putPayload({ state });
        expect(new TextEncoder().encode(payload).length).toBeLessThan(
          1024 * 1024,
        );
        const { response, body } = await call(supabase, 'state', {
          method: 'PUT',
          body: payload,
        });
        expect(response.status).toBe(400);
        expect(body).toEqual({ error: 'invalid_input' });
        expect(supabase.rows()).toHaveLength(0);
      },
    );
  });

  it('accepts checkins exactly at the limit', async () => {
    const supabase = createFakeSupabase();
    const state = {
      ...emptyState(),
      checkins: Array.from({ length: 4000 }, () => ({
        date: '',
        hours: 0,
      })),
    };
    const { response } = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload({ state }),
    });
    expect(response.status).toBe(200);
  });

  it('maps database read errors to state_unavailable without raw details', async () => {
    const query = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      insert() {
        return this;
      },
      update() {
        return this;
      },
      maybeSingle() {
        return Promise.resolve({ data: null, error: { code: 'XX000' } });
      },
      single() {
        return Promise.resolve({ data: null, error: { code: 'XX000' } });
      },
    };
    const supabase = { from: () => query };
    const { response, body } = await call(supabase, 'bootstrap');
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'state_unavailable' });
    expect(JSON.stringify(body)).not.toContain('XX000');
  });

  it('maps database write errors to write_result_unknown', async () => {
    const query = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      insert() {
        return this;
      },
      update() {
        return this;
      },
      maybeSingle() {
        return Promise.resolve({ data: null, error: { code: 'XX000' } });
      },
      single() {
        return Promise.resolve({ data: null, error: { code: 'XX000' } });
      },
    };
    const supabase = { from: () => query };
    const { response, body } = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload(),
    });
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'write_result_unknown' });
  });

  it('maps unexpected exceptions to fixed 503 codes', async () => {
    const supabase = {
      from() {
        throw new Error('provider secret detail');
      },
    };
    const read = await call(supabase, 'bootstrap');
    expect(read.response.status).toBe(503);
    expect(read.body).toEqual({ error: 'state_unavailable' });

    const write = await call(supabase, 'state', {
      method: 'PUT',
      body: putPayload(),
    });
    expect(write.response.status).toBe(503);
    expect(write.body).toEqual({ error: 'write_result_unknown' });
    expect(JSON.stringify(write.body)).not.toContain('provider secret detail');
  });
});
