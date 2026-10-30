/**
 * 自习室云端接口（与对话室同一个 Cloudflare Worker）。
 * 只负责账号与整份状态的读写；什么时候同步由状态仓库决定。
 */

const BASE = (
  (import.meta.env.VITE_CLOUD_API_URL as string | undefined) ??
  (import.meta.env.VITE_CHAT_API_URL as string | undefined) ??
  ''
).replace(/\/+$/, '');

const SESSION_KEY = 'qingyan-study-room:cloud-session:v1';
// 这条链路会「挂住」而不是立刻失败，所以单次超时压短、用更多次重试换总耗时。
const REQUEST_TIMEOUT = 6_000;
const EMAIL_CODE_TIMEOUT = 25_000;
const RETRY_DELAYS = [300, 700, 1400];

export interface CloudSession {
  token: string;
  expiresAt: string;
  userId: string;
  username: string;
  isAdmin: boolean;
}

export interface CloudUser {
  id: string;
  username: string;
  isAdmin: boolean;
}

export type CloudErrorCode =
  | 'network_error'
  | 'invalid_credentials'
  | 'username_taken'
  | 'email_taken'
  | 'email_bound'
  | 'code_invalid'
  | 'code_rate_limited'
  | 'too_many_attempts'
  | 'email_send_failed'
  | 'email_unavailable'
  | 'invalid_input'
  | 'unauthorized'
  | 'state_too_large'
  | 'forbidden'
  | 'unavailable';

const ERROR_MESSAGES: Record<CloudErrorCode, string> = {
  network_error: '连不上云端，请检查网络后重试',
  invalid_credentials: '用户名或密码不正确',
  username_taken: '用户名已存在',
  email_taken: '这个邮箱已经注册过了',
  email_bound: '该账号已经绑定过邮箱，请直接用邮箱登录',
  code_invalid: '验证码不正确或已过期',
  code_rate_limited: '验证码发送太频繁，请稍后再试',
  too_many_attempts: '尝试次数过多，请稍后再试',
  email_send_failed: '验证码邮件发送失败，请稍后重试',
  email_unavailable: '邮件服务暂时不可用，请稍后再试',
  invalid_input: '填写的信息格式不正确',
  unauthorized: '登录已过期，请重新登录',
  state_too_large: '数据太大，暂时无法同步',
  forbidden: '当前账号没有管理权限',
  unavailable: '云端服务暂时不可用，稍后再试',
};

export class CloudError extends Error {
  readonly code: CloudErrorCode;
  readonly retryAfter?: number;

  constructor(code: CloudErrorCode, retryAfter?: number) {
    super(ERROR_MESSAGES[code]);
    this.name = 'CloudError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function cloudEnabled(): boolean {
  return BASE.length > 0;
}

export function readCloudSession(): CloudSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CloudSession>;
    if (
      typeof value.token !== 'string' ||
      typeof value.userId !== 'string' ||
      typeof value.username !== 'string' ||
      typeof value.expiresAt !== 'string'
    ) {
      return null;
    }
    if (Date.parse(value.expiresAt) < Date.now()) return null;
    return {
      token: value.token,
      userId: value.userId,
      username: value.username,
      expiresAt: value.expiresAt,
      isAdmin: value.isAdmin === true,
    };
  } catch {
    return null;
  }
}

export function writeCloudSession(session: CloudSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // 本地存储不可用时只影响下次自动登录。
  }
}

export function clearCloudSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // 忽略。
  }
}

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(REQUEST_TIMEOUT)
    : undefined;
}

function rawErrorOf(payload: unknown): string {
  return payload && typeof payload === 'object' && 'error' in payload
    ? String((payload as { error?: unknown }).error)
    : '';
}

function codeOfStatus(status: number, payload: unknown): CloudErrorCode {
  const raw = rawErrorOf(payload);
  if (raw === 'username_taken') return 'username_taken';
  if (raw === 'email_taken') return 'email_taken';
  if (raw === 'email_bound') return 'email_bound';
  if (raw === 'code_invalid') return 'code_invalid';
  if (raw === 'code_rate_limited') return 'code_rate_limited';
  if (raw === 'too_many_attempts') return 'too_many_attempts';
  if (raw === 'email_send_failed') return 'email_send_failed';
  if (raw === 'email_unavailable') return 'email_unavailable';
  if (raw === 'state_too_large') return 'state_too_large';
  if (raw === 'invalid_input') return 'invalid_input';
  if (raw === 'invalid_credentials') return 'invalid_credentials';
  if (status === 401 || status === 403 || raw === 'unauthorized') return 'unauthorized';
  if (status === 409) return 'username_taken';
  if (status === 413) return 'state_too_large';
  if (status === 429) return 'code_rate_limited';
  return 'unavailable';
}

