/** Data types matching backend Go structs */

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

export interface CreateAgentInput {
  name: string;
  llm_provider?: string;
  llm_model?: string;
  max_tokens?: number;
  system_prompt?: string;
  scope?: string[];
  pinned?: string[];
}

export interface Topic {
  id: string;
  name: string;
  agent_id: string | null;
  agent_name: string | null;
  message_count: number;
  created_at: number;
  last_message_at: number;
  has_active_run?: boolean;
}

export interface Run {
  id: string;
  topic_id: string;
  status: "running" | "done" | "error" | "cancelled";
  pid: number;
  async: boolean;
  started_at: number;
  finished_at?: number;
}

export interface SendOptions {
  topicId?: string;
  runId?: string;
  agentId?: string;
  async?: boolean;
  attachments?: string[];
}

export interface FileAttachment {
  file: File;
  preview: string; // object URL for image preview
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
}

/** Raw message from backend get-topic */
export interface HistoryMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  reasoning?: string;
  tool_calls?: { name: string; arguments: string }[];
  attachments?: { name: string; url: string; is_image: boolean }[];
  usage?: TokenUsage;
}

// ─── Block-based message model (supports interleaved thinking/tool/text) ───

export type MessageBlock =
  | { type: "thinking"; content: string }
  | { type: "tool_call"; name: string; arguments: string; result?: string; status: "running" | "done" | "error" }
  | { type: "text"; content: string }
  | { type: "image"; url: string; name: string }
  | { type: "usage"; usage: TokenUsage };

/** A single chat message for rendering */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
  status: "done" | "streaming" | "error";
}
