// 自习室的云端账号与数据：注册/登录 + 状态读写。
// 为什么放在这个 Worker：站点是纯静态托管，Qoder 后端能力当前账号不可用，
// 而对话室已经在这台 Worker + D1 上跑，复用它就多不了任何服务与费用。
import { mailReady, sendVerificationEmail } from './study-mailer.js';

// Workers 的 WebCrypto 对 PBKDF2 迭代次数上限为 100000。
const PBKDF2_ITERATIONS = 100_000;
const SESSION_DAYS = 90;
const MAX_STATE_BYTES = 512 * 1024;
const USERNAME_MIN = 2;
const USERNAME_MAX = 24;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;
const USERNAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const NEW_PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)\S{8,128}$/;
const CODE_PATTERN = /^\d{6}$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 60 * 1000;
const CODE_HOURLY_LIMIT = 5;
const CODE_IP_HOURLY_LIMIT = 20;
const CODE_MAX_ATTEMPTS = 5;
const CODE_PURPOSES = new Set(['register', 'reset', 'bind']);
const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAILURE_LIMIT = 8;
const AUTH_IP_FAILURE_LIMIT = 30;

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

const json = (value, status = 200, extra = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });

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

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(digest);
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toHex(signature);
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

/** 新注册与重置密码强制 8 位以上、同时含字母和数字，与 qc-student 一致。 */
function validNewPassword(password) {
  return typeof password === 'string' && NEW_PASSWORD_PATTERN.test(password);
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

function normalizeCode(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function textOf(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

/** Cloudflare 的请求地理位置：登录时写进会话，管理页用来展示登录地点。 */
function requestLocation(request) {
  const cf = request.cf && typeof request.cf === 'object' ? request.cf : {};
  return {
    country: textOf(cf.country, 8),
    region: textOf(cf.region, 64),
    city: textOf(cf.city, 64),
    colo: textOf(cf.colo, 8),
    timezone: textOf(cf.timezone, 64),
  };
}

async function clientIpHash(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!ip || !env.EMAIL_CODE_SECRET) return '';
  return sha256Hex(`${env.EMAIL_CODE_SECRET}:ip:${ip}`);
}

async function checkAuthThrottle(env, usernameKey, ipHash) {
  const since = new Date(Date.now() - AUTH_FAILURE_WINDOW_MS).toISOString();
  const pair = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM study_auth_failures WHERE username_key = ? AND ip_hash = ? AND created_at >= ?',
  )
    .bind(usernameKey, ipHash, since)
    .first();
  if (Number(pair?.c ?? 0) >= AUTH_FAILURE_LIMIT) {
    return { retryAfter: Math.ceil(AUTH_FAILURE_WINDOW_MS / 1000) };
  }
  if (ipHash) {
    const byIp = await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM study_auth_failures WHERE ip_hash = ? AND created_at >= ?',
    )
      .bind(ipHash, since)
      .first();
    if (Number(byIp?.c ?? 0) >= AUTH_IP_FAILURE_LIMIT) {
      return { retryAfter: Math.ceil(AUTH_FAILURE_WINDOW_MS / 1000) };
    }
  }
  return null;
}

