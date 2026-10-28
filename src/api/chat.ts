export interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface ChatMessageInput {
  authorId: string;
  authorName: string;
  content: string;
}

export type ChatErrorCode =
  | 'network_error'
  | 'chat_unavailable'
  | 'invalid_input'
  | 'invalid_response'
  | 'unauthorized'
  | 'slow_down'
  | 'request_failed';

export class ChatApiError extends Error {
  readonly code: ChatErrorCode;
  readonly status: number;

  constructor(code: ChatErrorCode, status = 0) {
    super(code);
    this.name = 'ChatApiError';
    this.code = code;
    this.status = status;
  }
}

const CHAT_API_BASE = (
  (import.meta.env.VITE_CHAT_API_URL as string | undefined) ?? ''
).replace(/\/+$/, '');
const CHAT_ENDPOINT = `${CHAT_API_BASE}/api/chat`;
const DEFAULT_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.authorId === 'string' &&
    typeof value.authorName === 'string' &&
    typeof value.content === 'string' &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt))
  );
}

function errorFromResponse(status: number, payload: unknown): ChatApiError {
  if (status === 401 || status === 403) {
    return new ChatApiError('unauthorized', status);
  }
  if (status === 400) {
    return new ChatApiError('invalid_input', status);
  }
  if (status === 429) {
    return new ChatApiError('slow_down', status);
  }
  if (status === 503) {
    return new ChatApiError('chat_unavailable', status);
  }
  const code = isRecord(payload) ? payload.error : null;
  if (code === 'invalid_input') {
    return new ChatApiError('invalid_input', status);
  }
  if (code === 'chat_unavailable') {
    return new ChatApiError('chat_unavailable', status);
  }
  if (code === 'chat_slow_down') {
    return new ChatApiError('slow_down', status);
  }
  return new ChatApiError('request_failed', status);
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestChat(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...init.headers,
      },
      signal,
    });
  } catch (caught) {
    if (signal?.aborted || (caught instanceof DOMException && caught.name === 'AbortError')) {
      throw caught;
    }
    throw new ChatApiError('network_error');
  }

  const payload = await readPayload(response);
  if (!response.ok) {
    throw errorFromResponse(response.status, payload);
  }
  if (!isRecord(payload)) {
    throw new ChatApiError('invalid_response', response.status);
  }
  return payload;
}

export async function fetchChatMessages(
  limit = DEFAULT_LIMIT,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)));
  const payload = await requestChat(
    `${CHAT_ENDPOINT}?limit=${safeLimit}`,
    { method: 'GET' },
    signal,
  );
  if (!isRecord(payload) || !Array.isArray(payload.messages)) {
    throw new ChatApiError('invalid_response', 200);
  }
  return payload.messages.filter(isChatMessage);
}

export async function sendChatMessage(
  input: ChatMessageInput,
  signal?: AbortSignal,
): Promise<ChatMessage> {
  const payload = await requestChat(
    CHAT_ENDPOINT,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    signal,
  );
  if (!isRecord(payload) || !isChatMessage(payload.message)) {
    throw new ChatApiError('invalid_response', 201);
  }
  return payload.message;
}
