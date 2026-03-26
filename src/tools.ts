import { invoke, hubListClips } from '@pinixai/core';
import { Database } from 'bun:sqlite';
import { parseChain, Operator } from './chain';
import {
  type Config,
  configDelete,
  configSet,
  configToText,
  loadConfig,
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
import {
  humanSize,
  pinixDataURLPrefix,
  registerFSCommands,
  resolvePath,
  resolvePathToRelative,
} from './fs';
import { type ToolCall, type ToolDef } from './llm';
import { deleteFact, formatSearchResults, listFacts, searchMemory, storeFact } from './memory';
import { isImageFile } from './media';
import { attachmentToURL, extractThinking, extractUserContent } from './sanitize';
import { createSkill, deleteSkill, listSkills, loadSkill, updateSkill } from './skills';
import { parseOptionalLineCountArgs, parsePositiveInt, safeJSONParse, toErrorMessage } from './shared';
import { registerBrowserCommands } from './browser';

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

    this.register('grep', 'Filter lines matching a pattern (supports -i, -v, -c)', (args, stdin) => {
      if (args.length === 0) {
        throw new Error('usage: grep [-i] [-v] [-c] <pattern>');
      }

      let ignoreCase = false;
      let invert = false;
      let countOnly = false;
      let pattern = '';
      for (const arg of args) {
        switch (arg) {
          case '-i':
            ignoreCase = true;
            break;
          case '-v':
            invert = true;
            break;
          case '-c':
            countOnly = true;
            break;
          default:
            pattern = arg;
            break;
        }
      }

      if (!pattern) {
        throw new Error('pattern required');
      }

      const needle = ignoreCase ? pattern.toLowerCase() : pattern;
      const matches = stdin.split('\n').filter((line) => {
        const haystack = ignoreCase ? line.toLowerCase() : line;
        const matched = haystack.includes(needle);
        return invert ? !matched : matched;
      });
      return countOnly ? String(matches.length) : matches.join('\n');
    });

    this.register('head', 'Show first N lines (default 10). Usage: head 5 or head -n 5', (args, stdin) => {
      const count = parseOptionalLineCountArgs(args, 10);
      const lines = stdin.split('\n');
      return (count > 0 ? lines.slice(0, count) : lines).join('\n');
    });

    this.register('tail', 'Show last N lines (default 10). Usage: tail 5 or tail -n 5', (args, stdin) => {
      const count = parseOptionalLineCountArgs(args, 10);
      const lines = stdin.split('\n');
      return (count > 0 ? lines.slice(-count) : lines).join('\n');
    });

    this.register('wc', 'Count lines, words, chars (-l lines, -w words, -c chars)', (args, stdin) => {
      const lines = stdin.split('\n').length;
      const words = stdin.trim() ? stdin.trim().split(/\s+/).length : 0;
      const chars = stdin.length;
      switch (args[0]) {
        case '-l':
          return String(lines);
        case '-w':
          return String(words);
        case '-c':
          return String(chars);
        default:
          return `${lines} lines, ${words} words, ${chars} chars`;
      }
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
  registerFSCommands(registry.register.bind(registry));
  registerBrowserCommands(registry.register.bind(registry));
  registerMemoryCommands(registry.register.bind(registry), db, cfg);
  registerTopicCommands(registry.register.bind(registry), db, cfg);
  registerEventCommands(registry.register.bind(registry), db);
  registerSkillCommands(registry.register.bind(registry));
  registerConfigCommands(registry.register.bind(registry));
  registerClipCommands(registry.register.bind(registry));
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
      '  memory store <note>                — store a fact/note',
      '  memory facts                       — list all stored facts',
      '  memory forget <id>                 — delete a fact by ID',
    ].join('\n'),
    async (args, stdin) => {
      if (args.length === 0) {
        throw new Error('usage: memory search|recent|store|facts|forget');
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
        case 'store': {
          const note = args.slice(1).join(' ') || stdin;
          if (!note) {
            throw new Error('usage: memory store <note>');
          }
          storeFact(db, note, 'general');
          return 'fact stored';
        }
        case 'facts': {
          const facts = listFacts(db);
          if (facts.length === 0) {
            return 'No facts stored.';
          }
          const showing = facts.slice(0, 50);
          const lines = [`Facts (${showing.length} of ${facts.length}):`];
          for (const fact of showing) {
            lines.push(`  #${fact.id} [${fact.category}] ${fact.content}`);
          }
          if (facts.length > showing.length) {
            lines.push(`  ... ${facts.length - showing.length} more (use memory forget <id> to clean up)`);
          }
          return lines.join('\n');
        }
        case 'forget': {
          if (!args[1]) {
            throw new Error('usage: memory forget <id>');
          }
          deleteFact(db, Number.parseInt(args[1], 10));
          return `fact ${args[1]} deleted`;
        }
        default:
          throw new Error(`unknown: memory ${args[0]}. Use: search|recent|store|facts|forget`);
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

function registerSkillCommands(register: RegisterFn): void {
  register(
    'skill',
    [
      'Reusable instructions. Match task → load → execute.',
      '  skill list                        — list available skills',
      '  skill load <name>                 — load full instructions',
      '  skill search <query>              — search skills by keyword',
      '  skill create <name> --desc TEXT   — create (stdin=content)',
      '  skill update <name> [--desc TEXT] — update (stdin=content)',
      '  skill delete <name>               — delete a skill',
    ].join('\n'),
    async (args, stdin) => {
      if (args.length === 0) {
        throw new Error('usage: skill list|load|search|create|update|delete');
      }

      switch (args[0]) {
        case 'list': {
          const skills = await listSkills();
          if (skills.length === 0) {
            return 'No skills. Use `skill create` to add one.';
          }
          return [
            `Skills (${skills.length}):`,
            ...skills.map((skill) => `  ${skill.name.padEnd(20, ' ')} ${skill.description}`),
          ].join('\n');
        }
        case 'load': {
          if (!args[1]) {
            throw new Error('usage: skill load <name>');
          }
          const skill = loadSkill(args[1]);
          return `<skill name=${JSON.stringify(args[1])}>\n${skill.description ? `> ${skill.description}\n\n` : ''}${skill.body}\n</skill>`;
        }
        case 'search': {
          const query = args.slice(1).join(' ').trim().toLowerCase();
          if (!query) {
            throw new Error('usage: skill search <query>');
          }
          const matches = (await listSkills()).filter((skill) => {
            return skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query);
          });
          if (matches.length === 0) {
            return `No skills matching ${JSON.stringify(args.slice(1).join(' '))}.`;
          }
          return [
            `Matches (${matches.length}):`,
            ...matches.map((skill) => `  ${skill.name.padEnd(20, ' ')} ${skill.description}`),
          ].join('\n');
        }
        case 'create': {
          if (!args[1]) {
            throw new Error('usage: skill create <name> --desc TEXT');
          }
          if (!stdin.trim()) {
            throw new Error('stdin content is required for skill create');
          }
          createSkill(args[1], extractDesc(args.slice(2)), stdin);
          return `created skill ${args[1]}`;
        }
        case 'update': {
          if (!args[1]) {
            throw new Error('usage: skill update <name> [--desc TEXT]');
          }
          updateSkill(
            args[1],
            hasDesc(args.slice(2)) ? extractDesc(args.slice(2)) : undefined,
            stdin.trim() ? stdin : undefined,
          );
          return `updated skill ${args[1]}`;
        }
        case 'delete': {
          if (!args[1]) {
            throw new Error('usage: skill delete <name>');
          }
          deleteSkill(args[1]);
          return `deleted skill ${args[1]}`;
        }
        default:
          throw new Error(`unknown: skill ${args[0]}. Use: list|load|search|create|update|delete`);
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

function registerClipCommands(register: RegisterFn): void {
  register(
    'clip',
    [
      'Operate external clips (services, tools, environments).',
      '  clip list                              — list all clips from Hub',
      '  clip <name> <command> [args...]        — invoke a command',
      '  clip <name> pull <remote-path> [name]  — pull file from clip to local',
      '  clip <name> push <local-path> <remote> — push local file to clip',
    ].join('\n'),
    async (args, stdin) => {
      if (args.length === 0 || (args.length === 1 && args[0] === 'list')) {
        return clipList();
      }

      const name = args[0];
      const command = args[1];
      if (!command) {
        return clipInfo(name);
      }
      if (command === 'pull') {
        return clipPull(name, args.slice(2));
      }
      if (command === 'push') {
        return clipPush(name, args.slice(2));
      }
      return clipInvoke(name, command, args.slice(2), stdin);
    },
  );
}

async function clipInvoke(clipName: string, command: string, args: string[], stdin: string): Promise<string> {
  const input = buildClipInvokeInput(args, stdin);

  // If there are bare positional args (no --flags), the input is likely wrong.
  // Show usage hint from the command's schema.
  const hasFlags = args.some((a) => a.startsWith('--'));
  const hasPositionals = args.some((a) => !a.startsWith('--'));
  if (hasPositionals && !hasFlags && !stdin.trim()) {
    const hint = await getCommandUsageHint(clipName, command);
    if (hint) {
      throw new Error(`${hint}\n\nExample: clip ${clipName} ${command} ${hint.includes('--') ? hint.split('\n')[0].replace(/^usage: clip \S+ \S+ /, '') : ''}`);
    }
  }

  try {
    const result = await invoke(clipName, command, input);
    if (typeof result === 'string') {
      return result;
    }
    return JSON.stringify(result, null, 2);
  } catch (error) {
    const hint = await getCommandUsageHint(clipName, command);
    if (hint) {
      throw new Error(`${toErrorMessage(error)}\n\n${hint}`);
    }
    throw error;
  }
}

async function getCommandUsageHint(clipName: string, command: string): Promise<string | null> {
  try {
    const clips = await hubListClips();
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
    return `usage: clip ${clipName} ${command} ${parts.join(' ')}`;
  } catch {
    return null;
  }
}

async function clipPull(clipName: string, args: string[]): Promise<string> {
  if (!args[0]) {
    throw new Error(`usage: clip ${clipName} pull <remote-path> [local-name]`);
  }

  const remotePath = args[0];
  const localName = args[1] ?? remotePath.split('/').pop() ?? remotePath;
  const result = await invoke(clipName, 'read', { args: [remotePath], stdin: '' });
  const data = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  await Bun.write(resolvePath(localName), data);

  let output = `Pulled ${clipName}:${remotePath} -> ${localName} (${humanSize(Buffer.byteLength(data))})`;
  if (isImageFile(localName)) {
    output += `\nRender: ![image](${pinixDataURLPrefix}${resolvePathToRelative(localName)})`;
  }
  return output;
}

async function clipPush(clipName: string, args: string[]): Promise<string> {
  if (!args[0] || !args[1]) {
    throw new Error(`usage: clip ${clipName} push <local-path> <remote-path>`);
  }

  const bytes = await Bun.file(resolvePath(args[0])).bytes();
  const base64 = Buffer.from(bytes).toString('base64');
  await invoke(clipName, 'write', { args: ['-b', args[1]], stdin: base64 });
  return `Pushed ${args[0]} -> ${clipName}:${args[1]} (${humanSize(bytes.byteLength)})`;
}

async function clipList(): Promise<string> {
  let hubClips: Awaited<ReturnType<typeof hubListClips>> = [];
  try {
    hubClips = await hubListClips();
  } catch (err) {
    return `[error] cannot reach Hub: ${toErrorMessage(err)}`;
  }

  if (hubClips.length === 0) {
    return 'No clips on Hub.';
  }

  const lines: string[] = [];
  for (const clip of hubClips) {
    const cmds = clip.commands.map((c: { name: string }) => c.name).join(', ');
    lines.push(`  ${clip.name}${cmds ? ` — ${cmds}` : ''}`);
  }
  return lines.join('\n');
}

async function clipInfo(clipName: string): Promise<string> {
  let hubClips: Awaited<ReturnType<typeof hubListClips>> = [];
  try {
    hubClips = await hubListClips();
  } catch {}

  const info = hubClips.find((c) => c.name === clipName);
  const lines = [`Clip: ${clipName}`];

  if (info) {
    if (info.domain) lines.push(`Domain: ${info.domain}`);
    if (info.commands.length > 0) {
      lines.push('', 'Commands:');
      for (const cmd of info.commands) {
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
    lines.push('(not found on Hub)');
  }

  lines.push('', 'File transfer:');
  lines.push(`  clip ${clipName} pull <remote-path> [local-name]`);
  lines.push(`  clip ${clipName} push <local-path> <remote-path>`);
  return lines.join('\n');
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

function extractDesc(args: string[]): string {
  const index = args.indexOf('--desc');
  if (index < 0) {
    return '';
  }
  return args[index + 1] ?? '';
}

function hasDesc(args: string[]): boolean {
  return args.includes('--desc');
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
