import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseDocument, YAMLMap } from "yaml";
import { configPath, ensureDataLayout, seedRoot } from "./paths";
import { maskSecret } from "./shared";

export interface ProviderConfig {
  protocol?: string;
  base_url: string;
  api_key: string;
}

export interface ClipManifest {
  name?: string;
  description?: string;
  commands?: string[];
  hasWeb?: boolean;
}

export interface ClipConfig {
  name: string;
  url: string;
  token: string;
  commands: string[];
  manifest?: ClipManifest;
}

export interface BrowserConfig {
  endpoint: string;
}

export interface Config {
  name: string;
  providers: Record<string, ProviderConfig>;
  llm_provider: string;
  llm_model: string;
  embedding_provider: string;
  embedding_model: string;
  system_prompt: string;
  clips: ClipConfig[];
  browser?: BrowserConfig;
}

export interface ProviderJSON {
  protocol?: string;
  base_url: string;
  api_key: string;
}

export interface ClipJSON {
  name: string;
  url: string;
  token: string;
  commands: string[];
}

export interface ConfigJSON {
  name: string;
  providers: Record<string, ProviderJSON>;
  llm_provider: string;
  llm_model: string;
  embedding_provider: string;
  embedding_model: string;
  system_prompt: string;
  clips: ClipJSON[];
  browser?: BrowserConfig;
}

export interface ClipInput {
  name: string;
  url: string;
  token: string;
  commands?: string[];
}

export function ensureConfigExists(): void {
  ensureDataLayout();
  if (existsSync(configPath())) {
    return;
  }

  const seedConfig = seedRoot("config.yaml");
  if (!existsSync(seedConfig)) {
    throw new Error(`missing config file at ${configPath()}`);
  }

  copyFileSync(seedConfig, configPath());
}

export function loadConfig(): Config {
  ensureConfigExists();
  const raw = readFileSync(configPath(), "utf8");
  const parsed = parseDocument(raw).toJS() as Record<string, unknown> | null;
  const cfg: Config = {
    name: asString(parsed?.name),
    providers: normalizeProviders(parsed?.providers),
    llm_provider: asString(parsed?.llm_provider),
    llm_model: asString(parsed?.llm_model),
    embedding_provider: asString(parsed?.embedding_provider),
    embedding_model: asString(parsed?.embedding_model),
    system_prompt: asString(parsed?.system_prompt),
    clips: normalizeClips(parsed?.clips),
    browser: normalizeBrowser(parsed?.browser),
  };

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey && cfg.providers.openrouter) {
    cfg.providers.openrouter = {
      ...cfg.providers.openrouter,
      api_key: openrouterKey,
    };
  }

  return cfg;
}

export function getProvider(cfg: Config, name: string): ProviderConfig {
  const provider = cfg.providers[name];
  if (!provider) {
    throw new Error(`provider ${JSON.stringify(name)} not found in config`);
  }
  return provider;
}

export function getLLMProvider(cfg: Config): ProviderConfig {
  return getProvider(cfg, cfg.llm_provider);
}

export function getEmbeddingProvider(cfg: Config): ProviderConfig | null {
  if (!cfg.embedding_provider) {
    return null;
  }
  return getProvider(cfg, cfg.embedding_provider);
}

export function getClipConfig(cfg: Config, name: string): ClipConfig | null {
  return cfg.clips.find((clip) => clip.name === name) ?? null;
}

export function configToJSON(cfg: Config): ConfigJSON {
  return {
    name: cfg.name,
    providers: Object.fromEntries(
      Object.entries(cfg.providers).map(([name, provider]) => [name, {
        protocol: provider.protocol,
        base_url: provider.base_url,
        api_key: maskSecret(provider.api_key),
      }]),
    ),
    llm_provider: cfg.llm_provider,
    llm_model: cfg.llm_model,
    embedding_provider: cfg.embedding_provider,
    embedding_model: cfg.embedding_model,
    system_prompt: cfg.system_prompt,
    clips: cfg.clips.map((clip) => ({
      name: clip.name,
      url: clip.url,
      token: maskSecret(clip.token),
      commands: [...clip.commands],
    })),
    browser: cfg.browser,
  };
}

export function configToText(cfg: Config): string {
  const lines = [
    `name: ${cfg.name}`,
    `llm_provider: ${cfg.llm_provider}`,
    `llm_model: ${cfg.llm_model}`,
    `embedding_provider: ${cfg.embedding_provider}`,
    `embedding_model: ${cfg.embedding_model}`,
    `providers: ${Object.keys(cfg.providers).join(", ")}`,
  ];

  if (cfg.browser?.endpoint) {
    lines.push(`browser: ${cfg.browser.endpoint}`);
  }

  for (const clip of cfg.clips) {
    lines.push(`clip: ${clip.name} (${clip.commands.join(", ")})`);
  }

  return lines.join("\n");
}

