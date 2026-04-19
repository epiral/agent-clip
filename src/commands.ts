import { listClips, type Stream } from "@pinixai/core";
import { buildContext } from "./context";
import {
  configDelete,
  configSet,
  configToJSON,
  loadConfig,
  resolveAgentConfig,
} from "./config";
import {
  createAgent,
  createRun,
  createTopic,
  deleteAgent,
  deleteTopic,
  finishRun,
  getActiveRun,
  getActiveRunTopics,
  getAgent,
  getRun,
  getTopicAgent,
  injectMessage,
  listAgents,
  listTopicsPage,
  loadMessagesPage,
  openDB,
  readRunOutput,
  saveMessages,
  updateAgent,
  type CreateAgentInput,
} from "./db";
import { advanceDueEvent, claimDueEvents } from "./events";
import { ensureTopicDir, setCurrentTopic, withCurrentTopic } from "./fs";
import { runLoop } from "./loop";
import { processMemory } from "./memory";
import { createAsyncFileOutput, createJSONLChunkOutput, createOutput, type Output } from "./output";
import { getRunController, registerRunController, unregisterRunController } from "./run-control";
import { nowUnix, toErrorMessage, truncateRunes } from "./shared";
import { buildRegistry, toWebMessage, type WebMessage } from "./tools";
import { appendAttachments, readImageAttachments, uploadFile, type UploadInput } from "./upload";
import {
  type InvocationInput,
  type OutputFormat,
  readArgs,
  readStdin,
  readStringField,
  readStdinText,
  resolveCreateTopicName,
  resolveIntegerFlag,
  resolveIntegerOption,
  resolvePositionalOrField,
  resolveSendInput,
} from "./args";

interface RunExecution {
  runId: string;
  topicId: string;
  message: string;
  attachments: string[];
}

interface WebRun {
  id: string;
  status: string;
  started_at: number;
  async: boolean;
  output?: string;
}

interface TopicResponse {
  agent: { id: string; name: string; llm_model: string | null } | null;
  messages: WebMessage[];
  active_run: WebRun | null;
  has_more: boolean;
  oldest_id: number | null;
}

interface WebTopic {
  id: string;
  name: string;
  agent_id: string | null;
  agent_name: string | null;
  message_count: number;
  created_at: number;
  last_message_at: number;
  has_active_run?: boolean;
}

export function formatLegacyHelp(name: string, domain: string): string {
  return [
    `${name} (${domain})`,
    "",
    "Usage:",
    "  bun run index.ts                # start IPC server",
    "  bun run index.ts --ipc",
    "  bun run index.ts send -p \"hello\" [--output jsonl]",
    "  bun run index.ts create-topic -n \"name\"",
    "  bun run index.ts list-topics [-l 20] [--offset 0]",
    "  bun run index.ts get-topic <topic-id> [-l 100]",
    "  bun run index.ts get-run <run-id>",
    "  bun run index.ts cancel-run <run-id>",
    "  bun run index.ts config [subcommand]",
    "  bun run index.ts agent <create|list|get|update|delete>",
    "  bun run index.ts upload < stdin.json",
    "  bun run index.ts event-check [--limit 10]",
    "",
    "Global flags:",
    "  --output raw|jsonl",
    "",
  ].join("\n");
}

export class AgentClipCommands {
  async executeCommand(commandName: string, input: InvocationInput): Promise<unknown> {
    switch (commandName) {
      case "send":
        return await this.runSend(input);
      case "create-topic":
        return await this.runCreateTopic(input);
      case "list-topics":
        return await this.runListTopics(input);
      case "get-topic":
        return await this.runGetTopic(input);
      case "get-run":
        return await this.runGetRun(input);
      case "cancel-run":
        return await this.runCancelRun(input);
      case "delete-topic":
        return await this.runDeleteTopic(input);
      case "config":
        return await this.runConfig(input);
      case "upload":
        return await this.runUpload(input);
      case "agent":
        return await this.runAgentCommand(input);
      case "list-clips":
        return await this.runListClips();
      default:
        throw new Error(`unknown command: ${commandName}`);
    }
  }

