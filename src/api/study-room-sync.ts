import {
  isValidJoinedAt,
  sanitizeAvatar,
  truncateUtf8,
  NICKNAME_MAX_BYTES,
} from '#/lib/profile-state';
import type {
  StudyRoomCheckin,
  StudyRoomDoc,
  StudyRoomFocusSession,
  StudyRoomPlan,
  StudyRoomState,
  StudyRoomTodo,
} from '#/views/studyRoom/study-room-types';

export interface AccountInfo {
  id: string;
  name: string;
  picture: string;
}

export interface CloudProfile {
  nickname: string;
  avatar: string;
  joinedAt: string;
}

export interface CloudSnapshot {
  profile: CloudProfile;
  state: StudyRoomState;
  updatedAt: string;
}

export interface BootstrapData {
  user: AccountInfo;
  profile: CloudProfile | null;
  state: StudyRoomState | null;
  updatedAt: string | null;
}

export type SyncErrorCode =
  | 'login_required'
  | 'invalid_user_context'
  | 'conflict'
  | 'invalid_input'
  | 'invalid_response'
  | 'network_error'
  | 'service_unavailable'
  | 'request_failed';

export class SyncApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly current?: CloudSnapshot;

  constructor(
    code: string,
    status: number,
    message?: string,
    current?: CloudSnapshot,
  ) {
    super(message ?? defaultMessageFor(code));
    this.name = 'SyncApiError';
    this.code = code;
    this.status = status;
    this.current = current;
  }
}

function defaultMessageFor(code: string): string {
  switch (code) {
    case 'login_required':
      return '请先登录 Qoder 账号';
    case 'invalid_user_context':
      return '当前账号无权访问该站点';
    case 'conflict':
      return '云端数据已被其他设备更新';
    case 'invalid_input':
      return '提交的数据格式不正确';
    case 'invalid_response':
      return '云端返回的数据格式不正确';
    case 'network_error':
      return '网络异常，请稍后重试';
    case 'service_unavailable':
      return '云端服务暂时不可用';
    default:
      return '请求失败，请稍后重试';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

/** 比较两个服务端时间戳，容忍同一时刻的不同 ISO 表示。 */
export function isSameUpdatedAt(
  left: string | null,
  right: string | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return (
    !Number.isNaN(leftTime) &&
    !Number.isNaN(rightTime) &&
    leftTime === rightTime
  );
}

function isCheckin(value: unknown): value is StudyRoomCheckin {
  return (
    isRecord(value) &&
    typeof value.date === 'string' &&
    typeof value.hours === 'number'
  );
}

function isPlanTask(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.done === 'boolean'
  );
}

function isPlan(value: unknown): value is StudyRoomPlan {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.goal === 'string' &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isPlanTask)
  );
}

function isDoc(value: unknown): value is StudyRoomDoc {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.content === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isTodo(value: unknown): value is StudyRoomTodo {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.completed === 'boolean'
  );
}

function isFocusSession(value: unknown): value is StudyRoomFocusSession {
  return (
    isRecord(value) &&
    typeof value.minutes === 'number' &&
    typeof value.sessionId === 'string' &&
    typeof value.createdAt === 'string'
  );
}

function listOf<T>(candidate: unknown, guard: (item: unknown) => item is T): T[] {
  return Array.isArray(candidate) ? candidate.filter(guard) : [];
}

export function emptyStudyRoomState(): StudyRoomState {
  return {
    checkins: [],
    plans: [],
    docs: [],
    todos: [],
    focus_sessions: [],
  };
}

/** 页面/缓存/云端共用的状态归一化，丢弃非法条目而不是整页崩溃。 */
export function normalizeStudyRoomState(raw: unknown): StudyRoomState | null {
  if (!isRecord(raw)) return null;
  if (
    !Array.isArray(raw.checkins) ||
    !Array.isArray(raw.plans) ||
    !Array.isArray(raw.docs) ||
    !Array.isArray(raw.todos) ||
    !Array.isArray(raw.focus_sessions)
  ) {
    return null;
  }
  return {
    checkins: listOf(raw.checkins, isCheckin).map((item) => ({
      date: item.date,
      hours: item.hours,
      ...(typeof item.mood === 'string' ? { mood: item.mood } : {}),
    })),
    plans: listOf(raw.plans, isPlan).map((plan) => ({
      id: plan.id,
      name: plan.name,
      goal: plan.goal,
      createdAt: plan.createdAt,
      tasks: plan.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        done: task.done,
      })),
    })),
    docs: listOf(raw.docs, isDoc).map((doc) => ({
      id: doc.id,
      title: doc.title,
      content: doc.content,
      updatedAt: doc.updatedAt,
    })),
    todos: listOf(raw.todos, isTodo).map((todo) => ({
      id: todo.id,
      title: todo.title,
      completed: todo.completed,
    })),
    focus_sessions: listOf(raw.focus_sessions, isFocusSession).map((session) => ({
      minutes: session.minutes,
      sessionId: session.sessionId,
      createdAt: session.createdAt,
    })),
  };
}

export function hasStudyRoomStateArrays(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return [
    'checkins',
    'plans',
    'docs',
    'todos',
    'focus_sessions',
  ].every((key) => Array.isArray(raw[key]));
}

