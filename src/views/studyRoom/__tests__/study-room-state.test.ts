import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapSession,
  logoutLocal,
  migrationNeeded,
  resolveMigration,
} from '#/session/session-gate';
import {
  clearSession,
  locked,
  sessionStatus,
} from '#/session/session-state';
import { importBackup } from '#/lib/backup';
import { sanitizeAvatar, saveLocalUser, useLocalUser } from '#/lib/local-user';

import type { StudyRoomState } from '../study-room-types';
import {
  archiveLegacyLocalData,
  exportStudyRoomState,
  flushStudyRoom,
  hasLegacyLocalData,
  hydrateStudyRoom,
  importStudyRoomState,
  isStudyRoomSyncPending,
  loadStudyRoomState,
  migrationDecisionKey,
  readLegacyLocalData,
  readMigrationDecision,
  readStudyRoomCache,
  resetForLogout,
  resolveConflictKeepLocal,
  resolveConflictUseCloud,
  retrySync,
  scheduleSaveStudyRoom,
  useStudyRoomState,
  writeMigrationDecision,
} from '../study-room-state-store';

const CACHE_KEY = 'qingyan-study-room:cache:v1';
const LEGACY_STATE_KEY = 'qingyan-study-room:state:v1';
const LEGACY_PROFILE_KEY = 'qingyan-study-room:profile:v1';
const LEGACY_BACKUP_KEY = 'qingyan-study-room:legacy-backup:v1:u1';
const POMODORO_KEY = 'qingyan-study-room:pomodoro:v1';

const PROFILE = {
  nickname: '测试同学',
  avatar: '',
  joinedAt: '2026-10-24',
};

const USER = {
  id: 'u1',
  name: '测试同学',
  picture: 'https://img.example/u1.png',
};

function makeState(overrides: Partial<StudyRoomState> = {}): StudyRoomState {
  return {
    checkins: [],
    plans: [],
    docs: [],
    todos: [],
    focus_sessions: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bootstrapResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    user: USER,
    profile: null,
    state: null,
    updatedAt: null,
    ...overrides,
  });
}

function savedResponse(state: StudyRoomState, updatedAt = '2026-10-24T06:00:00.000Z'): Response {
  return jsonResponse({ profile: PROFILE, state, updatedAt });
}

function conflictResponse(
  state: StudyRoomState,
  updatedAt = '2026-10-24T09:00:00.000Z',
): Response {
  return jsonResponse(
    {
      error: 'conflict',
      current: { profile: PROFILE, state, updatedAt },
    },
    409,
  );
}

type FetchStep = Response | Error | (() => Promise<Response>);

function stubSequence(steps: FetchStep[]) {
  const queue = [...steps];
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const step = queue.shift();
      if (!step) return Promise.reject(new Error('unexpected fetch'));
      if (step instanceof Error) return Promise.reject(step);
      if (typeof step === 'function') return step();
      return Promise.resolve(step);
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function hydrate(
  overrides: Partial<Parameters<typeof hydrateStudyRoom>[0]> = {},
): void {
  hydrateStudyRoom({
    userId: 'u1',
    profile: PROFILE,
    state: makeState(),
    updatedAt: '2026-10-24T05:00:00.000Z',
    pending: false,
    ...overrides,
  });
}

function seedCache(overrides: Record<string, unknown> = {}): void {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      userId: 'u1',
      profile: PROFILE,
      state: makeState(),
      updatedAt: '2026-10-24T05:00:00.000Z',
      pending: false,
      baseUpdatedAt: '2026-10-24T05:00:00.000Z',
      ...overrides,
    }),
  );
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  resetForLogout();
  clearSession('unauthenticated');
  locked.value = false;
  migrationNeeded.value = false;
  vi.unstubAllGlobals();
});

