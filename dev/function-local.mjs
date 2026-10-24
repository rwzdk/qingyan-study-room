import { createServer } from 'node:http';

import { handleStudyRoom } from '../functions/handler.mjs';
import { createFakeSupabase } from './fake-supabase.mjs';

const HOST = '127.0.0.1';
const PORT = 8000;
const supabase = createFakeSupabase();

function fixtureUserContext() {
  const context = {
    user_id: 'fixture-user',
    name: '测试同学',
    picture: '',
    site_id: 'fixture',
    host_id: 'fixture',
    session_expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
  };
  return Buffer.from(JSON.stringify(context)).toString('base64url');
}

function hasAnonymousCookie(cookieHeader) {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((part) => {
    const [name, ...rest] = part.trim().split('=');
    return name === 'fixture' && rest.join('=').trim() === 'anonymous';
  });
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  try {
    const body = await readRequestBody(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(', '));
      else if (typeof value === 'string') headers.set(name, value);
    }
    if (!hasAnonymousCookie(headers.get('cookie'))) {
      headers.set('x-qoder-user-context', fixtureUserContext());
    }

    const init = { method: request.method ?? 'GET', headers };
    if (body.length > 0 && request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = body;
    }
    const url = `http://${HOST}:${PORT}${request.url ?? '/'}`;
    const result = await handleStudyRoom({
      request: new Request(url, init),
      supabase,
    });

    response.statusCode = result.status;
    result.headers.forEach((value, name) => response.setHeader(name, value));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.statusCode = 503;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'private, no-store');
    response.end(JSON.stringify({ error: 'service_unavailable' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `Study room function fixture: http://${HOST}:${PORT}/functions/v1/app?action=bootstrap`,
  );
});
