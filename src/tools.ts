import { hubInvoke, hubListClips } from '@pinixai/core';
import { Database } from 'bun:sqlite';
import { parseChain, Operator } from './chain';
import {
  type Config,
  type HubConfig,
  addInstalledClip,
  configDelete,
  configSet,
  configToText,
  loadConfig,
  removeInstalledClip,
} from './config';
import {
  countTopicRuns,
  countTopics,
  getRunInfo,
  getTopic,
  getTopicRunsPage,
  listTopicsPage,
  loadMessagesByRunID,
  renameTopic,
} from './db';
import { registerEventCommands } from './events';
import { type ToolCall, type ToolDef } from './llm';
import { formatSearchResults, searchMemory } from './memory';
import { isImageFile } from './media';
import { attachmentToURL, extractThinking, extractUserContent } from './sanitize';
import { parsePositiveInt, safeJSONParse, toErrorMessage } from './shared';

type CommandHandler = (args: string[], stdin: string) => Promise<string> | string;
type RegisterFn = (name: string, description: string, handler: CommandHandler) => void;

export interface WebToolCall {
  name: string;
  arguments: string;
}

export interface WebAttachment {
  name: string;
  url: string;
  is_image: boolean;
}

export interface WebMessage {
  role: string;
  content: string;
  tool_call_id?: string;
  reasoning?: string;
  tool_calls?: WebToolCall[];
  attachments?: WebAttachment[];
}

export class Registry {
  private readonly handlers = new Map<string, CommandHandler>();
  private readonly descriptions = new Map<string, string>();

  constructor() {
    this.registerBuiltins();
  }

  register(name: string, description: string, handler: CommandHandler): void {
    this.handlers.set(name, handler);
    this.descriptions.set(name, description);
  }

  help(): Record<string, string> {
    return Object.fromEntries(
      [...this.descriptions.entries()].sort((left, right) => left[0].localeCompare(right[0])),
    );
  }

  async exec(command: string, stdin = ''): Promise<string> {
    const segments = parseChain(command);
    if (segments.length === 0) {
      return '[error] empty command';
    }

    const collected: string[] = [];
    let lastOutput = '';
    let lastErr = false;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (index > 0) {
        const prevOp = segments[index - 1].op;
        if (prevOp === Operator.And && lastErr) {
          continue;
        }
        if (prevOp === Operator.Or && !lastErr) {
          continue;
        }
      }

      const segStdin = index === 0
        ? stdin
        : segments[index - 1].op === Operator.Pipe
          ? lastOutput
          : '';

      [lastOutput, lastErr] = await this.execSingle(segment.raw, segStdin);

      if (index < segments.length - 1 && segment.op === Operator.Pipe) {
        continue;
      }
      if (lastOutput) {
        collected.push(lastOutput);
      }
    }

    return collected.join('\n');
  }

  private async execSingle(command: string, stdin: string): Promise<[string, boolean]> {
    const parts = tokenize(command);
    if (parts.length === 0) {
      return ['[error] empty command', true];
    }

    const name = parts[0];
    const handler = this.handlers.get(name);
    if (!handler) {
      return [`[error] unknown command: ${name}\nAvailable: ${[...this.handlers.keys()].sort().join(', ')}`, true];
    }

    try {
      const output = await handler(parts.slice(1), stdin);
      return [output, false];
    } catch (error) {
      return [`[error] ${name}: ${toErrorMessage(error)}`, true];
    }
  }

  private registerBuiltins(): void {
    this.register('echo', 'Echo back the input', (args, stdin) => stdin || args.join(' '));

    this.register('time', 'Return the current time', () => new Date().toString());

    this.register('help', 'List available commands', () => {
      return Object.entries(this.help())
        .map(([name, description]) => `  ${name} — ${description}`)
        .join('\n');
    });
  }
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const char of input) {
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
      continue;
    }

    if (char === ' ' || char === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function runToolDef(commands: Record<string, string>): ToolDef {
  const description = [
    'Your ONLY tool. Execute commands via run(command="..."). Supports chaining: cmd1 && cmd2, cmd1 | cmd2.',
    '',
    'Available commands:',
    ...Object.entries(commands)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([name, help]) => `  ${name} — ${help}`),
  ].join('\n');

  return {
    type: 'function',
    function: {
      name: 'run',
      description,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Unix-style command to execute',
          },
          stdin: {
            type: 'string',
            description: 'Standard input for the command',
          },
        },
        required: ['command'],
      },
    },
  };
}