afterEach(() => {
  resetForLogout();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('loadStudyRoomState', () => {
  it('returns the current state without any network request', async () => {
    const fetchMock = stubSequence([]);
    hydrate({ state: makeState({ todos: [{ id: 't1', title: '复习', completed: false }] }) });

    const loaded = await loadStudyRoomState();

    expect(loaded.todos).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('hydrate and save', () => {
  it('hydrates refs and writes a non-pending cache', () => {
    hydrate({ state: makeState({ docs: [{ id: 'd1', title: '笔记', content: '', updatedAt: '2026-10-24' }] }) });

    const { state, loaded, syncStatus, userId, updatedAt } = useStudyRoomState();
    expect(loaded.value).toBe(true);
    expect(syncStatus.value).toBe('synced');
    expect(userId.value).toBe('u1');
    expect(updatedAt.value).toBe('2026-10-24T05:00:00.000Z');
    expect(state.value.docs).toHaveLength(1);

    const cache = readStudyRoomCache();
    expect(cache).toMatchObject({
      userId: 'u1',
      pending: false,
      updatedAt: '2026-10-24T05:00:00.000Z',
      baseUpdatedAt: '2026-10-24T05:00:00.000Z',
    });
  });

  it('debounces saves and uses the last server timestamp as base', async () => {
    vi.useFakeTimers();
    const fetchMock = stubSequence([
      savedResponse(makeState({ checkins: [{ date: '2026-10-24', hours: 2 }] })),
    ]);
    hydrate();

    const { state, syncStatus } = useStudyRoomState();
    state.value.checkins = [{ date: '2026-10-24', hours: 2 }];
    scheduleSaveStudyRoom();

    const pendingCache = readStudyRoomCache();
    expect(pendingCache?.pending).toBe(true);
    expect(syncStatus.value).toBe('saving');

    await vi.advanceTimersByTimeAsync(800);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock).baseUpdatedAt).toBe('2026-10-24T05:00:00.000Z');
    expect(syncStatus.value).toBe('synced');
    expect(readStudyRoomCache()?.pending).toBe(false);
    expect(readStudyRoomCache()?.updatedAt).toBe('2026-10-24T06:00:00.000Z');
  });

  it('keeps only one request in flight and pushes the latest snapshot afterwards', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });
    vi.stubGlobal('fetch', fetchMock);
    hydrate();

    const { state, syncStatus } = useStudyRoomState();
    state.value.todos = [{ id: 't1', title: '第一版', completed: false }];
    scheduleSaveStudyRoom();
    const firstFlush = flushStudyRoom();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    state.value.todos = [
      { id: 't1', title: '第一版', completed: false },
      { id: 't2', title: '第二版', completed: true },
    ];
    scheduleSaveStudyRoom();
    const secondFlush = flushStudyRoom();

    first.resolve(
      savedResponse(
        makeState({ todos: [{ id: 't1', title: '第一版', completed: false }] }),
        '2026-10-24T06:00:00.000Z',
      ),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(fetchMock, 1).baseUpdatedAt).toBe('2026-10-24T06:00:00.000Z');
    expect(
      (bodyOf(fetchMock, 1).state as StudyRoomState).todos,
    ).toHaveLength(2);

    second.resolve(
      savedResponse(
        makeState({
          todos: [
            { id: 't1', title: '第一版', completed: false },
            { id: 't2', title: '第二版', completed: true },
          ],
        }),
        '2026-10-24T07:00:00.000Z',
      ),
    );
    await Promise.all([firstFlush, secondFlush]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(syncStatus.value).toBe('synced');
    expect(readStudyRoomCache()?.pending).toBe(false);
    expect(readStudyRoomCache()?.updatedAt).toBe('2026-10-24T07:00:00.000Z');
  });

  it('does not surface a conflict from a stale generation response', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });
    vi.stubGlobal('fetch', fetchMock);
    hydrate();

    const { state, syncStatus, conflict } = useStudyRoomState();
    state.value.todos = [{ id: 't1', title: '旧编辑', completed: false }];
    scheduleSaveStudyRoom();
    const firstFlush = flushStudyRoom();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    state.value.todos = [{ id: 't1', title: '新编辑', completed: true }];
    scheduleSaveStudyRoom();
    const secondFlush = flushStudyRoom();

    first.resolve(conflictResponse(makeState(), '2026-10-24T09:00:00.000Z'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(conflict.value).toBeNull();
    expect(syncStatus.value).toBe('saving');

    second.resolve(
      savedResponse(
        makeState({ todos: [{ id: 't1', title: '新编辑', completed: true }] }),
      ),
    );
    await Promise.all([firstFlush, secondFlush]);
    expect(conflict.value).toBeNull();
    expect(syncStatus.value).toBe('synced');
  });
});

describe('conflict handling', () => {
  it('stores the cloud snapshot and can replace local with cloud', async () => {
    const cloudState = makeState({
      todos: [{ id: 'cloud', title: '云端待办', completed: false }],
    });
    stubSequence([conflictResponse(cloudState)]);
    hydrate({ state: makeState({ todos: [{ id: 'local', title: '本地待办', completed: false }] }) });

    const { state, conflict, syncStatus } = useStudyRoomState();
    scheduleSaveStudyRoom();
    await flushStudyRoom();

    expect(conflict.value?.updatedAt).toBe('2026-10-24T09:00:00.000Z');
    expect(syncStatus.value).toBe('conflict');

    resolveConflictUseCloud();

    expect(conflict.value).toBeNull();
    expect(syncStatus.value).toBe('synced');
    expect(state.value.todos[0]?.id).toBe('cloud');
    expect(readStudyRoomCache()?.pending).toBe(false);
    expect(readStudyRoomCache()?.updatedAt).toBe('2026-10-24T09:00:00.000Z');
  });

  it('can keep local data by rebasing on the cloud updatedAt', async () => {
    const localState = makeState({
      todos: [{ id: 'local', title: '本地待办', completed: false }],
    });
    const fetchMock = stubSequence([
      conflictResponse(makeState()),
      savedResponse(localState, '2026-10-24T10:00:00.000Z'),
    ]);
    hydrate({ state: localState });

    scheduleSaveStudyRoom();
    await flushStudyRoom();
    expect(useStudyRoomState().conflict.value).not.toBeNull();

    await resolveConflictKeepLocal();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).baseUpdatedAt).toBe('2026-10-24T09:00:00.000Z');
    expect(useStudyRoomState().conflict.value).toBeNull();
    expect(useStudyRoomState().syncStatus.value).toBe('synced');
  });
});

