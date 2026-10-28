import { computed, ref } from 'vue';

import { canWriteLocalStorage, readJson, writeJson } from './storage';

export interface LocalAccount {
  id: string;
  username: string;
  usernameKey: string;
  salt: string;
  hash: string;
  createdAt: string;
  lastLoginAt: string;
}

interface LocalSession {
  userId: string;
  loginAt: string;
}

const USERS_KEY = 'qingyan-study-room:users:v1';
const SESSION_KEY = 'qingyan-study-room:session:v1';
const POMODORO_KEY = 'qingyan-study-room:pomodoro:v1';
const REMINDER_KEY = 'qingyan-study-room:focus-reminder:v1';
export const LEGACY_MIGRATED_KEY = 'qingyan-study-room:legacy-migrated-to:v1';

const PBKDF2_ITERATIONS = 120_000;
const USERNAME_MIN = 2;
const USERNAME_MAX = 24;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;

export const LOCAL_STORAGE_ERROR_MESSAGE =
  '当前浏览器无法保存本地数据，换用普通浏览器窗口（不要用无痕模式或内嵌预览）打开后再试';
const SESSION_ERROR_MESSAGE =
  '账号数据已保存，但当前浏览器无法保存登录状态，请直接用该账号登录';


function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAccount(raw: unknown): LocalAccount | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== 'string' ||
    typeof raw.username !== 'string' ||
    typeof raw.usernameKey !== 'string' ||
    typeof raw.salt !== 'string' ||
    typeof raw.hash !== 'string' ||
    typeof raw.createdAt !== 'string' ||
    typeof raw.lastLoginAt !== 'string'
  ) {
    return null;
  }
  return {
    id: raw.id,
    username: raw.username,
    usernameKey: raw.usernameKey,
    salt: raw.salt,
    hash: raw.hash,
    createdAt: raw.createdAt,
    lastLoginAt: raw.lastLoginAt,
  };
}

function readAccounts(): LocalAccount[] {
  const raw = readJson<unknown>(USERS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeAccount)
    .filter((user): user is LocalAccount => user !== null);
}

function writeAccounts(next: LocalAccount[]): boolean {
  if (!writeJson(USERS_KEY, next)) return false;
  const restored = readJson<unknown>(USERS_KEY, null);
  if (!Array.isArray(restored) || restored.length !== next.length) return false;
  localAccounts.value = next;
  return true;
}

function readSession(): LocalSession | null {
  const raw = readJson<unknown>(SESSION_KEY, null);
  if (!isRecord(raw) || typeof raw.userId !== 'string' || !raw.userId) {
    return null;
  }
  return {
    userId: raw.userId,
    loginAt: typeof raw.loginAt === 'string' ? raw.loginAt : '',
  };
}

function writeSession(userId: string): boolean {
  if (
    !writeJson(SESSION_KEY, { userId, loginAt: new Date().toISOString() })
  ) {
    return false;
  }
  const restored = readJson<unknown>(SESSION_KEY, null);
  return isRecord(restored) && restored.userId === userId;
}

function removeSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // 本地存储不可用时忽略。
  }
}

export const localAccounts = ref<LocalAccount[]>(readAccounts());
export const hasLocalAccounts = computed(() => localAccounts.value.length > 0);
export const currentUser = ref<LocalAccount | null>(null);
export const localDisplayName = computed(() => currentUser.value?.username ?? '');

/** 当前浏览器是否能把数据写入本地存储；为 false 时注册无法真正保存。 */
export const canPersistLocalData = ref(canWriteLocalStorage());

export function refreshLocalStorageSupport(): boolean {
  canPersistLocalData.value = canWriteLocalStorage();
  return canPersistLocalData.value;
}

const initialSession = readSession();
if (initialSession) {
  const existing = localAccounts.value.find(
    (user) => user.id === initialSession.userId,
  );
  if (existing) currentUser.value = existing;
  else removeSession();
}

export function localStateKey(userId: string): string {
  return `qingyan-study-room:state:v1:${userId}`;
}