export function buildRegistry(db: Database, cfg: Config): Registry {
  const registry = new Registry();
  registerMemoryCommands(registry.register.bind(registry), db, cfg);
  registerTopicCommands(registry.register.bind(registry), db, cfg);
  registerEventCommands(registry.register.bind(registry), db);
  registerConfigCommands(registry.register.bind(registry));
  registerPkgCommands(registry, cfg);
  registerInstalledClipCommands(registry, cfg);
  return registry;
}

function registerMemoryCommands(register: RegisterFn, db: Database, cfg: Config): void {
  register(
    'memory',
    [
      'Search or manage memory.',
      '  memory search <query>              — search across all topics (semantic + keyword)',
      '  memory search <query> -t <id>      — search within a specific topic',
      '  memory search <query> -k <keyword> — filter results by keyword',
      '  memory recent [n]                  — show recent conversation summaries',
    ].join('\n'),
    async (args, stdin) => {
      if (args.length === 0) {
        throw new Error('usage: memory search|recent');
      }

      switch (args[0]) {
        case 'search': {
          const filter: { topicId?: string; keyword?: string; limit?: number } = { limit: 5 };
          const queryParts: string[] = [];
          for (let index = 1; index < args.length; index += 1) {
            switch (args[index]) {
              case '-t':
                filter.topicId = args[index + 1] ?? '';
                index += 1;
                break;
              case '-k':
                filter.keyword = args[index + 1] ?? '';
                index += 1;
                break;
              default:
                queryParts.push(args[index]);
                break;
            }
          }
          const query = queryParts.join(' ').trim();
          if (!query) {
            throw new Error('usage: memory search <query> [-t topic_id] [-k keyword]');
          }
          const results = await searchMemory(db, cfg, query, filter);
          return formatSearchResults(results);
        }
        case 'recent': {
          const limit = args[1] ? parsePositiveInt(args[1]) : 5;
          const rows = db.query<{ summary: string; created_at: number }, [number]>(
            'SELECT summary, created_at FROM summaries ORDER BY created_at DESC LIMIT ?',
          ).all(limit);
          if (rows.length === 0) {
            return 'No conversation summaries yet.';
          }
          return rows.map((row) => `[${formatSummaryTime(row.created_at)}] ${row.summary}`).join('\n');
        }
        default:
          throw new Error(`unknown: memory ${args[0]}. Use: search|recent`);
      }
    },
  );
}

