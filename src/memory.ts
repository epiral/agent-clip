import { Database } from "bun:sqlite";
import type { Config } from "./config";
import { hasVec } from "./db";
import { callLLM, textMessage, type Message } from "./llm";
import { nowUnix, truncateRunes } from "./shared";

export interface Summary {
  id: number;
  topic_id: string;
  topic_name?: string;
  run_id?: string;
  summary: string;
  user_message: string;
  similarity?: number;
  created_at: number;
}

export interface SearchFilter {
  topicId?: string;
  keyword?: string;
  limit?: number;
}

export async function getEmbedding(_cfg: Config, _text: string): Promise<number[]> {
  // Embedding provider has been removed from config.
  // RAG embedding may be re-added via a dedicated Memory Clip in the future.
  return [];
}

export function encodeEmbedding(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(values.length * 4);
  const view = new DataView(buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return new Uint8Array(buffer);
}

export function decodeEmbedding(blob: Uint8Array | Buffer | ArrayBuffer): number[] {
  const bytes = blob instanceof Uint8Array
    ? blob
    : blob instanceof Buffer
      ? new Uint8Array(blob)
      : new Uint8Array(blob);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values: number[] = [];
  for (let index = 0; index < bytes.byteLength; index += 4) {
    values.push(view.getFloat32(index, true));
  }
  return values;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function storeSummary(
  db: Database,
  topicId: string,
  runId: string,
  summary: string,
  userMessage: string,
  embedding: number[],
  embeddingModel: string,
): void {
  const blob = embedding.length > 0 ? Buffer.from(encodeEmbedding(embedding)) : null;
  const result = db.query(
    `INSERT INTO summaries (topic_id, run_id, summary, user_message, embedding, embedding_model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(topicId, runId, summary, userMessage, blob, embeddingModel || null, nowUnix());

  if (embedding.length > 0 && hasVec()) {
    const vecBlob = new Uint8Array(new Float32Array(embedding).buffer);
    db.query("INSERT INTO summaries_vec(rowid, embedding) VALUES (?, ?)").run(result.lastInsertRowid, vecBlob);
  }
}

export function getRecentSummaries(db: Database, limit: number): string[] {
  const rows = db.query<{ summary: string }, [number]>(
    "SELECT summary FROM summaries ORDER BY created_at DESC LIMIT ?",
  ).all(limit);
  return rows.map((row) => row.summary).reverse();
}

export async function searchMemory(db: Database, cfg: Config, query: string, filter: SearchFilter = {}): Promise<Summary[]> {
  const limit = filter.limit ?? 5;
  const results: Summary[] = [];

  try {
    const queryEmbedding = await getEmbedding(cfg, query);
    if (queryEmbedding.length > 0) {
      results.push(...searchSemantic(db, queryEmbedding, filter, 10));
    }
  } catch {
    // ignore semantic failures
  }

  if (results.length < limit) {
    const keywordResults = searchKeyword(db, query, filter, 10);
    const seen = new Set(results.map((item) => item.id));
    for (const item of keywordResults) {
      if (!seen.has(item.id)) {
        results.push(item);
      }
    }
  }

  let filtered = results;
  if (filter.keyword) {
    const keyword = filter.keyword.toLowerCase();
    filtered = filtered.filter((item) => item.summary.toLowerCase().includes(keyword) || item.user_message.toLowerCase().includes(keyword));
  }

  const enriched = filtered.slice(0, limit);
  enrichTopicNames(db, enriched);
  return enriched;
}

export function searchMemorySemantic(db: Database, queryEmbedding: number[], limit: number): Summary[] {
  return searchSemantic(db, queryEmbedding, {}, limit);
}

function searchSemantic(db: Database, queryEmbedding: number[], filter: SearchFilter, limit: number): Summary[] {
  if (hasVec()) {
    return searchSemanticVec(db, queryEmbedding, filter, limit);
  }
  return searchSemanticJS(db, queryEmbedding, filter, limit);
}

function searchSemanticVec(db: Database, queryEmbedding: number[], filter: SearchFilter, limit: number): Summary[] {
  const queryBlob = new Uint8Array(new Float32Array(queryEmbedding).buffer);
  const candidates = db.query<{ rowid: number; distance: number }, [Uint8Array, number]>(
    "SELECT rowid, distance FROM summaries_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
  ).all(queryBlob, limit * 3);

  if (candidates.length === 0) return [];

  const distanceMap = new Map(candidates.map((c) => [c.rowid, c.distance]));
  const rowids = candidates.map((c) => c.rowid);
  const placeholders = rowids.map(() => "?").join(",");

  let sql = `SELECT id, topic_id, COALESCE(run_id, '') AS run_id, summary, user_message, created_at
    FROM summaries WHERE id IN (${placeholders})`;
  const params: (string | number)[] = rowids.map((id) => id as number);

  if (filter.topicId) {
    sql += " AND topic_id = ?";
    params.push(filter.topicId);
  }

  const rows = db.query<{
    id: number;
    topic_id: string;
    run_id: string | null;
    summary: string;
    user_message: string;
    created_at: number;
  }, (string | number)[]>(sql).all(...params);

  return rows
    .map((row) => ({
      id: row.id,
      topic_id: row.topic_id,
      run_id: row.run_id ?? undefined,
      summary: row.summary,
      user_message: row.user_message,
      created_at: row.created_at,
      similarity: 1 / (1 + (distanceMap.get(row.id) ?? 999)),
    } satisfies Summary))
    .sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0))
    .slice(0, limit);
}

function searchSemanticJS(db: Database, queryEmbedding: number[], filter: SearchFilter, limit: number): Summary[] {
  const rows = (filter.topicId
    ? db.query<{
      id: number;
      topic_id: string;
      run_id: string | null;
      summary: string;
      user_message: string;
      embedding: Buffer | null;
      created_at: number;
    }, [string]>(
      `SELECT id, topic_id, COALESCE(run_id, '') AS run_id, summary, user_message, embedding, created_at
       FROM summaries WHERE embedding IS NOT NULL AND topic_id = ?`,
    ).all(filter.topicId)
    : db.query<{
      id: number;
      topic_id: string;
      run_id: string | null;
      summary: string;
      user_message: string;
      embedding: Buffer | null;
      created_at: number;
    }, []>(
      `SELECT id, topic_id, COALESCE(run_id, '') AS run_id, summary, user_message, embedding, created_at
       FROM summaries WHERE embedding IS NOT NULL`,
    ).all());

  return rows
    .map((row) => {
      const similarity = row.embedding ? cosineSimilarity(queryEmbedding, decodeEmbedding(row.embedding)) : 0;
      return {
        id: row.id,
        topic_id: row.topic_id,
        run_id: row.run_id ?? undefined,
        summary: row.summary,
        user_message: row.user_message,
        created_at: row.created_at,
        similarity,
      } satisfies Summary;
    })
    .filter((row) => (row.similarity ?? 0) >= 0.5)
    .sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0))
    .slice(0, limit);
}

function searchKeyword(db: Database, query: string, filter: SearchFilter, limit: number): Summary[] {
  const sql = filter.topicId
    ? `SELECT s.id, s.topic_id, COALESCE(s.run_id, '') AS run_id, s.summary, s.user_message, s.created_at
       FROM summaries_fts fts
       JOIN summaries s ON s.id = fts.rowid
       WHERE summaries_fts MATCH ? AND s.topic_id = ?
       ORDER BY rank LIMIT ?`
    : `SELECT s.id, s.topic_id, COALESCE(s.run_id, '') AS run_id, s.summary, s.user_message, s.created_at
       FROM summaries_fts fts
       JOIN summaries s ON s.id = fts.rowid
       WHERE summaries_fts MATCH ?
       ORDER BY rank LIMIT ?`;

  const rows = filter.topicId
    ? db.query<Summary, [string, string, number]>(sql).all(query, filter.topicId, limit)
    : db.query<Summary, [string, number]>(sql).all(query, limit);

  return rows.map((row) => ({ ...row, run_id: row.run_id ?? undefined }));
}

function enrichTopicNames(db: Database, summaries: Summary[]): void {
  const cache = new Map<string, string>();
  const query = db.query<{ name: string }, [string]>("SELECT name FROM topics WHERE id = ?");
  for (const summary of summaries) {
    if (cache.has(summary.topic_id)) {
      summary.topic_name = cache.get(summary.topic_id);
      continue;
    }
    const row = query.get(summary.topic_id);
    if (row?.name) {
      cache.set(summary.topic_id, row.name);
      summary.topic_name = row.name;
    }
  }
}

export function formatSearchResults(results: Summary[]): string {
  if (results.length === 0) {
    return "No matching memories found.";
  }

  const lines = [`Found ${results.length} results:`];
  for (const result of results) {
    const timestamp = new Date(result.created_at * 1000).toISOString().slice(5, 16).replace("T", " ");
    const similarity = result.similarity ? ` (${Math.round(result.similarity * 100)}%)` : "";
    const topicLabel = result.topic_name || result.topic_id.slice(0, 8);
    lines.push(`  [${timestamp}]${similarity} topic=${JSON.stringify(topicLabel)}${result.run_id ? ` run=${result.run_id}` : ""}`);
    lines.push(`    ${result.summary}`);
  }
  return lines.join("\n");
}

function renderTrajectory(messages: Message[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    switch (message.role) {
      case "user":
        if (message.content) {
          lines.push(`[user] ${message.content}`);
        }
        break;
      case "assistant":
        for (const toolCall of message.toolCalls ?? []) {
          lines.push(`[tool_call] ${toolCall.function.name}(${toolCall.function.arguments})`);
        }
        if (message.content) {
          lines.push(`[assistant] ${message.content}`);
        }
        break;
      case "tool":
        if (message.content) {
          lines.push(`[tool_result] ${message.content}`);
        }
        break;
      default:
        break;
    }
  }
  return lines.join("\n");
}

export async function generateSummary(db: Database, cfg: Config, newMessages: Message[]): Promise<string> {
  let trajectory = renderTrajectory(newMessages);
  if (Array.from(trajectory).length > 6000) {
    trajectory = `${Array.from(trajectory).slice(0, 6000).join("")}\n... (truncated)`;
  }

  let contextSection = "";
  const recentSummaries = getRecentSummaries(db, 5);
  if (recentSummaries.length > 0) {
    contextSection = "近期对话摘要（作为上下文）:\n";
    for (const summary of recentSummaries) {
      contextSection += `- ${summary}\n`;
    }
    contextSection += "\n";
  }

  const prompt = `${contextSection}请用1-3句话总结以下对话。包含：用户的意图、执行了什么操作、最终结果。\n\n对话轨迹:\n${trajectory}`;
  const response = await callLLM(cfg, [
    textMessage("system", "你是一个对话摘要生成器。只输出摘要，不要其他内容。中文输出。"),
    textMessage("user", prompt),
  ], [], null, null);

  return response.content.trim();
}

export async function processMemory(db: Database, cfg: Config, topicId: string, runId: string, newMessages: Message[]): Promise<void> {
  const userMessage = newMessages.find((message) => message.role === "user" && message.content)?.content ?? "";
  const summary = await generateSummary(db, cfg, newMessages).catch(() => truncateRunes(userMessage, 100));
  if (!summary) {
    return;
  }

  const embedding = await getEmbedding(cfg, summary).catch(() => []);
  storeSummary(db, topicId, runId, summary, userMessage, embedding, "");
}
