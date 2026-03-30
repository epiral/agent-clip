import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(srcDir, "..");

export function rootPath(...parts: string[]): string {
  return join(projectRoot, ...parts);
}

export function dataRoot(...parts: string[]): string {
  const base = process.env.PINIX_DATA_DIR ?? rootPath("data");
  return join(base, ...parts);
}

export function seedRoot(...parts: string[]): string {
  return rootPath("seed", ...parts);
}

export function webRoot(...parts: string[]): string {
  return rootPath("web", ...parts);
}

export function topicDir(topicId: string): string {
  return dataRoot("topics", topicId);
}

export function runDir(runId: string): string {
  return dataRoot("runs", runId);
}

export function configPath(): string {
  return dataRoot("config.yaml");
}

export function dbPath(): string {
  return dataRoot("agent.db");
}

export function runOutputPath(runId: string): string {
  return runDir(runId) + "/output";
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function ensureTopicDir(topicId: string): void {
  ensureDir(topicDir(topicId));
}

export function ensureDataLayout(): void {
  ensureDir(dataRoot());
  ensureDir(dataRoot("topics"));
  ensureDir(dataRoot("runs"));
}

export function schemaPath(): string {
  const seedSchema = seedRoot("schema.sql");
  if (existsSync(seedSchema)) {
    return seedSchema;
  }
  return dataRoot("schema.sql");
}

export { projectRoot };