function registerTopicCommands(register: RegisterFn, db: Database, cfg: Config): void {
  register(
    'topic',
    [
      'Manage conversation topics.',
      '  topic list [limit]               — list topics (default: 10, newest first)',
      '  topic info <id>                  — show topic details and run history',
      '  topic runs <id> [limit]          — list runs (default: 10, newest first)',
      '  topic run <run-id>               — show a run\'s full messages',
      '  topic rename <id> <new-name>     — rename a topic',
      '  topic search <id> <query>        — search within a topic',
    ].join('\n'),
    async (args) => {
      if (args.length === 0) {
        throw new Error('usage: topic list|info|rename|runs|run|search');
      }

      switch (args[0]) {
        case 'list': {
          const limit = args[1] ? parsePositiveInt(args[1]) : 10;
          const total = countTopics(db);
          if (total === 0) {
            return 'No topics.';
          }
          const topics = listTopicsPage(db, limit, 0);
          const lines = [`Topics (${topics.length} of ${total}, newest first):`];
          for (const topic of topics) {
            lines.push(`  ${topic.id}  ${topic.name}  (${topic.message_count} msgs)  ${formatShortDate(topic.created_at)}`);
          }
          return lines.join('\n');
        }
        case 'info': {
          if (!args[1]) {
            throw new Error('usage: topic info <id>');
          }
          const topic = getTopic(db, args[1]);
          const total = countTopicRuns(db, topic.id);
          const lines = [
            `Topic: ${topic.name} (${topic.id})`,
            `Created: ${formatFullDate(topic.created_at)}`,
          ];
          if (total > 0) {
            const runs = getTopicRunsPage(db, topic.id, 5, 0);
            lines.push(`Runs: ${total} (showing last ${runs.length})`, '');
            for (const run of runs) {
              const duration = run.finished_at > 0 ? ` (${run.finished_at - run.started_at}s)` : '';
              lines.push(`  ${run.id} [${formatClock(run.started_at)}]${duration}  status=${run.status}  tools=${run.tool_count}`);
              if (run.summary) {
                lines.push(`    ${run.summary}`);
              }
            }
          } else {
            lines.push('Runs: 0');
          }
          return lines.join('\n');
        }
        case 'rename': {
          if (args.length < 3) {
            throw new Error('usage: topic rename <id> <new-name>');
          }
          const name = args.slice(2).join(' ');
          renameTopic(db, args[1], name);
          return `topic ${args[1]} renamed to ${JSON.stringify(name)}`;
        }
        case 'runs': {
          if (!args[1]) {
            throw new Error('usage: topic runs <id> [limit]');
          }
          const limit = args[2] ? parsePositiveInt(args[2]) : 10;
          const total = countTopicRuns(db, args[1]);
          if (total === 0) {
            return 'No runs in this topic.';
          }
          const runs = getTopicRunsPage(db, args[1], limit, 0);
          const lines = [`Runs (${runs.length} of ${total}, newest first):`];
          for (const run of runs) {
            const duration = run.finished_at > 0 ? ` (${run.finished_at - run.started_at}s)` : '';
            lines.push(`  ${run.id} [${formatClock(run.started_at)}]${duration}  status=${run.status}  tools=${run.tool_count}`);
            if (run.summary) {
              lines.push(`     ${run.summary}`);
            }
          }
          return lines.join('\n');
        }
        case 'run': {
          if (!args[1]) {
            throw new Error('usage: topic run <run-id>');
          }
          const run = getRunInfo(db, args[1]);
          const messages = loadMessagesByRunID(db, args[1]);
          const lines = [
            `Run ${run.id}  [${formatFullDate(run.started_at)}]  status=${run.status}  tools=${run.tool_count}`,
          ];
          if (run.summary) {
            lines.push(`Summary: ${run.summary}`);
          }
          lines.push('', `Messages (${messages.length}):`);
          for (const message of messages) {
            switch (message.role) {
              case 'user':
                if (message.content) {
                  lines.push('', `[user] ${message.content}`);
                }
                break;
              case 'assistant':
                for (const toolCall of message.toolCalls ?? []) {
                  lines.push(`[tool_call] ${toolCall.function.name}(${toolCall.function.arguments})`);
                }
                if (message.content) {
                  lines.push(`[assistant] ${message.content}`);
                }
                break;
              case 'tool':
                if (message.content) {
                  lines.push(`[tool_result] ${message.content}`);
                }
                break;
              default:
                break;
            }
          }
          return lines.join('\n');
        }
        case 'search': {
          if (args.length < 3) {
            throw new Error('usage: topic search <topic-id> <query>');
          }
          const results = await searchMemory(db, cfg, args.slice(2).join(' '), { topicId: args[1], limit: 10 });
          return formatSearchResults(results);
        }
        default:
          throw new Error(`unknown: topic ${args[0]}. Use: list|info|runs|run|search|rename`);
      }
    },
  );
}

