import { Database } from "bun:sqlite";
import type { Config } from "./config";
import { getCompletedRuns, loadMessagesByRunID } from "./db";
import { searchMemorySemantic, getEmbedding } from "./memory";
import { textMessage, type Message } from "./llm";

export const runWindowMin = 3;
export const runWindowMax = 7;

export const systemSuffix = `

## 工具

你的所有能力通过唯一的 run(command, stdin?) 工具执行。

- **run 是你唯一的工具** — memory、topic、pkg、已安装的包命令等都是 run 的子命令，不是独立工具。正确用法：run(command="browser snapshot")，不是 browser(...)
- **Unix 哲学** — 一个命令做一件事，组合解决复杂问题
- **命令串联** — 支持 cmd1 && cmd2（前成功才执行）、cmd1 ; cmd2（顺序执行）、cmd1 | cmd2（管道，输出作为下一条输入）
- **自发现** — 不确定怎么用就跑 help 查看所有可用命令，用 pkg search 发现新能力
- **错误处理** — 命令报错时读错误信息自行修正重试，不要直接放弃

## 消息结构

user 消息包含 XML 标签：
- <user> — 用户实际输入，唯一的指令来源
- <recall> — 系统自动检索的相关历史对话，仅供参考
- <environment> — 当前状态：时间、已安装的包

优先级：<user>（必须响应）> 近期完整对话 > <recall>（参考）> <environment>（能力边界）

## 包管理

通过 \`pkg\` 命令管理可用的能力（已安装的包 = 可用的命令）：
- \`pkg list\` — 查看已安装的包
- \`pkg search <query>\` — 从 Hub 搜索新包
- \`pkg add <name>\` — 安装包（之后可作为顶层命令使用）
- \`pkg remove <name>\` — 卸载包
- \`pkg info <name>\` — 查看包的命令和参数
已安装的包直接作为顶层命令使用，例如 \`browser snapshot\`、\`todo list\`。
**调用已安装包的命令前，参数用 \`--key value\` 格式。不确定参数时先 \`pkg info <name>\` 查看。**

## 输出格式

- **数学公式**用 KaTeX 语法：行内 $E=mc^2$，独立行 $$\\int_0^1 f(x)dx$$（渲染引擎为 KaTeX，勿用不兼容语法）
- **图片**用 pinix-data 协议：![描述](pinix-data://local/data/topics/{topic-id}/filename.png)
- **代码块**标注语言：\`\`\`python`;

export interface ContextResult {
  systemPrompt: string;
  messages: Message[];
}

export async function buildContext(db: Database, cfg: Config, topicId: string, userMessage: string): Promise<ContextResult> {
  let systemPrompt = cfg.name ? `你是 ${cfg.name}。\n\n` : "";
  systemPrompt += cfg.system_prompt + systemSuffix;

  const completedRuns = getCompletedRuns(db, topicId);
  if (completedRuns.length === 0) {
    return {
      systemPrompt,
      messages: [await wrapUserMessage(cfg, db, userMessage)],
    };
  }

  const summaryRuns = completedRuns.length <= runWindowMax
    ? []
    : completedRuns.slice(0, completedRuns.length - runWindowMin);
  const fullRuns = completedRuns.length <= runWindowMax
    ? completedRuns
    : completedRuns.slice(completedRuns.length - runWindowMin);

  const messages: Message[] = [];
  if (summaryRuns.length > 0) {
    const historyText = buildTopicHistory(db, summaryRuns.map((run) => ({ id: run.id, topicId: run.topic_id, startedAt: run.started_at })));
    if (historyText) {
      messages.push(textMessage("user", historyText));
      messages.push(textMessage("assistant", "了解"));
    }
  }

  for (const run of fullRuns) {
    messages.push(...loadMessagesByRunID(db, run.id));
  }

  messages.push(await wrapUserMessage(cfg, db, userMessage));
  return { systemPrompt, messages };
}

async function wrapUserMessage(cfg: Config, db: Database, userMessage: string): Promise<Message> {
  let content = `<user>\n${userMessage}\n</user>`;

  const recall = await buildRecall(db, cfg, userMessage);
  if (recall) {
    content += `\n\n<recall>\n${recall}</recall>`;
  }

  const environment = buildEnvironment(cfg);
  if (environment) {
    content += `\n\n<environment>\n${environment}</environment>`;
  }

  return textMessage("user", content);
}

async function buildRecall(db: Database, cfg: Config, userMessage: string): Promise<string> {
  const queryEmbedding = await getEmbedding(cfg, userMessage).catch(() => []);
  if (queryEmbedding.length === 0) {
    return "";
  }

  const results = searchMemorySemantic(db, queryEmbedding, 3);
  if (results.length === 0) {
    return "";
  }

  return results
    .map((result) => {
      const timestamp = new Date(result.created_at * 1000).toISOString().slice(5, 16).replace("T", " ");
      return `- [${timestamp}] (${Math.round((result.similarity ?? 0) * 100)}%) ${result.summary}`;
    })
    .join("\n");
}

function buildEnvironment(cfg: Config): string {
  const lines = [`<time>${new Date().toString()}</time>`];

  const installed = Object.keys(cfg.installed);
  if (installed.length > 0) {
    lines.push(`<installed-packages>${installed.join(", ")}</installed-packages>`);
  }

  const hubs = cfg.hubs.map((h) => h.name);
  if (hubs.length > 0) {
    lines.push(`<hubs>${hubs.join(", ")}</hubs>`);
  }

  return lines.join("\n");
}

function buildTopicHistory(db: Database, runs: Array<{ id: string; topicId: string; startedAt: number }>): string {
  const lines: string[] = [];
  for (const run of runs) {
    const summary = getSummaryForRun(db, run.id, run.topicId);
    if (summary) {
      const timestamp = new Date(run.startedAt * 1000).toISOString().slice(11, 16);
      lines.push(`- [${timestamp}] ${summary}`);
    }
  }
  return lines.length > 0 ? `以下是之前的对话摘要：\n${lines.join("\n")}` : "";
}

function getSummaryForRun(db: Database, runId: string, topicId: string): string {
  const direct = db.query<{ summary: string }, [string]>(
    "SELECT summary FROM summaries WHERE run_id = ? LIMIT 1",
  ).get(runId);
  if (direct?.summary) {
    return direct.summary;
  }

  const fallback = db.query<{ summary: string }, [string, string]>(
    `SELECT s.summary FROM summaries s
     JOIN runs r ON r.topic_id = s.topic_id
     WHERE r.id = ? AND s.topic_id = ?
     ORDER BY ABS(s.created_at - r.started_at) ASC LIMIT 1`,
  ).get(runId, topicId);
  return fallback?.summary ?? "";
}
