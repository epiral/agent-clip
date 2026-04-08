import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { Config } from "./config";
import type { ContextResult } from "./context";
import { trackClipUsage } from "./context";
import { drainInbox, tryFinishRun } from "./db";
import { callLLM, toolResultMessage, type Message, type ToolCall } from "./llm";
import { log, setCurrentRunId } from "./log";
import { imageDataFromBytes, isImageFile } from "./media";
import type { Output } from "./output";
import { dataRoot } from "./paths";
import { runToolDef, type Registry } from "./tools";

export const maxIterations = 20;

export interface RunContext {
  db: Database;
  runId: string;
  signal?: AbortSignal;
}

export async function runLoop(
  cfg: Config,
  ctx: ContextResult,
  registry: Registry,
  out: Output,
  rc?: RunContext,
): Promise<Message[]> {
  setCurrentRunId(rc?.runId ?? "");
  const context: Message[] = [{ role: "system", content: ctx.systemPrompt }, ...ctx.messages];
  const lastMessage = ctx.messages.at(-1);
  const newMessages: Message[] = lastMessage ? [lastMessage] : [];
  const tools = [runToolDef(registry.help())];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    throwIfAborted(rc?.signal);
    drainInjectedMessages(context, newMessages, out, rc);

    let startedThinking = false;
    const response = await callLLM(
      cfg,
      context,
      tools,
      (token) => {
        out.text(token);
      },
      (token) => {
        if (!startedThinking) {
          out.thinking("[thinking] ");
          startedThinking = true;
        }
        out.thinking(token);
      },
      rc?.signal,
    );

    if (response.toolCalls.length > 0) {
      const assistantMessage: Message = {
        role: "assistant",
        toolCalls: response.toolCalls,
      };
      if (response.content) {
        assistantMessage.content = response.content;
      }
      if (response.reasoning) {
        assistantMessage.reasoning = response.reasoning;
      }

      context.push(assistantMessage);
      newMessages.push(assistantMessage);

      for (const toolCall of response.toolCalls) {
        throwIfAborted(rc?.signal);
        out.toolCall(toolCall.function.name, toolCall.function.arguments);
        const result = await executeToolCall(registry, toolCall);
        out.toolResult(result);

        const toolMessage = toolResultMessage(toolCall.id, result);
        const images = extractImagesFromResult(result);
        if (images.length > 0) {
          toolMessage.images = images;
        }
        context.push(toolMessage);
        newMessages.push(toolMessage);
      }
      continue;
    }

    const assistantMessage: Message = {
      role: "assistant",
      content: response.content,
    };
    if (response.reasoning) {
      assistantMessage.reasoning = response.reasoning;
    }

    if (rc) {
      const injected = tryFinishRun(rc.db, rc.runId, "done");
      if (injected.length > 0) {
        context.push(assistantMessage);
        newMessages.push(assistantMessage);
        for (const message of injected) {
          out.inject(message);
          const injectedMessage = wrapInjectedMessage(message);
          context.push(injectedMessage);
          newMessages.push(injectedMessage);
        }
        continue;
      }
    }

    context.push(assistantMessage);
    newMessages.push(assistantMessage);
    out.done();
    setCurrentRunId("");
    return newMessages;
  }

  setCurrentRunId("");
  throw new Error(`agentic loop exceeded ${maxIterations} iterations`);
}

function drainInjectedMessages(
  context: Message[],
  newMessages: Message[],
  out: Output,
  rc?: RunContext,
): void {
  if (!rc) {
    return;
  }

  const injected = drainInbox(rc.db, rc.runId);
  for (const message of injected) {
    out.inject(message);
    const injectedMessage = wrapInjectedMessage(message);
    context.push(injectedMessage);
    newMessages.push(injectedMessage);
  }
}

function wrapInjectedMessage(message: string): Message {
  return {
    role: "user",
    content: `<user>\n${message}\n</user>`,
  };
}

async function executeToolCall(registry: Registry, toolCall: ToolCall): Promise<string> {
  const args = parseToolArguments(toolCall);
  if (!args.command) {
    return args.parseError ?? "[error] empty command";
  }
  // Track clip usage: extract the first token (clip alias) from the command
  const firstToken = args.command.trim().split(/\s+/)[0];
  if (firstToken) {
    trackClipUsage(firstToken);
  }
  const result = await registry.exec(args.command, args.stdin);
  if (result.startsWith("[error]")) {
    log("run.error", { command: args.command, stdin_length: args.stdin.length || undefined, error: result });
  }
  return result;
}

function parseToolArguments(toolCall: ToolCall): { command: string; stdin: string; parseError?: string } {
  let parsed: { command?: string; stdin?: string } = {};
  try {
    parsed = JSON.parse(toolCall.function.arguments || "{}") as { command?: string; stdin?: string };
  } catch (error) {
    const raw = toolCall.function.arguments ?? "";
    const preview = raw.length > 500 ? raw.slice(0, 500) + `... (${raw.length} chars total)` : raw;
    log("run.parse_error", { tool: toolCall.function.name, error: error instanceof Error ? error.message : String(error), raw_length: raw.length, raw_preview: preview });
    return {
      command: "",
      stdin: "",
      parseError: `[error] failed to parse tool call arguments (JSON truncated or malformed)\n${error instanceof Error ? error.message : String(error)}\nraw arguments: ${preview}`,
    };
  }

  let command = parsed.command ?? "";
  if (toolCall.function.name !== "run") {
    const prefix = toolCall.function.name;
    if (!command || !command.startsWith(prefix)) {
      command = command ? `${prefix} ${command}` : prefix;
    }
  }

  return {
    command,
    stdin: parsed.stdin ?? "",
  };
}

const pinixDataURLRe = /pinix-data:\/\/local\/data\/((?:topics\/[^/]+\/|images\/)[^\s)]+)/g;

function extractImagesFromResult(result: string) {
  const images: Array<ReturnType<typeof imageDataFromBytes>> = [];
  for (const match of result.matchAll(pinixDataURLRe)) {
    const relativePath = match[1];
    if (!relativePath || !isImageFile(relativePath)) {
      continue;
    }

    const absolutePath = join(dataRoot(), ...relativePath.split("/"));
    if (!existsSync(absolutePath)) {
      continue;
    }

    try {
      const bytes = readFileSync(absolutePath);
      images.push(imageDataFromBytes(relativePath, bytes));
    } catch {
      // Ignore unreadable images.
    }
  }
  return images;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("run cancelled");
  error.name = "AbortError";
  throw error;
}
