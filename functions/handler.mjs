import { requireUser, UserContextError } from './auth.mjs';

// Keep in sync with the Function contract in docs/specs: bodies are capped at 1 MiB.
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_NICKNAME_BYTES = 64;
const MAX_AVATAR_CHARS = 200000;
const MAX_MOOD_CHARS = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const STATE_LIMITS = {
  checkins: 4000,
  plans: 500,
  docs: 500,
  todos: 2000,
  focus_sessions: 20000,
};
const encoder = new TextEncoder();

const json = (value, status = 200, extra = {}) =>
  Response.json(value, {
    status,
    headers: { 'cache-control': 'private, no-store', ...extra },
  });

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const accountOf = (user) => ({
  id: user.user_id,
  name: user.name,
  picture: user.picture,
});

const rowSnapshot = (row) => ({
  profile: row?.profile ?? null,
  state: row?.state ?? null,
  updatedAt: row?.updated_at ?? null,
});

function validCheckin(value) {
  if (
    !isRecord(value) ||
    typeof value.date !== 'string' ||
    typeof value.hours !== 'number' ||
    !Number.isFinite(value.hours)
  ) {
    return null;
  }
  if (
    value.mood !== undefined &&
    (typeof value.mood !== 'string' || value.mood.length > MAX_MOOD_CHARS)
  ) {
    return null;
  }
  const checkin = { date: value.date, hours: value.hours };
  if (value.mood !== undefined) checkin.mood = value.mood;
  return checkin;
}

function validPlan(value) {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.goal !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !Array.isArray(value.tasks)
  ) {
    return null;
  }
  const tasks = [];
  for (const task of value.tasks) {
    if (
      !isRecord(task) ||
      typeof task.id !== 'string' ||
      typeof task.title !== 'string' ||
      typeof task.done !== 'boolean'
    ) {
      return null;
    }
    tasks.push({ id: task.id, title: task.title, done: task.done });
  }
  return {
    id: value.id,
    name: value.name,
    goal: value.goal,
    tasks,
    createdAt: value.createdAt,
  };
}

function validDoc(value) {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.content !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    content: value.content,
    updatedAt: value.updatedAt,
  };
}

function validTodo(value) {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.completed !== 'boolean'
  ) {
    return null;
  }
  return { id: value.id, title: value.title, completed: value.completed };
}

function validFocusSession(value) {
  if (
    !isRecord(value) ||
    typeof value.minutes !== 'number' ||
    !Number.isFinite(value.minutes) ||
    typeof value.sessionId !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    minutes: value.minutes,
    sessionId: value.sessionId,
    createdAt: value.createdAt,
  };
}

const STATE_ITEM_VALIDATORS = {
  checkins: validCheckin,
  plans: validPlan,
  docs: validDoc,
  todos: validTodo,
  focus_sessions: validFocusSession,
};

function validState(value) {
  if (!isRecord(value)) return null;
  const state = {};
  for (const [key, limit] of Object.entries(STATE_LIMITS)) {
    const list = value[key];
    if (!Array.isArray(list) || list.length > limit) return null;
    const items = [];
    for (const item of list) {
      const parsed = STATE_ITEM_VALIDATORS[key](item);
      if (parsed === null) return null;
      items.push(parsed);
    }
    state[key] = items;
  }
  return state;
}

function validProfile(value) {
  if (!isRecord(value)) return null;
  const { nickname, avatar, joinedAt } = value;
  if (
    typeof nickname !== 'string' ||
    encoder.encode(nickname).length > MAX_NICKNAME_BYTES
  ) {
    return null;
  }
  if (
    typeof avatar !== 'string' ||
    avatar.length > MAX_AVATAR_CHARS ||
    (avatar !== '' &&
      !avatar.startsWith('https://') &&
      !avatar.startsWith('data:image/'))
  ) {
    return null;
  }
  if (
    typeof joinedAt !== 'string' ||
    (joinedAt !== '' && !ISO_DATE.test(joinedAt))
  ) {
    return null;
  }
  return { nickname, avatar, joinedAt };
}

