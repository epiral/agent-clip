import { listClips, invokeClip, type RuntimeClipInfo } from '@pinixai/core';
import { Database } from 'bun:sqlite';
import { parseChain, Operator } from './chain';
import {
  type Config,
  type ResolvedConfig,
  addPinnedClip,
  configDelete,
  configSet,
  configToText,
  loadConfig,
  removePinnedClip,
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

export interface WebTokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
}

export interface WebMessage {
  role: string;
  content: string;
  tool_call_id?: string;
  reasoning?: string;
  tool_calls?: WebToolCall[];
  attachments?: WebAttachment[];
  usage?: WebTokenUsage;
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
  let braceDepth = 0; // tracks {} and [] nesting

  for (const char of input) {
    // Inside quotes: collect until matching close quote
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
        if (braceDepth > 0) {
          // Inside braces: keep the quote chars as part of JSON
          current += char;
        } else {
          // Top-level quoted string: push without the quote
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
      continue;
    }

    // Inside braces: collect everything until balanced
    if (braceDepth > 0) {
      current += char;
      if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
      } else if (char === '{' || char === '[') {
        braceDepth += 1;
      } else if (char === '}' || char === ']') {
        braceDepth -= 1;
        if (braceDepth === 0) {
          tokens.push(current);
          current = '';
        }
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
      continue;
    }

    if (char === '{' || char === '[') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      braceDepth = 1;
      current = char;
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
    'Parameter types in command string:',
    '  string:  --key value or --key "value with spaces"',
    '  number:  --limit 10',
    '  boolean: --flag (no value = true)',
    '  object:  --properties {"name": "x", "tags": ["a"]}  (JSON without quotes, braces auto-matched)',
    '  array:   --tags ["a", "b"]  (JSON array without quotes)',
    '  multi-line text: use stdin parameter for long/multi-line content (markdown, body text, etc.)',
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
            description: 'Command to execute',
          },
          stdin: {
            type: 'string',
            description: 'Standard input for the command (multi-line content)',
          },
        },
        required: ['command'],
      },
    },
  };
}

export async function buildRegistry(db: Database, cfg: ResolvedConfig): Promise<Registry> {
  const registry = new Registry();
  registerMemoryCommands(registry.register.bind(registry), db, cfg);
  registerTopicCommands(registry.register.bind(registry), db, cfg);
  registerEventCommands(registry.register.bind(registry), db);
  registerConfigCommands(registry.register.bind(registry));
  registerPkgCommands(registry, cfg);
  await registerAllRuntimeClipCommands(registry, cfg.scope);
  return registry;
}

