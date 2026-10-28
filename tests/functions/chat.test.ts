// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createFakeSupabase } from '../../dev/fake-supabase.mjs';
import { handleStudyRoom } from '../../functions/handler.mjs';

const AUTHOR_ID = 'user-a';
const AUTHOR_NAME = '小明';
const VALID_MESSAGE = '今天也来专注了。';

function chatRequest(
  method = 'GET',
  options: {
    body?: string;
    contentType?: string | null;
    query?: Record<string, string>;
  } = {},
) {
  const params = new URLSearchParams({ action: 'chat', ...options.query });
  const headers = new Headers();
  if (options.body !== undefined && options.contentType !== null) {
    headers.set('content-type', options.contentType ?? 'application/json');
  }
  return new Request(`http://local/functions/v1/app?${params}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
}

async function call(
  supabase: any,
  method = 'GET',
  options: Parameters<typeof chatRequest>[1] = {},
) {
  const response = await handleStudyRoom({
    request: chatRequest(method, options),
    supabase,
  });
  const body = await response.json();
  return { response, body };
}

function messagePayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    authorId: AUTHOR_ID,
    authorName: AUTHOR_NAME,
    content: VALID_MESSAGE,
    ...overrides,
  });
}

describe('chat function handler', () => {
  it('lists an empty public room without requiring a Qoder session', async () => {
    const supabase = createFakeSupabase();
    const { response, body } = await call(supabase);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body.messages).toEqual([]);
    expect(typeof body.now).toBe('string');
  });

  it('writes a message and returns it from the shared list', async () => {
    const supabase = createFakeSupabase();
    const posted = await call(supabase, 'POST', {
      body: messagePayload({ content: '  你好\n世界  ' }),
    });
    expect(posted.response.status).toBe(201);
    expect(posted.response.headers.get('cache-control')).toBe('private, no-store');
    expect(posted.body.message).toMatchObject({
      authorId: AUTHOR_ID,
      authorName: AUTHOR_NAME,
      content: '你好\n世界',
    });
    expect(posted.body.message.id).toEqual(expect.any(String));
    expect(posted.body.message.createdAt).toEqual(expect.any(String));
    expect(supabase.chatRows()).toHaveLength(1);

    const listed = await call(supabase);
    expect(listed.response.status).toBe(200);
    expect(listed.body.messages).toHaveLength(1);
    expect(listed.body.messages[0]).toEqual(posted.body.message);
  });

  it('rejects invalid messages and unsupported methods without writing', async () => {
    const supabase = createFakeSupabase();
    const invalidBodies = [
      messagePayload({ content: '' }),
      messagePayload({ content: '   ' }),
      messagePayload({ content: 'x'.repeat(501) }),
      messagePayload({ authorId: 'bad id' }),
      messagePayload({ authorId: '' }),
      messagePayload({ authorName: '' }),
      messagePayload({ authorName: 'a'.repeat(65) }),
      messagePayload({ content: 'bad\u0000content' }),
      '{bad json',
    ];
    for (const body of invalidBodies) {
      const { response, body: result } = await call(supabase, 'POST', { body });
      expect(response.status).toBe(400);
      expect(result).toEqual({ error: 'invalid_input' });
    }

    const wrongType = await call(supabase, 'POST', {
      body: messagePayload(),
      contentType: 'text/plain',
    });
    expect(wrongType.response.status).toBe(415);

    const wrongMethod = await call(supabase, 'PUT', {
      body: messagePayload(),
    });
    expect(wrongMethod.response.status).toBe(405);
    expect(wrongMethod.response.headers.get('allow')).toBe('GET, POST');
    expect(wrongMethod.body).toEqual({ error: 'method_not_allowed' });
    expect(supabase.chatRows()).toHaveLength(0);
  });

  it('validates the history limit', async () => {
    const supabase = createFakeSupabase();
    for (const limit of ['0', '201', 'foo', '-1']) {
      const { response, body } = await call(supabase, 'GET', {
        query: { limit },
      });
      expect(response.status).toBe(400);
      expect(body).toEqual({ error: 'invalid_input' });
    }
  });

  it('bounds the number of returned messages', async () => {
    const supabase = createFakeSupabase();
    for (const content of ['第一条', '第二条', '第三条']) {
      const posted = await call(supabase, 'POST', {
        body: messagePayload({ content }),
      });
      expect(posted.response.status).toBe(201);
    }
    const { response, body } = await call(supabase, 'GET', {
      query: { limit: '2' },
    });
    expect(response.status).toBe(200);
    expect(body.messages).toHaveLength(2);
  });

  it('maps database failures to a fixed error without leaking details', async () => {
    const readQuery = {
      select() {
        return this;
      },
      order() {
        return this;
      },
      limit() {
        return Promise.resolve({ data: null, error: { code: 'XX000' } });
      },
    };
    const read = await call({ from: () => readQuery });
    expect(read.response.status).toBe(503);
    expect(read.body).toEqual({ error: 'chat_unavailable' });

    const writeQuery = {
      insert() {
        return this;
      },
      select() {
        return this;
      },
      single() {
        return Promise.resolve({ data: null, error: { code: 'XX000' } });
      },
    };
    const write = await call(
      { from: () => writeQuery },
      'POST',
      { body: messagePayload() },
    );
    expect(write.response.status).toBe(503);
    expect(write.body).toEqual({ error: 'chat_unavailable' });
    expect(JSON.stringify(write.body)).not.toContain('XX000');
  });
});