describe('retrySync', () => {
  it('reconciles unknown outcomes before re-pushing', async () => {
    const localState = makeState({
      todos: [{ id: 't1', title: '待同步', completed: false }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('offline')),
    );
    hydrate({ state: localState });
    scheduleSaveStudyRoom();
    await flushStudyRoom();
    expect(useStudyRoomState().syncStatus.value).toBe('error');
    expect(readStudyRoomCache()?.pending).toBe(true);

    const fetchMock = stubSequence([
      bootstrapResponse({
        profile: PROFILE,
        state: makeState(),
        updatedAt: '2026-10-24T05:00:00.000Z',
      }),
      savedResponse(localState, '2026-10-24T06:00:00.000Z'),
    ]);

    await retrySync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/functions/v1/app?action=bootstrap',
    );
    expect(bodyOf(fetchMock, 1).baseUpdatedAt).toBe('2026-10-24T05:00:00.000Z');
    expect(useStudyRoomState().syncStatus.value).toBe('synced');
    expect(readStudyRoomCache()?.pending).toBe(false);
  });

  it('marks synced when the unknown write actually landed', async () => {
    const localState = makeState({
      todos: [{ id: 't1', title: '已写入', completed: false }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('offline')),
    );
    hydrate({ state: localState });
    scheduleSaveStudyRoom();
    await flushStudyRoom();

    const fetchMock = stubSequence([
      bootstrapResponse({
        profile: PROFILE,
        state: localState,
        updatedAt: '2026-10-24T08:00:00.000Z',
      }),
    ]);

    await retrySync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useStudyRoomState().syncStatus.value).toBe('synced');
    expect(useStudyRoomState().updatedAt.value).toBe('2026-10-24T08:00:00.000Z');
    expect(readStudyRoomCache()?.pending).toBe(false);
  });
});

