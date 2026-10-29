// 自习室的云端账号与数据：注册/登录 + 状态读写。
// 为什么放在这个 Worker：站点是纯静态托管，Qoder 后端能力当前账号不可用，
// 而对话室已经在这台 Worker + D1 上跑，复用它就多不了任何服务与费用。

// Workers 的 WebCrypto 对 PBKDF2 迭代次数上限为 100000。
const PBKDF2_ITERATIONS = 100_000;
const SESSION_DAYS = 90;
const MAX_STATE_BYTES = 512 * 1024;
const USERNAME_MIN = 2;
const USERNAME_MAX = 24;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;
const USERNAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });

const encoder = new TextEncoder();

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveHash(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromBase64(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

/** 长度固定的字符串比较，避免按字节提前返回。 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 管理员：env.ADMIN_USERNAMES（逗号分隔）或用户表 is_admin 标记。 */
function adminUsernames(env) {
  const raw = env.ADMIN_USERNAMES || '';
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isAdminUser(env, username, flag) {
  if (Number(flag) === 1) return true;
  return adminUsernames(env).has(String(username || '').toLowerCase());
}

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function usernameKeyOf(username) {
  return username.toLowerCase();
}

function validUsername(username) {
  return (
    username.length >= USERNAME_MIN &&
    username.length <= USERNAME_MAX &&
    USERNAME_PATTERN.test(username)
  );
}

function validPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= PASSWORD_MIN &&
    password.length <= PASSWORD_MAX
  );
}

async function readBody(request) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('application/json')) return null;
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

async function createSession(env, userId) {
  const token = toBase64Url(randomBytes(32));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  await env.DB.prepare(
    'INSERT INTO study_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(token, userId, now.toISOString(), expiresAt)
    .run();
  return { token, expiresAt };
}

async function authenticate(env, request) {
  const header = request.headers.get('authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT s.user_id, s.expires_at, u.username, u.is_admin FROM study_sessions s JOIN study_users u ON u.id = s.user_id WHERE s.token = ?',
  )
    .bind(token)
    .first();
  if (!row || typeof row.expires_at !== 'string') return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  return {
    userId: row.user_id,
    username: row.username,
    token,
    isAdmin: isAdminUser(env, row.username, row.is_admin),
  };
}

async function handleRegister(request, env) {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_input' }, 400);
  const username = normalizeUsername(body.username);
  const password = body.password;
  if (!validUsername(username) || !validPassword(password)) {
    return json({ error: 'invalid_input' }, 400);
  }
  const usernameKey = usernameKeyOf(username);
  const existing = await env.DB.prepare(
    'SELECT id FROM study_users WHERE username_key = ?',
  )
    .bind(usernameKey)
    .first();
  if (existing) return json({ error: 'username_taken' }, 409);

  const salt = toBase64(randomBytes(16));
  const hash = await deriveHash(password, salt);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      'INSERT INTO study_users (id, username, username_key, salt, password_hash, iterations, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, username, usernameKey, salt, hash, PBKDF2_ITERATIONS, now, now)
      .run();
  } catch {
    // 唯一索引冲突：并发注册同名。
    return json({ error: 'username_taken' }, 409);
  }
  const session = await createSession(env, id);
  return json(
    { ...session, user: { id, username, isAdmin: isAdminUser(env, username, 0) } },
    201,
  );
}

async function handleLogin(request, env) {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_input' }, 400);
  const username = normalizeUsername(body.username);
  const password = body.password;
  if (!username || !validPassword(password)) {
    return json({ error: 'invalid_credentials' }, 401);
  }
  const row = await env.DB.prepare(
    'SELECT id, username, salt, password_hash FROM study_users WHERE username_key = ?',
  )
    .bind(usernameKeyOf(username))
    .first();
  // 用户不存在时也算一次哈希，避免用耗时差异探测账号是否存在。
  const salt = row?.salt ?? toBase64(new Uint8Array(16));
  const hash = await deriveHash(password, salt);
  if (!row || !safeEqual(hash, row.password_hash)) {
    return json({ error: 'invalid_credentials' }, 401);
  }
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE study_users SET last_login_at = ? WHERE id = ?')
    .bind(now, row.id)
    .run();
  // 顺手清掉很久以前过期的会话，避免会话表无限增长。
  await env.DB.prepare('DELETE FROM study_sessions WHERE expires_at < ?')
    .bind(new Date(Date.now() - 30 * 86_400_000).toISOString())
    .run();
  const session = await createSession(env, row.id);
  return json({
    ...session,
    user: {
      id: row.id,
      username: row.username,
      isAdmin: isAdminUser(env, row.username, row.is_admin),
    },
  });
}

