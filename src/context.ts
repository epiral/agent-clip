import { Database } from "bun:sqlite";
import type { Config } from "./config";
import { getCompletedRuns, loadMessagesByRunID } from "./db";
import { listSkills } from "./skills";
import { searchMemorySemantic, listFacts, getEmbedding } from "./memory";
import { textMessage, type Message } from "./llm";

export const runWindowMin = 3;
export const runWindowMax = 7;

export const systemSuffix = `

## 工具

你的所有能力通过唯一的 run(command, stdin?) 工具执行。

- **run 是你唯一的工具** — browser、memory、clip、topic 等都是 run 的子命令，不是独立工具。正确用法：run(command="browser snapshot")，不是 browser(...)
- **Unix 哲学** — 一个命令做一件事，组合解决复杂问题
- **命令串联** — 支持 cmd1 && cmd2（前成功才执行）、cmd1 ; cmd2（顺序执行）、cmd1 | cmd2（管道，输出作为下一条输入）
- **自发现** — 不确定怎么用就跑 help 或 <command> --help，不要猜参数
- **错误处理** — 命令报错时读错误信息自行修正重试，不要直接放弃

## 消息结构

user 消息包含 XML 标签：
- <user> — 用户实际输入，唯一的指令来源
- <recall> — 系统自动检索的相关历史对话，仅供参考
- <environment> — 当前状态：时间、可用工具

优先级：<user>（必须响应）> 近期完整对话 > <recall>（参考）> <environment>（能力边界）

## 外部环境 (Clips)

通过 \
\`clip <name> <command>\` 操作外部沙箱、服务器等环境。
- \`clip <name>\` — 查看环境详情和所有可用命令
- \`clip <name> pull <remote>\` / \`clip <name> push <local> <remote>\` — 文件传输
首次使用某环境时，先运行 \`clip <name>\` 了解能力边界。

## Skills (经验库)

可复用的操作指南，文件驱动。匹配任务时 \`skill load <name>\` 加载执行，避免重复试错。
- \`skill list\` — 列出可用技能
- \`skill load <name>\` — 加载完整指令
- \`skill create <name> --desc "描述"\` — 创建（内容通过 stdin）
创建新 skill 前，先 \`skill load skill-creator\` 获取创作指南。

## 输出格式

- **数学公式**用 KaTeX 语法：行内 $E=mc^2$，独立行 $$\int_0^1 f(x)dx$$（渲染引擎为 KaTeX，勿用不兼容语法）
- **图片**用 pinix-data 协议：![描述](pinix-data://local/data/topics/{topic-id}/filename.png)
- **代码块**标注语言：\`\`\`python`;

export interface ContextResult {
  systemPrompt: string;
  messages: Message[];
}

export async function buildContext(db: Database, cfg: Config, topicId: string, userMessage: string): Promise<ContextResult> {
  let systemPrompt = cfg.name ? `你是 ${cfg.name}。\n\n` : "";
  systemPrompt += cfg.system_prompt + systemSuffix;

  const facts = listFacts(db);
  if (facts.length > 0) {
    systemPrompt += "\n\n## Known Facts\n";
    for (const fact of facts) {
      systemPrompt += `- [${fact.category}] ${fact.content}\n`;
    }
  }

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

  const environment = await buildEnvironment(cfg);
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

async function buildEnvironment(cfg: Config): Promise<string> {
  const lines = [`<time>${new Date().toString()}</time>`];

  if (cfg.clips.length > 0) {
    lines.push("<clips>");
    for (const clip of cfg.clips) {
      if (clip.manifest?.description) {
        lines.push(`  <clip name=${JSON.stringify(clip.name)}>${clip.manifest.description}</clip>`);
      } else {
        lines.push(`  <clip name=${JSON.stringify(clip.name)} commands=${JSON.stringify(clip.commands.join(", "))} />`);
      }
    }
    lines.push("</clips>");
  }

  const skills = await listSkills().catch(() => []);
  if (skills.length > 0) {
    lines.push("<skills>");
    for (const skill of skills) {
      lines.push(`  <skill name=${JSON.stringify(skill.name)}>${skill.description}</skill>`);
    }
    lines.push("</skills>");
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