describe('pending cache recovery', () => {
  it('automatically pushes a pending cache when the cloud is empty', async () => {
    seedCache({
      state: makeState({
        todos: [{ id: 'pending', title: '未同步', completed: false }],
      }),
      pending: true,
      updatedAt: '2026-10-24T05:00:00.000Z',
      baseUpdatedAt: '2026-10-24T05:00:00.000Z',
    });
    const fetchMock = stubSequence([
      bootstrapResponse(),
      savedResponse(
        makeState({ todos: [{ id: 'pending', title: '未同步', completed: false }] }),
      ),
    ]);

    await bootstrapSession();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).baseUpdatedAt).toBeNull();
    expect(sessionStatus.value).toBe('ready');
    expect(useStudyRoomState().syncStatus.value).toBe('synced');
    expect(readStudyRoomCache()?.pending).toBe(false);
  });

  it('auto re-pushes when the cached base matches the cloud updatedAt', async () => {
    const cachedState = makeState({
      checkins: [{ date: '2026-10-24', hours: 3 }],
    });
    seedCache({
      state: cachedState,
      pending: true,
      updatedAt: '2026-10-24T05:00:00.000Z',
      baseUpdatedAt: '2026-10-24T05:00:00.000Z',
    });
    const fetchMock = stubSequence([
      bootstrapResponse({
        profile: PROFILE,
        state: makeState(),
        updatedAt: '2026-10-24T05:00:00.000Z',
      }),
      savedResponse(cachedState),
    ]);

    await bootstrapSession();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).baseUpdatedAt).toBe('2026-10-24T05:00:00.000Z');
    expect(readStudyRoomCache()?.pending).toBe(false);
  });

  it('keeps pending data and shows a conflict when the cloud moved ahead', async () => {
    const cachedState = makeState({
      todos: [{ id: 'pending', title: '本地未同步', completed: false }],
    });
    const cloudState = makeState({
      todos: [{ id: 'cloud', title: '云端更新', completed: false }],
    });
    seedCache({
      state: cachedState,
      pending: true,
      updatedAt: '2026-10-24T05:00:00.000Z',
      baseUpdatedAt: '2026-10-24T05:00:00.000Z',
    });
    const fetchMock = stubSequence([
      bootstrapResponse({
        profile: PROFILE,
        state: cloudState,
        updatedAt: '2026-10-24T09:00:00.000Z',
      }),
    ]);

    await bootstrapSession();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useStudyRoomState().conflict.value?.state.todos[0]?.id).toBe('cloud');
    expect(useStudyRoomState().state.value.todos[0]?.id).toBe('pending');
    expect(isStudyRoomSyncPending()).toBe(true);
    expect(readStudyRoomCache()?.pending).toBe(true);
    expect(readStudyRoomCache()?.baseUpdatedAt).toBe(
      '2026-10-24T05:00:00.000Z',
    );
    expect(sessionStatus.value).toBe('ready');
  });
});

describe('auth failures while saving', () => {
  it('clears the session on 401 but keeps the pending cache', async () => {
    stubSequence([jsonResponse({ error: 'login_required' }, 401)]);
    hydrate();
    useStudyRoomState().state.value.todos = [
      { id: 't1', title: '待同步', completed: false },
    ];
    scheduleSaveStudyRoom();

    await flushStudyRoom();

    expect(sessionStatus.value).toBe('unauthenticated');
    expect(readStudyRoomCache()?.pending).toBe(true);
  });

  it('shows forbidden on 403', async () => {
    stubSequence([jsonResponse({ error: 'invalid_user_context' }, 403)]);
    hydrate();
    useStudyRoomState().state.value.todos = [
      { id: 't1', title: '待同步', completed: false },
    ];
    scheduleSaveStudyRoom();

    await flushStudyRoom();

    expect(sessionStatus.value).toBe('forbidden');
  });

  it('never sends a browser-supplied user id', async () => {
    const fetchMock = stubSequence([
      savedResponse(makeState()),
    ]);
    hydrate();

    await importStudyRoomState(
      JSON.stringify(makeState({ todos: [{ id: 't1', title: 'x', completed: false }] })),
    );
    await flushStudyRoom();

    const body = bodyOf(fetchMock);
    expect(body).not.toHaveProperty('user_id');
    expect(useStudyRoomState().userId.value).toBe('u1');
  });
});

describe('profile and avatar sanitization', () => {
  it('accepts only empty, https and data:image avatars', () => {
    expect(sanitizeAvatar('')).toBe('');
    expect(sanitizeAvatar('https://img.example/a.png')).toBe(
      'https://img.example/a.png',
    );
    expect(sanitizeAvatar('data:image/jpeg;base64,abc')).toBe(
      'data:image/jpeg;base64,abc',
    );
    expect(sanitizeAvatar('/src/assets/defaultUserAvatar.png')).toBe('');
    expect(sanitizeAvatar('/assets/defaultUserAvatar-abc.png')).toBe('');
    expect(sanitizeAvatar('javascript:alert(1)')).toBe('');
  });

  it('rejects nicknames longer than 64 UTF-8 bytes', () => {
    hydrate();
    expect(() => saveLocalUser({ nickname: '学'.repeat(22) })).toThrow(
      '昵称过长',
    );
    expect(() =>
      saveLocalUser({ nickname: `${'学'.repeat(21)}a` }),
    ).not.toThrow();
  });
});

