/**
 * Run handler — resource-oriented commands for runs.
 *
 * Clip Commands:
 *   run get      <id>
 *   run list     --topic_id?, --status?, --limit?, --cursor?
 *   run cancel   <id>
 */

import type { InvocationInput } from "../args";
import {
  finishRun,
  getRun,
  getRunInfo,
  getTopicRunsPage,
  openDB,
  readRunOutput,
  type Run,
  type TopicRunInfo,
} from "../db";
import { getRunController } from "../run-control";
import { ok, encodeCursor, decodeCursor, paginate, type DataResponse, type ListResponse } from "./response";
import { readId, readInt, readString } from "./params";

// --- Response types ---

export interface RunGetData extends Run {
  output?: string;
  tool_count?: number;
  summary?: string;
}

// --- Handlers ---

export function handleRunGet(input: InvocationInput): DataResponse<RunGetData> {
  const runId = readId(input, 0, ["run_id", "runId"]);
  if (!runId) throw new Error("run id is required");

  const db = openDB();
  const run = getRun(db, runId);
  const info = getRunInfo(db, runId);

  const data: RunGetData = {
    ...run,
    tool_count: info.tool_count,
    summary: info.summary || undefined,
  };

  if (run.async) {
    data.output = readRunOutput(run.id);
  }

  return ok(data);
}

export function handleRunList(input: InvocationInput): ListResponse<TopicRunInfo & { topic_id?: string; topic_name?: string }> {
  const topicId = readString(input, ["topic_id", "topicId"], ["--topic_id", "--topic", "-t"]);
  const status = readString(input, ["status"], ["--status"]) || "all";
  const limit = readInt(input, ["limit"], ["-l", "--limit"], 20) ?? 20;
  const cursorStr = readString(input, ["cursor"], ["--cursor"]);

  const db = openDB();

  if (topicId) {
    // Per-topic: use existing getTopicRunsPage, then apply cursor + status filter
    // Fetch more than needed for post-filtering
    const rows = getTopicRunsPage(db, topicId, 0);

    let filtered = rows;
    if (status !== "all") {
      filtered = rows.filter((r) => r.status === status);
    }

    // Apply cursor
    if (cursorStr) {
      const cursor = decodeCursor(cursorStr);
      if (cursor) {
        const idx = filtered.findIndex((r) => r.id === cursor.id);
        if (idx >= 0) {
          filtered = filtered.slice(idx + 1);
        }
      }
    }

    // Paginate
    const page = filtered.slice(0, limit + 1);
    const has_more = page.length > limit;
    const data = has_more ? page.slice(0, limit) : page;
    const resultCursor = has_more && data.length > 0
      ? encodeCursor(data[data.length - 1].started_at, data[data.length - 1].id)
      : undefined;

    return { data, has_more, ...(resultCursor ? { cursor: resultCursor } : {}) };
  }

  // Cross-topic query
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (status !== "all") {
    conditions.push("r.status = ?");
    params.push(status);
  }

  if (cursorStr) {
    const cursor = decodeCursor(cursorStr);
    if (cursor) {
      conditions.push("(r.started_at < ? OR (r.started_at = ? AND r.id < ?))");
      params.push(cursor.sortValue as number, cursor.sortValue as number, cursor.id as string);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit + 1);

  const sql = `
    SELECT r.id, r.status, r.started_at, COALESCE(r.finished_at, 0) AS finished_at,
      r.topic_id,
      (SELECT t.name FROM topics t WHERE t.id = r.topic_id) AS topic_name,
      (SELECT COUNT(*) FROM messages m WHERE m.run_id = r.id AND m.role = 'tool') AS tool_count,
      COALESCE((SELECT s.summary FROM summaries s WHERE s.run_id = r.id LIMIT 1), '') AS summary
    FROM runs r
    ${where}
    ORDER BY r.started_at DESC, r.id DESC
    LIMIT ?
  `;

  const rows = db.query<TopicRunInfo & { topic_id: string; topic_name: string }, (string | number)[]>(sql).all(...params);

  const result = paginate(rows, limit, (item) =>
    encodeCursor(item.started_at, item.id),
  );

  return { data: result.data, has_more: result.has_more, ...(result.cursor ? { cursor: result.cursor } : {}) };
}

export function handleRunCancel(input: InvocationInput): DataResponse<Run> {
  const runId = readId(input, 0, ["run_id", "runId"]);
  if (!runId) throw new Error("run id is required");

  const db = openDB();
  const run = getRun(db, runId);

  if (run.status !== "running") {
    throw new Error(`run ${run.id} is not active (status: ${run.status})`);
  }

  const controller = getRunController(run.id);
  if (controller) {
    controller.abort();
  } else if (run.pid > 0 && run.pid !== process.pid) {
    try {
      process.kill(run.pid, "SIGTERM");
    } catch {
      // Ignore missing process.
    }
  }

  finishRun(db, run.id, "cancelled");
  return ok({ ...run, status: "cancelled" });
}
