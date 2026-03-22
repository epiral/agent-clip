// @ts-nocheck
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Clip, command, handler, z } from "./src/pinix-core";
import { ensureConfigExists, configAddClip, configDelete, configRemoveClip, configSet, configToJSON, loadConfig, parseClipInput } from "./src/config";
import { buildContext } from "./src/context";
import {
  countTopics,
  createRun,
  createTopic,
  finishRun,
  getActiveRun,
  getActiveRunTopics,
  getRun,
  getTopic,
  injectMessage,
  listTopicsPage,
  loadMessagesByRunID,
  loadMessagesPage,
  openDB,
  readRunOutput,
  saveMessages,
  updateRunPID,
  type Run,
} from "./src/db";
import { claimDueEvents } from "./src/events";
import { ensureTopicDir, getCurrentTopic, setCurrentTopic } from "./src/fs";
import { runLoop } from "./src/loop";
import { processMemory } from "./src/memory";
import { createAsyncFileOutput, createJSONLChunkOutput, createOutput, type Output } from "./src/output";
import { projectRoot, rootPath } from "./src/paths";
import { registerRunController, unregisterRunController } from "./src/run-control";
import { handleInvokeResponse, setIPCMode, setIPCTransport } from "./src/runtime";
import { attachmentToURL, extractThinking, extractUserContent } from "./src/sanitize";
import { createSkill, deleteSkill, ensureSkillsDir, listSkills, loadSkill, updateSkill } from "./src/skills";
import { nowUnix, randomID, readStdinText, safeJSONParse, toErrorMessage, truncateRunes } from "./src/shared";
import { buildRegistry, toWebMessage } from "./src/tools";
import { appendAttachments, readImageAttachments, uploadFile, type UploadInput } from "./src/upload";

const InvocationSchema = z.object({
  args: z.array(z.string()).optional(),
  stdin: z.string().optional(),
}).passthrough();

const AnyOutputSchema = z.any();

type OutputFormat = "raw" | "jsonl";

type InvocationInput = z.infer<typeof InvocationSchema>;

interface IPCMessage {
  id?: string;
  type: "register" | "registered" | "invoke" | "result" | "error" | "chunk" | "done";
  clip?: string;
  command?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  manifest?: {
    name: string;
    domain: string;
    description?: string;
    commands: Array<{ name: string; description?: string }>;
    dependencies: string[];
  };
}

interface PinixFileManifest {
  name?: string;
  domain?: string;
  description?: string;
  commands?: Array<{ name?: string; description?: string }>;
  dependencies?: Record<string, string>;
}

interface SendJSONInput {
  message?: string;
  topic_id?: string;
  run_id?: string;
  attachments?: string[];
}

interface ResolvedSendInput {
  message: string;
  topicId: string;
  runId: string;
  attachments: string[];
  isAsync: boolean;
}

interface WorkerPayload {
  runId: string;
  topicId: string;
  message: string;
  attachments: string[];
  outputFormat: OutputFormat;
  asyncFile: boolean;
}

interface WebRun {
  id: string;
  status: string;
  started_at: number;
  async: boolean;
  output?: string;
}

interface TopicResponse {
  messages: ReturnType<typeof toWebMessage>[];
  active_run: WebRun | null;
}

interface WebTopic {
  id: string;
  name: string;
  message_count: number;
  created_at: number;
  last_message_at: number;
  has_active_run?: boolean;
}

interface SkillPayload {
  name: string;
  description: string;
  content: string;
}

interface WorkerSpawnOptions {
  detached: boolean;
  outputFormat: OutputFormat;
  asyncFile: boolean;
  stdio: ["ignore" | "pipe", "ignore" | "pipe", "ignore" | "pipe"];
}

class IPCResponder {
  finished = false;
  streamed = false;

  constructor(private readonly id: string, private readonly send: (message: IPCMessage) => void) {}

  result(output: unknown): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.send({ id: this.id, type: "result", output });
  }

  chunk(output: string): void {
    if (this.finished) {
      return;
    }
    this.streamed = true;
    this.send({ id: this.id, type: "chunk", output });
  }

  done(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.send({ id: this.id, type: "done" });
  }

  fail(error: unknown): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.send({ id: this.id, type: "error", error: toErrorMessage(error) });
  }
}