async function handleLogout(request, env) {
  const auth = await authenticate(env, request);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  await env.DB.prepare('DELETE FROM study_sessions WHERE token = ?')
    .bind(auth.token)
    .run();
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function handleMe(request, env) {
  const auth = await authenticate(env, request);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  return json({
    user: { id: auth.userId, username: auth.username, isAdmin: auth.isAdmin },
  });
}

async function handleGetState(request, env) {
  const auth = await authenticate(env, request);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const row = await env.DB.prepare(
    'SELECT state_json, updated_at, revision FROM study_state WHERE user_id = ?',
  )
    .bind(auth.userId)
    .first();
  if (!row) return json({ error: 'no_state' }, 404);
  return json({
    state: row.state_json,
    updatedAt: row.updated_at,
    revision: row.revision,
  });
}

async function handlePutState(request, env) {
  const auth = await authenticate(env, request);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const body = await readBody(request);
  if (!body || typeof body.state !== 'string') {
    return json({ error: 'invalid_input' }, 400);
  }
  const stateJson = body.state;
  if (encoder.encode(stateJson).length > MAX_STATE_BYTES) {
    return json({ error: 'state_too_large' }, 413);
  }
  try {
    const parsed = JSON.parse(stateJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json({ error: 'invalid_input' }, 400);
    }
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }

  const baseRevision = Number.isInteger(body.baseRevision) ? body.baseRevision : null;
  const now = new Date().toISOString();
  const current = await env.DB.prepare(
    'SELECT revision, state_json, updated_at FROM study_state WHERE user_id = ?',
  )
    .bind(auth.userId)
    .first();

  if (!current) {
    await env.DB.prepare(
      'INSERT INTO study_state (user_id, state_json, updated_at, revision) VALUES (?, ?, ?, 1)',
    )
      .bind(auth.userId, stateJson, now)
      .run();
    return json({ updatedAt: now, revision: 1 });
  }

  if (baseRevision !== null && baseRevision !== current.revision) {
    // 另一台设备已经写过，返回服务端版本让客户端决定取舍。
    return json(
      {
        error: 'conflict',
        state: current.state_json,
        updatedAt: current.updated_at,
        revision: current.revision,
      },
      409,
    );
  }

  const revision = Number(current.revision || 0) + 1;
  await env.DB.prepare(
    'UPDATE study_state SET state_json = ?, updated_at = ?, revision = ? WHERE user_id = ?',
  )
    .bind(stateJson, now, revision, auth.userId)
    .run();
  return json({ updatedAt: now, revision });
}

/** 前端定时调用，刷新会话的最后活跃时间；「在线用户」靠它统计。 */
async function handlePresence(request, env) {
  const auth = await authenticate(env, request);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const body = await readBody(request);
  const ua =
    (body && typeof body.userAgent === 'string' ? body.userAgent : '') ||
    request.headers.get('user-agent') ||
    '';
  await env.DB.prepare(
    'UPDATE study_sessions SET last_seen_at = ?, user_agent = ? WHERE token = ?',
  )
    .bind(new Date().toISOString(), ua.slice(0, 200), auth.token)
    .run();
  return json({ ok: true, serverTime: new Date().toISOString() });
}

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function startOfTodayIso() {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
}

async function countOf(env, sql, ...binds) {
  const statement = env.DB.prepare(sql);
  const row = await (binds.length ? statement.bind(...binds) : statement).first();
  return Number(row?.c ?? row?.total ?? 0);
}

async function handleAdminStats(request, env) {
  const auth = await authenticate(env, request);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (!auth.isAdmin) return json({ error: 'forbidden' }, 403);

  const now = new Date();
  const nowIso = now.toISOString();
  const today = startOfTodayIso();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MS).toISOString();

  const [
    usersTotal,
    usersToday,
    usersWeek,
    sessionsActive,
    sessionsOnline,
    stateRows,
    stateToday,
    chatMessages,
    chatAuthorsToday,
  ] = await Promise.all([
    countOf(env, 'SELECT COUNT(*) AS c FROM study_users'),
    countOf(env, 'SELECT COUNT(*) AS c FROM study_users WHERE created_at >= ?', today),
    countOf(env, 'SELECT COUNT(*) AS c FROM study_users WHERE created_at >= ?', weekAgo),
    countOf(env, 'SELECT COUNT(*) AS c FROM study_sessions WHERE expires_at > ?', nowIso),
    countOf(
      env,
      'SELECT COUNT(*) AS c FROM study_sessions WHERE expires_at > ? AND COALESCE(last_seen_at, created_at) >= ?',
      nowIso,
      onlineSince,
    ),
    countOf(env, 'SELECT COUNT(*) AS c FROM study_state'),
    countOf(env, 'SELECT COUNT(*) AS c FROM study_state WHERE updated_at >= ?', today),
    countOf(env, 'SELECT COUNT(*) AS c FROM chat_messages'),
    countOf(
      env,
      'SELECT COUNT(DISTINCT author_id) AS c FROM chat_messages WHERE created_at >= ?',
      today,
    ),
  ]);

  const storage = await env.DB.prepare(
    'SELECT COALESCE(SUM(LENGTH(state_json)), 0) AS bytes, MAX(updated_at) AS last FROM study_state',
  ).first();

  const onlineRows = await env.DB.prepare(
    `SELECT u.username, s.user_id, COALESCE(s.last_seen_at, s.created_at) AS seen, s.user_agent, s.expires_at
     FROM study_sessions s JOIN study_users u ON u.id = s.user_id
     WHERE s.expires_at > ? AND COALESCE(s.last_seen_at, s.created_at) >= ?
     ORDER BY seen DESC LIMIT 200`,
  )
    .bind(nowIso, onlineSince)
    .all();

  // 同一个人可能有多条会话（每台设备一次登录），按人去重只留最近活跃。
  const onlineByUser = new Map();
  for (const row of onlineRows.results || []) {
    const existing = onlineByUser.get(row.user_id);
    if (existing && existing.seen >= row.seen) continue;
    onlineByUser.set(row.user_id, row);
  }
  const online = [...onlineByUser.values()].sort((a, b) => (a.seen < b.seen ? 1 : -1));

  const recentRows = await env.DB.prepare(
    `SELECT u.username, t.user_id, t.updated_at, LENGTH(t.state_json) AS bytes, t.revision
     FROM study_state t JOIN study_users u ON u.id = t.user_id
     ORDER BY t.updated_at DESC LIMIT 20`,
  ).all();

  const cf = request.cf || {};
  return json({
    now: nowIso,
    runtime: {
      colo: typeof cf.colo === 'string' ? cf.colo : '',
      region: typeof cf.region === 'string' ? cf.region : '',
      country: typeof cf.country === 'string' ? cf.country : '',
      onlineWindowMinutes: ONLINE_WINDOW_MS / 60_000,
    },
    users: {
      total: usersTotal,
      today: usersToday,
      week: usersWeek,
      online: online.length,
    },
    sessions: { active: sessionsActive, onlineSessions: sessionsOnline },
    storage: {
      rows: stateRows,
      bytes: Number(storage?.bytes ?? 0),
      updatedToday: stateToday,
      lastUpdatedAt: storage?.last ?? null,
    },
    chat: { messages: chatMessages, authorsToday: chatAuthorsToday },
    online: online.map((row) => ({
      userId: row.user_id,
      username: row.username,
      lastSeenAt: row.seen,
      userAgent: row.user_agent || '',
      expiresAt: row.expires_at,
    })),
    recent: (recentRows.results || []).map((row) => ({
      userId: row.user_id,
      username: row.username,
      updatedAt: row.updated_at,
      bytes: Number(row.bytes ?? 0),
      revision: Number(row.revision ?? 0),
    })),
  });
}

