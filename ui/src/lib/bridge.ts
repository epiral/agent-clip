/**
 * Transport layer for the clip web UI.
 *
 * In Pinix Portal, the UI runs under `/clips/<name>/` and invokes clip
 * commands through relative HTTP endpoints: `POST api/<command>`.
 *
 * This module keeps the old `invoke` / `invokeStream` interface so the rest
 * of the UI can stay unchanged.
 */

type InvokeOptions = {
  args?: string[];
  stdin?: string;
};

// --- Stream event types (matches JSONL output from backend) ---

export type StreamEvent =
  | { type: "info"; message: string }
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_call"; name: string; arguments: string }
  | { type: "tool_result"; content: string }
  | { type: "inject"; content: string }
  | { type: "result"; data: unknown }
  | { type: "done" };

const STREAM_EVENT_TYPES = new Set<StreamEvent["type"]>([
  "info",
  "text",
  "thinking",
  "tool_call",
  "tool_result",
  "inject",
  "result",
  "done",
]);

function commandURL(command: string): string {
  return `api/${command}`;
}

async function postCommand(command: string, opts: InvokeOptions, signal?: AbortSignal): Promise<Response> {
  return await fetch(commandURL(command), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(opts),
    signal,
  });
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const directMessage = (payload as { message?: unknown }).message;
    if (typeof directMessage === "string" && directMessage.trim()) {
      return directMessage;
    }

    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) {
      return error;
    }

    if (error && typeof error === "object") {
      const nestedMessage = (error as { message?: unknown }).message;
      if (typeof nestedMessage === "string" && nestedMessage.trim()) {
        return nestedMessage;
      }
    }
  }

  return fallback;
}

function isStreamEvent(value: unknown): value is StreamEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && STREAM_EVENT_TYPES.has(type as StreamEvent["type"]);
}

function emitJSONL(text: string, onEvent: (event: StreamEvent) => void): void {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      emitPayload(JSON.parse(trimmed), onEvent);
    } catch {
      // Ignore non-JSONL lines.
    }
  }
}

function emitPayload(payload: unknown, onEvent: (event: StreamEvent) => void): void {
  if (payload == null) {
    return;
  }

  if (typeof payload === "string") {
    emitJSONL(payload, onEvent);
    return;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      emitPayload(item, onEvent);
    }
    return;
  }

  if (isStreamEvent(payload)) {
    onEvent(payload);
  }
}

/** invoke a command, return parsed JSON response or raw string */
export async function invoke<T = unknown>(
  command: string,
  opts: InvokeOptions = {},
): Promise<T> {
  const response = await postCommand(command, opts);
  const payload = await readResponseBody(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, `command "${command}" failed (${response.status})`));
  }

  return payload as T;
}

/** invoke a command with streaming output, parsing backend JSONL events */
export function invokeStream(
  command: string,
  opts: InvokeOptions,
  onEvent: (event: StreamEvent) => void,
  onDone: (exitCode: number) => void,
): () => void {
  const controller = new AbortController();
  let cancelled = false;

  void (async () => {
    const exitCode = await streamCommand(command, opts, controller.signal, onEvent);
    if (!cancelled && exitCode !== null) {
      onDone(exitCode);
    }
  })();

  return () => {
    cancelled = true;
    controller.abort();
  };
}

async function streamCommand(
  command: string,
  opts: InvokeOptions,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void,
): Promise<number | null> {
  let response: Response;

  try {
    response = await fetch(commandURL(command), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(opts),
      signal,
    });
  } catch (error) {
    return isAbortError(error) || signal.aborted ? null : -1;
  }

  if (!response.ok) {
    const payload = await readResponseBody(response).catch(() => null);
    emitPayload(payload, onEvent);
    return 1;
  }

  if (!response.body) {
    const payload = await readResponseBody(response).catch(() => null);
    emitPayload(payload, onEvent);
    return 0;
  }

  // Parse SSE stream: "data: {...}\n\n" or "event: done\ndata: {}\n\n"
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.trim()) continue;

        // Check for "event: done"
        if (part.includes("event: done")) {
          onEvent({ type: "done" });
          continue;
        }

        // Extract "data: ..." line
        const dataMatch = part.match(/^data:\s*(.+)$/m);
        if (!dataMatch) continue;

        try {
          const chunk = JSON.parse(dataMatch[1]);
          // chunk could be a StreamEvent directly or a raw JSONL line
          if (chunk && typeof chunk === "object" && "type" in chunk) {
            onEvent(chunk as StreamEvent);
          } else if (chunk && typeof chunk === "object" && "error" in chunk) {
            onEvent({ type: "info", message: `Error: ${(chunk as { error: string }).error}` });
          }
        } catch {
          // skip unparseable chunks
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const dataMatch = buffer.match(/^data:\s*(.+)$/m);
      if (dataMatch) {
        try {
          const chunk = JSON.parse(dataMatch[1]);
          if (chunk && typeof chunk === "object" && "type" in chunk) {
            onEvent(chunk as StreamEvent);
          }
        } catch {
          // skip
        }
      }
    }

    return 0;
  } catch (error) {
    return isAbortError(error) || signal.aborted ? null : -1;
  }
}
