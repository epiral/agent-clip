/**
 * Topic handler — resource-oriented commands for topics.
 *
 * Clip Commands:
 *   topic create   --name, --agent_id?
 *   topic list     --limit?, --cursor?, --agent_id?, --status?, --query?
 *   topic get      <id> --limit?, --cursor?, --run_id?
 *   topic delete   <id>
 *   topic update   <id> --name
 *   topic fork     <id> --run_id?, --name?
 */

import type { Database } from "bun:sqlite";
import type { InvocationInput } from "../args";
import {
  createTopic,
  deleteTopic,
  forkTopic,
  getActiveRun,
  getActiveRunTopics,
  getCompletedRuns,
  getTopic,
  getTopicAgent,
  loadMessagesByRunID,
  loadMessagesPage,
  openDB,
  readRunOutput,
  renameTopic,
  type Topic,
  type TopicSummary,
} from "../db";
import { toWebMessage, type WebMessage } from "../tools";
import { ok, deleted, encodeCursor, decodeCursor, paginate, type DataResponse, type DeleteResponse, type ListResponse } from "./response";
import { readId, readInt, readString, readBool } from "./params";

// --- Response types ---

export interface TopicListItem extends TopicSummary {
  has_active_run?: boolean;
}

export interface TopicGetData {
  topic: Topic;
  agent: { id: string; name: string; llm_model: string | null } | null;
  messages: WebMessage[];
  active_run: {
    id: string;
    status: string;
    started_at: number;
    async: boolean;
    output?: string;
  } | null;
}

export type TopicGetResponse = DataResponse<TopicGetData> & { has_more: boolean; cursor?: string };

// --- Handlers ---

export function handleTopicCreate(input: InvocationInput): DataResponse<Topic> {
  const name = readString(input, ["name"], ["-n", "--name"]);
  if (!name) throw new Error("--name is required");

  const agentId = readString(input, ["agent_id", "agentId"], ["-a", "--agent", "--agent_id"]) || undefined;

  const db = openDB();
  const topic = createTopic(db, name, agentId);
  return ok(topic);
}

export function handleTopicList(input: InvocationInput): ListResponse<TopicListItem> {
  const limit = readInt(input, ["limit"], ["-l", "--limit"], 20) ?? 20;
  const cursorStr = readString(input, ["cursor"], ["--cursor"]);
  const agentId = readString(input, ["agent_id", "agentId"], ["--agent_id", "--agent"]);
  const status = readString(input, ["status"], ["--status"]) || "all";
  const query = readString(input, ["query"], ["--query", "-q"]);

  const db = openDB();
  const activeTopics = getActiveRunTopics(db);

  // Build WHERE clauses
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (agentId) {
    conditions.push("t.agent_id = ?");
    params.push(agentId);
  }

  if (query) {
    conditions.push("t.name LIKE ?");
    params.push(`%${query}%`);
  }

  if (cursorStr) {
    const cursor = decodeCursor(cursorStr);
    if (cursor) {
      // last_message_at DESC, id DESC — get items AFTER cursor
      conditions.push("(last_message_at < ? OR (last_message_at = ? AND t.id < ?))");
      params.push(cursor.sortValue as number, cursor.sortValue as number, cursor.id as string);
    }
  }

  const where = conditions.length > 0 ? `HAVING ${conditions.join(" AND ")}` : "";

  // We query limit+1 to detect has_more
  const sql = `
    SELECT t.id, t.name, t.agent_id, a.name AS agent_name, t.created_at,
      COUNT(m.id) AS message_count,
      COALESCE(MAX(m.created_at), t.created_at) AS last_message_at
    FROM topics t
    LEFT JOIN messages m ON m.topic_id = t.id
    LEFT JOIN agents a ON a.id = t.agent_id
    GROUP BY t.id
    ${where}
    ORDER BY last_message_at DESC, t.id DESC
    LIMIT ?
  `;

  params.push(limit + 1);
  const rows = db.query<TopicSummary, (string | number)[]>(sql).all(...params);

  // Post-filter: status (requires active run info, can't do in SQL easily)
  let filtered: TopicListItem[];
  if (status === "active") {
    filtered = rows
      .filter((t) => activeTopics[t.id])
      .map((t) => ({ ...t, has_active_run: true }));
  } else if (status === "idle") {
    filtered = rows
      .filter((t) => !activeTopics[t.id])
      .map((t) => ({ ...t, has_active_run: false }));
  } else {
    filtered = rows.map((t) => ({
      ...t,
      has_active_run: activeTopics[t.id] ?? false,
    }));
  }

  const result = paginate(filtered, limit, (item) =>
    encodeCursor(item.last_message_at, item.id),
  );

  return { data: result.data, has_more: result.has_more, ...(result.cursor ? { cursor: result.cursor } : {}) };
}

