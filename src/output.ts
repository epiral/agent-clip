import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import type { Writable } from "node:stream";
import { dirname } from "node:path";
import type { TokenUsage } from "./llm";
import { runOutputPath } from "./paths";
import { truncateRunes } from "./shared";

export interface Output {
  info(message: string): void;
  result(value: unknown): void;
  thinking(token: string): void;
  text(token: string): void;
  toolCall(name: string, args: string): void;
  toolResult(content: string): void;
  usage(data: TokenUsage): void;
  inject(content: string): void;
  done(): void;
  close(): void;
}

interface Writer {
  write(chunk: string): void;
  close(): void;
}

class StreamWriter implements Writer {
  constructor(private readonly stream: Writable | NodeJS.WriteStream) {}

  write(chunk: string): void {
    this.stream.write(chunk);
  }

  close(): void {}
}

class SyncFileWriter implements Writer {
  private readonly fd: number;
  private closed = false;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.fd = openSync(path, "a");
  }

  write(chunk: string): void {
    writeSync(this.fd, chunk);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    closeSync(this.fd);
    this.closed = true;
  }
}

class CLIOutput implements Output {
  constructor(private readonly stdout: Writer, private readonly stderr: Writer) {}

  info(message: string): void {
    this.stderr.write(`${message}\n`);
  }

  result(value: unknown): void {
    this.stdout.write(`${JSON.stringify(value)}\n`);
  }

  thinking(token: string): void {
    this.stderr.write(token);
  }

  text(token: string): void {
    this.stdout.write(token);
  }

  toolCall(name: string, args: string): void {
    this.stderr.write(`[tool] ${name}(${truncateRunes(args, 80)})\n`);
  }

  toolResult(content: string): void {
    this.stderr.write(`  → ${content}\n`);
  }

  usage(data: TokenUsage): void {
    this.stderr.write(`[usage] ${JSON.stringify(data)}\n`);
  }

  inject(content: string): void {
    this.stderr.write(`[injected] ${content}\n`);
  }

  done(): void {
    this.stdout.write("\n");
  }

  close(): void {
    this.stdout.close();
    this.stderr.close();
  }
}

class JSONLOutput implements Output {
  constructor(private readonly writer: Writer) {}

  private emit(value: unknown): void {
    this.writer.write(`${JSON.stringify(value)}\n`);
  }

  info(message: string): void {
    this.emit({ type: "info", message });
  }

  result(value: unknown): void {
    this.emit({ type: "result", data: value });
  }

  thinking(token: string): void {
    this.emit({ type: "thinking", content: token });
  }

  text(token: string): void {
    this.emit({ type: "text", content: token });
  }

  toolCall(name: string, args: string): void {
    this.emit({ type: "tool_call", name, arguments: args });
  }

  toolResult(content: string): void {
    this.emit({ type: "tool_result", content });
  }

  usage(data: TokenUsage): void {
    this.emit({ type: "usage", ...data });
  }

  inject(content: string): void {
    this.emit({ type: "inject", content });
  }

  done(): void {
    this.emit({ type: "done" });
  }

  close(): void {
    this.writer.close();
  }
}

export function createCLIOutput(): Output {
  return new CLIOutput(new StreamWriter(process.stdout), new StreamWriter(process.stderr));
}

export function createJSONLOutput(): Output {
  return new JSONLOutput(new StreamWriter(process.stdout));
}

export function createJSONLChunkOutput(onChunk: (chunk: string) => void): Output {
  return new JSONLOutput({ write: onChunk, close() {} });
}

export function createAsyncFileOutput(runId: string): Output {
  return new CLIOutput(new SyncFileWriter(runOutputPath(runId)), new SyncFileWriter(runOutputPath(runId)));
}

export function createOutput(format = "raw"): Output {
  return format === "jsonl" ? createJSONLOutput() : createCLIOutput();
}

export function readOutput(runId: string): string {
  const path = runOutputPath(runId);
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8");
}