describe('legacy data and migration', () => {
  function seedLegacy(): void {
    localStorage.setItem(
      LEGACY_STATE_KEY,
      JSON.stringify(
        makeState({
          checkins: [{ date: '2026-01-01', hours: 2 }],
          todos: [{ id: 'old', title: '旧待办', completed: true }],
        }),
      ),
    );
    localStorage.setItem(
      LEGACY_PROFILE_KEY,
      JSON.stringify({
        nickname: '旧同学',
        avatar: '/src/assets/defaultUserAvatar.png',
        joinedAt: '2026-01-02',
      }),
    );
  }

  it('reads and archives legacy keys only after writing a per-user backup', () => {
    seedLegacy();
    expect(hasLegacyLocalData()).toBe(true);
    const legacy = readLegacyLocalData();
    expect(legacy?.state.todos[0]?.id).toBe('old');
    expect(legacy?.profile.nickname).toBe('旧同学');
    expect(legacy?.profile.avatar).toBe('');

    expect(archiveLegacyLocalData('u1')).toBe(true);

    expect(localStorage.getItem(LEGACY_STATE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_PROFILE_KEY)).toBeNull();
    expect(hasLegacyLocalData()).toBe(false);
    const backup = JSON.parse(
      localStorage.getItem(LEGACY_BACKUP_KEY) ?? '{}',
    ) as { state?: { todos?: { id: string }[] }; profile?: { nickname: string } };
    expect(backup.state?.todos?.[0]?.id).toBe('old');
    expect(backup.profile?.nickname).toBe('旧同学');
  });

  it('isolates migration decisions by user id', () => {
    expect(migrationDecisionKey('u1')).not.toBe(migrationDecisionKey('u2'));
    writeMigrationDecision('u1', 'imported');
    expect(readMigrationDecision('u1')).toBe('imported');
    expect(readMigrationDecision('u2')).toBeNull();
  });

  it('imports legacy data through a first insert and archives it on success', async () => {
    seedLegacy();
    const importedState = readLegacyLocalData()!.state;
    const fetchMock = stubSequence([
      bootstrapResponse(),
      savedResponse(importedState, '2026-10-24T06:00:00.000Z'),
    ]);

    await bootstrapSession();
    expect(migrationNeeded.value).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await resolveMigration('import');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).baseUpdatedAt).toBeNull();
    expect(
      (bodyOf(fetchMock, 1).state as StudyRoomState).todos[0]?.id,
    ).toBe('old');
    expect(migrationNeeded.value).toBe(false);
    expect(readMigrationDecision('u1')).toBe('imported');
    expect(localStorage.getItem(LEGACY_STATE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_BACKUP_KEY)).toBeTruthy();
    expect(useStudyRoomState().state.value.todos[0]?.id).toBe('old');
  });
});

describe('import / export', () => {
  it('exports current state and imports it as a pending cloud write', async () => {
    hydrate();
    useStudyRoomState().state.value.todos = [
      { id: 't1', title: '导出', completed: false },
    ];
    const exported = exportStudyRoomState();

    const fetchMock = stubSequence([
      savedResponse(makeState({ todos: [{ id: 't1', title: '导出', completed: false }] })),
    ]);
    importStudyRoomState(exported);
    await flushStudyRoom();

    expect(bodyOf(fetchMock).baseUpdatedAt).toBe('2026-10-24T05:00:00.000Z');
    expect(
      (bodyOf(fetchMock).state as StudyRoomState).todos,
    ).toHaveLength(1);
    expect(useStudyRoomState().syncStatus.value).toBe('synced');
  });

  it('waits for the cloud save inside importBackup', async () => {
    hydrate();
    const imported = makeState({
      todos: [{ id: 'backup', title: '备份数据', completed: true }],
    });
    const fetchMock = stubSequence([savedResponse(imported)]);

    await importBackup(
      JSON.stringify({
        version: 1,
        state: imported,
        profile: PROFILE,
        scene: 'rain',
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (bodyOf(fetchMock).state as StudyRoomState).todos[0]?.id,
    ).toBe('backup');
    expect(readStudyRoomCache()?.pending).toBe(false);
    expect(useStudyRoomState().state.value.todos[0]?.id).toBe('backup');
  });
});

describe('logoutLocal', () => {
  it('clears cache, legacy keys, pomodoro data and profile', () => {
    seedCache({ pending: true });
    localStorage.setItem(LEGACY_STATE_KEY, JSON.stringify(makeState()));
    localStorage.setItem(LEGACY_PROFILE_KEY, JSON.stringify(PROFILE));
    localStorage.setItem(POMODORO_KEY, JSON.stringify({ remaining: 100 }));

    logoutLocal({ redirect: false });

    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_STATE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_PROFILE_KEY)).toBeNull();
    expect(localStorage.getItem(POMODORO_KEY)).toBeNull();
    expect(readStudyRoomCache()).toBeNull();
    expect(useStudyRoomState().userId.value).toBeNull();
    expect(useLocalUser().profile.nickname).toBe('学习者');
    expect(locked.value).toBe(true);
    expect(sessionStatus.value).toBe('unauthenticated');
  });
});