const pinixManifest = loadPinixManifest();
const dependencyNames = Object.keys(pinixManifest.dependencies ?? {});

class AgentClip extends Clip {
  name = pinixManifest.name ?? "agent";
  domain = pinixManifest.domain ?? "ai";
  patterns = ["send -> tool use -> memory"];
  description = pinixManifest.description ?? "AI Agent — agentic loop with memory, tools, and vision";
  dependencies = dependencyNames;

  @command("发送消息并执行 agentic loop")
  send = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.executeCommand("send", input));

  @command("创建新话题")
  ["create-topic"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.executeCommand("create-topic", input));

  @command("列出所有话题")
  ["list-topics"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.executeCommand("list-topics", input));

  @command("读取话题消息和活动 Run")
  ["get-topic"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.executeCommand("get-topic", input));

  @command("获取运行状态")
  ["get-run"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.executeCommand("get-run", input));

  @command("取消运行")
  ["cancel-run"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.executeCommand("cancel-run", input));

  @command("配置管理")
  config = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.executeCommand("config", input));

  @command("技能管理")
  skill = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.executeCommand("skill", input));

  @command("上传附件")
  upload = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.executeCommand("upload", input));

  async start(): Promise<void> {
    ensureConfigExists();
    ensureSkillsDir();

    const argv = process.argv.slice(2);
    const first = argv[0];

    if (!first || first === "--ipc") {
      await serveAgentIPC(this);
      return;
    }

    if (first === "--help" || first === "help") {
      process.stdout.write(this.legacyHelp());
      return;
    }

    if (first === "--manifest") {
      process.stdout.write(this.toManifest() + "\n");
      return;
    }

    if (first === "event-check") {
      await this.runEventCheck(argv.slice(1));
      return;
    }

    if (first === "_run-worker") {
      const exitCode = await runWorker(argv.slice(1));
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
      return;
    }

    const { outputFormat, args } = stripOutputFlag(argv);
    const commandName = args[0];
    if (!commandName) {
      process.stdout.write(this.legacyHelp());
      return;
    }

    try {
      const exitCode = await this.runCLI(commandName, args.slice(1), outputFormat);
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    } catch (error) {
      process.stderr.write(`${toErrorMessage(error)}\n`);
      process.exit(1);
    }
  }

  async executeCommand(commandName: string, input: InvocationInput, responder?: IPCResponder): Promise<unknown> {
    switch (commandName) {
      case "send":
        return await this.runSend(input, responder);
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
      case "config":
        return await this.runConfig(input);
      case "skill":
        return await this.runSkill(input);
      case "upload":
        return await this.runUpload(input);
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
      case "skill":
        return await this.runSkillCLI(args, outputFormat);
      case "upload":
        return await this.runUploadCLI(args, outputFormat);
      default:
        throw new Error(`unknown command: ${commandName}`);
    }
  }

  legacyHelp(): string {
    return [
      `${this.name} (${this.domain})`,
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
      "  bun run index.ts skill [subcommand]",
      "  bun run index.ts upload < stdin.json",
      "  bun run index.ts event-check [--limit 10]",
      "",
      "Global flags:",
      "  --output raw|jsonl",
      "",
    ].join("\n");
  }

  private async runSendCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    const out = createOutput(outputFormat);
    const invocation = { args, stdin: readStdinText() } satisfies InvocationInput;
    return await this.handleSend(invocation, outputFormat, out);
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
      out.info(`[run] ${result.id} cancelled`);
    }
    return 0;
  }

  private async runConfigCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    const out = createOutput(outputFormat);
    const result = await this.runConfig({ args, stdin: readStdinText() });
    if (args.length === 0) {
      out.result(result);
    } else if (outputFormat === "jsonl") {
      out.result(result);
    } else {
      out.info(String(result));
    }
    return 0;
  }

  private async runSkillCLI(args: string[], outputFormat: OutputFormat): Promise<number> {
    const out = createOutput(outputFormat);
    const result = await this.runSkill({ args, stdin: readStdinText() });
    out.result(result);
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

  private async runEventCheck(args: string[]): Promise<void> {
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
      if (activeTopics[event.topic_id]) {
        skipped += 1;
        out.info(`skipped ${event.id}: topic ${event.topic_id} already running`);
        continue;
      }

      await spawnDetachedSelf([
        "send",
        "--topic",
        event.topic_id,
        "--payload",
        event.run_message,
        "--async",
      ]);
      activeTopics[event.topic_id] = true;
      triggered += 1;
      out.info(`triggered ${event.id} for topic ${event.topic_id}`);
    }

    out.result({ due: due.length, triggered, skipped });
  }

  private async runSend(input: InvocationInput, responder?: IPCResponder): Promise<unknown> {
    const outputFormat = resolveOutputFormat(input);

    if (responder && outputFormat === "jsonl") {
      const out = createJSONLChunkOutput((chunk) => responder.chunk(chunk));
      try {
        await this.handleSend(input, outputFormat, out, responder);
      } catch (error) {
        responder.fail(error);
      }
      return {};
    }

    const lines: string[] = [];
    const out = createJSONLChunkOutput((chunk) => lines.push(chunk));
    await this.handleSend(input, outputFormat, out);
    return lines.join("");
  }

  private async handleSend(
    input: InvocationInput,
    outputFormat: OutputFormat,
    out: Output,
    responder?: IPCResponder,
  ): Promise<number> {
    const resolved = resolveSendInput(input);
    if (!resolved.message) {
      throw new Error("message is required (-p or stdin JSON)");
    }

    const db = openDB();

    if (resolved.runId) {
      injectMessage(db, resolved.runId, resolved.message);
      out.info(`[inject] sent to run ${resolved.runId}`);
      if (responder) {
        responder.done();
      }
      return 0;
    }

    const topicId = await ensureTopic(db, resolved.topicId, resolved.message, out);
    setCurrentTopic(topicId);
    ensureTopicDir(topicId);

    if (getActiveRun(db, topicId)) {
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
    }

    if (resolved.isAsync) {
      const run = createRun(db, topicId, process.pid, true);
      try {
        const child = spawnWorker(
          {
            runId: run.id,
            topicId,
            message: resolved.message,
            attachments: resolved.attachments,
            outputFormat: "raw",
            asyncFile: true,
          },
          {
            detached: true,
            outputFormat: "raw",
            asyncFile: true,
            stdio: ["ignore", "ignore", "ignore"],
          },
        );
        updateRunPID(db, run.id, child.pid ?? process.pid);
        child.unref();
      } catch (error) {
        finishRun(db, run.id, "error");
        throw error;
      }

      out.info(`[run] ${run.id} started (async)`);
      out.info(`  -> watch:   get-run ${run.id}`);
      out.info(`  -> inject:  send -p '...' -r ${run.id}`);
      out.info(`  -> cancel:  cancel-run ${run.id}`);
      if (responder) {
        responder.done();
      }
      return 0;
    }

    const run = createRun(db, topicId, process.pid, false);
    const child = spawnWorker(
      {
        runId: run.id,
        topicId,
        message: resolved.message,
        attachments: resolved.attachments,
        outputFormat,
        asyncFile: false,
      },
      {
        detached: false,
        outputFormat,
        asyncFile: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    updateRunPID(db, run.id, child.pid ?? process.pid);

    if (responder) {
      const stderr = await streamWorkerToResponder(child, responder);
      if (!responder.finished) {
        if (stderr) {
          responder.fail(stderr);
        } else {
          responder.done();
        }
      }
      return stderr ? 1 : 0;
    }

    pipeWorkerToCurrentProcess(child);
    const exitCode = await waitForChild(child);
    return exitCode;
  }

  private async runCreateTopic(input: InvocationInput): Promise<unknown> {
    const db = openDB();
    const name = resolveCreateTopicName(input);
    if (!name) {
      throw new Error("name is required (-n or stdin JSON)");
    }
    return createTopic(db, name);
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

    const limit = resolveIntegerOption(input, ["-l", "--limit"], "limit", 100);
    const messages = loadMessagesPage(db, topicId, limit).map((message) => toWebMessage(topicId, message));
    const activeRun = getActiveRun(db, topicId);

    return {
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

    if (run.pid > 0) {
      try {
        process.kill(run.pid, "SIGTERM");
      } catch {
        // Ignore missing process.
      }
    }

    finishRun(db, run.id, "cancelled");
    return { id: run.id, status: "cancelled" };
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
        if (!args[1]) {
          throw new Error("usage: config delete <dot.path>");
        }
        configDelete(args[1]);
        return `deleted ${args[1]}`;
      }
      case "add-clip": {
        const raw = args.slice(1).join(" ") || readStdin(input);
        const clip = parseClipInput(raw);
        if (!clip.name || !clip.url) {
          throw new Error("clip requires name and url");
        }
        configAddClip(clip);
        return `added clip ${clip.name}`;
      }
      case "remove-clip": {
        if (!args[1]) {
          throw new Error("usage: config remove-clip <name>");
        }
        configRemoveClip(args[1]);
        return `removed clip ${args[1]}`;
      }
      default:
        throw new Error(`unknown subcommand: ${args[0]}`);
    }
  }

  private async runSkill(input: InvocationInput): Promise<unknown> {
    ensureSkillsDir();
    const args = readArgs(input);

    if (args.length === 0 || args[0] === "list") {
      return await listSkills();
    }

    switch (args[0]) {
      case "get": {
        if (!args[1]) {
          throw new Error("usage: skill get <name>");
        }
        const skill = loadSkill(args[1]);
        return {
          name: args[1],
          description: skill.description,
          content: skill.body,
        };
      }
      case "save": {
        const raw = readStdin(input);
        const payload = JSON.parse(raw) as SkillPayload;
        if (!payload.name) {
          throw new Error("name is required");
        }
        try {
          loadSkill(payload.name);
          updateSkill(payload.name, payload.description, payload.content);
        } catch {
          createSkill(payload.name, payload.description, payload.content);
        }
        return { status: "ok", name: payload.name };
      }
      case "delete": {
        if (!args[1]) {
          throw new Error("usage: skill delete <name>");
        }
        deleteSkill(args[1]);
        return { status: "ok" };
      }
      default:
        throw new Error(`unknown: skill ${args[0]}`);
    }
  }

  private async runUpload(input: InvocationInput): Promise<unknown> {
    const raw = readStdin(input);
    if (!raw) {
      throw new Error("upload requires stdin JSON payload");
    }
    return uploadFile(JSON.parse(raw) as UploadInput);
  }
}