function registerConfigCommands(register: RegisterFn): void {
  register(
    'config',
    [
      'View or update agent configuration.',
      '  config                                    — show current config',
      '  config set <key> <value>                  — set a value (supports dot-path: providers.openrouter.api_key)',
      '  config delete <key>                       — delete a key (e.g., providers.minimax)',
    ].join('\n'),
    async (args, stdin) => {
      if (args.length === 0) {
        return configToText(loadConfig());
      }

      switch (args[0]) {
        case 'set': {
          if (args.length < 3) {
            throw new Error('usage: config set <key> <value>');
          }
          const key = args[1];
          const value = args.slice(2).join(' ');
          configSet(key, value);
          return `${key} = ${value}`;
        }
        case 'delete': {
          if (!args[1]) {
            throw new Error('usage: config delete <key>');
          }
          configDelete(args[1]);
          return `deleted ${args[1]}`;
        }
        default:
          throw new Error(`unknown config subcommand: ${args[0]}`);
      }
    },
  );
}

function registerPkgCommands(registry: Registry, cfg: Config): void {
  registry.register(
    'pkg',
    [
      'Manage installed packages (Clips).',
      '  pkg list                          — list installed packages',
      '  pkg search <query>                — search all connected Hubs',
      '  pkg add <name> [--hub <hub>]      — install a Clip',
      '  pkg remove <name>                 — uninstall a Clip',
      '  pkg info <name>                   — show Clip commands and schema',
    ].join('\n'),
    async (args) => {
      if (args.length === 0 || args[0] === 'list') {
        return pkgList(cfg);
      }

      switch (args[0]) {
        case 'search':
          return pkgSearch(cfg, args.slice(1));
        case 'add':
          return pkgAdd(registry, cfg, args.slice(1));
        case 'remove':
          return pkgRemove(args.slice(1));
        case 'info':
          return pkgInfo(cfg, args.slice(1));
        default:
          throw new Error(`unknown: pkg ${args[0]}. Use: list|search|add|remove|info`);
      }
    },
  );
}

function pkgList(cfg: Config): string {
  const entries = Object.entries(cfg.installed);
  if (entries.length === 0) {
    return 'No packages installed. Use `pkg search` to find packages, then `pkg add <name>` to install.';
  }

  const lines = [`Installed packages (${entries.length}):`];
  for (const [alias, info] of entries) {
    lines.push(`  ${alias}  (hub: ${info.hub})`);
  }
  return lines.join('\n');
}

async function pkgSearch(cfg: Config, args: string[]): Promise<string> {
  const query = args.join(' ').trim().toLowerCase();

  if (cfg.hubs.length === 0) {
    return 'No Hubs connected. Add a Hub first: config set hubs.0.url <url>';
  }

  const allResults: string[] = [];
  for (const hub of cfg.hubs) {
    try {
      const clips = await hubListClips(hub.url, hub.token);
      const filtered = query
        ? clips.filter((c) => {
            const searchable = [c.name, c.domain, ...c.commands.map((cmd) => cmd.name), ...c.commands.map((cmd) => cmd.description)].join(' ').toLowerCase();
            return searchable.includes(query);
          })
        : clips;

      if (filtered.length > 0) {
        allResults.push(`[${hub.name}] ${filtered.length} clip(s):`);
        for (const clip of filtered) {
          const cmds = clip.commands.map((c) => c.name).join(', ');
          const installed = cfg.installed[clip.name] ? ' (installed)' : '';
          allResults.push(`  ${clip.name}${cmds ? ` — ${cmds}` : ''}${installed}`);
        }
      }
    } catch (err) {
      allResults.push(`[${hub.name}] error: ${toErrorMessage(err)}`);
    }
  }

  if (allResults.length === 0) {
    return query ? `No clips matching "${query}".` : 'No clips found on any Hub.';
  }

  return allResults.join('\n');
}

