import { readFileSync } from "node:fs";
import { Clip, command, handler, serveIPC, serveHTTP, z } from "@pinixai/core";
import { InvocationSchema, stripOutputFlag } from "./src/args";
import { AgentClipCommands, formatLegacyHelp } from "./src/commands";
import { ensureConfigExists } from "./src/config";
import {
  handleTopicCreate, handleTopicList, handleTopicGet, handleTopicDelete, handleTopicUpdate, handleTopicFork,
  handleRunGet, handleRunList, handleRunCancel,
  handleAgentCreate, handleAgentList, handleAgentGet, handleAgentUpdate, handleAgentDelete,
  handleEventCreate, handleEventList, handleEventUpdate, handleEventCancel,
  handleConfigGet, handleConfigSet, handleConfigDelete,
  handleClipList,
  handleAttachmentUpload,
} from "./src/handlers";
import { rootPath } from "./src/paths";
import { toErrorMessage } from "./src/shared";

interface PinixFileManifest {
  name?: string;
  domain?: string;
  description?: string;
  commands?: Array<{ name?: string; description?: string }>;
  dependencies?: Record<string, { package: string; version: string }>;
}

const AnyOutputSchema = z.any();

type CommandDecorator = (describe?: string) => <This extends object, Value>(
  value: undefined,
  context: ClassFieldDecoratorContext<This, Value>,
) => void;

const clipCommand = command as unknown as CommandDecorator;

const pinixManifest = loadPinixManifest();
const dependencySlots = pinixManifest.dependencies ?? {};

class AgentClip extends Clip {
  private readonly runtime = new AgentClipCommands();

  name = pinixManifest.name ?? "agent";
  domain = pinixManifest.domain ?? "ai";
  patterns = ["send -> tool use -> memory"];
  description = pinixManifest.description ?? "AI Agent — agentic loop with memory, tools, and vision";
  dependencies = dependencySlots;

  @clipCommand("发送消息并执行 agentic loop")
  send = handler(InvocationSchema, AnyOutputSchema, async (input, stream) => await this.runtime.runSend(input, stream));

  @clipCommand("创建新话题")
  ["create-topic"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.runtime.executeCommand("create-topic", input));

  @clipCommand("列出所有话题")
  ["list-topics"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.runtime.executeCommand("list-topics", input));

  @clipCommand("读取话题消息和活动 Run")
  ["get-topic"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.runtime.executeCommand("get-topic", input));

  @clipCommand("获取运行状态")
  ["get-run"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.runtime.executeCommand("get-run", input));

  @clipCommand("取消运行")
  ["cancel-run"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.runtime.executeCommand("cancel-run", input));

  @clipCommand("删除话题")
  ["delete-topic"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.runtime.executeCommand("delete-topic", input));