function parseAccount(raw: unknown): AccountInfo | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== 'string' ||
    !raw.id ||
    typeof raw.name !== 'string' ||
    typeof raw.picture !== 'string'
  ) {
    return null;
  }
  return { id: raw.id, name: raw.name, picture: raw.picture };
}

function parseCloudProfile(raw: unknown): CloudProfile | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.nickname !== 'string' ||
    typeof raw.avatar !== 'string' ||
    typeof raw.joinedAt !== 'string'
  ) {
    return null;
  }
  return {
    nickname: truncateUtf8(raw.nickname.trim(), NICKNAME_MAX_BYTES),
    avatar: sanitizeAvatar(raw.avatar),
    joinedAt: isValidJoinedAt(raw.joinedAt) ? raw.joinedAt : '',
  };
}

function parseCloudSnapshot(raw: unknown): CloudSnapshot | null {
  if (!isRecord(raw)) return null;
  const profile = parseCloudProfile(raw.profile);
  const state = normalizeStudyRoomState(raw.state);
  const updatedAt = isTimestamp(raw.updatedAt) ? raw.updatedAt : null;
  if (!profile || !state || !updatedAt) return null;
  return { profile, state, updatedAt };
}

function parseBootstrap(raw: unknown): BootstrapData {
  if (!isRecord(raw)) {
    throw new SyncApiError('invalid_response', 200);
  }
  const user = parseAccount(raw.user);
  if (!user) throw new SyncApiError('invalid_response', 200);

  const profile = raw.profile === null ? null : parseCloudProfile(raw.profile);
  const state = raw.state === null ? null : normalizeStudyRoomState(raw.state);
  const updatedAt =
    raw.updatedAt === null
      ? null
      : isTimestamp(raw.updatedAt)
        ? raw.updatedAt
        : undefined;

  if (profile === undefined || state === undefined || updatedAt === undefined) {
    throw new SyncApiError('invalid_response', 200);
  }
  const allNull = profile === null && state === null && updatedAt === null;
  const allPresent =
    profile !== null && state !== null && updatedAt !== null;
  if (!allNull && !allPresent) {
    throw new SyncApiError('invalid_response', 200);
  }
  return { user, profile, state, updatedAt };
}

interface RequestOptions {
  method?: 'GET' | 'PUT';
  body?: unknown;
}

async function requestJson(
  action: 'bootstrap' | 'state',
  options: RequestOptions = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/functions/v1/app?action=${action}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers:
        options.body === undefined
          ? { accept: 'application/json' }
          : {
              accept: 'application/json',
              'content-type': 'application/json',
            },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new SyncApiError('network_error', 0);
  }

  const status = response.status;
  if (status === 401) {
    throw new SyncApiError('login_required', 401);
  }
  if (status === 403) {
    throw new SyncApiError('invalid_user_context', 403);
  }
  if (status >= 500) {
    throw new SyncApiError('service_unavailable', status);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.toLowerCase().includes('application/json');

  let payload: unknown = null;
  if (isJson) {
    try {
      payload = await response.json();
    } catch {
      if (status === 409) {
        throw new SyncApiError('conflict', 409);
      }
      if (!response.ok) {
        throw new SyncApiError(
          status === 400 || status === 413 ? 'invalid_input' : 'request_failed',
          status,
        );
      }
      throw new SyncApiError('invalid_response', status);
    }
  }

  if (status === 409) {
    const current =
      isRecord(payload) && payload.current !== undefined
        ? parseCloudSnapshot(payload.current)
        : null;
    throw new SyncApiError(
      'conflict',
      409,
      undefined,
      current ?? undefined,
    );
  }
  if (!response.ok) {
    const serverCode =
      isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : '';
    if (status === 400 || status === 413) {
      throw new SyncApiError('invalid_input', status);
    }
    throw new SyncApiError(serverCode || 'request_failed', status);
  }
  if (!isJson) {
    throw new SyncApiError('invalid_response', status);
  }
  return payload;
}

export async function bootstrapStudyRoom(): Promise<BootstrapData> {
  const payload = await requestJson('bootstrap');
  return parseBootstrap(payload);
}

export interface SaveStudyRoomInput {
  profile: CloudProfile;
  state: StudyRoomState;
  baseUpdatedAt: string | null;
}

export async function saveStudyRoom(
  input: SaveStudyRoomInput,
): Promise<CloudSnapshot> {
  const profile = parseCloudProfile(input.profile);
  const state = normalizeStudyRoomState(input.state);
  if (!profile || !state) {
    throw new SyncApiError('invalid_input', 400);
  }
  if (
    input.baseUpdatedAt !== null &&
    !isTimestamp(input.baseUpdatedAt)
  ) {
    throw new SyncApiError('invalid_input', 400);
  }

  const payload = await requestJson('state', {
    method: 'PUT',
    body: {
      profile,
      state,
      baseUpdatedAt: input.baseUpdatedAt,
    },
  });

  if (!isRecord(payload)) {
    throw new SyncApiError('invalid_response', 200);
  }
  const saved = parseCloudSnapshot(payload);
  if (!saved) {
    throw new SyncApiError('invalid_response', 200);
  }
  return saved;
}
