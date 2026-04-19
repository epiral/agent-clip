import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseDocument, YAMLMap, YAMLSeq } from "yaml";
import type { Agent } from "./db";
import { configPath, ensureDataLayout, seedRoot } from "./paths";
import { maskSecret } from "./shared";

export interface ProviderConfig {
  protocol?: string;
  base_url: string;
  api_key: string;
  provider?: Record<string, unknown>; // OpenRouter provider routing (ignore, order, etc.)
}

export interface HubConfig {
  url: string;
  name: string;
  token?: string;
}

export interface Config {
  name: string;
  hubs: HubConfig[]; // keep for Registry URL
  pinned: string[];   // manually pinned clip aliases
  providers: Record<string, ProviderConfig>;
  llm_provider: string;
  llm_model: string;
  max_tokens?: number;
  system_prompt: string;
}

export interface ResolvedConfig extends Config {
  scope: string[] | null;
}

export function resolveAgentConfig(globalCfg: Config, agent?: Agent | null): ResolvedConfig {
  if (!agent) {
    return { ...globalCfg, scope: null };
  }

  const hasScope = agent.scope !== null;
  return {
    ...globalCfg,
    name: agent.name,
    llm_provider: agent.llm_provider ?? globalCfg.llm_provider,
    llm_model: agent.llm_model ?? globalCfg.llm_model,
    max_tokens: agent.max_tokens ?? globalCfg.max_tokens,
    system_prompt: agent.system_prompt ?? globalCfg.system_prompt,
    pinned: hasScope ? (agent.pinned ?? []) : (agent.pinned ?? globalCfg.pinned),
    scope: agent.scope,
  };
}

export interface ProviderJSON {
  protocol?: string;
  base_url: string;
  api_key: string;
}

export interface ConfigJSON {
  name: string;
  hubs: HubConfig[];
  pinned: string[];
  providers: Record<string, ProviderJSON>;
  llm_provider: string;
  llm_model: string;
  system_prompt: string;
}

const DEFAULT_CONFIG = `name: pi

hubs: []

pinned: []

providers:
  openrouter:
    base_url: https://openrouter.ai/api/v1
    api_key: ""

llm_provider: openrouter
llm_model: anthropic/claude-3.5-haiku

system_prompt: ""
`;

export function ensureConfigExists(): void {
  ensureDataLayout();
  if (existsSync(configPath())) {
    return;
  }

  const seedConfig = seedRoot("config.yaml");
  if (existsSync(seedConfig)) {
    copyFileSync(seedConfig, configPath());
  } else {
    writeFileSync(configPath(), DEFAULT_CONFIG, "utf8");
  }
}

