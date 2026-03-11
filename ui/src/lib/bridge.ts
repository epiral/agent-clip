/**
 * Bridge — Clip Dock communication layer.
 *
 * In Clip Dock Desktop (Electron), window.Bridge is injected via preload.
 * Outside Clip Dock, all calls throw "No Bridge available".
 */

interface BridgeAPI {
  invoke(command: string, payload?: unknown): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  invokeStream(
    command: string,
    opts: { args?: string[]; stdin?: string },
    onChunk: (kind: "stdout" | "stderr", text: string) => void,
    onDone: (exitCode: number) => void,
    onError: (error: Error) => void,
  ): () => void;
}

declare global {
  interface Window {
    Bridge?: BridgeAPI;
  }
}

function getBridge(): BridgeAPI {
  if (!window.Bridge) throw new Error("No Bridge available (not in Clip Dock)");
  return window.Bridge;
}

/** invoke a command, return parsed stdout as JSON or raw string */
export async function invoke<T = unknown>(
  command: string,
  opts: { args?: string[]; stdin?: string } = {},
): Promise<T> {
  const bridge = getBridge();
  const result = await bridge.invoke(command, opts);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `command "${command}" failed (exit ${result.exitCode})`);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return result.stdout as unknown as T;
  }
}

/** invoke a command with streaming stdout, parse each line as JSONL */
export function invokeStream(
  command: string,
  opts: { args?: string[]; stdin?: string },
  onEvent: (event: StreamEvent) => void,
  onDone: (exitCode: number) => void,
): () => void {
  const bridge = getBridge();
  let buffer = "";

  return bridge.invokeStream(
    command,
    opts,
    (kind: "stdout" | "stderr", chunk: string) => {
      if (kind !== "stdout") return;
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onEvent(JSON.parse(line) as StreamEvent);
        } catch {
          // not JSONL, ignore
        }
      }
    },
    (exitCode: number) => {
      // flush remaining buffer
      if (buffer.trim()) {
        try {
          onEvent(JSON.parse(buffer) as StreamEvent);
        } catch {
          // ignore
        }
      }
      onDone(exitCode);
    },
    () => {
      onDone(-1);
    },
  );
}

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
