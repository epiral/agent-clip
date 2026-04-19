import { z } from "@pinixai/core";
import { parsePositiveInt, readStdinText, safeJSONParse } from "./shared";

export const InvocationSchema = z.object({
  args: z.array(z.string()).optional(),
  stdin: z.string().optional(),
}).passthrough();

export type OutputFormat = "raw" | "jsonl";

export interface InvocationInput {
  args?: string[];
  stdin?: string;
  [key: string]: unknown;
}

export interface SendJSONInput {
  message?: string;
  topic_id?: string;
  run_id?: string;
  agent_id?: string;
  attachments?: string[];
}

export interface ResolvedSendInput {
  message: string;
  topicId: string;
  runId: string;
  agentId: string;
  attachments: string[];
  isAsync: boolean;
}

export { parsePositiveInt, readStdinText };

export function stripOutputFlag(argv: string[]): { outputFormat: OutputFormat; args: string[] } {
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

export function resolveSendInput(input: InvocationInput): ResolvedSendInput {
  const args = readArgs(input);
  const stdinText = readStdin(input);
  let message = "";
  let topicId = readStringField(input, ["topic_id", "topicId"]);
  let runId = readStringField(input, ["run_id", "runId"]);
  let agentId = readStringField(input, ["agent_id", "agentId"]);
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
      case "-a":
      case "--agent":
        agentId = args[index + 1] ?? agentId;
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
      if (!agentId) {
        agentId = parsed.agent_id ?? "";
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
    agentId,
    attachments,
    isAsync,
  };
}

export function resolveCreateTopicName(input: InvocationInput): string {
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

export function resolveIntegerOption(
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

  const direct = readIntegerField(input, field);
  return direct ?? defaultValue;
}

export function resolveIntegerFlag(args: string[], flags: string[], defaultValue: number): number {
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

export function resolvePositionalOrField(input: InvocationInput, position: number, fields: string[]): string {
  const args = readArgs(input);
  if (args[position]) {
    return args[position];
  }
  return readStringField(input, fields);
}

export function readArgs(input: InvocationInput): string[] {
  return Array.isArray(input.args)
    ? input.args.filter((value): value is string => typeof value === "string")
    : [];
}

export function readStdin(input: InvocationInput): string {
  return typeof input.stdin === "string" ? input.stdin : "";
}

export function readStringField(input: InvocationInput, fields: string[]): string {
  for (const field of fields) {
    const value = input[field];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

export function readStringArrayField(input: InvocationInput, fields: string[]): string[] {
  for (const field of fields) {
    const value = input[field];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
}

export function readBooleanField(input: InvocationInput, fields: string[]): boolean | undefined {
  for (const field of fields) {
    const value = input[field];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function readIntegerField(input: InvocationInput, field: string): number | undefined {
  const value = input[field];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}
