interface PendingInvoke {
  chunks: unknown[];
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface OutgoingInvoke {
  id: string;
  type: "invoke";
  clip: string;
  command: string;
  input: unknown;
}

interface IncomingResponse {
  id?: string;
  type?: string;
  output?: unknown;
  error?: string;
}

let ipcMode = false;
let sendMessage: ((message: OutgoingInvoke) => void) | null = null;
let nextInvokeID = 0;
const pendingInvokes = new Map<string, PendingInvoke>();

export function setIPCMode(value: boolean): void {
  ipcMode = value;
}

export function isIPCMode(): boolean {
  return ipcMode;
}

export function setIPCTransport(sender: ((message: OutgoingInvoke) => void) | null): void {
  sendMessage = sender;
}

export async function invoke(clip: string, command: string, input: unknown): Promise<unknown> {
  if (!ipcMode || !sendMessage) {
    throw new Error(`invoke(${clip}, ${command}) requires Pinix IPC runtime`);
  }

  const sender = sendMessage;
  const id = `c${++nextInvokeID}`;

  return await new Promise((resolve, reject) => {
    pendingInvokes.set(id, {
      chunks: [],
      resolve,
      reject,
    });

    try {
      sender({
        id,
        type: "invoke",
        clip,
        command,
        input,
      });
    } catch (error) {
      pendingInvokes.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function handleInvokeResponse(message: IncomingResponse): boolean {
  const id = message.id ?? "";
  if (!id) {
    return false;
  }

  const pending = pendingInvokes.get(id);
  if (!pending) {
    return false;
  }

  switch (message.type) {
    case "result":
      pendingInvokes.delete(id);
      pending.resolve(message.output ?? {});
      return true;
    case "chunk":
      pending.chunks.push(message.output);
      return true;
    case "done":
      pendingInvokes.delete(id);
      pending.resolve(aggregateChunks(pending.chunks));
      return true;
    case "error":
      pendingInvokes.delete(id);
      pending.reject(new Error(message.error || "invoke failed"));
      return true;
    default:
      return false;
  }
}

function aggregateChunks(chunks: unknown[]): unknown {
  if (chunks.length === 0) {
    return {};
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

  if (chunks.every((chunk) => typeof chunk === "string")) {
    return chunks.join("");
  }

  return chunks.at(-1) ?? {};
}