function registerMemoryCommands(register: RegisterFn, db: Database, cfg: ResolvedConfig): void {
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

function registerTopicCommands(register: RegisterFn, db: Database, cfg: ResolvedConfig): void {
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
            const agentLabel = topic.agent_name ? `  [${topic.agent_name}]` : '';
            lines.push(`  ${topic.id}  ${topic.name}${agentLabel}  (${topic.message_count} msgs)  ${formatShortDate(topic.created_at)}`);
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

function registerPkgCommands(registry: Registry, cfg: ResolvedConfig): void {
  registry.register(
    'pkg',
    [
      'Manage clips and pinning.',
      '  pkg list                          — list runtime clips (marks pinned)',
      '  pkg search <query>                — search the Registry for clips',
      '  pkg pin <clip>                    — pin a clip to system prompt context',
      '  pkg unpin <clip>                  — unpin a clip from context',
      '  pkg info <clip>                   — show clip details and commands',
    ].join('\n'),
    async (args) => {
      if (args.length === 0 || args[0] === 'list') {
        return pkgList(cfg);
      }

      switch (args[0]) {
        case 'search':
          return pkgSearch(args.slice(1));
        case 'pin':
          return pkgPin(cfg, args.slice(1));
        case 'unpin':
          return pkgUnpin(cfg, args.slice(1));
        case 'info':
          return pkgInfo(cfg, args.slice(1));
        default:
          throw new Error(`unknown: pkg ${args[0]}. Use: list|search|pin|unpin|info`);
      }
    },
  );
}

async function pkgList(cfg: ResolvedConfig): Promise<string> {
  try {
    let clips = await listClips();
    if (cfg.scope) {
      const scopeSet = new Set(cfg.scope);
      clips = clips.filter((c) => scopeSet.has(c.name));
    }
    if (clips.length === 0) {
      return 'No clips found.';
    }

    const pinnedSet = new Set(cfg.pinned);
    const lines = [`${clips.length} clip(s)${cfg.scope ? ' (scoped)' : ''}:`];
    for (const clip of clips) {
      const cmds = (clip.commands ?? []).map((c) => c.name).join(', ');
      const pinLabel = pinnedSet.has(clip.name) ? ' (pinned)' : '';
      lines.push(`  ${clip.name}${cmds ? ` — ${cmds}` : ''}${pinLabel}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `error: ${toErrorMessage(err)}`;
  }
}

const REGISTRY_SEARCH_URL = 'https://api.pinix.ai/search';

async function pkgSearch(args: string[]): Promise<string> {
  const query = args.join(' ').trim();
  if (!query) {
    throw new Error('usage: pkg search <query>');
  }

  try {
    const url = `${REGISTRY_SEARCH_URL}?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`registry returned ${resp.status}`);
    }
    const data = await resp.json() as { packages?: Array<{ name: string; description?: string; type?: string; domain?: string }>; total?: number };
    const packages = data.packages ?? [];
    if (packages.length === 0) {
      return `No packages matching "${query}" in the Registry.`;
    }

    const lines = [`${packages.length} result(s) (total: ${data.total ?? packages.length}):`];
    for (const pkg of packages) {
      const desc = pkg.description ? ` — ${pkg.description}` : '';
      const domain = pkg.domain ? ` [${pkg.domain}]` : '';
      lines.push(`  ${pkg.name}${domain}${desc}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `error: ${toErrorMessage(err)}`;
  }
}

function checkScope(cfg: ResolvedConfig, name: string): void {
  if (cfg.scope && !cfg.scope.includes(name)) {
    throw new Error(`clip "${name}" is not in this agent's scope`);
  }
}

function pkgPin(cfg: ResolvedConfig, args: string[]): string {
  const name = args[0];
  if (!name) {
    throw new Error('usage: pkg pin <clip>');
  }
  checkScope(cfg, name);
  if (cfg.pinned.includes(name)) {
    return `"${name}" is already pinned.`;
  }
  addPinnedClip(name);
  cfg.pinned.push(name);
  return `Pinned "${name}". Its info will appear in system prompt.`;
}

function pkgUnpin(cfg: ResolvedConfig, args: string[]): string {
  const name = args[0];
  if (!name) {
    throw new Error('usage: pkg unpin <clip>');
  }
  checkScope(cfg, name);
  removePinnedClip(name);
  const idx = cfg.pinned.indexOf(name);
  if (idx !== -1) {
    cfg.pinned.splice(idx, 1);
  }
  return `Unpinned "${name}".`;
}

async function pkgInfo(cfg: ResolvedConfig, args: string[]): Promise<string> {
  if (args.length === 0) {
    throw new Error('usage: pkg info <clip>');
  }

  const name = args[0];
  checkScope(cfg, name);

  let clipInfo: RuntimeClipInfo | undefined;
  try {
    const clips = await listClips();
    clipInfo = clips.find((c) => c.name === name);
  } catch {
    // IPC unavailable
  }

  return clipInfo ? formatClipInfo(clipInfo) : `Clip: ${name}\n(not found in runtime — clip may not be running)`;
}

function formatClipInfo(clip: RuntimeClipInfo): string {
  const lines = [`Clip: ${clip.name}`];
  if (clip.package) lines.push(`Package: ${clip.package}`);
  if (clip.version) lines.push(`Version: ${clip.version}`);
  if ((clip.commands ?? []).length > 0) {
    lines.push('', 'Commands:');
    for (const cmd of clip.commands ?? []) {
      lines.push(`  ${cmd.name}${cmd.description ? ` — ${cmd.description}` : ''}`);
      if (cmd.input) {
        try {
          const schema = JSON.parse(cmd.input);
          const props = schema.properties || {};
          const required = new Set(schema.required || []);
          const params = Object.entries(props).map(([k, v]: [string, any]) => {
            const req = required.has(k) ? '' : '?';
            const type = v.type || 'any';
            const desc = v.description ? ` (${v.description})` : '';
            return `      --${k}${req}: ${type}${desc}`;
          });
          if (params.length > 0) lines.push(...params);
        } catch {}
      }
    }
  }
  return lines.join('\n');
}

/**
 * Register ALL runtime clips as top-level commands.
 * Each clip's alias becomes a command that forwards subcommands via IPC invokeClip().
 */
async function registerAllRuntimeClipCommands(registry: Registry, scope: string[] | null): Promise<void> {
  let clips: RuntimeClipInfo[] = [];
  try {
    clips = await Promise.race([
      listClips(),
      new Promise<RuntimeClipInfo[]>((_, reject) =>
        setTimeout(() => reject(new Error("IPC timeout")), 3000)
      ),
    ]);
  } catch {
    return;
  }

  if (scope) {
    const scopeSet = new Set(scope);
    clips = clips.filter((c) => scopeSet.has(c.name));
  }

  for (const clip of clips) {
    registerSingleClipCommand(registry, clip);
  }
}

function registerSingleClipCommand(registry: Registry, clip: RuntimeClipInfo): void {
  const cmds = (clip.commands ?? []).map((c) => c.name).join(', ');
  const desc = cmds ? `Clip commands: ${cmds}` : `Clip "${clip.name}"`;
  registry.register(
    clip.name,
    `${desc}. Run "${clip.name} <command> [--param value]" or "${clip.name} --help".`,
    async (args, stdin) => {
      if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        return formatClipInfo(clip);
      }

      const command = args[0];
      const input = buildClipInvokeInput(args.slice(1), stdin);

      try {
        const result = await invokeClip(clip.name, command, input);
        if (typeof result === 'string') {
          return result;
        }
        return JSON.stringify(result, null, 2);
      } catch (error) {
        const hint = getCommandUsageHint(clip, command);
        if (hint) {
          throw new Error(`${toErrorMessage(error)}\n\n${hint}`);
        }
        throw error;
      }
    },
  );
}

function getCommandUsageHint(clip: RuntimeClipInfo, command: string): string | null {
  const cmd = (clip.commands ?? []).find((c) => c.name === command);
  if (!cmd) return null;

  if (!cmd.input) {
    return `usage: ${clip.name} ${command} [--param value ...]`;
  }

  try {
    const schema = JSON.parse(cmd.input);
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    const params = Object.entries(props).map(([k, v]: [string, any]) => {
      const req = required.has(k);
      const type = v.type || 'any';
      const desc = v.description ? ` — ${v.description}` : '';
      return `  --${k}${req ? '' : '?'} <${type}>${desc}`;
    });
    if (params.length === 0) {
      return `usage: ${clip.name} ${command} (no parameters)`;
    }
    return `usage: ${clip.name} ${command}\n${params.join('\n')}`;
  } catch {
    return `usage: ${clip.name} ${command} [--param value ...]`;
  }
}

function buildClipInvokeInput(args: string[], stdin: string): unknown {
  const flags: Record<string, unknown> = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    let key: string | null = null;
    if (arg.startsWith('--')) {
      key = arg.slice(2);
    } else if (arg.startsWith('-') && arg.length > 1 && !/^-\d/.test(arg)) {
      key = arg.slice(1);
    }

    if (!key) {
      positionals.push(arg);
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith('-')) {
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

  // Try JSON object or array
  if (value.length > 0 && (value[0] === '{' || value[0] === '[')) {
    try {
      return JSON.parse(value);
    } catch {
      // not valid JSON, fall through to string
    }
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
  usage?: WebTokenUsage;
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
    if (message.usage) {
      result.usage = message.usage;
    }
    return result;
  }

  if (reasoning) {
    result.reasoning = reasoning;
  }
  return result;
}