export function localProfileKey(userId: string): string {
  return `qingyan-study-room:profile:v1:${userId}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64(bytes);
}

function makeId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deriveHash(password: string, salt: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前浏览器不支持安全存储，请使用现代浏览器');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const saltBuffer = Uint8Array.from(base64ToBytes(salt)).buffer;
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function normalizeUsername(value: string): string {
  return value.trim();
}

function usernameKeyOf(value: string): string {
  return normalizeUsername(value).toLowerCase();
}

function validateUsername(value: string): string {
  const username = normalizeUsername(value);
  if (username.length < USERNAME_MIN) {
    throw new Error(`用户名至少 ${USERNAME_MIN} 个字符`);
  }
  if (username.length > USERNAME_MAX) {
    throw new Error(`用户名最多 ${USERNAME_MAX} 个字符`);
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(username)) {
    throw new Error('用户名只能包含文字、数字、下划线或短横线');
  }
  return username;
}

function validatePassword(value: string): string {
  if (value.length < PASSWORD_MIN) {
    throw new Error(`密码至少 ${PASSWORD_MIN} 位`);
  }
  if (value.length > PASSWORD_MAX) {
    throw new Error(`密码最多 ${PASSWORD_MAX} 位`);
  }
  return value;
}

function setCurrentUser(user: LocalAccount): void {
  if (!writeSession(user.id)) {
    throw new Error(SESSION_ERROR_MESSAGE);
  }
  currentUser.value = user;
  try {
    window.localStorage.removeItem(POMODORO_KEY);
    window.localStorage.removeItem(REMINDER_KEY);
  } catch {
    // 忽略本地存储不可用。
  }
}

export async function registerLocalUser(
  usernameInput: string,
  passwordInput: string,
): Promise<LocalAccount> {
  const username = validateUsername(usernameInput);
  const password = validatePassword(passwordInput);
  const usernameKey = usernameKeyOf(username);
  if (localAccounts.value.some((user) => user.usernameKey === usernameKey)) {
    throw new Error('用户名已存在');
  }
  const salt = randomSalt();
  const hash = await deriveHash(password, salt);
  const now = new Date().toISOString();
  const user: LocalAccount = {
    id: makeId(),
    username,
    usernameKey,
    salt,
    hash,
    createdAt: now,
    lastLoginAt: now,
  };
  if (!writeAccounts([...localAccounts.value, user])) {
    throw new Error(LOCAL_STORAGE_ERROR_MESSAGE);
  }
  setCurrentUser(user);
  return user;
}

export async function loginLocalUser(
  usernameInput: string,
  passwordInput: string,
): Promise<LocalAccount> {
  const usernameKey = usernameKeyOf(usernameInput);
  const user = localAccounts.value.find(
    (item) => item.usernameKey === usernameKey,
  );
  const hash = user
    ? await deriveHash(passwordInput, user.salt)
    : '';
  if (!user || hash !== user.hash) {
    throw new Error('用户名或密码不正确');
  }
  const nextUser = { ...user, lastLoginAt: new Date().toISOString() };
  const nextList = localAccounts.value.map((item) =>
    item.id === user.id ? nextUser : item,
  );
  if (!writeAccounts(nextList)) {
    // 账号本体仍在本地存储中，只是这次登录时间没写进去，不阻断登录。
    console.warn('[local-auth] 无法更新账号登录时间', LOCAL_STORAGE_ERROR_MESSAGE);
  }
  setCurrentUser(nextUser);
  return nextUser;
}

export function logoutLocalAccount(): void {
  currentUser.value = null;
  removeSession();
  try {
    window.localStorage.removeItem(POMODORO_KEY);
    window.localStorage.removeItem(REMINDER_KEY);
  } catch {
    // 忽略本地存储不可用。
  }
}

export function restoreLocalSession(): LocalAccount | null {
  const session = readSession();
  if (!session) return null;
  const user = localAccounts.value.find((item) => item.id === session.userId);
  if (!user) {
    removeSession();
    return null;
  }
  currentUser.value = user;
  return user;
}