export function loadConfig(): Config {
  ensureConfigExists();
  const raw = readFileSync(configPath(), "utf8");
  const parsed = parseDocument(raw).toJS() as Record<string, unknown> | null;
  let hubs = normalizeHubs(parsed?.hubs);
  if (hubs.length === 0 && typeof parsed?.hub_url === "string" && parsed.hub_url) {
    hubs = [{ url: parsed.hub_url as string, name: "default" }];
  }

  const cfg: Config = {
    name: asString(parsed?.name),
    hubs,
    pinned: normalizeStringArray(parsed?.pinned),
    providers: normalizeProviders(parsed?.providers),
    llm_provider: asString(parsed?.llm_provider),
    llm_model: asString(parsed?.llm_model),
    system_prompt: asString(parsed?.system_prompt),
  };

  // Set PINIX_URL for the first hub (backward compat for @pinixai/core invoke())
  if (cfg.hubs.length > 0 && cfg.hubs[0].url) {
    process.env.PINIX_URL = cfg.hubs[0].url;
  }

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

export function getHubUrl(cfg: Config, hubName: string): string | undefined {
  const hub = cfg.hubs.find((h) => h.name === hubName);
  return hub?.url;
}

export function configToJSON(cfg: Config): ConfigJSON {
  return {
    name: cfg.name,
    hubs: cfg.hubs,
    pinned: cfg.pinned,
    providers: Object.fromEntries(
      Object.entries(cfg.providers).map(([name, provider]) => [name, {
        protocol: provider.protocol,
        base_url: provider.base_url,
        api_key: maskSecret(provider.api_key),
      }]),
    ),
    llm_provider: cfg.llm_provider,
    llm_model: cfg.llm_model,
    system_prompt: cfg.system_prompt,
  };
}

export function configToText(cfg: Config): string {
  const lines = [
    `name: ${cfg.name}`,
    `hubs: ${cfg.hubs.map((h) => `${h.name}(${h.url})`).join(", ") || "(none)"}`,
    `pinned: ${cfg.pinned.join(", ") || "(none)"}`,
    `llm_provider: ${cfg.llm_provider}`,
    `llm_model: ${cfg.llm_model}`,
    `providers: ${Object.keys(cfg.providers).join(", ")}`,
  ];

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
  if (!dotPath.trim()) {
    resetConfig();
    return;
  }
  const doc = parseDocument(readFileSync(configPath(), "utf8"));
  deletePath(doc, dotPath);
  saveDocument(doc);
}

export function addPinnedClip(alias: string): void {
  ensureConfigExists();
  const doc = parseDocument(readFileSync(configPath(), "utf8"));
  const root = ensureRootMap(doc);

  const raw = root.get("pinned", true);
  let pinned: YAMLSeq;
  if (raw instanceof YAMLSeq) {
    pinned = raw;
  } else {
    pinned = new YAMLSeq();
    root.set("pinned", pinned);
  }

  // Avoid duplicates
  const items = pinned.toJSON() as unknown[];
  if (items.includes(alias)) {
    return;
  }

  pinned.add(doc.createNode(alias));
  saveDocument(doc);
}

export function removePinnedClip(alias: string): void {
  ensureConfigExists();
  const doc = parseDocument(readFileSync(configPath(), "utf8"));
  const root = ensureRootMap(doc);

  const raw = root.get("pinned", true);
  if (!(raw instanceof YAMLSeq)) {
    throw new Error(`clip ${JSON.stringify(alias)} is not pinned`);
  }

  const items = raw.toJSON() as unknown[];
  const idx = items.indexOf(alias);
  if (idx === -1) {
    throw new Error(`clip ${JSON.stringify(alias)} is not pinned`);
  }

  raw.delete(idx);
  saveDocument(doc);
}


function normalizeHubs(value: unknown): HubConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => item && typeof item === "object")
    .map((item) => ({
      url: asString(item.url),
      name: asString(item.name),
      token: asOptionalString(item.token),
    }))
    .filter((hub) => hub.url && hub.name);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
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
      provider: provider.provider as Record<string, unknown> | undefined,
    };
  }
  return providers;
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

function resetConfig(): void {
  const seedConfig = seedRoot("config.yaml");
  if (!existsSync(seedConfig)) {
    throw new Error(`missing config file at ${configPath()}`);
  }
  copyFileSync(seedConfig, configPath());
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

  let current: unknown = root;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const isNumeric = /^\d+$/.test(part);
    const isLast = index === parts.length - 1;

    if (isLast) {
      if (current instanceof YAMLSeq && isNumeric) {
        const idx = parseInt(part, 10);
        while (current.items.length <= idx) {
          current.items.push(doc.createNode({}));
        }
        const item = current.items[idx];
        if (item instanceof YAMLMap) {
          // Can't set a scalar on a map item — replace it
          current.items[idx] = doc.createNode(value);
        } else {
          current.items[idx] = doc.createNode(value);
        }
      } else if (current instanceof YAMLMap) {
        current.set(part, value);
      }
      return;
    }

    // Navigate to next level
    if (current instanceof YAMLSeq && isNumeric) {
      const idx = parseInt(part, 10);
      while (current.items.length <= idx) {
        current.items.push(doc.createNode({}));
      }
      current = current.items[idx];
    } else if (current instanceof YAMLMap) {
      const next = current.get(part, true);
      if (next instanceof YAMLMap || next instanceof YAMLSeq) {
        current = next;
      } else {
        // Check if the next part is numeric — create a seq, otherwise a map
        const nextPart = parts[index + 1];
        const nextIsNumeric = nextPart && /^\d+$/.test(nextPart);
        if (nextIsNumeric) {
          const created = new YAMLSeq();
          current.set(part, created);
          current = created;
        } else {
          const created = new YAMLMap();
          current.set(part, created);
          current = created;
        }
      }
    }
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