async function pkgAdd(registry: Registry, cfg: Config, args: string[]): Promise<string> {
  if (args.length === 0) {
    throw new Error('usage: pkg add <name> [--hub <hub-name>]');
  }

  const name = args[0];
  let hubName = '';

  for (let i = 1; i < args.length; i += 1) {
    if (args[i] === '--hub' && args[i + 1]) {
      hubName = args[i + 1];
      i += 1;
    }
  }

  if (cfg.installed[name]) {
    return `"${name}" is already installed (hub: ${cfg.installed[name].hub}).`;
  }

  // If hub not specified, find the clip on any connected hub
  if (!hubName) {
    for (const hub of cfg.hubs) {
      try {
        const clips = await hubListClips(hub.url, hub.token);
        if (clips.find((c) => c.name === name)) {
          hubName = hub.name;
          break;
        }
      } catch {
        // skip unreachable hubs
      }
    }
  }

  if (!hubName) {
    if (cfg.hubs.length === 0) {
      throw new Error('No Hubs connected. Add a Hub first.');
    }
    throw new Error(`Clip "${name}" not found on any connected Hub.`);
  }

  // Verify the hub name exists in config
  const hub = cfg.hubs.find((h) => h.name === hubName);
  if (!hub) {
    throw new Error(`Hub "${hubName}" not found in config.`);
  }

  addInstalledClip(name, hubName);
  cfg.installed[name] = { hub: hubName };
  registerSingleClipCommand(registry, cfg, name, hub);
  return `Installed "${name}" from hub "${hubName}". It is now available as a command.`;
}

function pkgRemove(args: string[]): string {
  if (args.length === 0) {
    throw new Error('usage: pkg remove <name>');
  }
  const name = args[0];
  removeInstalledClip(name);
  return `Removed "${name}".`;
}

async function pkgInfo(cfg: Config, args: string[]): Promise<string> {
  if (args.length === 0) {
    throw new Error('usage: pkg info <name>');
  }

  const name = args[0];
  const entry = cfg.installed[name];

  // Try to find info from the hub
  let clipInfo: Awaited<ReturnType<typeof hubListClips>>[number] | undefined;

  if (entry) {
    const hubCfg = cfg.hubs.find((h) => h.name === entry.hub);
    if (hubCfg) {
      try {
        const clips = await hubListClips(hubCfg.url, hubCfg.token);
        clipInfo = clips.find((c) => c.name === name);
      } catch {
        // hub unreachable
      }
    }
  } else {
    // Search all hubs
    for (const hub of cfg.hubs) {
      try {
        const clips = await hubListClips(hub.url, hub.token);
        clipInfo = clips.find((c) => c.name === name);
        if (clipInfo) break;
      } catch {
        // skip
      }
    }
  }

  const lines = [`Package: ${name}`];
  if (entry) {
    lines.push(`Status: installed (hub: ${entry.hub})`);
  } else {
    lines.push('Status: not installed');
  }

  if (clipInfo) {
    if (clipInfo.domain) lines.push(`Domain: ${clipInfo.domain}`);
    if (clipInfo.commands.length > 0) {
      lines.push('', 'Commands:');
      for (const cmd of clipInfo.commands) {
        lines.push(`  ${cmd.name}${cmd.description ? ` — ${cmd.description}` : ''}`);
        const schema = cmd.input ? safeJSONParse<{ properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] }>(cmd.input) : null;
        if (schema?.properties) {
          const required = new Set(schema.required ?? []);
          for (const [key, prop] of Object.entries(schema.properties)) {
            const req = required.has(key) ? ' (required)' : '';
            const enumVals = prop.enum ? ` [${prop.enum.join('|')}]` : '';
            lines.push(`    --${key} <${prop.type || 'value'}>${enumVals}${req}${prop.description ? ` ${prop.description}` : ''}`);
          }
        }
      }
    }
  } else {
    lines.push('(no info available — Hub unreachable or clip not found)');
  }

  return lines.join('\n');
}

/**
 * Register installed clips as top-level commands.
 * Each installed clip's alias becomes a command name.
 * Subcommands are forwarded to the Hub via hubInvoke().
 */
function registerInstalledClipCommands(registry: Registry, cfg: Config): void {
  for (const [alias, clipInfo] of Object.entries(cfg.installed)) {
    const hubCfg = cfg.hubs.find((h) => h.name === clipInfo.hub);
    if (!hubCfg) {
      continue;
    }
    registerSingleClipCommand(registry, cfg, alias, hubCfg);
  }
}

