/** Data types matching backend Go structs */

export interface Topic {
  id: string;
  name: string;
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
  async?: boolean;
  attachments?: string[];
}

export interface FileAttachment {
  file: File;
  preview: string; // object URL for image preview
}

/** Raw message from backend get-topic */
export interface HistoryMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  reasoning?: string;
  tool_calls?: { name: string; arguments: string }[];
  attachments?: { name: string; url: string; is_image: boolean }[];
}

// ─── Block-based message model (supports interleaved thinking/tool/text) ───

export type MessageBlock =
  | { type: "thinking"; content: string }
  | { type: "tool_call"; name: string; arguments: string; result?: string; status: "running" | "done" | "error" }
  | { type: "text"; content: string }
  | { type: "image"; url: string; name: string };

/** A single chat message for rendering */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
  status: "done" | "streaming" | "error";
}