/** 首次请求时确保表存在：D1 的迁移需要额外的账号权限，
 *  幂等 DDL 不依赖它，部署后即可用。 */
let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  const statements = [
    'CREATE TABLE IF NOT EXISTS study_users (id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, iterations INTEGER NOT NULL, created_at TEXT NOT NULL, last_login_at TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS study_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT, user_agent TEXT)',
    'CREATE INDEX IF NOT EXISTS idx_study_sessions_user ON study_sessions (user_id)',
    'CREATE TABLE IF NOT EXISTS study_state (user_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1)',
  ];
  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
  // 老库补列：重复执行会报 duplicate column，忽略即可。
  const columns = [
    'ALTER TABLE study_users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE study_sessions ADD COLUMN last_seen_at TEXT',
    'ALTER TABLE study_sessions ADD COLUMN user_agent TEXT',
  ];
  for (const sql of columns) {
    try {
      await env.DB.prepare(sql).run();
    } catch {
      // 列已存在。
    }
  }
  schemaReady = true;
}

/** 命中 /api/auth/* 或 /api/state 时返回响应，其它路径返回 null 交给上层路由。 */
export async function handleStudyCloud(request, env, url) {
  const path = url.pathname;
  const isAuth = path.startsWith('/api/auth/');
  const isState = path === '/api/state';
  const isAdminPath = path === '/api/admin/stats';
  const isPresence = path === '/api/presence';
  if (!isAuth && !isState && !isAdminPath && !isPresence) return null;
  if (!env.DB) return json({ error: 'cloud_unavailable' }, 503);

  try {
    await ensureSchema(env);
    if (path === '/api/auth/register') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return await handleRegister(request, env);
    }
    if (path === '/api/auth/login') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return await handleLogin(request, env);
    }
    if (path === '/api/auth/logout') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return await handleLogout(request, env);
    }
    if (path === '/api/auth/me') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      return await handleMe(request, env);
    }
    if (path === '/api/presence') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return await handlePresence(request, env);
    }
    if (path === '/api/admin/stats') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      return await handleAdminStats(request, env);
    }
    if (isState) {
      if (request.method === 'GET') return await handleGetState(request, env);
      if (request.method === 'PUT') return await handlePutState(request, env);
      return json({ error: 'method_not_allowed' }, 405);
    }
    return json({ error: 'not_found' }, 404);
  } catch {
    return json({ error: 'cloud_unavailable' }, 503);
  }
}
