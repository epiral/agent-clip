import { readFileSync } from "node:fs";

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function randomID(length = 8): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, length);
}

export function truncateRunes(value: string, limit: number): string {
  const chars = Array.from(value);
  if (chars.length <= limit) {
    return value;
  }
  return chars.slice(0, limit).join("") + "...";
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readStdinText(): string {
  if (process.stdin.isTTY) {
    return "";
  }
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function safeJSONParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function isJSONContent(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed === "null" || trimmed === "true" || trimmed === "false";
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

export function maskSecret(value: string): string {
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return "****";
  }
  return `****${value.slice(-4)}`;
}

export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid integer ${JSON.stringify(value)}`);
  }
  return parsed;
}

export function parseOptionalLineCountArgs(args: string[], defaultValue: number): number {
  let count = defaultValue;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-n") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("missing value for -n");
      }
      count = parsePositiveInt(next);
      index += 1;
      continue;
    }

    const cleaned = arg.replace(/^-+/, "");
    const parsed = Number.parseInt(cleaned, 10);
    if (Number.isFinite(parsed)) {
      if (parsed <= 0) {
        throw new Error(`line count must be positive: ${JSON.stringify(arg)}`);
      }
      count = parsed;
    }
  }
  return count;
}