async function recordAuthFailure(env, usernameKey, ipHash) {
  await env.DB.prepare(
    'INSERT INTO study_auth_failures (id, username_key, ip_hash, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), usernameKey, ipHash, new Date().toISOString())
    .run();
  await env.DB.prepare('DELETE FROM study_auth_failures WHERE created_at < ?')
    .bind(new Date(Date.now() - 86_400_000).toISOString())
    .run()
    .catch(() => {});
}

async function clearAuthFailures(env, usernameKey, ipHash) {
  await env.DB.prepare(
    'DELETE FROM study_auth_failures WHERE username_key = ? AND ip_hash = ?',
  )
    .bind(usernameKey, ipHash)
    .run()
    .catch(() => {});
}

async function createSession(env, userId, request) {
  const token = toBase64Url(randomBytes(32));
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  const location = requestLocation(request);
  const ipHash = await clientIpHash(request, env);
  const userAgent = textOf(request.headers.get('user-agent') || '', 200);
  await env.DB.prepare(
    `INSERT INTO study_sessions
      (token, user_id, created_at, expires_at, last_seen_at, user_agent, country, region, city, colo, timezone, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      token,
      userId,
      nowIso,
      expiresAt,
      nowIso,
      userAgent,
      location.country,
      location.region,
      location.city,
      location.colo,
      location.timezone,
      ipHash,
    )
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

function randomVerificationCode() {
  // 六位数字，配合每封邮件 60 秒/每小时 5 次与 5 次尝试上限足够。
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(value).padStart(6, '0');
}

/** 校验验证码但不消费；先返回行 id，业务成功后再标记已用。 */
async function checkEmailCode(env, email, purpose, code) {
  if (!env.EMAIL_CODE_SECRET || !CODE_PATTERN.test(code)) return null;
  const row = await env.DB.prepare(
    `SELECT id, code_hash, attempts, expires_at
     FROM study_email_codes
     WHERE email = ? AND purpose = ? AND used_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(email, purpose)
    .first();
  if (!row || typeof row.expires_at !== 'string') return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  if (Number(row.attempts) >= CODE_MAX_ATTEMPTS) return null;

  // 先原子占用一次尝试名额，并发请求也只能用满 5 次。
  const bumped = await env.DB.prepare(
    'UPDATE study_email_codes SET attempts = attempts + 1 WHERE id = ? AND used_at IS NULL AND attempts < ?',
  )
    .bind(row.id, CODE_MAX_ATTEMPTS)
    .run();
  if (Number(bumped.meta?.changes ?? 0) !== 1) return null;

  const expected = await hmacHex(env.EMAIL_CODE_SECRET, code);
  if (!safeEqual(expected, String(row.code_hash || ''))) return null;
  return row.id;
}

async function markEmailCodeUsed(env, id) {
  const result = await env.DB.prepare(
    'UPDATE study_email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL',
  )
    .bind(new Date().toISOString(), id)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

/**
 * 用一个原子 INSERT…SELECT 同时检查 60 秒重发、邮箱每小时和 IP 每小时上限，
 * 并发请求不会一起穿过去。失败时返回一个给前端的等待秒数。
 */
async function reserveEmailCode(env, { email, purpose, codeHash, ipHash, now }) {
  const id = crypto.randomUUID();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + CODE_TTL_MS).toISOString();
  const resendThreshold = new Date(now - CODE_RESEND_MS).toISOString();
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO study_email_codes
      (id, email, purpose, code_hash, attempts, created_at, expires_at, used_at, ip_hash)
     SELECT ?, ?, ?, ?, 0, ?, ?, NULL, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM study_email_codes
       WHERE email = ? AND purpose = ? AND created_at > ?
     )
     AND (
       SELECT COUNT(*) FROM study_email_codes
       WHERE email = ? AND created_at >= ?
     ) < ?
     AND (
       ? = '' OR (
         SELECT COUNT(*) FROM study_email_codes
         WHERE ip_hash = ? AND created_at >= ?
       ) < ?
     )`,
  )
    .bind(
      id,
      email,
      purpose,
      codeHash,
      createdAt,
      expiresAt,
      ipHash,
      email,
      purpose,
      resendThreshold,
      email,
      hourAgo,
      CODE_HOURLY_LIMIT,
      ipHash,
      ipHash,
      hourAgo,
      CODE_IP_HOURLY_LIMIT,
    )
    .run();
  if (Number(result.meta?.changes ?? 0) === 1) {
    return { inserted: true, id, createdAt };
  }

  const latest = await env.DB.prepare(
    `SELECT created_at FROM study_email_codes
     WHERE email = ? AND purpose = ?
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(email, purpose)
    .first();
  const elapsed =
    latest && typeof latest.created_at === 'string'
      ? now - Date.parse(latest.created_at)
      : CODE_RESEND_MS;
  const retryAfter =
    elapsed < CODE_RESEND_MS
      ? Math.max(1, Math.ceil((CODE_RESEND_MS - elapsed) / 1000))
      : 600;
  return { inserted: false, retryAfter };
}

async function handleSendEmailCode(request, env) {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_input' }, 400);
  const email = normalizeEmail(body.email);
  const purpose = typeof body.purpose === 'string' ? body.purpose : '';
  if (!email || !CODE_PURPOSES.has(purpose)) {
    return json({ error: 'invalid_input' }, 400);
  }
  if (!env.EMAIL_CODE_SECRET || !mailReady(env)) {
    return json({ error: 'email_unavailable' }, 503);
  }

  let shouldSend = true;
  if (purpose === 'register' || purpose === 'bind') {
    const existing = await env.DB.prepare(
      'SELECT id FROM study_users WHERE email_key = ?',
    )
      .bind(email)
      .first();
    if (existing) return json({ error: 'email_taken' }, 409);
  } else {
    const account = await env.DB.prepare(
      'SELECT id FROM study_users WHERE email_key = ?',
    )
      .bind(email)
      .first();
    // 不暴露邮箱是否注册：不存在也走同一条限流记录，只是不发信。
    shouldSend = !!account;
  }

  const now = Date.now();
  const code = randomVerificationCode();
  const codeHash = await hmacHex(env.EMAIL_CODE_SECRET, code);
  const ipHash = await clientIpHash(request, env);
  const reservation = await reserveEmailCode(env, {
    email,
    purpose,
    codeHash,
    ipHash,
    now,
  });
  if (!reservation.inserted) {
    return json(
      { error: 'code_rate_limited', retryAfter: reservation.retryAfter },
      429,
      { 'retry-after': String(reservation.retryAfter) },
    );
  }

  if (shouldSend) {
    try {
      await sendVerificationEmail(env, { to: email, code, purpose });
    } catch (caught) {
      // 发信失败就不留一条无法使用的验证码，用户可直接重试。
      await env.DB.prepare('DELETE FROM study_email_codes WHERE id = ?')
        .bind(reservation.id)
        .run()
        .catch(() => {});
      console.error('verification email failed', String(caught?.name || 'error'));
      return json({ error: 'email_send_failed' }, 502);
    }
  }

  await env.DB.prepare(
    'DELETE FROM study_email_codes WHERE expires_at < ?',
  )
    .bind(new Date(now - 86_400_000).toISOString())
    .run()
    .catch(() => {});

  // 新码发出后旧码立即作废，避免同一邮箱同时存在多条可用验证码。
  await env.DB.prepare(
    `UPDATE study_email_codes SET used_at = ?
     WHERE email = ? AND purpose = ? AND used_at IS NULL AND id <> ?`,
  )
    .bind(reservation.createdAt, email, purpose, reservation.id)
    .run()
    .catch(() => {});

  return json({ ok: true, retryAfter: 60, expiresIn: 600 });
}

async function handleRegister(request, env) {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_input' }, 400);
  const username = normalizeUsername(body.username);
  const email = normalizeEmail(body.email);
  const code = normalizeCode(body.code);
  const password = body.password;
  if (
    !validUsername(username) ||
    !email ||
    !CODE_PATTERN.test(code) ||
    !validNewPassword(password)
  ) {
    return json({ error: 'invalid_input' }, 400);
  }

  const usernameKey = usernameKeyOf(username);
  const [existingName, existingEmail] = await Promise.all([
    env.DB.prepare('SELECT id FROM study_users WHERE username_key = ?')
      .bind(usernameKey)
      .first(),
    env.DB.prepare('SELECT id FROM study_users WHERE email_key = ?')
      .bind(email)
      .first(),
  ]);
  if (existingName) return json({ error: 'username_taken' }, 409);
  if (existingEmail) return json({ error: 'email_taken' }, 409);
  if (!env.EMAIL_CODE_SECRET) return json({ error: 'email_unavailable' }, 503);

  const codeId = await checkEmailCode(env, email, 'register', code);
  if (!codeId) return json({ error: 'code_invalid' }, 400);
  const consumed = await markEmailCodeUsed(env, codeId);
  if (!consumed) return json({ error: 'code_invalid' }, 400);

  const salt = toBase64(randomBytes(16));
  const hash = await deriveHash(password, salt);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO study_users
        (id, username, username_key, email, email_key, email_verified_at, salt, password_hash, iterations, created_at, last_login_at, is_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
      .bind(
        id,
        username,
        usernameKey,
        email,
        email,
        now,
        salt,
        hash,
        PBKDF2_ITERATIONS,
        now,
        now,
      )
      .run();
  } catch {
    // 并发注册同名/同邮箱时，唯一索引兜底。
    const [nameRow, emailRow] = await Promise.all([
      env.DB.prepare('SELECT id FROM study_users WHERE username_key = ?')
        .bind(usernameKey)
        .first(),
      env.DB.prepare('SELECT id FROM study_users WHERE email_key = ?')
        .bind(email)
        .first(),
    ]);
    if (nameRow) return json({ error: 'username_taken' }, 409);
    if (emailRow) return json({ error: 'email_taken' }, 409);
    return json({ error: 'invalid_input' }, 400);
  }

  const session = await createSession(env, id, request);
  return json(
    {
      ...session,
      user: { id, username, isAdmin: isAdminUser(env, username, 0) },
    },
    201,
  );
}

async function handleLogin(request, env) {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_input' }, 400);
  // account 兼容旧版前端的 username 字段；有 @ 就按邮箱查。
  const account = normalizeUsername(body.account ?? body.username);
  const password = body.password;
  if (!account || !validPassword(password)) {
    return json({ error: 'invalid_credentials' }, 401);
  }
  const isEmail = account.includes('@');
  const lookupKey = isEmail ? account.toLowerCase() : usernameKeyOf(account);
  const ipHash = await clientIpHash(request, env);
  const throttle = await checkAuthThrottle(env, lookupKey, ipHash);
  if (throttle) {
    return json(
      { error: 'too_many_attempts', retryAfter: throttle.retryAfter },
      429,
      { 'retry-after': String(throttle.retryAfter) },
    );
  }
  const row = await env.DB.prepare(
    isEmail
      ? 'SELECT id, username, salt, password_hash, is_admin FROM study_users WHERE email_key = ?'
      : 'SELECT id, username, salt, password_hash, is_admin FROM study_users WHERE username_key = ?',
  )
    .bind(lookupKey)
    .first();
  // 用户不存在时也算一次哈希，避免用耗时差异探测账号是否存在。
  const salt = row?.salt ?? toBase64(new Uint8Array(16));
  const hash = await deriveHash(password, salt);
  if (!row || !safeEqual(hash, row.password_hash)) {
    await recordAuthFailure(env, lookupKey, ipHash);
    return json({ error: 'invalid_credentials' }, 401);
  }
  await clearAuthFailures(env, lookupKey, ipHash);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE study_users SET last_login_at = ? WHERE id = ?')
    .bind(now, row.id)
    .run();
  // 顺手清掉很久以前过期的会话，避免会话表无限增长。
  await env.DB.prepare('DELETE FROM study_sessions WHERE expires_at < ?')
    .bind(new Date(Date.now() - 30 * 86_400_000).toISOString())
    .run();
  const session = await createSession(env, row.id, request);
  return json({
    ...session,
    user: {
      id: row.id,
      username: row.username,
      isAdmin: isAdminUser(env, row.username, row.is_admin),
    },
  });
}

async function handleResetPassword(request, env) {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_input' }, 400);
  const email = normalizeEmail(body.email);
  const code = normalizeCode(body.code);
  const password = body.password;
  if (!email || !CODE_PATTERN.test(code) || !validNewPassword(password)) {
    return json({ error: 'invalid_input' }, 400);
  }
  const account = await env.DB.prepare(
    'SELECT id FROM study_users WHERE email_key = ?',
  )
    .bind(email)
    .first();
  // 邮箱不存在与验证码错误返回同一个结果，避免探测账号。
  if (!account) return json({ error: 'code_invalid' }, 400);
  if (!env.EMAIL_CODE_SECRET) return json({ error: 'email_unavailable' }, 503);

  const codeId = await checkEmailCode(env, email, 'reset', code);
  if (!codeId) return json({ error: 'code_invalid' }, 400);
  const consumed = await markEmailCodeUsed(env, codeId);
  if (!consumed) return json({ error: 'code_invalid' }, 400);

  const salt = toBase64(randomBytes(16));
  const hash = await deriveHash(password, salt);
  // 改密与踢掉所有旧会话放在一个批次里，避免只成功一半。
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE study_users SET salt = ?, password_hash = ?, iterations = ? WHERE id = ?',
    ).bind(salt, hash, PBKDF2_ITERATIONS, account.id),
    env.DB.prepare('DELETE FROM study_sessions WHERE user_id = ?').bind(account.id),
  ]);
  return json({ ok: true });
}

