CREATE TABLE IF NOT EXISTS agents (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    llm_provider  TEXT,
    llm_model     TEXT,
    max_tokens    INTEGER,
    system_prompt TEXT,
    scope         TEXT,
    pinned        TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    agent_id   TEXT REFERENCES agents(id),
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id     TEXT NOT NULL REFERENCES topics(id),
    run_id       TEXT,
    role         TEXT NOT NULL,
    content      TEXT,
    tool_calls   TEXT,
    tool_call_id TEXT,
    reasoning    TEXT,
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_run ON messages(run_id);

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

CREATE TABLE IF NOT EXISTS summaries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id         TEXT NOT NULL REFERENCES topics(id),
    run_id           TEXT,
    summary          TEXT NOT NULL,
    user_message     TEXT NOT NULL,
    embedding        BLOB,
    embedding_model  TEXT,
    created_at       INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
    summary, user_message,
    content='summaries',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS summaries_ai AFTER INSERT ON summaries BEGIN
    INSERT INTO summaries_fts(rowid, summary, user_message) VALUES (new.id, new.summary, new.user_message);
END;

CREATE TABLE IF NOT EXISTS facts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'general',
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id               TEXT PRIMARY KEY,
    topic_id         TEXT NOT NULL REFERENCES topics(id),
    prompt           TEXT NOT NULL,
    schedule_kind    TEXT NOT NULL,
    schedule_value   TEXT NOT NULL,
    timezone         TEXT NOT NULL DEFAULT 'Local',
    next_run_at      INTEGER NOT NULL,
    last_run_at      INTEGER,
    status           TEXT NOT NULL DEFAULT 'scheduled',
    created_at       INTEGER NOT NULL,
    canceled_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_due ON events(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_events_topic_status ON events(topic_id, status);