export function configSet(dotPath: string, value: string): void {
  ensureConfigExists();
  const doc = parseDocument(readFileSync(configPath(), "utf8"));
  setPath(doc, dotPath, value);
  saveDocument(doc);
}

export function configDelete(dotPath: string): void {
  ensureConfigExists();
  const doc = parseDocument(readFileSync(configPath(), "utf8"));
  deletePath(doc, dotPath);
  saveDocument(doc);
}

export function parseClipInput(jsonString: string): ClipConfig {
  const input = JSON.parse(jsonString) as ClipInput;
  return {
    name: input.name ?? "",
    url: input.url ?? "",
    token: input.token ?? "",
    commands: Array.isArray(input.commands)
      ? input.commands.filter((command): command is string => typeof command === "string")
      : [],
  };
}

export function configAddClip(clip: ClipConfig): void {
  const cfg = loadConfig();
  if (cfg.clips.some((item) => item.name === clip.name)) {
    throw new Error(`clip ${JSON.stringify(clip.name)} already exists`);
  }
  cfg.clips.push({
    name: clip.name,
    url: clip.url,
    token: clip.token,
    commands: [...clip.commands],
  });
  saveConfig(cfg);
}

export function configRemoveClip(name: string): void {
  const cfg = loadConfig();
  const next = cfg.clips.filter((clip) => clip.name !== name);
  if (next.length === cfg.clips.length) {
    throw new Error(`clip ${JSON.stringify(name)} not found`);
  }
  cfg.clips = next;
  saveConfig(cfg);
}

function normalizeProviders(value: unknown): Record<string, ProviderConfig> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const providers: Record<string, ProviderConfig> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const provider = raw as Record<string, unknown>;
    providers[name] = {
      protocol: asOptionalString(provider.protocol),
      base_url: asString(provider.base_url),
      api_key: asString(provider.api_key),
    };
  }
  return providers;
}

function normalizeClips(value: unknown): ClipConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((clip) => ({
      name: asString(clip.name),
      url: asString(clip.url),
      token: asString(clip.token),
      commands: Array.isArray(clip.commands)
        ? clip.commands.filter((command): command is string => typeof command === "string")
        : [],
    }));
}

function normalizeBrowser(value: unknown): BrowserConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const browser = value as Record<string, unknown>;
  const endpoint = asString(browser.endpoint);
  if (!endpoint) {
    return undefined;
  }
  return { endpoint };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function saveDocument(doc: ReturnType<typeof parseDocument>): void {
  writeFileSync(configPath(), doc.toString(), "utf8");
}

function ensureRootMap(doc: ReturnType<typeof parseDocument>): YAMLMap<unknown, unknown> {
  if (!(doc.contents instanceof YAMLMap)) {
    throw new Error("invalid config format");
  }
  return doc.contents;
}

function getMapValue(map: YAMLMap<unknown, unknown>, key: string): unknown {
  return map.get(key, true);
}

function setPath(doc: ReturnType<typeof parseDocument>, dotPath: string, value: string): void {
  const root = ensureRootMap(doc);
  const parts = dotPath.split(".").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("config path is required");
  }

  let current: YAMLMap<unknown, unknown> = root;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (index === parts.length - 1) {
      current.set(part, value);
      return;
    }

    const next = getMapValue(current, part);
    if (next instanceof YAMLMap) {
      current = next;
      continue;
    }

    const created = new YAMLMap();
    current.set(part, created);
    current = created;
  }
}

function deletePath(doc: ReturnType<typeof parseDocument>, dotPath: string): void {
  const root = ensureRootMap(doc);
  const parts = dotPath.split(".").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("config path is required");
  }

  let current: YAMLMap<unknown, unknown> = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]!;
    const next = getMapValue(current, part);
    if (!(next instanceof YAMLMap)) {
      throw new Error(`key ${JSON.stringify(part)} not found`);
    }
    current = next;
  }

  const key = parts.at(-1) ?? "";
  if (!current.delete(key)) {
    throw new Error(`key ${JSON.stringify(key)} not found`);
  }
}

function saveConfig(cfg: Config): void {
  const doc = parseDocument("");
  const serialized: Record<string, unknown> = {
    name: cfg.name,
    providers: cfg.providers,
    llm_provider: cfg.llm_provider,
    llm_model: cfg.llm_model,
    embedding_provider: cfg.embedding_provider,
    embedding_model: cfg.embedding_model,
    system_prompt: cfg.system_prompt,
    clips: cfg.clips.map((clip) => ({
      name: clip.name,
      url: clip.url,
      token: clip.token,
      commands: clip.commands,
    })),
  };

  if (cfg.browser) {
    serialized.browser = cfg.browser;
  }

  doc.contents = doc.createNode(serialized) as typeof doc.contents;
  saveDocument(doc);
}
