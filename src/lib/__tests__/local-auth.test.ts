import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

const USERS_KEY = 'qingyan-study-room:users:v1';
const SESSION_KEY = 'qingyan-study-room:session:v1';

async function loadAuth() {
  vi.resetModules();
  return await import('#/lib/local-auth');
}

describe('local-auth 本地账号', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('注册后账号与登录状态都会写入本地存储', async () => {
    const auth = await loadAuth();
    const user = await auth.registerLocalUser('tester', 'pass1234');

    const stored = JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].username).toBe('tester');
    expect(stored[0].hash).not.toBe('pass1234');
    expect(localStorage.getItem(SESSION_KEY)).toContain(user.id);
    expect(auth.currentUser.value?.id).toBe(user.id);
  });

  it('重新加载页面后可以用同一账号登录', async () => {
    const auth = await loadAuth();
    await auth.registerLocalUser('tester', 'pass1234');

    const reloaded = await loadAuth();
    expect(reloaded.hasLocalAccounts.value).toBe(true);
    const user = await reloaded.loginLocalUser('tester', 'pass1234');
    expect(user.username).toBe('tester');
  });

  it('密码错误时拒绝登录', async () => {
    const auth = await loadAuth();
    await auth.registerLocalUser('tester', 'pass1234');

    const reloaded = await loadAuth();
    await expect(reloaded.loginLocalUser('tester', 'wrong-pass')).rejects.toThrow(
      '用户名或密码不正确',
    );
  });

  it('浏览器拒绝写入时明确报错，且不留下内存中的假账号', async () => {
    const auth = await loadAuth();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    await expect(
      auth.registerLocalUser('tester', 'pass1234'),
    ).rejects.toThrow(/无法保存本地数据/);
    expect(auth.localAccounts.value).toHaveLength(0);
    expect(auth.currentUser.value).toBeNull();
  });

  it('存储写入失败后同名账号仍可重新注册', async () => {
    const auth = await loadAuth();
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      });
    await expect(
      auth.registerLocalUser('tester', 'pass1234'),
    ).rejects.toThrow();
    setItem.mockRestore();

    const user = await auth.registerLocalUser('tester', 'pass1234');
    expect(user.username).toBe('tester');
  });
});