  @clipCommand("配置管理")
  config = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.runtime.executeCommand("config", input));

  @clipCommand("上传附件")
  upload = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.runtime.executeCommand("upload", input));

  @clipCommand("从指定 Run 分叉出新话题")
  ["topic-fork"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.runtime.executeCommand("topic-fork", input));

  @clipCommand("管理 Agent")
  agent = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.runtime.executeCommand("agent", input));

  @clipCommand("列出可用 Clips")
  ["list-clips"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await this.runtime.executeCommand("list-clips", input));

  // ── New resource-oriented commands (#21) ──────────────────

  @clipCommand("topic create — 创建话题")
  ["topic create"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleTopicCreate(input));

  @clipCommand("topic list — 列出话题 (支持 --agent_id, --status, --query 筛选)")
  ["topic list"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleTopicList(input));

  @clipCommand("topic get — 读取话题消息 (支持 --run_id 筛选)")
  ["topic get"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleTopicGet(input));

  @clipCommand("topic delete — 删除话题")
  ["topic delete"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleTopicDelete(input));

  @clipCommand("topic update — 更新话题")
  ["topic update"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleTopicUpdate(input));

  @clipCommand("topic fork — 从 Run 分叉话题")
  ["topic fork"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleTopicFork(input));

  @clipCommand("run get — 获取 Run 详情")
  ["run get"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleRunGet(input));

  @clipCommand("run list — 列出 Runs (支持 --topic_id, --status 筛选)")
  ["run list"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleRunList(input));

  @clipCommand("run cancel — 取消 Run")
  ["run cancel"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleRunCancel(input));

  @clipCommand("agent create — 创建 Agent")
  ["agent create"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleAgentCreate(input));

  @clipCommand("agent list — 列出 Agents")
  ["agent list"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleAgentList(input));

  @clipCommand("agent get — 获取 Agent")
  ["agent get"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleAgentGet(input));

  @clipCommand("agent update — 更新 Agent")
  ["agent update"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleAgentUpdate(input));

  @clipCommand("agent delete — 删除 Agent")
  ["agent delete"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleAgentDelete(input));

  @clipCommand("event create — 创建定时事件")
  ["event create"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleEventCreate(input));

  @clipCommand("event list — 列出定时事件")
  ["event list"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleEventList(input));

  @clipCommand("event update — 更新定时事件")
  ["event update"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleEventUpdate(input));

  @clipCommand("event cancel — 取消定时事件")
  ["event cancel"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleEventCancel(input));

  @clipCommand("config get — 查看配置")
  ["config get"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleConfigGet(input));

  @clipCommand("config set — 设置配置项")
  ["config set"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleConfigSet(input));

  @clipCommand("config delete — 删除配置项")
  ["config delete"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleConfigDelete(input));

  @clipCommand("clip list — 列出可用 Clips")
  ["clip list"] = handler(InvocationSchema, AnyOutputSchema, async (input) => await handleClipList(input));

  @clipCommand("message send — 发送消息")
  ["message send"] = handler(InvocationSchema, AnyOutputSchema, async (input, stream) => await this.runtime.runSend(input, stream));

  @clipCommand("attachment upload — 上传附件")
  ["attachment upload"] = handler(InvocationSchema, AnyOutputSchema, async (input) => handleAttachmentUpload(input));

  // ── End new commands ──────────────────────────────────────

  async start(): Promise<void> {
    ensureConfigExists();

    const argv = process.argv.slice(2);
    const first = argv[0];

    if (!first || first === "--ipc") {
      await serveIPC(this);
      return;
    }

    if (first === "--web") {
      const port = argv[1] ? parseInt(argv[1]) : 3000;
      await serveHTTP(this, port);
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
      await this.runtime.runEventCheck(argv.slice(1));
      return;
    }

    const { outputFormat, args } = stripOutputFlag(argv);
    const commandName = args[0];
    if (!commandName) {
      process.stdout.write(this.legacyHelp());
      return;
    }

    try {
      // Try resource-oriented commands first (e.g. "topic list", "run get")
      const subCommand = args[1] ?? "";
      const resourceCmd = `${commandName} ${subCommand}`.trim();
      const resourceResult = await this.tryResourceCommand(resourceCmd, args.slice(2));
      if (resourceResult !== undefined) {
        process.stdout.write(JSON.stringify(resourceResult) + "\n");
        return;
      }

      const exitCode = await this.runtime.runCLI(commandName, args.slice(1), outputFormat);
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    } catch (error) {
      process.stderr.write(`${toErrorMessage(error)}\n`);
      process.exit(1);
    }
  }

  /** Try to match a resource-oriented command. Returns undefined if not matched. */
  private async tryResourceCommand(cmd: string, remainingArgs: string[]): Promise<unknown> {
    const input = { args: remainingArgs };
    switch (cmd) {
      case "topic create":   return handleTopicCreate(input);
      case "topic list":     return handleTopicList(input);
      case "topic get":      return handleTopicGet(input);
      case "topic delete":   return handleTopicDelete(input);
      case "topic update":   return handleTopicUpdate(input);
      case "topic fork":     return handleTopicFork(input);
      case "run get":        return handleRunGet(input);
      case "run list":       return handleRunList(input);
      case "run cancel":     return handleRunCancel(input);
      case "agent create":   return handleAgentCreate(input);
      case "agent list":     return handleAgentList(input);
      case "agent get":      return handleAgentGet(input);
      case "agent update":   return handleAgentUpdate(input);
      case "agent delete":   return handleAgentDelete(input);
      case "event create":   return handleEventCreate(input);
      case "event list":     return handleEventList(input);
      case "event update":   return handleEventUpdate(input);
      case "event cancel":   return handleEventCancel(input);
      case "config get":     return handleConfigGet(input);
      case "config set":     return handleConfigSet(input);
      case "config delete":  return handleConfigDelete(input);
      case "clip list":      return await handleClipList(input);
      case "message send":   return undefined; // handled by legacy send (streaming)
      case "attachment upload": return handleAttachmentUpload(input);
      default:               return undefined;
    }
  }

  legacyHelp(): string {
    return formatLegacyHelp(this.name, this.domain);
  }
}

function loadPinixManifest(): PinixFileManifest {
  try {
    return JSON.parse(readFileSync(rootPath("pinix.json"), "utf8")) as PinixFileManifest;
  } catch {
    return {};
  }
}

const clip = new AgentClip();

if (import.meta.main) {
  await clip.start();
}
