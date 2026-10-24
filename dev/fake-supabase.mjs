// In-memory stand-in for the Supabase client used by the study room Function.
// Supports only the chain shapes the handler relies on.
const clone = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

class Query {
  constructor(store, operation, payload) {
    this.store = store;
    this.operation = operation;
    this.payload = payload;
    this.filters = [];
  }

  select() {
    return this;
  }

  eq(column, value) {
    this.filters.push([column, value]);
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.run());
  }

  single() {
    return Promise.resolve(this.run());
  }

  run() {
    if (this.operation === 'insert') {
      const row = clone(this.payload);
      if (this.store.has(row.user_id)) {
        return { data: null, error: { code: '23505' } };
      }
      this.store.set(row.user_id, clone(row));
      return { data: clone(row), error: null };
    }

    const userId = this.filters.find(([column]) => column === 'user_id')?.[1];
    const row = this.store.get(userId);

    if (this.operation === 'select') {
      return { data: row ? clone(row) : null, error: null };
    }

    // update: only match when every filter equals the stored row.
    if (
      !row ||
      !this.filters.every(([column, value]) => row[column] === value)
    ) {
      return { data: null, error: null };
    }
    const next = { ...clone(row), ...clone(this.payload) };
    this.store.set(userId, next);
    return { data: clone(next), error: null };
  }
}

export function createFakeSupabase() {
  const store = new Map();

  return {
    from(table) {
      if (table !== 'study_room_states') {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        select: () => new Query(store, 'select'),
        insert: (row) => new Query(store, 'insert', row),
        update: (patch) => new Query(store, 'update', patch),
      };
    },
    seed(userId, row) {
      store.set(userId, clone({ user_id: userId, ...row }));
    },
    rows() {
      return [...store.values()].map(clone);
    },
  };
}