async function serveAgentIPC(clip: AgentClip): Promise<void> {
  const send = (message: IPCMessage) => {
    process.stdout.write(JSON.stringify(message) + "\n");
  };

  setIPCMode(true);
  setIPCTransport((message) => send(message as IPCMessage));

  send({
    type: "register",
    manifest: {
      name: clip.name,
      domain: clip.domain,
      description: clip.description,
      commands: Array.from(clip.getCommands().keys()).map((name) => ({
        name,
        description: clip.getCommandDescription(name),
      })),
      dependencies: [...clip.dependencies],
    },
  });

  for await (const line of readLines(process.stdin)) {
    let message: IPCMessage;
    try {
      message = JSON.parse(line) as IPCMessage;
    } catch {
      process.stderr.write(`[ipc] invalid JSON: ${line}\n`);
      continue;
    }

    if (message.type === "registered") {
      continue;
    }

    if (
      message.type === "result" ||
      message.type === "error" ||
      message.type === "chunk" ||
      message.type === "done"
    ) {
      if (!handleInvokeResponse(message)) {
        process.stderr.write(`[ipc] unexpected response: ${line}\n`);
      }
      continue;
    }

    if (message.type !== "invoke") {
      process.stderr.write(`[ipc] unsupported message type: ${message.type}\n`);
      continue;
    }

    if (!message.id || !message.command) {
      send({ id: message.id, type: "error", error: "invoke requires id and command" });
      continue;
    }

    const responder = new IPCResponder(message.id, send);
    try {
      const commandDef = clip.getCommands().get(message.command);
      if (!commandDef) {
        throw new Error(`unknown command: ${message.command}`);
      }
      const parsed = commandDef.input.parse((message.input ?? {}) as InvocationInput);
      const result = await clip.executeCommand(message.command, parsed, responder);
      if (!responder.finished) {
        responder.result(result ?? {});
      }
    } catch (error) {
      responder.fail(error);
    }
  }
}