  async runCLI(commandName: string, args: string[], outputFormat: OutputFormat): Promise<number> {
    switch (commandName) {
      case "send":
        return await this.runSendCLI(args, outputFormat);
      case "create-topic":
        return await this.runCreateTopicCLI(args, outputFormat);
      case "list-topics":
        return await this.runListTopicsCLI(args, outputFormat);
      case "get-topic":
        return await this.runGetTopicCLI(args, outputFormat);
      case "get-run":
        return await this.runGetRunCLI(args, outputFormat);
      case "cancel-run":
        return await this.runCancelRunCLI(args, outputFormat);
      case "config":
        return await this.runConfigCLI(args, outputFormat);
      case "upload":
        return await this.runUploadCLI(args, outputFormat);
      case "agent":
        return await this.runAgentCLI(args, outputFormat);
      case "list-clips": {
        const out = createOutput(outputFormat);
        out.result(await this.runListClips());
        return 0;
      }
      default:
        throw new Error(`unknown command: ${commandName}`);
    }
  }

  async runEventCheck(args: string[]): Promise<void> {
    const limit = resolveIntegerFlag(args, ["--limit"], 10);
    const db = openDB();
    const due = claimDueEvents(db, limit);
    const out = createOutput("raw");

    if (due.length === 0) {
      out.info("no due events");
      return;
    }

    const activeTopics = getActiveRunTopics(db);
    let triggered = 0;
    let skipped = 0;

    for (const event of due) {
      if (activeTopics[event.topic_id] || getActiveRun(db, event.topic_id)) {
        skipped += 1;
        out.info(`skipped ${event.id}: topic ${event.topic_id} already running`);
        continue;
      }

      const run = createRun(db, event.topic_id, process.pid, true);
      if (!advanceDueEvent(db, event.id, event.fired_at)) {
        finishRun(db, run.id, "cancelled");
        skipped += 1;
        out.info(`skipped ${event.id}: event no longer due`);
        continue;
      }

      this.startBackgroundRun({
        runId: run.id,
        topicId: event.topic_id,
        message: event.run_message,
        attachments: [],
      });
      activeTopics[event.topic_id] = true;
      triggered += 1;
      out.info(`triggered ${event.id} for topic ${event.topic_id} (${run.id})`);
    }

    out.result({ due: due.length, triggered, skipped });
  }

