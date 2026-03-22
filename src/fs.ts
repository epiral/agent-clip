import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { dataRoot, ensureDir, topicDir } from "./paths";
import { isImageFile } from "./media";

const topicContext = new AsyncLocalStorage<string>();
let fallbackTopicID = "";

export const pinixDataURLPrefix = "pinix-data://local/data/";

export function setCurrentTopic(topicId: string): void {
  fallbackTopicID = topicId.trim();
}

export function withCurrentTopic<T>(topicId: string, fn: () => T): T {
  return topicContext.run(topicId.trim(), fn);
}

export function getCurrentTopic(): string {
  return topicContext.getStore() ?? fallbackTopicID;
}

export function ensureTopicDir(topicId: string): void {
  ensureDir(topicDir(topicId));
}

export function resolvePath(inputPath: string): string {
  if (inputPath.startsWith("/")) {
    const abs = resolve(dataRoot("topics"), inputPath.slice(1));
    const topicsRoot = resolve(dataRoot("topics"));
    if (abs !== topicsRoot && !abs.startsWith(topicsRoot + "/")) {
      throw new Error(`path escapes topics directory: ${inputPath}`);
    }
    return abs;
  }

  const currentTopicID = getCurrentTopic();
  if (!currentTopicID) {
    throw new Error(`no topic context set (relative path ${JSON.stringify(inputPath)} requires a topic)`);
  }

  const root = resolve(topicDir(currentTopicID));
  const abs = resolve(root, inputPath);
  if (abs !== root && !abs.startsWith(root + "/")) {
    throw new Error(`path escapes topic directory: ${inputPath}`);
  }
  return abs;
}

export function resolvePathToRelative(path: string): string {
  if (path.startsWith("/")) {
    return join("topics", path.slice(1));
  }
  const currentTopicID = getCurrentTopic();
  if (currentTopicID) {
    return join("topics", currentTopicID, path);
  }
  return path;
}

export function humanSize(size: number): string {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)}KB`;
  }
  return `${size}B`;
}

export function registerFSCommands(register: (name: string, description: string, handler: (args: string[], stdin: string) => Promise<string> | string) => void): void {
  register("ls", "List files in current topic. Usage: ls [dir]", async (args) => fsLs(args));
  register("cat", "Read file. Usage: cat <path>  Options: -b (base64 for binary)", async (args) => fsCat(args));
  register("see", "View an image (auto-attaches to vision). Usage: see <path>", async (args) => fsSee(args));
  register("write", "Write file. Usage: write <path> [content] or stdin. Options: -b", async (args, stdin) => fsWrite(args, stdin));
  register("stat", "File info. Usage: stat <path>", async (args) => fsStat(args));
  register("rm", "Remove file. Usage: rm <path>", async (args) => fsRm(args));
  register("cp", "Copy file. Usage: cp <src> <dst>", async (args) => fsCp(args));
  register("mv", "Move or rename file. Usage: mv <src> <dst>", async (args) => fsMv(args));
  register("mkdir", "Create directory. Usage: mkdir <dir>", async (args) => fsMkdir(args));
}

function fsLs(args: string[]): string {
  const input = args[0] ?? "";
  const path = resolvePath(input);
  const entries = readdirSync(path, { withFileTypes: true });
  if (entries.length === 0) {
    return "(empty directory)";
  }
  return entries
    .map((entry) => {
      if (entry.isDirectory()) {
        return `d  ${"-".padEnd(8)} ${entry.name}/`;
      }
      const info = statSync(join(path, entry.name));
      return `f  ${humanSize(info.size).padEnd(8)} ${entry.name}`;
    })
    .join("\n");
}

function fsCat(args: string[]): string {
  let base64Mode = false;
  let path = "";
  for (const arg of args) {
    if (arg === "-b" || arg === "--base64") {
      base64Mode = true;
    } else if (!path) {
      path = arg;
    }
  }
  if (!path) {
    throw new Error("usage: cat <path>");
  }

  const bytes = readFileSync(resolvePath(path));
  if (!base64Mode) {
    return bytes.toString("utf8");
  }

  let result = bytes.toString("base64");
  if (isImageFile(path)) {
    result += `\nRender: ![image](${pinixDataURLPrefix}${resolvePathToRelative(path)})`;
  }
  return result;
}

function fsSee(args: string[]): string {
  const path = args[0];
  if (!path) {
    throw new Error("usage: see <image-path>");
  }
  if (!isImageFile(path)) {
    throw new Error(`not an image file: ${path} (use cat to read text files)`);
  }
  const info = statSync(resolvePath(path));
  return `Image: ${path} (${humanSize(info.size)})\nRender: ![image](${pinixDataURLPrefix}${resolvePathToRelative(path)})`;
}

function fsWrite(args: string[], stdin: string): string {
  let base64Mode = false;
  let path = "";
  const contentParts: string[] = [];
  for (const arg of args) {
    if (arg === "-b" || arg === "--base64") {
      base64Mode = true;
    } else if (!path) {
      path = arg;
    } else {
      contentParts.push(arg);
    }
  }
  if (!path) {
    throw new Error("usage: write <path> [content] or pipe stdin");
  }

  const abs = resolvePath(path);
  mkdirSync(dirname(abs), { recursive: true });

  const data = base64Mode
    ? Buffer.from((stdin || contentParts.join(" ")).trim(), "base64")
    : Buffer.from(contentParts.length > 0 ? contentParts.join(" ") : stdin, "utf8");

  writeFileSync(abs, data);

  let result = `Written ${humanSize(data.byteLength)} -> ${path}`;
  if (isImageFile(path)) {
    result += `\nRender: ![image](${pinixDataURLPrefix}${resolvePathToRelative(path)})`;
  }
  return result;
}

function fsStat(args: string[]): string {
  const path = args[0];
  if (!path) {
    throw new Error("usage: stat <path>");
  }
  const info = statSync(resolvePath(path));
  const mime = mimeFromPath(path);
  const lines = [
    `File: ${path}`,
    `Size: ${humanSize(info.size)} (${info.size} bytes)`,
    `Type: ${mime}`,
    `Modified: ${info.mtime.toISOString()}`,
  ];
  if (info.isDirectory()) {
    lines.push("Kind: directory");
  }
  return lines.join("\n");
}

function fsRm(args: string[]): string {
  const path = args[0];
  if (!path) {
    throw new Error("usage: rm <path>");
  }
  rmSync(resolvePath(path), { recursive: true, force: true });
  return `Removed ${path}`;
}

function fsCp(args: string[]): string {
  if (args.length < 2) {
    throw new Error("usage: cp <src> <dst>");
  }
  const source = readFileSync(resolvePath(args[0]));
  const destination = resolvePath(args[1]);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, source);
  return `Copied ${args[0]} -> ${args[1]} (${humanSize(source.byteLength)})`;
}

function fsMv(args: string[]): string {
  if (args.length < 2) {
    throw new Error("usage: mv <src> <dst>");
  }
  const destination = resolvePath(args[1]);
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(resolvePath(args[0]), destination);
  return `Moved ${args[0]} -> ${args[1]}`;
}

function fsMkdir(args: string[]): string {
  const path = args[0];
  if (!path) {
    throw new Error("usage: mkdir <dir>");
  }
  mkdirSync(resolvePath(path), { recursive: true });
  return `Created ${path}`;
}

function mimeFromPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
