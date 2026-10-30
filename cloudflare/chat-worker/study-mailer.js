// 验证码邮件：沿用 qc-student 的 QQ 邮箱 SMTP（smtp.qq.com:465，SSL + 授权码）。
// Workers 不能连 25 端口，465/587 可用；这里固定走 465 隐式 TLS。
import { WorkerMailer } from 'worker-mailer';

const DEFAULT_SENDER_NAME = '栖心自习室';
const EHLO_NAME = 'mindofqc.dpdns.org';
const MAIL_TIMEOUT_MS = 8_000;

const COPY = {
  register: {
    subject: '栖心自习室 注册验证码',
    action: '注册',
  },
  reset: {
    subject: '栖心自习室 重置密码验证码',
    action: '重置密码',
  },
  bind: {
    subject: '栖心自习室 绑定邮箱验证码',
    action: '绑定邮箱',
  },
};

export function mailReady(env) {
  return !!(
    env &&
    env.MAIL_HOST &&
    env.MAIL_USERNAME &&
    env.MAIL_PASSWORD
  );
}

/** 发信失败时只把错误抛给调用方，验证码本身绝不写日志。 */
export async function sendVerificationEmail(env, { to, code, purpose }) {
  const copy = COPY[purpose] ?? COPY.register;
  const port = Number(env.MAIL_PORT);
  const secure = String(env.MAIL_SECURE ?? 'true').toLowerCase() !== 'false';
  const from = env.MAIL_FROM || env.MAIL_USERNAME;

  const mailer = await WorkerMailer.connect({
    host: env.MAIL_HOST,
    port: Number.isFinite(port) ? port : 465,
    secure,
    startTls: !secure,
    credentials: {
      username: env.MAIL_USERNAME,
      password: env.MAIL_PASSWORD,
    },
    // QQ 邮箱对 AUTH LOGIN 的兼容性最好，qc-student 也是显式走 LOGIN。
    authType: 'login',
    name: EHLO_NAME,
    socketTimeoutMs: MAIL_TIMEOUT_MS,
    responseTimeoutMs: MAIL_TIMEOUT_MS,
    logLevel: 4,
  });
  try {
    await mailer.send({
      from: {
        name: env.MAIL_SENDER_NAME || DEFAULT_SENDER_NAME,
        email: from,
      },
      to,
      subject: copy.subject,
      text: [
        '你好！',
        '',
        `你正在栖心自习室完成${copy.action}。验证码：${code}`,
        '验证码 10 分钟内有效，请勿告诉他人。',
        '',
        '如果这不是你的操作，忽略这封邮件即可。',
      ].join('\n'),
    });
  } finally {
    // 静态 send() 在失败时不会关闭连接，这里显式收尾，避免接续请求泄漏 socket。
    await mailer.close().catch(() => {});
  }
}