function validBaseUpdatedAt(value) {
  if (value === null) return { ok: true, value: null };
  if (
    typeof value !== 'string' ||
    !ISO_TIMESTAMP.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return { ok: false, value: null };
  }
  return { ok: true, value };
}

async function readJsonBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return { status: 400, value: null };
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The stream is already being discarded.
        }
        return { status: 413, value: null };
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Cancellation already released the reader.
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    return { status: 200, value };
  } catch {
    return { status: 400, value: null };
  }
}

function nextUpdatedAt(baseUpdatedAt) {
  const now = Date.now();
  if (baseUpdatedAt !== null) {
    const base = Date.parse(baseUpdatedAt);
    if (Number.isFinite(base) && now <= base) {
      return new Date(base + 1).toISOString();
    }
  }
  return new Date(now).toISOString();
}

async function readCurrentRow(supabase, userId) {
  return supabase
    .from('study_room_states')
    .select('profile,state,updated_at')
    .eq('user_id', userId)
    .maybeSingle();
}

export async function handleStudyRoom({ request, supabase }) {
  let writePath = false;
  try {
    const action = new URL(request.url).searchParams.get('action');
    if (action !== 'bootstrap' && action !== 'state') {
      return json({ error: 'not_found' }, 404);
    }

    if (action === 'bootstrap') {
      if (request.method !== 'GET') {
        return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
      }
      const user = requireUser(request);
      const { data, error } = await supabase
        .from('study_room_states')
        .select('profile,state,updated_at')
        .eq('user_id', user.user_id)
        .maybeSingle();
      if (error) return json({ error: 'state_unavailable' }, 503);
      const account = accountOf(user);
      if (!data) {
        return json({ user: account, profile: null, state: null, updatedAt: null });
      }
      return json({ user: account, ...rowSnapshot(data) });
    }

    writePath = true;
    if (request.method !== 'PUT') {
      return json({ error: 'method_not_allowed' }, 405, { allow: 'PUT' });
    }
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return json({ error: 'invalid_input' }, 415);
    }
    const user = requireUser(request);

    const body = await readJsonBody(request);
    if (body.status !== 200) {
      return json({ error: 'invalid_input' }, body.status);
    }
    const input = body.value;
    if (!isRecord(input)) return json({ error: 'invalid_input' }, 400);
    const profile = validProfile(input.profile);
    const state = validState(input.state);
    const base = validBaseUpdatedAt(input.baseUpdatedAt);
    if (!profile || !state || !base.ok) {
      return json({ error: 'invalid_input' }, 400);
    }

    // Ownership always comes from the verified Qoder context, never from JSON.
    const updatedAt = nextUpdatedAt(base.value);
    if (base.value === null) {
      const inserted = await supabase
        .from('study_room_states')
        .insert({ user_id: user.user_id, profile, state, updated_at: updatedAt })
        .select('profile,state,updated_at')
        .single();
      if (inserted.error) {
        if (inserted.error.code === '23505') {
          const current = await readCurrentRow(supabase, user.user_id);
          if (current.error) return json({ error: 'state_unavailable' }, 503);
          return json(
            { error: 'conflict', current: rowSnapshot(current.data) },
            409,
          );
        }
        return json({ error: 'write_result_unknown' }, 503);
      }
      if (!inserted.data) {
        return json({ error: 'write_result_unknown' }, 503);
      }
      return json(rowSnapshot(inserted.data));
    }

    const updated = await supabase
      .from('study_room_states')
      .update({ profile, state, updated_at: updatedAt })
      .eq('user_id', user.user_id)
      .eq('updated_at', base.value)
      .select('profile,state,updated_at')
      .maybeSingle();
    if (updated.error) {
      return json({ error: 'write_result_unknown' }, 503);
    }
    if (!updated.data) {
      const current = await readCurrentRow(supabase, user.user_id);
      if (current.error) return json({ error: 'state_unavailable' }, 503);
      return json(
        { error: 'conflict', current: rowSnapshot(current.data) },
        409,
      );
    }
    return json(rowSnapshot(updated.data));
  } catch (error) {
    if (error instanceof UserContextError) {
      return json({ error: error.code }, error.status);
    }
    return json(
      { error: writePath ? 'write_result_unknown' : 'state_unavailable' },
      503,
    );
  }
}
