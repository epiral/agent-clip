import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseDocument, YAMLMap } from "yaml";
import { configPath, ensureDataLayout, seedRoot } from "./paths";
import { maskSecret } from "./shared";

export interface ProviderConfig {
  protocol?: string;
  base_url: string;
  api_key: string;
}

export interface HubConfig {
  url: string;
  name: string;
  token?: string;
}

export interface InstalledClip {
  hub: string; // hub name
  token?: string; // clip token for authenticated invocations
}

export interface Config {
  name: string;
  hubs: HubConfig[];
  installed: Record<string, InstalledClip>; // alias → hub mapping
  providers: Record<string, ProviderConfig>;
  llm_provider: string;
  llm_model: string;
  system_prompt: string;
}

export interface ProviderJSON {
  protocol?: string;
  base_url: string;
  api_key: string;
}

export interface ConfigJSON {
  name: string;
  hubs: HubConfig[];
  installed: Record<string, InstalledClip>;
  providers: Record<string, ProviderJSON>;
  llm_provider: string;
  llm_model: string;
  system_prompt: string;
}

const DEFAULT_CONFIG = `name: pi

hubs: []

installed: {}

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
    installed: normalizeInstalled(parsed?.installed),
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
    installed: cfg.installed,
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
    `installed: ${Object.keys(cfg.installed).join(", ") || "(none)"}`,
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

export function addInstalledClip(alias: string, hubName: string): void {
  ensureConfigExists();
  const doc = parseDocument(readFileSync(configPath(), "utf8"));
  doc.setIn(["installed", alias], doc.createNode({ hub: hubName }));
  saveDocument(doc);
}

export function removeInstalledClip(alias: string): void {
  ensureConfigExists();
  const doc = parseDocument(readFileSync(configPath(), "utf8"));
  const root = ensureRootMap(doc);

  const installed = root.get("installed", true);
  if (!(installed instanceof YAMLMap)) {
    throw new Error(`clip ${JSON.stringify(alias)} is not installed`);
  }

  if (!installed.delete(alias)) {
    throw new Error(`clip ${JSON.stringify(alias)} is not installed`);
  }
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

function normalizeInstalled(value: unknown): Record<string, InstalledClip> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const installed: Record<string, InstalledClip> = {};
  for (const [alias, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    installed[alias] = {
      hub: asString(entry.hub),
      token: asOptionalString(entry.token),
    };
  }
  return installed;
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
