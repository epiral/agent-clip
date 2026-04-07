import { readFileSync } from "node:fs";
import { Clip, command, handler, serveIPC, serveHTTP, z } from "@pinixai/core";
import { InvocationSchema, stripOutputFlag } from "./src/args";
import { AgentClipCommands, formatLegacyHelp } from "./src/commands";
import { ensureConfigExists } from "./src/config";
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
      const exitCode = await this.runtime.runCLI(commandName, args.slice(1), outputFormat);
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    } catch (error) {
      process.stderr.write(`${toErrorMessage(error)}\n`);
      process.exit(1);
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