/** 老账号用用户名 + 密码验证身份，再凭邮箱验证码绑定 QQ 邮箱。 */
async function handleBindEmail(request, env) {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_input' }, 400);
  const username = normalizeUsername(body.username);
  const password = body.password;
  const email = normalizeEmail(body.email);
  const code = normalizeCode(body.code);
  if (
    !validUsername(username) ||
    !validPassword(password) ||
    !email ||
    !CODE_PATTERN.test(code)
  ) {
    return json({ error: 'invalid_input' }, 400);
  }
  const usernameKey = usernameKeyOf(username);
  const ipHash = await clientIpHash(request, env);
  const throttle = await checkAuthThrottle(env, usernameKey, ipHash);
  if (throttle) {
    return json(
      { error: 'too_many_attempts', retryAfter: throttle.retryAfter },
      429,
      { 'retry-after': String(throttle.retryAfter) },
    );
  }
  const row = await env.DB.prepare(
    'SELECT id, username, salt, password_hash, is_admin, email_key FROM study_users WHERE username_key = ?',
  )
    .bind(usernameKey)
    .first();
  const salt = row?.salt ?? toBase64(new Uint8Array(16));
  const hash = await deriveHash(password, salt);
  if (!row || !safeEqual(hash, row.password_hash)) {
    await recordAuthFailure(env, usernameKey, ipHash);
    return json({ error: 'invalid_credentials' }, 401);
  }
  await clearAuthFailures(env, usernameKey, ipHash);
  // 绑定入口只服务还没邮箱的老账号；已有邮箱不能在不知道旧邮箱的情况下改绑。
  if (row.email_key) {
    return json({ error: 'email_bound' }, 409);
  }
  const existing = await env.DB.prepare(
    'SELECT id FROM study_users WHERE email_key = ?',
  )
    .bind(email)
    .first();
  if (existing && existing.id !== row.id) {
    return json({ error: 'email_taken' }, 409);
  }
  if (!env.EMAIL_CODE_SECRET) return json({ error: 'email_unavailable' }, 503);

  const codeId = await checkEmailCode(env, email, 'bind', code);
  if (!codeId) return json({ error: 'code_invalid' }, 400);
  const consumed = await markEmailCodeUsed(env, codeId);
  if (!consumed) return json({ error: 'code_invalid' }, 400);

  const result = await env.DB.prepare(
    'UPDATE study_users SET email = ?, email_key = ?, email_verified_at = ? WHERE id = ? AND email_key IS NULL',
  )
    .bind(email, email, new Date().toISOString(), row.id)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    return json({ error: 'email_bound' }, 409);
  }
  return json({ ok: true });
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
  // 管理页按北京时间分天，和下面的 +8 小时分组保持一致。
  const shifted = new Date(Date.now() + 8 * 3_600_000);
  return new Date(`${shifted.toISOString().slice(0, 10)}T00:00:00+08:00`).toISOString();
}