  async runSend(input: InvocationInput, stream?: Stream): Promise<unknown> {
    const lines: string[] = [];
    const out = createJSONLChunkOutput((chunk) => {
      lines.push(chunk);
      if (stream) {
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try { stream.chunk(JSON.parse(trimmed)); } catch { /* skip */ }
        }
      }
    });
    const exitCode = await this.handleSend(input, out);
    if (exitCode !== 0) {
      throw new Error(extractSendError(lines, exitCode));
    }
    return lines.join("");
  }

  private async runSendCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    const out = createOutput(outputFormat);
    const invocation = { args, stdin: readStdinText() } satisfies InvocationInput;
    return await this.handleSend(invocation, out);
  }

  private async runCreateTopicCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    const out = createOutput(outputFormat);
    out.result(await this.runCreateTopic({ args, stdin: readStdinText() }));
    return 0;
  }

  private async runListTopicsCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    const out = createOutput(outputFormat);
    out.result(await this.runListTopics({ args }));
    return 0;
  }

  private async runGetTopicCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    const out = createOutput(outputFormat);
    out.result(await this.runGetTopic({ args }));
    return 0;
  }

  private async runGetRunCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    const out = createOutput(outputFormat);
    out.result(await this.runGetRun({ args }));
    return 0;
  }

  private async runCancelRunCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    const out = createOutput(outputFormat);
    const result = await this.runCancelRun({ args });
    if (outputFormat === "jsonl") {
      out.result(result);
    } else {
      out.info(`[run] ${String(result.id)} cancelled`);
    }
    return 0;
  }

  private async runConfigCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    const out = createOutput(outputFormat);
    const result = await this.runConfig({ args, stdin: readStdinText() });
    if (args.length === 0 || outputFormat === "jsonl") {
      out.result(result);
    } else {
      out.info(String(result));
    }
    return 0;
  }

  private async runUploadCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    if (args.length > 0) {
      throw new Error("upload reads JSON from stdin only");
    }
    const out = createOutput(outputFormat);
    out.result(await this.runUpload({ stdin: readStdinText() }));
    return 0;
  }

  private async handleSend(input: InvocationInput, out: Output): Promise<number> {
    const resolved = resolveSendInput(input);
    if (!resolved.message) {
      throw new Error("message is required (-p or stdin JSON)");
    }

    const db = openDB();

    if (resolved.runId) {
      injectMessage(db, resolved.runId, resolved.message);
      out.info(`[inject] sent to run ${resolved.runId}`);
      return 0;
    }

    const topicId = await ensureTopic(db, resolved.topicId, resolved.agentId, resolved.message, out);
    setCurrentTopic(topicId);
    ensureTopicDir(topicId);

    const activeRun = getActiveRun(db, topicId);
    if (activeRun) {
      const elapsed = Math.max(0, nowUnix() - activeRun.started_at);
      throw new Error(
        `topic ${topicId} has an active run (${activeRun.id}, running ${elapsed}s)\n` +
          `  -> inject:  send -p '...' -r ${activeRun.id}\n` +
          `  -> watch:   get-run ${activeRun.id}\n` +
          `  -> cancel:  cancel-run ${activeRun.id}`,
      );
    }

    if (resolved.isAsync) {
      const run = createRun(db, topicId, process.pid, true);
      this.startBackgroundRun({
        runId: run.id,
        topicId,
        message: resolved.message,
        attachments: resolved.attachments,
      });

      out.info(`[run] ${run.id} started (async)`);
      out.info(`  -> watch:   get-run ${run.id}`);
      out.info(`  -> inject:  send -p '...' -r ${run.id}`);
      out.info(`  -> cancel:  cancel-run ${run.id}`);
      return 0;
    }

    const run = createRun(db, topicId, process.pid, false);
    try {
      await this.executeRunLoop(
        {
          runId: run.id,
          topicId,
          message: resolved.message,
          attachments: resolved.attachments,
        },
        out,
      );
      return 0;
    } catch (error) {
      return isAbortError(error) ? 130 : 1;
    }
  }

  private startBackgroundRun(execution: RunExecution): void {
    const out = createAsyncFileOutput(execution.runId);
    void this.executeRunLoop(execution, out).catch(() => {});
  }

  private async executeRunLoop(execution: RunExecution, out: Output): Promise<void> {
    const db = openDB();
    const globalCfg = loadConfig();
    const agent = getTopicAgent(db, execution.topicId);
    const cfg = resolveAgentConfig(globalCfg, agent);
    const controller = new AbortController();
    registerRunController(execution.runId, controller);
    const signalHandler = () => controller.abort();
    process.on("SIGTERM", signalHandler);
    process.on("SIGINT", signalHandler);

    try {
      await withCurrentTopic(execution.topicId, async () => {
        ensureTopicDir(execution.topicId);
        setCurrentTopic(execution.topicId);
        const message = execution.attachments.length > 0
          ? appendAttachments(execution.message, execution.attachments)
          : execution.message;
        const ctx = await buildContext(db, cfg, execution.topicId, message);
        const images = readImageAttachments(execution.attachments);
        const lastMessage = ctx.messages.at(-1);
        if (images.length > 0 && lastMessage) {
          ctx.messages[ctx.messages.length - 1] = {
            ...lastMessage,
            images,
          };
        }

        const registry = await buildRegistry(db, cfg);
        const newMessages = await runLoop(cfg, ctx, registry, out, {
          db,
          runId: execution.runId,
          signal: controller.signal,
        });
        saveMessages(db, execution.topicId, execution.runId, newMessages);
        await processMemory(db, cfg, execution.topicId, execution.runId, newMessages).catch(() => {});
      });
    } catch (error) {
      const cancelled = controller.signal.aborted || isAbortError(error);
      finishRun(db, execution.runId, cancelled ? "cancelled" : "error");
      out.info(`[error] ${toErrorMessage(error)}`);
      throw error;
    } finally {
      unregisterRunController(execution.runId);
      process.off("SIGTERM", signalHandler);
      process.off("SIGINT", signalHandler);
      out.close();
    }
  }

  private async runCreateTopic(input: InvocationInput): Promise<unknown> {
    const db = openDB();
    const name = resolveCreateTopicName(input);
    if (!name) {
      throw new Error("name is required (-n or stdin JSON)");
    }
    const agentId = readStringField(input, ["agent_id", "agentId"]) || resolveFlag(readArgs(input), ["--agent", "-a"]);
    return createTopic(db, name, agentId || undefined);
  }

  private async runListTopics(input: InvocationInput): Promise<WebTopic[]> {
    const db = openDB();
    const limit = resolveIntegerOption(input, ["-l", "--limit"], "limit", 20);
    const offset = resolveIntegerOption(input, ["--offset"], "offset", 0);
    const topics = listTopicsPage(db, limit, offset);
    const activeTopics = getActiveRunTopics(db);
    return topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      agent_id: topic.agent_id,
      agent_name: topic.agent_name,
      message_count: topic.message_count,
      created_at: topic.created_at,
      last_message_at: topic.last_message_at,
      has_active_run: activeTopics[topic.id],
    }));
  }

  private async runGetTopic(input: InvocationInput): Promise<TopicResponse> {
    const db = openDB();
    const topicId = resolvePositionalOrField(input, 0, ["topic_id", "topicId"]);
    if (!topicId) {
      throw new Error("usage: get-topic <topic-id>");
    }

    const limit = resolveIntegerOption(input, ["-l", "--limit"], "limit", 50);
    const before = resolveIntegerOption(input, ["--before"], "before", 0) || undefined;
    const page = loadMessagesPage(db, topicId, limit, before);
    const messages = page.messages.map((message) => toWebMessage(topicId, message));
    const activeRun = before ? null : getActiveRun(db, topicId);
    const agent = getTopicAgent(db, topicId);

    return {
      agent: agent ? { id: agent.id, name: agent.name, llm_model: agent.llm_model } : null,
      messages,
      active_run: activeRun
        ? {
            id: activeRun.id,
            status: activeRun.status,
            started_at: activeRun.started_at,
            async: activeRun.async,
            output: activeRun.async ? readRunOutput(activeRun.id) : undefined,
          }
        : null,
      has_more: page.has_more,
      oldest_id: page.oldest_id,
    };
  }

  private async runGetRun(input: InvocationInput): Promise<Record<string, unknown>> {
    const db = openDB();
    const runId = resolvePositionalOrField(input, 0, ["run_id", "runId"]);
    if (!runId) {
      throw new Error("usage: get-run <run-id>");
    }

    const run = getRun(db, runId);
    const result: Record<string, unknown> = { ...run };
    if (run.async) {
      result.output = readRunOutput(run.id);
    }
    return result;
  }

  private async runCancelRun(input: InvocationInput): Promise<Record<string, unknown>> {
    const db = openDB();
    const runId = resolvePositionalOrField(input, 0, ["run_id", "runId"]);
    if (!runId) {
      throw new Error("usage: cancel-run <run-id>");
    }

    const run = getRun(db, runId);
    if (run.status !== "running") {
      throw new Error(`run ${run.id} is not active (status: ${run.status})`);
    }

    const controller = getRunController(run.id);
    if (controller) {
      controller.abort();
    } else if (run.pid > 0 && run.pid !== process.pid) {
      try {
        process.kill(run.pid, "SIGTERM");
      } catch {
        // Ignore missing process.
      }
    }

    finishRun(db, run.id, "cancelled");
    return { id: run.id, status: "cancelled" };
  }

  private async runDeleteTopic(input: InvocationInput): Promise<Record<string, unknown>> {
    const db = openDB();
    const topicId = resolvePositionalOrField(input, 0, ["topic_id", "topicId"]);
    if (!topicId) {
      throw new Error("usage: delete-topic <topic-id>");
    }
    deleteTopic(db, topicId);
    return { id: topicId, deleted: true };
  }

  private async runConfig(input: InvocationInput): Promise<unknown> {
    const args = readArgs(input);
    if (args.length === 0) {
      return configToJSON(loadConfig());
    }

    switch (args[0]) {
      case "set": {
        if (args.length < 3) {
          throw new Error("usage: config set <dot.path> <value>");
        }
        const key = args[1];
        const value = args.slice(2).join(" ");
        configSet(key, value);
        return `${key} = ${value}`;
      }
      case "delete": {
        if (args.length < 2) {
          throw new Error("usage: config delete <dot.path>");
        }
        const key = args[1] ?? "";
        configDelete(key);
        return key ? `deleted ${key}` : "config reset";
      }
      default:
        throw new Error(`unknown subcommand: ${args[0]}`);
    }
  }

  private async runUpload(input: InvocationInput): Promise<unknown> {
    const raw = readStdin(input);
    if (!raw) {
      throw new Error("upload requires stdin JSON payload");
    }
    return uploadFile(JSON.parse(raw) as UploadInput);
  }

  private async runListClips(): Promise<unknown> {
    const clips = await listClips();
    return clips.map((c) => ({
      name: c.name,
      package: c.package ?? "",
      version: c.version ?? "",
      commands: (c.commands ?? []).map((cmd) => cmd.name),
    }));
  }

  private async runAgentCommand(input: InvocationInput): Promise<unknown> {
    const args = readArgs(input);
    if (args.length === 0) {
      throw new Error("usage: agent <create|list|get|update|delete>");
    }
    const db = openDB();

    switch (args[0]) {
      case "create": {
        const parsed = parseAgentFlags(args.slice(1));
        if (!parsed.name) {
          throw new Error("usage: agent create --name <name> [--model <model>] [--provider <provider>] [--max-tokens <n>] [--system-prompt <text>] [--scope clip1,clip2] [--pinned clip1,clip2]");
        }
        return createAgent(db, parsed);
      }
      case "list":
        return listAgents(db);
      case "get": {
        const id = args[1] ?? resolvePositionalOrField(input, 1, ["id"]);
        if (!id) throw new Error("usage: agent get <id>");
        return getAgent(db, id);
      }
      case "update": {
        const id = args[1];
        if (!id) throw new Error("usage: agent update <id> [--name ...] [--model ...] ...");
        const updates = parseAgentFlags(args.slice(2));
        return updateAgent(db, id, updates);
      }
      case "delete": {
        const id = args[1] ?? resolvePositionalOrField(input, 1, ["id"]);
        if (!id) throw new Error("usage: agent delete <id>");
        deleteAgent(db, id);
        return { id, deleted: true };
      }
      default:
        throw new Error(`unknown: agent ${args[0]}. Use: create|list|get|update|delete`);
    }
  }

  private async runAgentCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    const out = createOutput(outputFormat);
    out.result(await this.runAgentCommand({ args, stdin: readStdinText() }));
    return 0;
  }
}