export function handleTopicGet(input: InvocationInput): TopicGetResponse {
  const topicId = readId(input, 0, ["topic_id", "topicId"]);
  if (!topicId) throw new Error("topic id is required");

  const limit = readInt(input, ["limit"], ["-l", "--limit"], 50) ?? 50;
  const cursorStr = readString(input, ["cursor"], ["--cursor"]);
  const runId = readString(input, ["run_id", "runId"], ["--run_id", "--run"]);

  const db = openDB();
  const topic = getTopic(db, topicId);
  const agent = getTopicAgent(db, topicId);

  // Load messages — either by run_id or paginated
  let messages: WebMessage[];
  let has_more = false;
  let cursor: string | undefined;

  if (runId) {
    // Load all messages for a specific run
    const msgs = loadMessagesByRunID(db, runId);
    messages = msgs.map((msg) => toWebMessage(topicId, msg));
    has_more = false;
  } else {
    const before = cursorStr ? decodeCursor(cursorStr) : null;
    const beforeId = before ? (before.id as number) : undefined;
    const page = loadMessagesPage(db, topicId, limit, beforeId);
    messages = page.messages.map((msg) => toWebMessage(topicId, msg));
    has_more = page.has_more;
    if (has_more && page.oldest_id) {
      cursor = encodeCursor(page.oldest_id, page.oldest_id);
    }
  }

  const activeRun = getActiveRun(db, topicId);

  const data: TopicGetData = {
    topic,
    agent: agent ? { id: agent.id, name: agent.name, llm_model: agent.llm_model } : null,
    messages,
    active_run: activeRun
      ? {
          id: activeRun.id,
          status: activeRun.status,
          started_at: activeRun.started_at,
          async: activeRun.async,
          output: activeRun.async ? readRunOutput(activeRun.id) : undefined,
        }
      : null,
  };

  return { data, has_more, ...(cursor ? { cursor } : {}) };
}

export function handleTopicDelete(input: InvocationInput): DeleteResponse {
  const topicId = readId(input, 0, ["topic_id", "topicId"]);
  if (!topicId) throw new Error("topic id is required");

  const db = openDB();
  deleteTopic(db, topicId);
  return deleted(topicId);
}

export function handleTopicUpdate(input: InvocationInput): DataResponse<Topic> {
  const topicId = readId(input, 0, ["topic_id", "topicId"]);
  if (!topicId) throw new Error("topic id is required");

  const name = readString(input, ["name"], ["-n", "--name"]);
  if (!name) throw new Error("--name is required");

  const db = openDB();
  renameTopic(db, topicId, name);
  const topic = getTopic(db, topicId);
  return ok(topic);
}

export function handleTopicFork(input: InvocationInput): DataResponse<Topic> {
  const topicId = readId(input, 0, ["topic_id", "topicId"]);
  if (!topicId) throw new Error("topic id is required");

  const runId = readString(input, ["run_id", "runId"], ["--run_id"]);
  const name = readString(input, ["name"], ["-n", "--name"]);

  const db = openDB();

  // Default to last completed run if no run_id
  let forkRunId = runId;
  if (!forkRunId) {
    const runs = getCompletedRuns(db, topicId);
    if (runs.length === 0) throw new Error("no completed runs to fork from");
    forkRunId = runs[runs.length - 1].id;
  }

  const forkName = name || `${getTopic(db, topicId).name} (fork)`;
  const topic = forkTopic(db, topicId, forkRunId, forkName);
  return ok(topic);
}
