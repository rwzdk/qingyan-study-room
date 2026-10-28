CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
  ON chat_messages (created_at);

CREATE INDEX IF NOT EXISTS idx_chat_messages_author_created
  ON chat_messages (author_id, created_at);
