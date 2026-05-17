/**
 * Agent handler — resource-oriented commands for agents.
 *
 * Clip Commands:
 *   agent create  --name, --model?, --provider?, ...
 *   agent list
 *   agent get     <id>
 *   agent update  <id> --name?, --model?, ...
 *   agent delete  <id>
 */

import type { InvocationInput } from "../args";
import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  openDB,
  updateAgent,
  type Agent,
  type CreateAgentInput,
} from "../db";
import { ok, deleted, type DataResponse, type DeleteResponse } from "./response";
import { readId, readInt, readString } from "./params";

// --- Response types ---

export interface AgentWithStats extends Agent {
  topic_count: number;
}

// --- Handlers ---

export function handleAgentCreate(input: InvocationInput): DataResponse<Agent> {
  const parsed = parseAgentInput(input);
  if (!parsed.name) throw new Error("--name is required");

  const db = openDB();
  const agent = createAgent(db, parsed);
  return ok(agent);
}

export function handleAgentList(_input: InvocationInput): DataResponse<AgentWithStats[]> {
  const db = openDB();
  const agents = listAgents(db);

  // Attach topic_count for each agent
  const withStats = agents.map((agent) => {
    const row = db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM topics WHERE agent_id = ?",
    ).get(agent.id);
    return { ...agent, topic_count: row?.count ?? 0 };
  });

  return ok(withStats);
}

export function handleAgentGet(input: InvocationInput): DataResponse<Agent> {
  const id = readId(input, 0, ["id"]);
  if (!id) throw new Error("agent id is required");

  const db = openDB();
  return ok(getAgent(db, id));
}

export function handleAgentUpdate(input: InvocationInput): DataResponse<Agent> {
  const id = readId(input, 0, ["id"]);
  if (!id) throw new Error("agent id is required");

  const updates = parseAgentInput(input);
  const db = openDB();
  return ok(updateAgent(db, id, updates));
}

export function handleAgentDelete(input: InvocationInput): DeleteResponse {
  const id = readId(input, 0, ["id"]);
  if (!id) throw new Error("agent id is required");

  const db = openDB();
  deleteAgent(db, id);
  return deleted(id);
}

// --- Helpers ---

function parseAgentInput(input: InvocationInput): CreateAgentInput {
  const result: CreateAgentInput = {
    name: readString(input, ["name"], ["--name"]),
  };

  const model = readString(input, ["llm_model", "model"], ["--model"]);
  if (model) result.llm_model = model;

  const provider = readString(input, ["llm_provider", "provider"], ["--provider"]);
  if (provider) result.llm_provider = provider;

  const maxTokens = readInt(input, ["max_tokens", "maxTokens"], ["--max-tokens", "--max_tokens"]);
  if (maxTokens !== undefined) result.max_tokens = maxTokens;

  const systemPrompt = readString(input, ["system_prompt", "systemPrompt"], ["--system-prompt", "--system_prompt"]);
  if (systemPrompt) result.system_prompt = systemPrompt;

  const scope = readString(input, ["scope"], ["--scope"]);
  if (scope) result.scope = scope.split(",").map((s) => s.trim()).filter(Boolean);

  const pinned = readString(input, ["pinned"], ["--pinned"]);
  if (pinned) result.pinned = pinned.split(",").map((s) => s.trim()).filter(Boolean);

  return result;
}