function registerSingleClipCommand(registry: Registry, cfg: Config, alias: string, hubCfg: HubConfig): void {
  const clipInfo = cfg.installed[alias];
  const hubLabel = clipInfo?.hub ?? 'unknown';
  registry.register(
    alias,
    `Installed package (hub: ${hubLabel}). Run "${alias} <command> [--param value]" or just "${alias}" for info.`,
    async (args, stdin) => {
      if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        return pkgInfo(cfg, [alias]);
      }

      const command = args[0];
      const input = buildClipInvokeInput(args.slice(1), stdin);

      try {
        const result = await hubInvoke(alias, command, input, clipInfo?.token, hubCfg.url, hubCfg.token);
        if (typeof result === 'string') {
          return result;
        }
        return JSON.stringify(result, null, 2);
      } catch (error) {
        // Try to give a usage hint
        const hint = await getCommandUsageHint(alias, command, hubCfg);
        if (hint) {
          throw new Error(`${toErrorMessage(error)}\n\n${hint}`);
        }
        throw error;
      }
    },
  );
}

async function getCommandUsageHint(clipName: string, command: string, hubCfg: HubConfig): Promise<string | null> {
  try {
    const clips = await hubListClips(hubCfg.url, hubCfg.token);
    const clip = clips.find((c) => c.name === clipName);
    const cmd = clip?.commands.find((c) => c.name === command);
    if (!cmd?.input) return null;

    const schema = safeJSONParse<{ properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] }>(cmd.input);
    if (!schema?.properties) return null;

    const parts: string[] = [];
    const required = new Set(schema.required ?? []);
    for (const [key, prop] of Object.entries(schema.properties)) {
      const desc = prop.description ? ` (${prop.description})` : '';
      const enumVals = prop.enum ? ` [${prop.enum.join('|')}]` : '';
      if (required.has(key)) {
        parts.push(`--${key} <${prop.type || 'value'}>${enumVals}${desc}`);
      } else {
        parts.push(`[--${key} <${prop.type || 'value'}>${enumVals}${desc}]`);
      }
    }
    return `usage: ${clipName} ${command} ${parts.join(' ')}`;
  } catch {
    return null;
  }
}

function buildClipInvokeInput(args: string[], stdin: string): unknown {
  const flags: Record<string, unknown> = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = parseScalar(next);
    index += 1;
  }

  if (Object.keys(flags).length > 0) {
    if (positionals.length > 0) {
      flags.args = positionals;
    }
    if (stdin) {
      flags.stdin = stdin;
    }
    return flags;
  }

  if (stdin.trim()) {
    const parsed = safeJSONParse<unknown>(stdin.trim());
    if (parsed !== null) {
      return parsed;
    }
  }

  if (positionals.length > 0 || stdin) {
    return { args: positionals, stdin };
  }

  return {};
}

function parseScalar(value: string): unknown {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && value.trim() !== '') {
    return asNumber;
  }

  return value;
}

function formatSummaryTime(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(5, 16).replace('T', ' ');
}

function formatShortDate(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(5, 16).replace('T', ' ');
}

function formatFullDate(unix: number): string {
  return new Date(unix * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function formatClock(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(11, 19);
}

export function toWebMessage(topicId: string, message: {
  role: string;
  content?: string;
  toolCallId?: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
}): WebMessage {
  let content = message.content ?? '';
  let reasoning = message.reasoning;

  const result: WebMessage = {
    role: message.role,
    content,
  };

  if (message.toolCallId) {
    result.tool_call_id = message.toolCallId;
  }

  if (message.toolCalls && message.toolCalls.length > 0) {
    result.tool_calls = message.toolCalls.map((toolCall) => ({
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    }));
  }

  if (message.role === 'user') {
    const extracted = extractUserContent(content);
    result.content = extracted.content;
    if (extracted.attachments.length > 0) {
      result.attachments = extracted.attachments.map((attachment) => ({
        name: attachment,
        url: attachmentToURL(topicId, attachment),
        is_image: isImageFile(attachment),
      }));
    }
    return result;
  }

  if (message.role === 'assistant') {
    const extracted = extractThinking(content, reasoning ?? '');
    result.content = extracted.content;
    if (extracted.reasoning) {
      result.reasoning = extracted.reasoning;
    }
    return result;
  }

  if (reasoning) {
    result.reasoning = reasoning;
  }
  return result;
}
