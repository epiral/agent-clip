/**
 * Agent service — all business logic for UI consumption.
 *
 * Uses resource-oriented commands (topic list, run get, etc.)
 * with unified { data: T } / { data: T[], has_more, cursor? } envelopes.
 *
 * UI components should ONLY call functions from this module.
 */

import { invoke, invokeStream, type StreamEvent } from "@pinixai/core/web";
import type { Agent, CreateAgentInput, Topic, Run, SendOptions, HistoryMessage, TokenUsage } from "./types";

// ─── Envelope helpers ───

/** Unwrap { data: T } envelope from resource-oriented commands */
async function cmd<T>(command: string, params?: Record<string, unknown>): Promise<T> {
  const result = await invoke<{ data: T }>(command, params);
  return result.data;
}

/** Invoke a list command and return { data, has_more, cursor? } */
async function cmdList<T>(command: string, params?: Record<string, unknown>): Promise<{ data: T[]; has_more: boolean; cursor?: string }> {
  return invoke<{ data: T[]; has_more: boolean; cursor?: string }>(command, params);
}

// ─── Agents ───

export async function listAgents(): Promise<Agent[]> {
  return cmd<Agent[]>("agent list");
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  return cmd<Agent>("agent create", {
    name: input.name,
    llm_model: input.llm_model,
    llm_provider: input.llm_provider,
    max_tokens: input.max_tokens,
    system_prompt: input.system_prompt,
    scope: input.scope?.join(","),
    pinned: input.pinned?.join(","),
  });
}

export async function getAgent(id: string): Promise<Agent> {
  return cmd<Agent>("agent get", { args: [id] });
}

export async function updateAgent(id: string, updates: Partial<CreateAgentInput>): Promise<Agent> {
  return cmd<Agent>("agent update", {
    args: [id],
    name: updates.name,
    llm_model: updates.llm_model,
    llm_provider: updates.llm_provider,
    max_tokens: updates.max_tokens,
    system_prompt: updates.system_prompt,
    scope: updates.scope?.join(","),
    pinned: updates.pinned?.join(","),
  });
}

export async function deleteAgent(id: string): Promise<void> {
  await invoke("agent delete", { args: [id] });
}

// ─── Clips ───

export interface ClipInfo {
  name: string;
  package: string;
  version: string;
  commands: string[];
}

export async function listClips(): Promise<ClipInfo[]> {
  return cmd<ClipInfo[]>("clip list");
}

// ─── Topics ───

export interface TopicListResult {
  topics: Topic[];
  has_more: boolean;
  cursor?: string;
}

export async function listTopics(limit = 20, cursor?: string): Promise<TopicListResult> {
  const params: Record<string, unknown> = { limit };
  if (cursor) params.cursor = cursor;
  const result = await cmdList<Topic>("topic list", params);
  return { topics: result.data, has_more: result.has_more, cursor: result.cursor };
}

export async function createTopic(name: string, agentId?: string): Promise<TopicDetail> {
  const params: Record<string, unknown> = { name };
  if (agentId) params.agent_id = agentId;
  return cmd<TopicDetail>("topic create", params);
}

export interface TopicDetail {
  id: string;
  name: string;
  agent_id: string | null;
  forked_from_topic_id?: string | null;
  forked_from_run_id?: string | null;
  created_at: number;
}

export interface TopicResponse {
  topic: TopicDetail;
  agent: { id: string; name: string; llm_model: string | null } | null;
  messages: HistoryMessage[];
  active_run: {
    id: string;
    status: string;
    started_at: number;
    async: boolean;
    output?: string;
  } | null;
}

export interface TopicGetResult {
  data: TopicResponse;
  has_more: boolean;
  cursor?: string;
}

export async function getTopicData(topicId: string, cursor?: string): Promise<TopicGetResult> {
  const params: Record<string, unknown> = { args: [topicId] };
  if (cursor) params.cursor = cursor;
  return invoke<TopicGetResult>("topic get", params);
}

export async function deleteTopic(topicId: string): Promise<void> {
  await invoke("topic delete", { args: [topicId] });
}

export interface ForkResult {
  id: string;
  name: string;
  agent_id: string | null;
  forked_from_topic_id: string | null;
  forked_from_run_id: string | null;
  created_at: number;
}