async function runWorker(args: string[]): Promise<number> {
  const payloadBase64 = valueAfterFlag(args, "--payload-base64");
  if (!payloadBase64) {
    process.stderr.write("missing --payload-base64\n");
    return 1;
  }

  let payload: WorkerPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf8")) as WorkerPayload;
  } catch (error) {
    process.stderr.write(`parse worker payload: ${toErrorMessage(error)}\n`);
    return 1;
  }

  const db = openDB();
  const cfg = loadConfig();
  const out = payload.asyncFile ? createAsyncFileOutput(payload.runId) : createOutput(payload.outputFormat);
  const controller = new AbortController();
  registerRunController(payload.runId, controller);
  const signalHandler = () => controller.abort();
  process.on("SIGTERM", signalHandler);
  process.on("SIGINT", signalHandler);

  try {
    ensureSkillsDir();
    ensureTopicDir(payload.topicId);
    setCurrentTopic(payload.topicId);
    updateRunPID(db, payload.runId, process.pid);

    const message = payload.attachments.length > 0
      ? appendAttachments(payload.message, payload.attachments)
      : payload.message;
    const ctx = await buildContext(db, cfg, payload.topicId, message);
    const images = readImageAttachments(payload.attachments);
    if (images.length > 0 && ctx.messages.length > 0) {
      ctx.messages[ctx.messages.length - 1] = {
        ...ctx.messages[ctx.messages.length - 1],
        images,
      };
    }

    const registry = buildRegistry(db, cfg);
    const newMessages = await runLoop(cfg, ctx, registry, out, {
      db,
      runId: payload.runId,
      signal: controller.signal,
    });
    saveMessages(db, payload.topicId, payload.runId, newMessages);
    await processMemory(db, cfg, payload.topicId, payload.runId, newMessages).catch(() => {});
    return 0;
  } catch (error) {
    const cancelled = controller.signal.aborted || isAbortError(error);
    finishRun(db, payload.runId, cancelled ? "cancelled" : "error");
    out.info(`[error] ${toErrorMessage(error)}`);
    return cancelled ? 130 : 1;
  } finally {
    unregisterRunController(payload.runId);
    process.off("SIGTERM", signalHandler);
    process.off("SIGINT", signalHandler);
  }
}

