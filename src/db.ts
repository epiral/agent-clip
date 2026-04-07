import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { dbPath, ensureDataLayout, ensureTopicDir, runDir, runOutputPath, schemaPath, topicDir } from "./paths";
import type { Message, ToolCall } from "./llm";
import { extractThinking } from "./sanitize";
import { isProcessAlive, nowUnix, randomID } from "./shared";

let vecLoaded = false;

function findBrewSqlite(): string | null {
  const path = "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
  if (statSync(path, { throwIfNoEntry: false })) return path;
  return null;
}

function loadVec(db: Database): boolean {
  try {
    sqliteVec.load(db);
    return true;
  } catch {
    return false;
  }
}

let dbInstance: Database | null = null;

function transaction<T>(db: Database, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw error;
  }
}

export function hasVec(): boolean {
  return vecLoaded;
}

export function openDB(): Database {
  if (dbInstance) {
    return dbInstance;
  }

  ensureDataLayout();

  if (process.platform === "darwin") {
    const brewSqlite = findBrewSqlite();
    if (brewSqlite) {
      Database.setCustomSQLite(brewSqlite);
    }
  }

  const db = new Database(dbPath(), { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(readFileSync(schemaPath(), "utf8"));

  const migrations = [
    "ALTER TABLE messages ADD COLUMN run_id TEXT",
    "ALTER TABLE messages ADD COLUMN reasoning TEXT",
    "ALTER TABLE summaries ADD COLUMN run_id TEXT",
    "ALTER TABLE summaries ADD COLUMN embedding_model TEXT",
    "ALTER TABLE events ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Local'",
    "ALTER TABLE events ADD COLUMN last_run_at INTEGER",
    "ALTER TABLE events ADD COLUMN canceled_at INTEGER",
  ];
  for (const statement of migrations) {
    try {
      db.exec(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("duplicate column name")) {
        throw error;
      }
    }
  }

  migrateThinkTags(db);

  vecLoaded = loadVec(db);
  if (vecLoaded) {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS summaries_vec USING vec0(embedding float[1536])");
    migrateEmbeddingsToVec(db);
  }

  dbInstance = db;
  return db;
}

function migrateThinkTags(db: Database): void {
  const rows = db.query<{
    rowid: number;
    content: string | null;
    reasoning: string | null;
  }, []>(
    "SELECT rowid, content, reasoning FROM messages WHERE role = 'assistant' AND content LIKE '%<think>%'",
  ).all();

  const update = db.query("UPDATE messages SET content = ?, reasoning = ? WHERE rowid = ?");
  for (const row of rows) {
    const { content, reasoning } = extractThinking(row.content ?? "", row.reasoning ?? "");
    if (content !== (row.content ?? "")) {
      update.run(content, reasoning || null, row.rowid);
    }
  }
}

function migrateEmbeddingsToVec(db: Database): void {
  const total = db.query<{ c: number }, []>(
    "SELECT COUNT(*) as c FROM summaries WHERE embedding IS NOT NULL",
  ).get();
  const indexed = db.query<{ c: number }, []>(
    "SELECT COUNT(*) as c FROM summaries_vec",
  ).get();
  if ((total?.c ?? 0) <= (indexed?.c ?? 0)) return;

  const rows = db.query<{ id: number; embedding: Buffer }, []>(
    "SELECT id, embedding FROM summaries WHERE embedding IS NOT NULL",
  ).all();
  const stmt = db.query("INSERT OR IGNORE INTO summaries_vec(rowid, embedding) VALUES (?, ?)");
  for (const row of rows) {
    stmt.run(row.id, new Uint8Array(row.embedding));
  }
}

export interface Topic {
  id: string;
  name: string;
  created_at: number;
}

export interface TopicSummary {
  id: string;
  name: string;
  message_count: number;
  created_at: number;
  last_message_at: number;
  has_active_run?: boolean;
}

export function createTopic(db: Database, name: string): Topic {
  const topic: Topic = {
    id: randomID(),
    name,
    created_at: nowUnix(),
  };
  db.query("INSERT INTO topics (id, name, created_at) VALUES (?, ?, ?)").run(topic.id, topic.name, topic.created_at);
  ensureTopicDir(topic.id);
  return topic;
}

export function countTopics(db: Database): number {
  const row = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM topics").get();
  return row?.count ?? 0;
}

export function listTopicsPage(db: Database, limit = 0, offset = 0): TopicSummary[] {
  const query = `
    SELECT t.id, t.name, t.created_at, COUNT(m.id) AS message_count,
      COALESCE(MAX(m.created_at), t.created_at) AS last_message_at
    FROM topics t
    LEFT JOIN messages m ON m.topic_id = t.id
    GROUP BY t.id
    ORDER BY last_message_at DESC
    ${limit > 0 ? "LIMIT ? OFFSET ?" : ""}
  `;
  return limit > 0
    ? db.query<TopicSummary, [number, number]>(query).all(limit, offset)
    : db.query<TopicSummary, []>(query).all();
}

export function renameTopic(db: Database, id: string, name: string): void {
  const result = db.query("UPDATE topics SET name = ? WHERE id = ?").run(name, id);
  if (!result.changes) {
    throw new Error(`topic ${id} not found`);
  }
}

export function getTopic(db: Database, id: string): Topic {
  const topic = db.query<Topic, [string]>("SELECT id, name, created_at FROM topics WHERE id = ?").get(id);
  if (!topic) {
    throw new Error(`topic ${id} not found`);
  }
  return topic;
}

function decodeToolCalls(value: string | null): ToolCall[] {
  if (!value) {
    return [];
  }
  return JSON.parse(value) as ToolCall[];
}

function toMessage(row: {
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  reasoning: string | null;
}): Message {
  return {
    role: row.role,
    content: row.content ?? undefined,
    toolCalls: decodeToolCalls(row.tool_calls),
    toolCallId: row.tool_call_id ?? undefined,
    reasoning: row.reasoning ?? undefined,
  };
}

export function loadMessagesPage(db: Database, topicId: string, limit = 0): Message[] {
  if (limit > 0) {
    const rows = db.query<{
      role: string;
      content: string | null;
      tool_calls: string | null;
      tool_call_id: string | null;
      reasoning: string | null;
    }, [string, number]>(
      `SELECT role, content, tool_calls, tool_call_id, reasoning FROM (
        SELECT role, content, tool_calls, tool_call_id, reasoning, id
        FROM messages WHERE topic_id = ? ORDER BY id DESC LIMIT ?
      ) sub ORDER BY id ASC`,
    ).all(topicId, limit);
    return rows.map(toMessage);
  }

  return db.query<{
    role: string;
    content: string | null;
    tool_calls: string | null;
    tool_call_id: string | null;
    reasoning: string | null;
  }, [string]>(
    "SELECT role, content, tool_calls, tool_call_id, reasoning FROM messages WHERE topic_id = ? ORDER BY id ASC",
  ).all(topicId).map(toMessage);
}

export function loadMessagesByRunID(db: Database, runId: string): Message[] {
  return db.query<{
    role: string;
    content: string | null;
    tool_calls: string | null;
    tool_call_id: string | null;
    reasoning: string | null;
  }, [string]>(
    "SELECT role, content, tool_calls, tool_call_id, reasoning FROM messages WHERE run_id = ? ORDER BY id ASC",
  ).all(runId).map(toMessage);
}

export function saveMessages(db: Database, topicId: string, runId: string, messages: Message[]): void {
  transaction(db, () => {
    const stmt = db.query(
      `INSERT INTO messages (topic_id, run_id, role, content, tool_calls, tool_call_id, reasoning, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const createdAt = nowUnix();
    for (const message of messages) {
      stmt.run(
        topicId,
        runId,
        message.role,
        message.content ?? null,
        message.toolCalls && message.toolCalls.length > 0 ? JSON.stringify(message.toolCalls) : null,
        message.toolCallId ?? null,
        message.reasoning ?? null,
        createdAt,
      );
    }
  });
}

export interface Run {
  id: string;
  topic_id: string;
  status: string;
  pid: number;
  async: boolean;
  started_at: number;
  finished_at?: number;
}

function toRun(row: {
  id: string;
  topic_id: string;
  status: string;
  pid: number;
  async: number;
  started_at: number;
  finished_at: number | null;
}): Run {
  return {
    id: row.id,
    topic_id: row.topic_id,
    status: row.status,
    pid: row.pid,
    async: row.async === 1,
    started_at: row.started_at,
    finished_at: row.finished_at ?? undefined,
  };
}

export function createRun(db: Database, topicId: string, pid: number, isAsync: boolean): Run {
  const run: Run = {
    id: randomID(),
    topic_id: topicId,
    status: "running",
    pid,
    async: isAsync,
    started_at: nowUnix(),
  };
  db.query("INSERT INTO runs (id, topic_id, status, pid, async, started_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(run.id, run.topic_id, run.status, run.pid, run.async ? 1 : 0, run.started_at);

  if (run.async) {
    ensureTopicDir(topicId);
    writeFileSync(runOutputPath(run.id), "", "utf8");
  }
  return run;
}

export function getActiveRun(db: Database, topicId: string): Run | null {
  const row = db.query<{
    id: string;
    topic_id: string;
    status: string;
    pid: number;
    async: number;
    started_at: number;
    finished_at: number | null;
  }, [string]>(
    "SELECT id, topic_id, status, pid, async, started_at, finished_at FROM runs WHERE topic_id = ? AND status = 'running' LIMIT 1",
  ).get(topicId);

  if (!row) {
    return null;
  }

  const run = toRun(row);
  if (!isProcessAlive(run.pid)) {
    finishRun(db, run.id, "error");
    cleanupRunDir(run.id);
    return null;
  }
  return run;
}

export function getActiveRunTopics(db: Database): Record<string, boolean> {
  const rows = db.query<{ topic_id: string; pid: number }, []>("SELECT topic_id, pid FROM runs WHERE status = 'running'").all();
  return Object.fromEntries(rows.filter((row) => isProcessAlive(row.pid)).map((row) => [row.topic_id, true]));
}

export function getRun(db: Database, runId: string): Run {
  const row = db.query<{
    id: string;
    topic_id: string;
    status: string;
    pid: number;
    async: number;
    started_at: number;
    finished_at: number | null;
  }, [string]>(
    "SELECT id, topic_id, status, pid, async, started_at, finished_at FROM runs WHERE id = ?",
  ).get(runId);
  if (!row) {
    throw new Error(`run ${runId} not found`);
  }
  return toRun(row);
}

export function updateRunPID(db: Database, runId: string, pid: number): void {
  db.query("UPDATE runs SET pid = ? WHERE id = ?").run(pid, runId);
}

export function injectMessage(db: Database, runId: string, message: string): void {
  transaction(db, () => {
    const run = db.query<{ status: string }, [string]>("SELECT status FROM runs WHERE id = ?").get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    if (run.status !== "running") {
      throw new Error(`run ${runId} is not active (status: ${run.status})`);
    }
    db.query("INSERT INTO run_inbox (run_id, message) VALUES (?, ?)").run(runId, message);
  });
}

export function drainInbox(db: Database, runId: string): string[] {
  return transaction(db, () => {
    const rows = db.query<{ message: string }, [string]>("SELECT message FROM run_inbox WHERE run_id = ? ORDER BY id ASC").all(runId);
    if (rows.length > 0) {
      db.query("DELETE FROM run_inbox WHERE run_id = ?").run(runId);
    }
    return rows.map((row) => row.message);
  });
}

export function tryFinishRun(db: Database, runId: string, status: string): string[] {
  return transaction(db, () => {
    const rows = db.query<{ message: string }, [string]>("SELECT message FROM run_inbox WHERE run_id = ? ORDER BY id ASC").all(runId);
    if (rows.length > 0) {
      db.query("DELETE FROM run_inbox WHERE run_id = ?").run(runId);
      return rows.map((row) => row.message);
    }

    db.query("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?").run(status, nowUnix(), runId);
    return [];
  });
}

export function finishRun(db: Database, runId: string, status: string): void {
  db.query("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?").run(status, nowUnix(), runId);
}

export function cleanupRunDir(runId: string): void {
  if (existsSync(runDir(runId))) {
    rmSync(runDir(runId), { recursive: true, force: true });
  }
}

export interface CompletedRun {
  id: string;
  topic_id: string;
  started_at: number;
}

export function getCompletedRuns(db: Database, topicId: string): CompletedRun[] {
  return db.query<CompletedRun, [string]>(
    "SELECT id, topic_id, started_at FROM runs WHERE topic_id = ? AND status = 'done' ORDER BY started_at ASC",
  ).all(topicId);
}

export interface TopicRunInfo {
  id: string;
  status: string;
  started_at: number;
  finished_at: number;
  tool_count: number;
  summary: string;
}

export function countTopicRuns(db: Database, topicId: string): number {
  const row = db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM runs WHERE topic_id = ?").get(topicId);
  return row?.count ?? 0;
}

export function getTopicRunsPage(db: Database, topicId: string, limit = 0, offset = 0): TopicRunInfo[] {
  const query = `
    SELECT r.id, r.status, r.started_at, COALESCE(r.finished_at, 0) AS finished_at,
      (SELECT COUNT(*) FROM messages m WHERE m.run_id = r.id AND m.role = 'tool') AS tool_count,
      COALESCE((SELECT s.summary FROM summaries s WHERE s.run_id = r.id LIMIT 1), '') AS summary
    FROM runs r
    WHERE r.topic_id = ?
    ORDER BY r.started_at DESC
    ${limit > 0 ? "LIMIT ? OFFSET ?" : ""}
  `;
  return limit > 0
    ? db.query<TopicRunInfo, [string, number, number]>(query).all(topicId, limit, offset)
    : db.query<TopicRunInfo, [string]>(query).all(topicId);
}

export function getRunInfo(db: Database, runId: string): TopicRunInfo {
  const row = db.query<TopicRunInfo, [string]>(
    `SELECT r.id, r.status, r.started_at, COALESCE(r.finished_at, 0) AS finished_at,
      (SELECT COUNT(*) FROM messages m WHERE m.run_id = r.id AND m.role = 'tool') AS tool_count,
      COALESCE((SELECT s.summary FROM summaries s WHERE s.run_id = r.id LIMIT 1), '') AS summary
     FROM runs r WHERE r.id = ?`,
  ).get(runId);
  if (!row) {
    throw new Error(`run ${runId} not found`);
  }
  return row;
}

export function readRunOutput(runId: string): string {
  return existsSync(runOutputPath(runId)) ? readFileSync(runOutputPath(runId), "utf8") : "";
}

export function removeTopicFiles(topicId: string): void {
  rmSync(topicDir(topicId), { recursive: true, force: true });
}

export function deleteTopic(db: Database, topicId: string): void {
  transaction(db, () => {
    // Delete in dependency order
    const runIds = db.query<{ id: string }, [string]>(
      "SELECT id FROM runs WHERE topic_id = ?",
    ).all(topicId);
    for (const { id } of runIds) {
      db.run("DELETE FROM run_inbox WHERE run_id = ?", [id]);
    }
    db.run("DELETE FROM runs WHERE topic_id = ?", [topicId]);
    db.run("DELETE FROM messages WHERE topic_id = ?", [topicId]);
    db.run("DELETE FROM summaries WHERE topic_id = ?", [topicId]);
    db.run("DELETE FROM events WHERE topic_id = ?", [topicId]);
    db.run("DELETE FROM topics WHERE id = ?", [topicId]);
  });
  removeTopicFiles(topicId);
}
