CREATE TABLE IF NOT EXISTS topics (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id     TEXT NOT NULL REFERENCES topics(id),
    role         TEXT NOT NULL,
    content      TEXT,
    tool_calls   TEXT,
    tool_call_id TEXT,
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic_id, id);

CREATE TABLE IF NOT EXISTS runs (
    id          TEXT PRIMARY KEY,
    topic_id    TEXT NOT NULL REFERENCES topics(id),
    status      TEXT NOT NULL DEFAULT 'running',
    pid         INTEGER NOT NULL,
    async       INTEGER NOT NULL DEFAULT 0,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_runs_topic_status ON runs(topic_id, status);

CREATE TABLE IF NOT EXISTS run_inbox (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  TEXT NOT NULL REFERENCES runs(id),
    message TEXT NOT NULL
);

-- Memory: conversation summaries with embeddings
CREATE TABLE IF NOT EXISTS summaries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id      TEXT NOT NULL REFERENCES topics(id),
    summary       TEXT NOT NULL,
    user_message  TEXT NOT NULL,
    embedding     BLOB,
    created_at    INTEGER NOT NULL
);

-- FTS5 for keyword search fallback
CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
    summary, user_message,
    content='summaries',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS summaries_ai AFTER INSERT ON summaries BEGIN
    INSERT INTO summaries_fts(rowid, summary, user_message) VALUES (new.id, new.summary, new.user_message);
END;

-- Memory: user facts (persistent knowledge)
CREATE TABLE IF NOT EXISTS facts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'general',
    created_at INTEGER NOT NULL
);
