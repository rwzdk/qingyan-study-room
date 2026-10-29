import { handleStudyCloud } from './study-cloud.js';

const MAX_BODY_BYTES = 4096;
const MAX_AUTHOR_NAME_BYTES = 64;
const MAX_CONTENT_CHARS = 500;
const MAX_CONTENT_BYTES = 4000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const AUTHOR_ID = /^[A-Za-z0-9_-]{1,64}$/;
const encoder = new TextEncoder();

// 语音提醒走阿里云百炼 Qwen3-TTS，与 qc-student 用的是同一套服务与音色。
const DASHSCOPE_TTS_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const TTS_MODEL = 'qwen3-tts-flash';
const TTS_MAX_TEXT_CHARS = 200;
const TTS_DEFAULT_VOICE = 'Momo';
// 音色名区分大小写，只放行官方列表里确认过的值，避免把任意字符串转给上游。
const TTS_VOICES = new Set([
  'Cherry',
  'Serena',
  'Ethan',
  'Chelsie',
  'Momo',
  'Vivian',
  'Moon',
  'Maia',
  'Kai',
  'Nofish',
  'Bella',
  'Jennifer',
]);

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  // 云端状态同步会带 Authorization 头，预检必须放行，否则浏览器直接拦截请求。
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

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function validAuthorId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return AUTHOR_ID.test(id) ? id : null;
}

function validAuthorName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (
    !name ||
    encoder.encode(name).length > MAX_AUTHOR_NAME_BYTES ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    return null;
  }
  return name;
}

function validContent(value) {
  if (typeof value !== 'string') return null;
  const content = value.replace(/\r\n?/g, '\n').trim();
  if (
    !content ||
    content.length > MAX_CONTENT_CHARS ||
    encoder.encode(content).length > MAX_CONTENT_BYTES ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)
  ) {
    return null;
  }
  return content;
}

function chatLimit(value) {
  if (value === null) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(value)) return null;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT
    ? limit
    : null;
}

function messageOf(row) {
  if (
    !isRecord(row) ||
    typeof row.id !== 'string' ||
    typeof row.author_id !== 'string' ||
    typeof row.author_name !== 'string' ||
    typeof row.content !== 'string' ||
    typeof row.created_at !== 'string' ||
    Number.isNaN(Date.parse(row.created_at))
  ) {
    return null;
  }
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name,
    content: row.content,
    createdAt: row.created_at,
  };
}

async function listMessages(env, url) {
  const limit = chatLimit(url.searchParams.get('limit'));
  if (limit === null) return json({ error: 'invalid_input' }, 400);

  const result = await env.DB.prepare(
    'SELECT id, author_id, author_name, content, created_at FROM chat_messages ORDER BY created_at DESC LIMIT ?',
  )
    .bind(limit)
    .all();
  const rows = Array.isArray(result.results) ? result.results : [];
  const messages = rows
    .map(messageOf)
    .filter((message) => message !== null)
    .reverse();
  return json({ messages, now: new Date().toISOString() });
}

async function createMessage(env, request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'invalid_input' }, 415);
  }

  const contentLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'invalid_input' }, 413);
  }

  const raw = await request.text();
  if (encoder.encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: 'invalid_input' }, 413);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }
  if (!isRecord(input)) return json({ error: 'invalid_input' }, 400);

  const authorId = validAuthorId(input.authorId);
  const authorName = validAuthorName(input.authorName);
  const content = validContent(input.content);
  if (!authorId || !authorName || !content) {
    return json({ error: 'invalid_input' }, 400);
  }

  const last = await env.DB.prepare(
    'SELECT created_at FROM chat_messages WHERE author_id = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(authorId)
    .first();
  if (
    last &&
    typeof last.created_at === 'string' &&
    Date.now() - Date.parse(last.created_at) < 1000
  ) {
    return json({ error: 'chat_slow_down' }, 429);
  }

  const message = {
    id: crypto.randomUUID(),
    authorId,
    authorName,
    content,
    createdAt: new Date().toISOString(),
  };
  await env.DB.prepare(
    'INSERT INTO chat_messages (id, author_id, author_name, content, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      message.id,
      message.authorId,
      message.authorName,
      message.content,
      message.createdAt,
    )
    .run();
  return json({ message }, 201);
}

async function synthesizeSpeech(request, env) {
  if (!env.QWEN_TTS_API_KEY) return json({ error: 'tts_unavailable' }, 503);

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }
  if (!isRecord(input)) return json({ error: 'invalid_input' }, 400);

  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > TTS_MAX_TEXT_CHARS) {
    return json({ error: 'invalid_input' }, 400);
  }
  const voice = TTS_VOICES.has(input.voice) ? input.voice : TTS_DEFAULT_VOICE;
  const speed = Number.isFinite(input.speed)
    ? Math.min(2, Math.max(0.5, input.speed))
    : 1;
  // 百炼用语速偏移量（-500~500），前端传的是倍速，这里换算。
  const rate = Math.round((speed - 1) * 500);

  let synthesis;
  try {
    synthesis = await fetch(DASHSCOPE_TTS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.QWEN_TTS_API_KEY}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: { text, voice, language_type: 'Chinese' },
        parameters: { rate },
      }),
    });
  } catch (caught) {
    // 只回阶段与错误名，不带密钥与上游正文。
    return json(
      { error: 'tts_failed', stage: 'synthesis', reason: String(caught?.name) },
      502,
    );
  }
  if (!synthesis.ok) {
    const detail = await synthesis.text().catch(() => '');
    return json(
      {
        error: 'tts_failed',
        stage: 'synthesis_status',
        status: synthesis.status,
        hint: detail.slice(0, 160),
      },
      502,
    );
  }

  const payload = await synthesis.json().catch(() => null);
  const audioUrl = isRecord(payload)
    ? payload.output?.audio?.url
    : null;
  // 上游给的是带签名的 OSS 直链（可能是 http），由 Worker 代取后再回给页面，
  // 否则 HTTPS 站点会把它当混合内容拦掉，密钥也不会外泄。
  if (typeof audioUrl !== 'string' || !/^https?:\/\//i.test(audioUrl)) {
    return json({ error: 'tts_failed', stage: 'no_audio_url' }, 502);
  }

  let audio;
  try {
    audio = await fetch(audioUrl);
  } catch (caught) {
    return json(
      { error: 'tts_failed', stage: 'download', reason: String(caught?.name) },
      502,
    );
  }
  if (!audio.ok || !audio.body) {
    return json(
      { error: 'tts_failed', stage: 'download_status', status: audio.status },
      502,
    );
  }

  return new Response(audio.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'cache-control': 'no-store',
      'content-type':
        audio.headers.get('content-type') ?? 'audio/wav',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 自习室云端账号与数据（/api/auth/*、/api/state）
    const cloudResponse = await handleStudyCloud(request, env, url);
    if (cloudResponse) return cloudResponse;

    if (url.pathname === '/api/tts') {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      }
      try {
        return await synthesizeSpeech(request, env);
      } catch {
        return json({ error: 'tts_failed' }, 502);
      }
    }

    if (url.pathname !== '/api/chat') {
      return json({ error: 'not_found' }, 404);
    }

    try {
      if (request.method === 'GET') {
        return await listMessages(env, url);
      }
      if (request.method === 'POST') {
        return await createMessage(env, request);
      }
      return json(
        { error: 'method_not_allowed' },
        405,
        { allow: 'GET, POST' },
      );
    } catch {
      return json({ error: 'chat_unavailable' }, 503);
    }
  },
};