function loadPinixManifest(): PinixFileManifest {
  try {
    return JSON.parse(readFileSync(rootPath("pinix.json"), "utf8")) as PinixFileManifest;
  } catch {
    return {};
  }
}

function stripOutputFlag(argv: string[]): { outputFormat: OutputFormat; args: string[] } {
  const next: string[] = [];
  let outputFormat: OutputFormat = "raw";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      const value = argv[index + 1];
      if (value === "jsonl") {
        outputFormat = "jsonl";
      }
      index += 1;
      continue;
    }
    next.push(arg);
  }

  return { outputFormat, args: next };
}

async function ensureTopic(db: ReturnType<typeof openDB>, topicId: string, message: string, out: Output): Promise<string> {
  if (topicId) {
    return topicId;
  }

  const name = truncateRunes(message, 30) + (Array.from(message).length > 30 ? "..." : "");
  const topic = createTopic(db, name || "new topic");
  out.info(`[topic] ${topic.id} (${topic.name})`);
  return topic.id;
}

function resolveSendInput(input: InvocationInput): ResolvedSendInput {
  const args = readArgs(input);
  const stdinText = readStdin(input);
  let message = "";
  let topicId = readStringField(input, ["topic_id", "topicId"]);
  let runId = readStringField(input, ["run_id", "runId"]);
  let attachments = readStringArrayField(input, ["attachments"]);
  let isAsync = readBooleanField(input, ["async"]) ?? false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "-p":
      case "--payload":
        message = args[index + 1] ?? "";
        index += 1;
        break;
      case "-t":
      case "--topic":
        topicId = args[index + 1] ?? topicId;
        index += 1;
        break;
      case "-r":
      case "--run":
        runId = args[index + 1] ?? runId;
        index += 1;
        break;
      case "--async":
        isAsync = true;
        break;
      default:
        break;
    }
  }

  if (!message) {
    message = readStringField(input, ["message"]);
  }

  if (!message && stdinText) {
    const parsed = safeJSONParse<SendJSONInput>(stdinText);
    if (parsed) {
      message = parsed.message ?? "";
      if (!topicId) {
        topicId = parsed.topic_id ?? "";
      }
      if (!runId) {
        runId = parsed.run_id ?? "";
      }
      if (attachments.length === 0) {
        attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
      }
    }
  }

  return {
    message,
    topicId,
    runId,
    attachments,
    isAsync,
  };
}

