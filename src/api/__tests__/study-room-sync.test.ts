import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapStudyRoom,
  saveStudyRoom,
  SyncApiError,
} from '../study-room-sync';

const profile = {
  nickname: '测试同学',
  avatar: '',
  joinedAt: '2026-10-24',
};

const state = {
  checkins: [{ date: '2026-10-24', hours: 1 }],
  plans: [],
  docs: [],
  todos: [{ id: 'todo-1', title: '复习', completed: false }],
  focus_sessions: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function captureError(run: () => Promise<unknown>): Promise<SyncApiError> {
  try {
    await run();
  } catch (caught) {
    expect(caught).toBeInstanceOf(SyncApiError);
    return caught as SyncApiError;
  }
  throw new Error('expected SyncApiError');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bootstrapStudyRoom', () => {
  it('reads the bootstrap endpoint with same-origin credentials', async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        user: { id: 'u1', name: '测试同学', picture: 'https://img.example/a.png' },
        profile,
        state,
        updatedAt: '2026-10-24T05:00:00.000Z',
      }),
    );

    const data = await bootstrapStudyRoom();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/functions/v1/app?action=bootstrap',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'same-origin',
    });
    expect(data.user).toEqual({
      id: 'u1',
      name: '测试同学',
      picture: 'https://img.example/a.png',
    });
    expect(data.state?.todos).toHaveLength(1);
    expect(data.updatedAt).toBe('2026-10-24T05:00:00.000Z');
  });

  it('accepts an empty cloud row', async () => {
    stubFetch(
      jsonResponse({
        user: { id: 'u1', name: '测试同学', picture: '' },
        profile: null,
        state: null,
        updatedAt: null,
      }),
    );

    const data = await bootstrapStudyRoom();
    expect(data.profile).toBeNull();
    expect(data.state).toBeNull();
    expect(data.updatedAt).toBeNull();
  });

  it('keeps valid todo dates and drops malformed ones', async () => {
    stubFetch(
      jsonResponse({
        user: { id: 'u1', name: '测试同学', picture: '' },
        profile,
        state: {
          ...state,
          todos: [
            {
              id: 't1',
              title: '复习',
              completed: true,
              date: '2026-10-23',
              completedOn: '2026-10-24',
            },
            { id: 't2', title: '做题', completed: false, date: '10/23' },
          ],
        },
        updatedAt: '2026-10-24T05:00:00.000Z',
      }),
    );

    const data = await bootstrapStudyRoom();
    expect(data.state?.todos).toEqual([
      {
        id: 't1',
        title: '复习',
        completed: true,
        date: '2026-10-23',
        completedOn: '2026-10-24',
      },
      { id: 't2', title: '做题', completed: false },
    ]);
  });

  it('maps 401 to login_required', async () => {
    stubFetch(jsonResponse({ error: 'login_required' }, 401));

    const error = await captureError(() => bootstrapStudyRoom());
    expect(error.code).toBe('login_required');
    expect(error.status).toBe(401);
  });

  it('maps 403 to invalid_user_context', async () => {
    stubFetch(jsonResponse({ error: 'invalid_user_context' }, 403));

    const error = await captureError(() => bootstrapStudyRoom());
    expect(error.code).toBe('invalid_user_context');
    expect(error.status).toBe(403);
  });

  it('rejects responses without a valid user', async () => {
    stubFetch(
      jsonResponse({
        user: { name: '缺少 id' },
        profile: null,
        state: null,
        updatedAt: null,
      }),
    );

    const error = await captureError(() => bootstrapStudyRoom());
    expect(error.code).toBe('invalid_response');
  });

  it('rejects non-json success responses', async () => {
    stubFetch(new Response('<html>oops</html>', { status: 200 }));

    const error = await captureError(() => bootstrapStudyRoom());
    expect(error.code).toBe('invalid_response');
  });
});

describe('saveStudyRoom', () => {
  it('submits profile, state and baseUpdatedAt', async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        profile,
        state,
        updatedAt: '2026-10-24T06:00:00.000Z',
      }),
    );

    const saved = await saveStudyRoom({
      profile,
      state,
      baseUpdatedAt: '2026-10-24T05:00:00.000Z',
    });

    expect(saved.updatedAt).toBe('2026-10-24T06:00:00.000Z');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/functions/v1/app?action=state');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(String(init.body))).toMatchObject({
      baseUpdatedAt: '2026-10-24T05:00:00.000Z',
      profile,
      state,
    });
  });

  it('parses the current snapshot from a 409', async () => {
    stubFetch(
      jsonResponse(
        {
          error: 'conflict',
          current: {
            profile,
            state,
            updatedAt: '2026-10-24T07:00:00.000Z',
          },
        },
        409,
      ),
    );

    const error = await captureError(() =>
      saveStudyRoom({ profile, state, baseUpdatedAt: null }),
    );
    expect(error.code).toBe('conflict');
    expect(error.status).toBe(409);
    expect(error.current?.updatedAt).toBe('2026-10-24T07:00:00.000Z');
    expect(error.current?.state.todos[0]?.id).toBe('todo-1');
  });

  it('maps network failures to network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    const error = await captureError(() =>
      saveStudyRoom({ profile, state, baseUpdatedAt: null }),
    );
    expect(error.code).toBe('network_error');
    expect(error.status).toBe(0);
  });

  it('maps 503 to service_unavailable', async () => {
    stubFetch(jsonResponse({ error: 'write_result_unknown' }, 503));

    const error = await captureError(() =>
      saveStudyRoom({ profile, state, baseUpdatedAt: null }),
    );
    expect(error.code).toBe('service_unavailable');
    expect(error.status).toBe(503);
  });

  it('maps an oversized payload rejection to invalid_input', async () => {
    stubFetch(jsonResponse({ error: 'invalid_input' }, 413));

    const error = await captureError(() =>
      saveStudyRoom({ profile, state, baseUpdatedAt: null }),
    );
    expect(error.code).toBe('invalid_input');
    expect(error.status).toBe(413);
  });

  it('does not call fetch for an invalid base timestamp', async () => {
    const fetchMock = stubFetch(jsonResponse({}));

    const error = await captureError(() =>
      saveStudyRoom({ profile, state, baseUpdatedAt: 'not-a-time' }),
    );
    expect(error.code).toBe('invalid_input');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