function retryAfterOf(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = Number((payload as { retryAfter?: unknown }).retryAfter);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 网络抖动时重试：只重试幂等的 GET；注册/重置/绑定这类 POST 重放会误报已存在或验证码已用。 */
async function request(
  path: string,
  init: RequestInit,
  token?: string,
): Promise<{ status: number; payload: unknown }> {
  const delays = !init.method || init.method === 'GET' ? RETRY_DELAYS : [];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await requestOnce(path, init, token);
    } catch (caught) {
      lastError = caught;
      if (!(caught instanceof CloudError) || caught.code !== 'network_error') {
        throw caught;
      }
      if (attempt < delays.length) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new CloudError('network_error');
}

async function requestOnce(
  path: string,
  init: RequestInit,
  token?: string,
): Promise<{ status: number; payload: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
      signal: init.signal ?? timeoutSignal(),
    });
  } catch {
    throw new CloudError('network_error');
  }
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

function readAuthPayload(payload: unknown): { token: string; expiresAt: string; user: CloudUser } | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as {
    token?: unknown;
    expiresAt?: unknown;
    user?: { id?: unknown; username?: unknown; isAdmin?: unknown };
  };
  if (
    typeof value.token !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    !value.user ||
    typeof value.user.id !== 'string' ||
    typeof value.user.username !== 'string'
  ) {
    return null;
  }
  return {
    token: value.token,
    expiresAt: value.expiresAt,
    user: {
      id: value.user.id,
      username: value.user.username,
      isAdmin: value.user.isAdmin === true,
    },
  };
}

function authResult(payload: unknown): { token: string; expiresAt: string; user: CloudUser } {
  const parsed = readAuthPayload(payload);
  if (!parsed) throw new CloudError('unavailable');
  return parsed;
}

export async function cloudRegister(input: {
  username: string;
  email: string;
  code: string;
  password: string;
}): Promise<{ token: string; expiresAt: string; user: CloudUser }> {
  const { status, payload } = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (status === 201) return authResult(payload);
  throw new CloudError(codeOfStatus(status, payload), retryAfterOf(payload));
}

export async function cloudLogin(
  account: string,
  password: string,
): Promise<{ token: string; expiresAt: string; user: CloudUser }> {
  const { status, payload } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account, password }),
  });
  if (status === 200) return authResult(payload);
  if (status === 401) throw new CloudError('invalid_credentials');
  throw new CloudError(codeOfStatus(status, payload), retryAfterOf(payload));
}

export type EmailCodePurpose = 'register' | 'reset' | 'bind';

export interface EmailCodeResult {
  retryAfter: number;
  expiresIn: number;
}

/** 发码接口可能等 SMTP 十几秒，单独放宽超时，并且不自动重试（避免重复发信）。 */
export async function cloudSendEmailCode(
  email: string,
  purpose: EmailCodePurpose,
): Promise<EmailCodeResult> {
  const { status, payload } = await requestOnce(
    '/api/auth/email-code',
    {
      method: 'POST',
      body: JSON.stringify({ email, purpose }),
      signal: AbortSignal.timeout(EMAIL_CODE_TIMEOUT),
    },
  );
  if (status === 200) {
    return {
      retryAfter: Math.max(1, Number((payload as { retryAfter?: unknown })?.retryAfter) || 60),
      expiresIn: Math.max(60, Number((payload as { expiresIn?: unknown })?.expiresIn) || 600),
    };
  }
  throw new CloudError(codeOfStatus(status, payload), retryAfterOf(payload));
}

export async function cloudResetPassword(
  email: string,
  code: string,
  password: string,
): Promise<void> {
  const { status, payload } = await request('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, code, password }),
  });
  if (status === 200) return;
  throw new CloudError(codeOfStatus(status, payload), retryAfterOf(payload));
}

/** 老账号绑定 QQ 邮箱：用户名 + 密码验明身份，邮箱验证码证明邮箱归属。 */
export async function cloudBindEmail(input: {
  username: string;
  password: string;
  email: string;
  code: string;
}): Promise<void> {
  const { status, payload } = await request('/api/auth/bind-email', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (status === 200) return;
  if (status === 401) throw new CloudError('invalid_credentials');
  throw new CloudError(codeOfStatus(status, payload), retryAfterOf(payload));
}

export async function cloudLogout(token: string): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST' }, token);
  } catch {
    // 退出登录失败不影响本地清理。
  }
}

