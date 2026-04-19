import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { dbPath, ensureDataLayout, ensureTopicDir, runDir, runOutputPath, schemaPath, topicDir } from "./paths";
import type { Message, TokenUsage, ToolCall } from "./llm";
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
    "ALTER TABLE messages ADD COLUMN usage TEXT",
    "ALTER TABLE topics ADD COLUMN agent_id TEXT REFERENCES agents(id)",
  ];
  for (const statement of migrations) {
    try {
      db.exec(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("duplicate column name") && !message.includes("already exists")) {
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

// --- Agents ---

export interface Agent {
  id: string;
  name: string;
  llm_provider: string | null;
  llm_model: string | null;
  max_tokens: number | null;
  system_prompt: string | null;
  scope: string[] | null;
  pinned: string[] | null;
  created_at: number;
  updated_at: number;
}

type AgentRow = {
  id: string;
  name: string;
  llm_provider: string | null;
  llm_model: string | null;
  max_tokens: number | null;
  system_prompt: string | null;
  scope: string | null;
  pinned: string | null;
  created_at: number;
  updated_at: number;
};

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    llm_provider: row.llm_provider,
    llm_model: row.llm_model,
    max_tokens: row.max_tokens,
    system_prompt: row.system_prompt,
    scope: row.scope ? JSON.parse(row.scope) as string[] : null,
    pinned: row.pinned ? JSON.parse(row.pinned) as string[] : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface CreateAgentInput {
  name: string;
  llm_provider?: string;
  llm_model?: string;
  max_tokens?: number;
  system_prompt?: string;
  scope?: string[];
  pinned?: string[];
}

export function createAgent(db: Database, input: CreateAgentInput): Agent {
  const now = nowUnix();
  const agent: Agent = {
    id: randomID(),
    name: input.name,
    llm_provider: input.llm_provider ?? null,
    llm_model: input.llm_model ?? null,
    max_tokens: input.max_tokens ?? null,
    system_prompt: input.system_prompt ?? null,
    scope: input.scope ?? null,
    pinned: input.pinned ?? null,
    created_at: now,
    updated_at: now,
  };
  db.query(
    `INSERT INTO agents (id, name, llm_provider, llm_model, max_tokens, system_prompt, scope, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    agent.id, agent.name, agent.llm_provider, agent.llm_model, agent.max_tokens,
    agent.system_prompt, agent.scope ? JSON.stringify(agent.scope) : null,
    agent.pinned ? JSON.stringify(agent.pinned) : null, agent.created_at, agent.updated_at,
  );
  return agent;
}

export function getAgent(db: Database, id: string): Agent {
  const row = db.query<AgentRow, [string]>(
    `SELECT id, name, llm_provider, llm_model, max_tokens, system_prompt, scope, pinned, created_at, updated_at
     FROM agents WHERE id = ?`,
  ).get(id);
  if (!row) {
    throw new Error(`agent ${id} not found`);
  }
  return toAgent(row);
}

export function listAgents(db: Database): Agent[] {
  return db.query<AgentRow, []>(
    `SELECT id, name, llm_provider, llm_model, max_tokens, system_prompt, scope, pinned, created_at, updated_at
     FROM agents ORDER BY created_at ASC`,
  ).all().map(toAgent);
}

export function updateAgent(db: Database, id: string, updates: Partial<CreateAgentInput>): Agent {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.name !== undefined) { sets.push("name = ?"); values.push(updates.name); }
  if (updates.llm_provider !== undefined) { sets.push("llm_provider = ?"); values.push(updates.llm_provider || null); }
  if (updates.llm_model !== undefined) { sets.push("llm_model = ?"); values.push(updates.llm_model || null); }
  if (updates.max_tokens !== undefined) { sets.push("max_tokens = ?"); values.push(updates.max_tokens || null); }
  if (updates.system_prompt !== undefined) { sets.push("system_prompt = ?"); values.push(updates.system_prompt || null); }
  if (updates.scope !== undefined) { sets.push("scope = ?"); values.push(updates.scope ? JSON.stringify(updates.scope) : null); }
  if (updates.pinned !== undefined) { sets.push("pinned = ?"); values.push(updates.pinned ? JSON.stringify(updates.pinned) : null); }

  if (sets.length === 0) {
    return getAgent(db, id);
  }

  sets.push("updated_at = ?");
  values.push(nowUnix());
  values.push(id);

  const result = db.query(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  if (!result.changes) {
    throw new Error(`agent ${id} not found`);
  }
  return getAgent(db, id);
}

export function deleteAgent(db: Database, id: string): void {
  const topics = db.query<{ c: number }, [string]>(
    "SELECT COUNT(*) AS c FROM topics WHERE agent_id = ?",
  ).get(id);
  if (topics && topics.c > 0) {
    throw new Error(`agent ${id} has ${topics.c} topic(s), delete them first or reassign`);
  }
  const result = db.query("DELETE FROM agents WHERE id = ?").run(id);
  if (!result.changes) {
    throw new Error(`agent ${id} not found`);
  }
}

export function getTopicAgent(db: Database, topicId: string): Agent | null {
  const row = db.query<AgentRow, [string]>(
    `SELECT a.id, a.name, a.llm_provider, a.llm_model, a.max_tokens, a.system_prompt, a.scope, a.pinned, a.created_at, a.updated_at
     FROM agents a JOIN topics t ON t.agent_id = a.id WHERE t.id = ?`,
  ).get(topicId);
  return row ? toAgent(row) : null;
}

// --- Topics ---

export interface Topic {
  id: string;
  name: string;
  agent_id: string | null;
  created_at: number;
}

export interface TopicSummary {
  id: string;
  name: string;
  agent_id: string | null;
  agent_name: string | null;
  message_count: number;
  created_at: number;
  last_message_at: number;
  has_active_run?: boolean;
}

export function createTopic(db: Database, name: string, agentId?: string): Topic {
  if (agentId) {
    getAgent(db, agentId);
  }
  const topic: Topic = {
    id: randomID(),
    name,
    agent_id: agentId ?? null,
    created_at: nowUnix(),
  };
  db.query("INSERT INTO topics (id, name, agent_id, created_at) VALUES (?, ?, ?, ?)").run(topic.id, topic.name, topic.agent_id, topic.created_at);
  ensureTopicDir(topic.id);
  return topic;
}

export function countTopics(db: Database): number {
  const row = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM topics").get();
  return row?.count ?? 0;
}

export function listTopicsPage(db: Database, limit = 0, offset = 0): TopicSummary[] {
  const query = `
    SELECT t.id, t.name, t.agent_id, a.name AS agent_name, t.created_at, COUNT(m.id) AS message_count,
      COALESCE(MAX(m.created_at), t.created_at) AS last_message_at
    FROM topics t
    LEFT JOIN messages m ON m.topic_id = t.id
    LEFT JOIN agents a ON a.id = t.agent_id
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
  const topic = db.query<Topic, [string]>("SELECT id, name, agent_id, created_at FROM topics WHERE id = ?").get(id);
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

function decodeUsage(value: string | null): TokenUsage | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as TokenUsage;
  } catch {
    return undefined;
  }
}

function toMessage(row: {
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  reasoning: string | null;
  usage: string | null;
}): Message {
  return {
    role: row.role,
    content: row.content ?? undefined,
    toolCalls: decodeToolCalls(row.tool_calls),
    toolCallId: row.tool_call_id ?? undefined,
    reasoning: row.reasoning ?? undefined,
    usage: decodeUsage(row.usage),
  };
}

export interface MessagePage {
  messages: Message[];
  oldest_id: number | null;
  has_more: boolean;
}

export function loadMessagesPage(db: Database, topicId: string, limit = 0, before?: number): MessagePage {
  type Row = {
    id: number;
    role: string;
    content: string | null;
    tool_calls: string | null;
    tool_call_id: string | null;
    reasoning: string | null;
    usage: string | null;
  };

  let rows: Row[];

  if (limit > 0 && before) {
    rows = db.query<Row, [string, number, number]>(
      `SELECT id, role, content, tool_calls, tool_call_id, reasoning, usage FROM (
        SELECT id, role, content, tool_calls, tool_call_id, reasoning, usage
        FROM messages WHERE topic_id = ? AND id < ? ORDER BY id DESC LIMIT ?
      ) sub ORDER BY id ASC`,
    ).all(topicId, before, limit);
  } else if (limit > 0) {
    rows = db.query<Row, [string, number]>(
      `SELECT id, role, content, tool_calls, tool_call_id, reasoning, usage FROM (
        SELECT id, role, content, tool_calls, tool_call_id, reasoning, usage
        FROM messages WHERE topic_id = ? ORDER BY id DESC LIMIT ?
      ) sub ORDER BY id ASC`,
    ).all(topicId, limit);
  } else {
    rows = db.query<Row, [string]>(
      "SELECT id, role, content, tool_calls, tool_call_id, reasoning, usage FROM messages WHERE topic_id = ? ORDER BY id ASC",
    ).all(topicId);
  }

  const oldestId = rows.length > 0 ? rows[0].id : null;
  const hasMore = oldestId !== null && !!db.query<{ c: number }, [string, number]>(
    "SELECT 1 as c FROM messages WHERE topic_id = ? AND id < ? LIMIT 1",
  ).get(topicId, oldestId);

  return {
    messages: rows.map(toMessage),
    oldest_id: oldestId,
    has_more: hasMore,
  };
}

export function loadMessagesByRunID(db: Database, runId: string): Message[] {
  return db.query<{
    role: string;
    content: string | null;
    tool_calls: string | null;
    tool_call_id: string | null;
    reasoning: string | null;
    usage: string | null;
  }, [string]>(
    "SELECT role, content, tool_calls, tool_call_id, reasoning, usage FROM messages WHERE run_id = ? ORDER BY id ASC",
  ).all(runId).map(toMessage);
}

export function saveMessages(db: Database, topicId: string, runId: string, messages: Message[]): void {
  transaction(db, () => {
    const stmt = db.query(
      `INSERT INTO messages (topic_id, run_id, role, content, tool_calls, tool_call_id, reasoning, usage, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        message.usage ? JSON.stringify(message.usage) : null,
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