function resolveCreateTopicName(input: InvocationInput): string {
  const args = readArgs(input);
  let name = readStringField(input, ["name"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-n" || arg === "--name") {
      name = args[index + 1] ?? name;
      index += 1;
    }
  }

  if (name) {
    return name;
  }

  const stdinText = readStdin(input);
  const parsed = safeJSONParse<{ name?: string }>(stdinText);
  return parsed?.name ?? "";
}

function resolveOutputFormat(input: InvocationInput): OutputFormat {
  const args = readArgs(input);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--output") {
      return args[index + 1] === "jsonl" ? "jsonl" : "raw";
    }
  }

  const value = readStringField(input, ["output"]);
  return value === "jsonl" ? "jsonl" : "raw";
}

function resolveIntegerOption(
  input: InvocationInput,
  flags: string[],
  field: string,
  defaultValue: number,
): number {
  const args = readArgs(input);
  for (let index = 0; index < args.length; index += 1) {
    if (!flags.includes(args[index])) {
      continue;
    }
    const value = Number.parseInt(args[index + 1] ?? "", 10);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  const direct = input[field];
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return Math.trunc(direct);
  }
  if (typeof direct === "string") {
    const parsed = Number.parseInt(direct, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return defaultValue;
}

function resolveIntegerFlag(args: string[], flags: string[], defaultValue: number): number {
  for (let index = 0; index < args.length; index += 1) {
    if (!flags.includes(args[index])) {
      continue;
    }
    const parsed = Number.parseInt(args[index + 1] ?? "", 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

function resolvePositionalOrField(input: InvocationInput, position: number, fields: string[]): string {
  const args = readArgs(input);
  if (args[position]) {
    return args[position];
  }
  return readStringField(input, fields);
}

function readArgs(input: InvocationInput): string[] {
  return Array.isArray(input.args)
    ? input.args.filter((value): value is string => typeof value === "string")
    : [];
}

function readStdin(input: InvocationInput): string {
  return typeof input.stdin === "string" ? input.stdin : "";
}

function readStringField(input: InvocationInput, fields: string[]): string {
  for (const field of fields) {
    const value = input[field];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function readStringArrayField(input: InvocationInput, fields: string[]): string[] {
  for (const field of fields) {
    const value = input[field];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
}

function readBooleanField(input: InvocationInput, fields: string[]): boolean | undefined {
  for (const field of fields) {
    const value = input[field];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function valueAfterFlag(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index < 0) {
    return "";
  }
  return args[index + 1] ?? "";
}

function spawnWorker(payload: WorkerPayload, options: WorkerSpawnOptions): ChildProcess {
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const entrypoint = rootPath("index.ts");
  return spawn(
    process.execPath,
    ["run", entrypoint, "_run-worker", "--payload-base64", payloadBase64],
    {
      cwd: projectRoot,
      detached: options.detached,
      stdio: options.stdio,
      env: process.env,
    },
  );
}

function pipeWorkerToCurrentProcess(child: ChildProcess): void {
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
}

async function streamWorkerToResponder(child: ChildProcess, responder: IPCResponder): Promise<string> {
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer | string) => {
    responder.chunk(chunk.toString());
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const exitCode = await waitForChild(child);
  return exitCode === 0 ? "" : stderr || `send exited with code ${exitCode}`;
}

function waitForChild(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

async function spawnDetachedSelf(args: string[]): Promise<void> {
  const entrypoint = rootPath("index.ts");
  const child = spawn(process.execPath, ["run", entrypoint, ...args], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: process.env,
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => resolve());
  });
  child.unref();
}

async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        yield line;
      }
    }
  }
  if (buffer.trim()) {
    yield buffer;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

const clip = new AgentClip();

if (import.meta.main) {
  await clip.start();
}