async function ensureTopic(db: ReturnType<typeof openDB>, topicId: string, agentId: string, message: string, out: Output): Promise<string> {
  if (topicId) {
    return topicId;
  }

  const name = truncateRunes(message, 30) + (Array.from(message).length > 30 ? "..." : "");
  const topic = createTopic(db, name || "new topic", agentId || undefined);
  const agentLabel = topic.agent_id ? ` [agent=${topic.agent_id}]` : "";
  out.info(`[topic] ${topic.id} (${topic.name})${agentLabel}`);
  return topic.id;
}

function parseAgentFlags(args: string[]): CreateAgentInput & Record<string, unknown> {
  const result: CreateAgentInput & Record<string, unknown> = { name: "" };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--name":
        result.name = next ?? "";
        i += 1;
        break;
      case "--model":
        result.llm_model = next;
        i += 1;
        break;
      case "--provider":
        result.llm_provider = next;
        i += 1;
        break;
      case "--max-tokens":
        result.max_tokens = next ? parseInt(next, 10) : undefined;
        i += 1;
        break;
      case "--system-prompt":
        result.system_prompt = next;
        i += 1;
        break;
      case "--scope":
        result.scope = next ? next.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
        i += 1;
        break;
      case "--pinned":
        result.pinned = next ? next.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
        i += 1;
        break;
      default:
        break;
    }
  }

  return result;
}

function resolveFlag(args: string[], flags: string[]): string {
  for (let i = 0; i < args.length; i += 1) {
    if (flags.includes(args[i]) && args[i + 1]) {
      return args[i + 1];
    }
  }
  return "";
}

function extractSendError(chunks: string[], exitCode: number): string {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(chunks[index]) as { type?: string; message?: string };
      if (entry.type === "info" && typeof entry.message === "string" && entry.message.startsWith("[error] ")) {
        return entry.message.slice("[error] ".length);
      }
    } catch {
      // Ignore malformed output fragments.
    }
  }

  return `send exited with code ${exitCode}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