function chinaDayKey(date) {
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function lastChinaDays(count) {
  const today = Date.now();
  const days = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    days.push(chinaDayKey(new Date(today - i * 86_400_000)));
  }
  return days;
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
  const activitySince = new Date(now.getTime() - 15 * 86_400_000).toISOString();
  const locationSince = new Date(now.getTime() - 30 * 86_400_000).toISOString();

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
    loginSeries,
    registerSeries,
    locationRows,
    recentLoginRows,
    storage,
    onlineRows,
    recentRows,
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
    env.DB.prepare(
      `SELECT substr(datetime(created_at, '+8 hours'), 1, 10) AS day,
              COUNT(*) AS logins, COUNT(DISTINCT user_id) AS users
       FROM study_sessions WHERE created_at >= ? GROUP BY day`,
    )
      .bind(activitySince)
      .all(),
    env.DB.prepare(
      `SELECT substr(datetime(created_at, '+8 hours'), 1, 10) AS day,
              COUNT(*) AS total
       FROM study_users WHERE created_at >= ? GROUP BY day`,
    )
      .bind(activitySince)
      .all(),
    env.DB.prepare(
      `SELECT country, region, city, COUNT(*) AS sessions,
              COUNT(DISTINCT user_id) AS users
       FROM study_sessions WHERE created_at >= ?
         AND (COALESCE(country, '') <> '' OR COALESCE(region, '') <> '' OR COALESCE(city, '') <> '')
       GROUP BY country, region, city
       ORDER BY sessions DESC LIMIT 8`,
    )
      .bind(locationSince)
      .all(),
    env.DB.prepare(
      `SELECT u.username, s.created_at AS at, s.country, s.region, s.city,
              s.colo, s.user_agent
       FROM study_sessions s JOIN study_users u ON u.id = s.user_id
       ORDER BY s.created_at DESC LIMIT 20`,
    ).all(),
    env.DB.prepare(
      'SELECT COALESCE(SUM(LENGTH(state_json)), 0) AS bytes, MAX(updated_at) AS last FROM study_state',
    ).first(),
    env.DB.prepare(
      `SELECT u.username, s.user_id, COALESCE(s.last_seen_at, s.created_at) AS seen,
              s.created_at AS login_at, s.user_agent, s.expires_at,
              s.country, s.region, s.city, s.colo, s.timezone
       FROM study_sessions s JOIN study_users u ON u.id = s.user_id
       WHERE s.expires_at > ? AND COALESCE(s.last_seen_at, s.created_at) >= ?
       ORDER BY seen DESC LIMIT 200`,
    )
      .bind(nowIso, onlineSince)
      .all(),
    env.DB.prepare(
      `SELECT u.username, t.user_id, t.updated_at, LENGTH(t.state_json) AS bytes, t.revision
       FROM study_state t JOIN study_users u ON u.id = t.user_id
       ORDER BY t.updated_at DESC LIMIT 20`,
    ).all(),
  ]);

  // 同一个人可能有多条会话（每台设备一次登录），按人去重只留最近活跃。
  const onlineByUser = new Map();
  for (const row of onlineRows.results || []) {
    const existing = onlineByUser.get(row.user_id);
    if (existing && existing.seen >= row.seen) continue;
    onlineByUser.set(row.user_id, row);
  }
  const online = [...onlineByUser.values()].sort((a, b) => (a.seen < b.seen ? 1 : -1));

  const loginMap = new Map(
    (loginSeries.results || []).map((row) => [row.day, row]),
  );
  const registerMap = new Map(
    (registerSeries.results || []).map((row) => [row.day, row]),
  );
  const activity = lastChinaDays(14).map((day) => {
    const login = loginMap.get(day);
    const register = registerMap.get(day);
    return {
      date: day,
      logins: Number(login?.logins ?? 0),
      users: Number(login?.users ?? 0),
      registrations: Number(register?.total ?? 0),
    };
  });

  const cf = request.cf || {};
  return json({
    now: nowIso,
    runtime: {
      colo: typeof cf.colo === 'string' ? cf.colo : '',
      region: typeof cf.region === 'string' ? cf.region : '',
      city: typeof cf.city === 'string' ? cf.city : '',
      country: typeof cf.country === 'string' ? cf.country : '',
      timezone: typeof cf.timezone === 'string' ? cf.timezone : '',
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
    activity,
    locations: (locationRows.results || []).map((row) => ({
      country: row.country || '',
      region: row.region || '',
      city: row.city || '',
      sessions: Number(row.sessions ?? 0),
      users: Number(row.users ?? 0),
    })),
    recentLogins: (recentLoginRows.results || []).map((row) => ({
      username: row.username,
      at: row.at,
      country: row.country || '',
      region: row.region || '',
      city: row.city || '',
      colo: row.colo || '',
      userAgent: row.user_agent || '',
    })),
    online: online.map((row) => ({
      userId: row.user_id,
      username: row.username,
      lastSeenAt: row.seen,
      loginAt: row.login_at,
      userAgent: row.user_agent || '',
      expiresAt: row.expires_at,
      country: row.country || '',
      region: row.region || '',
      city: row.city || '',
      colo: row.colo || '',
      timezone: row.timezone || '',
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
    'CREATE TABLE IF NOT EXISTS study_users (id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, email TEXT, email_key TEXT, email_verified_at TEXT, salt TEXT NOT NULL, password_hash TEXT NOT NULL, iterations INTEGER NOT NULL, created_at TEXT NOT NULL, last_login_at TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS study_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT, user_agent TEXT, country TEXT, region TEXT, city TEXT, colo TEXT, timezone TEXT, ip_hash TEXT)',
    'CREATE INDEX IF NOT EXISTS idx_study_sessions_user ON study_sessions (user_id)',
    'CREATE INDEX IF NOT EXISTS idx_study_sessions_created ON study_sessions (created_at)',
    'CREATE INDEX IF NOT EXISTS idx_study_sessions_expires ON study_sessions (expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_study_users_created ON study_users (created_at)',
    'CREATE TABLE IF NOT EXISTS study_state (user_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1)',
    'CREATE TABLE IF NOT EXISTS study_email_codes (id TEXT PRIMARY KEY, email TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, ip_hash TEXT)',
    'CREATE INDEX IF NOT EXISTS idx_study_email_codes_email ON study_email_codes (email, purpose, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_study_email_codes_ip ON study_email_codes (ip_hash, created_at)',
    'CREATE TABLE IF NOT EXISTS study_auth_failures (id TEXT PRIMARY KEY, username_key TEXT NOT NULL, ip_hash TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS idx_study_auth_failures_pair ON study_auth_failures (username_key, ip_hash, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_study_auth_failures_ip ON study_auth_failures (ip_hash, created_at)',
  ];
  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
  // 老库补列：重复执行会报 duplicate column，忽略即可。
  const columns = [
    'ALTER TABLE study_users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE study_users ADD COLUMN email TEXT',
    'ALTER TABLE study_users ADD COLUMN email_key TEXT',
    'ALTER TABLE study_users ADD COLUMN email_verified_at TEXT',
    'ALTER TABLE study_sessions ADD COLUMN last_seen_at TEXT',
    'ALTER TABLE study_sessions ADD COLUMN user_agent TEXT',
    'ALTER TABLE study_sessions ADD COLUMN country TEXT',
    'ALTER TABLE study_sessions ADD COLUMN region TEXT',
    'ALTER TABLE study_sessions ADD COLUMN city TEXT',
    'ALTER TABLE study_sessions ADD COLUMN colo TEXT',
    'ALTER TABLE study_sessions ADD COLUMN timezone TEXT',
    'ALTER TABLE study_sessions ADD COLUMN ip_hash TEXT',
  ];
  for (const sql of columns) {
    try {
      await env.DB.prepare(sql).run();
    } catch {
      // 列已存在。
    }
  }
  // 多个 NULL 不冲突，老账号可以没有邮箱。索引建失败也不能让整个站点不可用。
  try {
    await env.DB.prepare(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_study_users_email ON study_users (email_key)',
    ).run();
  } catch (error) {
    console.error('email unique index failed', String(error?.name || 'error'));
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
    if (path === '/api/auth/email-code') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return await handleSendEmailCode(request, env);
    }
    if (path === '/api/auth/reset-password') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return await handleResetPassword(request, env);
    }
    if (path === '/api/auth/bind-email') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return await handleBindEmail(request, env);
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
  } catch (error) {
    console.error('study cloud failed', String(error?.name || 'error'));
    return json({ error: 'cloud_unavailable' }, 503);
  }
}