export async function forkTopic(topicId: string, runId?: string, name?: string): Promise<ForkResult> {
  const params: Record<string, unknown> = { args: [topicId] };
  if (runId) params.run_id = runId;
  if (name) params.name = name;
  return cmd<ForkResult>("topic fork", params);
}

// ─── Upload ───

export interface UploadResult {
  path: string;
  size: number;
  topic_id: string;
}

export async function upload(
  file: File,
  topicId: string,
): Promise<UploadResult> {
  const data = await fileToBase64(file);
  return cmd<UploadResult>("attachment upload", {
    stdin: JSON.stringify({
      name: file.name,
      mime: file.type,
      data,
      topic_id: topicId,
    }),
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Send (streaming) ───

export interface SendCallbacks {
  onInfo?: (message: string) => void;
  onText?: (token: string) => void;
  onThinking?: (token: string) => void;
  onToolCall?: (name: string, args: string) => void;
  onToolResult?: (content: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Send a message and stream the agentic loop response.
 * Returns a cancel function.
 */
export function send(
  message: string,
  options: SendOptions = {},
  callbacks: SendCallbacks = {},
): () => void {
  // If attachments present, use stdin JSON mode
  if (options.attachments?.length) {
    const stdin = JSON.stringify({
      message,
      topic_id: options.topicId,
      run_id: options.runId,
      agent_id: options.agentId,
      attachments: options.attachments,
    });
    return invokeStream(
      "message send",
      { args: ["--output", "jsonl"], stdin },
      (event: StreamEvent) => dispatchEvent(event, callbacks),
      (exitCode: number) => {
        if (exitCode !== 0) callbacks.onError?.(new Error(`send exited with code ${exitCode}`));
      },
    );
  }

  const args: string[] = ["-p", message, "--output", "jsonl"];
  if (options.topicId) args.push("-t", options.topicId);
  if (options.runId) args.push("-r", options.runId);
  if (options.agentId) args.push("-a", options.agentId);
  if (options.async) args.push("--async");

  return invokeStream(
    "message send",
    { args },
    (event: StreamEvent) => dispatchEvent(event, callbacks),
    (exitCode: number) => {
      if (exitCode !== 0) {
        callbacks.onError?.(new Error(`send exited with code ${exitCode}`));
      }
    },
  );
}

function dispatchEvent(event: StreamEvent, callbacks: SendCallbacks) {
  switch (event.type) {
    case "info":
      callbacks.onInfo?.(event.message);
      break;
    case "text":
      callbacks.onText?.(event.content);
      break;
    case "thinking":
      callbacks.onThinking?.(event.content);
      break;
    case "tool_call":
      callbacks.onToolCall?.(event.name, event.arguments);
      break;
    case "tool_result":
      callbacks.onToolResult?.(event.content);
      break;
    case "done":
      callbacks.onDone?.();
      break;
    default: {
      const raw = event as unknown as Record<string, unknown>;
      if (raw.type === "usage") {
        callbacks.onUsage?.(raw as unknown as TokenUsage);
      }
      break;
    }
  }
}

// ─── Runs ───

export async function getRun(runId: string): Promise<Run> {
  return cmd<Run>("run get", { args: [runId] });
}

export async function cancelRun(runId: string): Promise<void> {
  await invoke("run cancel", { args: [runId] });
}

// ─── Config ───

export interface ProviderInfo {
  protocol: string;
  base_url: string;
  api_key: string;
}

export interface AgentConfig {
  name: string;
  hubs: Array<{ url: string; name: string }>;
  installed: Record<string, { hub: string }>;
  providers: Record<string, ProviderInfo>;
  llm_provider: string;
  llm_model: string;
  system_prompt: string;
}

export async function getConfig(): Promise<AgentConfig> {
  return cmd<AgentConfig>("config get");
}

export async function setConfig(key: string, value: string): Promise<void> {
  await invoke("config set", { args: [key, value] });
}

export async function deleteConfig(key: string): Promise<void> {
  await invoke("config delete", { args: [key] });
}

export function isConfigReady(config: AgentConfig): boolean {
  const provider = config.providers[config.llm_provider];
  return !!(provider && provider.api_key);
}