export async function cloudMe(
  token: string,
): Promise<CloudUser | null> {
  const { status, payload } = await request('/api/auth/me', { method: 'GET' }, token);
  if (status === 200 && payload && typeof payload === 'object') {
    const user = (
      payload as { user?: { id?: unknown; username?: unknown; isAdmin?: unknown } }
    ).user;
    if (user && typeof user.id === 'string' && typeof user.username === 'string') {
      return { id: user.id, username: user.username, isAdmin: user.isAdmin === true };
    }
  }
  if (status === 401) return null;
  throw new CloudError(codeOfStatus(status, payload));
}

export interface CloudState {
  state: string;
  updatedAt: string;
  revision: number;
}

export async function cloudGetState(token: string): Promise<CloudState | null> {
  const { status, payload } = await request('/api/state', { method: 'GET' }, token);
  if (status === 404) return null;
  if (status !== 200 || !payload || typeof payload !== 'object') {
    throw new CloudError(codeOfStatus(status, payload));
  }
  const value = payload as {
    state?: unknown;
    updatedAt?: unknown;
    revision?: unknown;
  };
  if (
    typeof value.state !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    typeof value.revision !== 'number'
  ) {
    throw new CloudError('unavailable');
  }
  return {
    state: value.state,
    updatedAt: value.updatedAt,
    revision: value.revision,
  };
}

export type CloudPutResult =
  | { ok: true; updatedAt: string; revision: number }
  | { ok: false; conflict: CloudState };

export async function cloudPutState(
  token: string,
  state: string,
  baseRevision?: number | null,
): Promise<CloudPutResult> {
  const { status, payload } = await request(
    '/api/state',
    {
      method: 'PUT',
      body: JSON.stringify(
        baseRevision === undefined || baseRevision === null
          ? { state }
          : { state, baseRevision },
      ),
    },
    token,
  );
  if (status === 200 && payload && typeof payload === 'object') {
    const value = payload as { updatedAt?: unknown; revision?: unknown };
    if (typeof value.updatedAt === 'string' && typeof value.revision === 'number') {
      return { ok: true, updatedAt: value.updatedAt, revision: value.revision };
    }
    throw new CloudError('unavailable');
  }
  if (status === 409 && payload && typeof payload === 'object') {
    const value = payload as {
      state?: unknown;
      updatedAt?: unknown;
      revision?: unknown;
    };
    if (
      typeof value.state === 'string' &&
      typeof value.updatedAt === 'string' &&
      typeof value.revision === 'number'
    ) {
      return {
        ok: false,
        conflict: {
          state: value.state,
          updatedAt: value.updatedAt,
          revision: value.revision,
        },
      };
    }
  }
  throw new CloudError(codeOfStatus(status, payload));
}

/** 在线心跳：让管理端知道这个会话还活着。 */
export async function cloudPresence(token: string, userAgent: string): Promise<void> {
  await request(
    '/api/presence',
    { method: 'POST', body: JSON.stringify({ userAgent }) },
    token,
  );
}

export interface AdminActivityPoint {
  date: string;
  logins: number;
  users: number;
  registrations: number;
}

export interface AdminLocation {
  country: string;
  region: string;
  city: string;
  sessions: number;
  users: number;
}

export interface AdminLogin {
  username: string;
  at: string;
  country: string;
  region: string;
  city: string;
  colo: string;
  userAgent: string;
}

export interface AdminOnlineUser {
  userId: string;
  username: string;
  lastSeenAt: string;
  loginAt: string;
  userAgent: string;
  expiresAt: string;
  country: string;
  region: string;
  city: string;
  colo: string;
  timezone: string;
}

export interface AdminStats {
  now: string;
  runtime: {
    colo: string;
    region: string;
    city: string;
    country: string;
    timezone: string;
    onlineWindowMinutes: number;
  };
  users: { total: number; today: number; week: number; online: number };
  sessions: { active: number; onlineSessions: number };
  storage: {
    rows: number;
    bytes: number;
    updatedToday: number;
    lastUpdatedAt: string | null;
  };
  chat: { messages: number; authorsToday: number };
  activity: AdminActivityPoint[];
  locations: AdminLocation[];
  recentLogins: AdminLogin[];
  online: AdminOnlineUser[];
  recent: {
    userId: string;
    username: string;
    updatedAt: string;
    bytes: number;
    revision: number;
  }[];
}

export async function cloudAdminStats(token: string): Promise<AdminStats> {
  const { status, payload } = await request('/api/admin/stats', { method: 'GET' }, token);
  if (status === 200 && payload && typeof payload === 'object') {
    return payload as AdminStats;
  }
  if (status === 403) throw new CloudError('forbidden' as CloudErrorCode);
  throw new CloudError(codeOfStatus(status, payload));
}
