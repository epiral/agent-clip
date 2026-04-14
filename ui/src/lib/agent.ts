/**
 * Agent service — all business logic for UI consumption.
 *
 * Every method maps to a backend command.
 * UI components should ONLY call functions from this module.
 */

import { invoke, invokeStream, type StreamEvent } from "@pinixai/core/web";
import type { Topic, Run, SendOptions, HistoryMessage, TokenUsage } from "./types";

// ─── Topics ───

export async function listTopics(): Promise<Topic[]> {
  return invoke<Topic[]>("list-topics");
}

export async function createTopic(name: string): Promise<Topic> {
  return invoke<Topic>("create-topic", {
    args: ["-n", name],
  });
}

export interface TopicResponse {
  messages: HistoryMessage[];
  active_run: {
    id: string;
    status: string;
    started_at: number;
    async: boolean;
    output?: string;
  } | null;
  has_more: boolean;
  oldest_id: number | null;
}

export async function getTopicData(topicId: string, before?: number): Promise<TopicResponse> {
  const args = [topicId];
  if (before) args.push("--before", String(before));
  return invoke<TopicResponse>("get-topic", { args });
}

export async function deleteTopic(topicId: string): Promise<void> {
  await invoke("delete-topic", { args: [topicId] });
}

// ─── Upload ───

export interface UploadResult {
  path: string;
  size: number;
}

export async function upload(
  file: File,
  topicId: string,
): Promise<UploadResult> {
  const data = await fileToBase64(file);
  return invoke<UploadResult>("upload", {
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
      // Strip data:...;base64, prefix
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
      attachments: options.attachments,
    });
    return invokeStream(
      "send",
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
  if (options.async) args.push("--async");

  return invokeStream(
    "send",
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
      // Extension events (pass through core's open runtime filter)
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
  return invoke<Run>("get-run", { args: [runId] });
}

export async function cancelRun(runId: string): Promise<void> {
  await invoke("cancel-run", { args: [runId] });
}

// ─── Config ───

export interface ProviderInfo {
  protocol: string;
  base_url: string;
  api_key: string; // masked
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
  return invoke<AgentConfig>("config");
}

export async function setConfig(key: string, value: string): Promise<void> {
  await invoke("config", { args: ["set", key, value] });
}

export async function deleteConfig(key: string): Promise<void> {
  await invoke("config", { args: ["delete", key] });
}

export function isConfigReady(config: AgentConfig): boolean {
  const provider = config.providers[config.llm_provider];
  return !!(provider && provider.api_key);
}
