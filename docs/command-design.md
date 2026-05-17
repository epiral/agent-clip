# Command Design

Agent Clip 命令体系重设计。资源导向 + 统一 response + 场景驱动查询。

资源关系图见 [resource-model.puml](resource-model.puml)。

---

## 1. 设计准则

### 命令暴露准则

| 准则 | 说明 |
|------|------|
| **P1. 资源独立性** | 有独立生命周期 → 暴露为顶层命令；仅作为父资源实现细节 → 隐藏 |
| **P2. 消费者需求** | UI 需要 → Clip Command；仅 Agent 需要 → Tool Registry；两者都要 → 两层都暴露 |
| **P3. 可预测性** | `{resource} {verb}` 结构；动词标准化: list / get / create / update / delete；特殊: fork / cancel / search / send |
| **P4. 最小暴露** | 内部状态转换 (RunInbox drain) → 不暴露；派生数据 (Summary) → 只暴露读；自动管理的生命周期 → 不暴露写 |

### Response 规范

| 规范 | 说明 |
|------|------|
| **R1. 统一信封** | 单资源: `{ data: T }`，列表: `{ data: T[], has_more, cursor? }`，删除: `{ id }`，流式: JSONL `{ type, ... }`，错误: `{ error: { code, message } }` |
| **R2. 返回完整资源** | create / update / cancel → 返回变更后的完整对象，不返回 `{ ok: true }` |
| **R3. 列表声明分页** | 每个 list 都返回 `has_more`，使用 cursor-based 分页 |
| **R4. snake_case** | 所有 JSON 字段 snake_case，与 DB 一致 |
| **R5. Tool 响应独立** | 给 LLM 的是结构化文本，非 JSON，与 Clip Command 不混用 |

### 分页准则

| 准则 | 说明 |
|------|------|
| **F1. cursor-based** | 输入: `--limit N --cursor <opaque>`，输出: `{ data, has_more, cursor? }`。不用 offset（实时数据漂移）。cursor 内部编码 `base64({ sort_field, id })`，消费者不解析 |
| **F2. 小集合全量** | Agent / Clip 预期 < 100 → `{ data: T[] }`，仍遵循信封格式 |
| **F3. 搜索用 limit** | 搜索按相关度排序，越往后越不相关，top-K 即可 |

### 排序策略

固定排序，不暴露 `sort_by`。单用户本地 agent，数据量有限；UI 如需多种视图 → 全量加载后内存排序。

| 资源 | 固定排序 | 理由 |
|------|---------|------|
| topic list | `last_message_at DESC` | 活跃对话优先 |
| topic search | `relevance DESC` | 搜索相关度 |
| topic get (消息) | `id ASC` | 时间正序阅读 |
| run list | `started_at DESC` | 最近执行优先 |
| event list | `next_run_at ASC` | 即将触发优先 |
| agent list | `created_at DESC` | 最近创建优先 |
| memory search | `similarity DESC` | 语义相关度 |

---

## 2. 暴露分析

谁用什么：

| 资源 | Clip Command (外部 API) | Tool Registry (Agent) | 理由 |
|------|------------------------|----------------------|------|
| Agent | CRUD | -- | UI 管理，Agent 不自操作 |
| Topic | CRUD + fork + search | list / get / rename / search / fork | 核心容器，两者都需要 |
| Run | get / list / cancel | get | 由 send 自动创建，不需外部 create |
| Message | -- (嵌套在 topic get) | -- | 不独立暴露 |
| (send) | message send | -- | message.create 的语义抬升 |
| Summary | -- | memory search / recent | 自动生成，Agent 搜索记忆 |
| Event | CRUD | CRUD | 独立生命周期，两者都需管理 |
| RunInbox | -- | -- | send --run 的实现细节 |
| Config | get / set / delete | get / set / delete | 两者都需要 |
| Clip | list | list / pin / unpin / info / search | UI 展示，Agent 运行时管理 |

---

## 3. 用户场景驱动的查询设计

从"用户会问什么"出发，而非从现有代码出发。

### Web UI / iOS 用户

| 场景 | 需要的查询能力 |
|------|--------------|
| "那个讨论 X 的对话在哪？" | 跨话题全文搜索 → **topic search** |
| "给我看 coder agent 的对话" | 按 agent 筛选 → **topic list --agent_id** |
| "哪些对话还在跑？" | 按活跃状态筛选 → **topic list --status active** |
| "只看某轮对话的消息" | 按 run 筛选 → **topic get --run_id** |
| "这个话题出过错吗？" | 按 status 筛选 → **run list --status error** |
| "看看所有失败的 run" | 跨话题 run 查询 → **run list --status error** (不传 topic_id) |
| "这个 agent 有多少对话？" | 关联统计 → **agent list** 返回 topic_count |
| "我有哪些活跃的定时任务？" | 按状态筛选 → **event list --status scheduled** |

### LLM Agent

| 场景 | 需要的查询能力 |
|------|--------------|
| "之前聊过什么类似的？" | 语义记忆搜索 → **memory search** |
| "最近几次对话的摘要" | 最近摘要 → **memory recent** |
| "这个话题之前聊了什么？" | 话题内搜索 → **topic search \<id\> \<query\>** (tool) |
| "有哪些可用工具？" | Clip 列表/搜索 → **pkg list / search** |

---

## 4. 各资源查询参数

### topic list

| 参数 | 类型 | 说明 |
|------|------|------|
| `--limit` | number | 每页数量 (默认 20) |
| `--cursor` | string | 分页游标 |
| `--agent_id` | string | 按 Agent 筛选 |
| `--status` | string | `active` / `idle` / `all` (默认 all)。active = 有 running 的 run |
| `--query` | string | 模糊搜索话题名 (LIKE) |

排序: `last_message_at DESC`

### topic search (新增)

| 参数 | 类型 | 说明 |
|------|------|------|
| `--query` | string | **必填** 搜索词 |
| `--agent_id` | string | 限定 Agent 范围 |
| `--limit` | number | 结果数 (默认 10) |

搜索范围: `summaries_fts` + `topics.name`。排序: `relevance DESC`。返回: `{ data: [{ topic, matches[] }] }`。

与 `memory search` 的区别：
- **topic search** → 面向 UI，返回 topic 维度，给人看
- **memory search** → 面向 Agent，返回 summary 维度，给 LLM 看

### topic get (含内嵌消息)

| 参数 | 类型 | 说明 |
|------|------|------|
| `<id>` | string | **必填** topic_id |
| `--limit` | number | 消息数 (默认 50) |
| `--cursor` | string | 消息分页游标 (向上翻页) |
| `--run_id` | string | 只看某个 Run 的消息 |

消息排序: `id ASC`。分页方向: 最新 → 最旧 (cursor = oldest_id)。

### run list

| 参数 | 类型 | 说明 |
|------|------|------|
| `--topic_id` | string | 所属话题 (不传则跨话题) |
| `--status` | string | `running` / `done` / `error` / `all` |
| `--limit` | number | 每页数量 (默认 20) |
| `--cursor` | string | 分页游标 |

排序: `started_at DESC`。跨话题查询时返回 `topic_id` + `topic_name`。

### event list

| 参数 | 类型 | 说明 |
|------|------|------|
| `--topic_id` | string | 按话题筛选 |
| `--status` | string | `scheduled` / `canceled` / `done` / `all` (默认 scheduled) |
| `--limit` | number | 每页数量 (默认 20) |
| `--cursor` | string | 分页游标 |

排序: `next_run_at ASC`。

### agent list

全量返回 `{ data: Agent[] }`，每个 Agent 附带 `topic_count`。排序: `created_at DESC`。不分页。

### clip list

全量返回 `{ data: Clip[] }`。不分页。

### memory search (Tool Registry)

| 参数 | 类型 | 说明 |
|------|------|------|
| `<query>` | string | **必填** 搜索文本 |
| `--topic` | string | 限定话题 |
| `--keyword` | string | 叠加关键词过滤 |
| `--limit` | number | 结果数 (默认 5) |

排序: `similarity DESC`。不分页 (top-K)。搜索策略: semantic (vec) → keyword (FTS5) fallback。

---

## 5. 完整命令清单

### Clip Commands (外部 API)

```
topic
├── create   --name, --agent_id?
│   → { data: Topic }
├── list     --limit?, --cursor?, --agent_id?, --status?, --query?
│   → { data: TopicSummary[], has_more, cursor? }
├── search   --query, --agent_id?, --limit?
│   → { data: [{ topic, matches[] }] }
├── get      <id> --limit?, --cursor?, --run_id?
│   → { data: { topic, agent?, messages[], active_run? }, has_more, cursor? }
├── delete   <id>
│   → { id }
├── update   <id> --name
│   → { data: Topic }
└── fork     <id> --run_id?, --name?
    → { data: Topic }

run
├── get      <id>
│   → { data: RunInfo }
├── list     --topic_id?, --status?, --limit?, --cursor?
│   → { data: RunInfo[], has_more, cursor? }
└── cancel   <id>
    → { data: Run }

agent
├── create   --name, --model?, --provider?, --max_tokens?, --system_prompt?, --scope?, --pinned?
│   → { data: Agent }
├── list
│   → { data: Agent[] }
├── get      <id>
│   → { data: Agent }
├── update   <id> --name?, --model?, ...
│   → { data: Agent }
└── delete   <id>
    → { id }

event
├── create   --topic_id, --prompt, --schedule_kind, --schedule_value, --tz?
│   → { data: Event }
├── list     --topic_id?, --status?, --limit?, --cursor?
│   → { data: Event[], has_more, cursor? }
├── update   <id> --prompt?, --tz?
│   → { data: Event }
└── cancel   <id>
    → { data: Event }

config
├── get
│   → { data: Config }
├── set      <key> <value>
│   → { data: Config }
└── delete   <key>
    → { data: Config }

clip
└── list
    → { data: Clip[] }

message
└── send     --topic_id?, --message, --agent_id?, --context?, --async?
    → stream: JSONL { type, ... }
    → --async: { data: Run }

attachment
└── upload   (stdin: name, mime, data, topic_id)
    → { data: { path, size, topic_id } }
```

### Tool Registry (LLM Agent 内部)

```
memory
├── search   <query> --topic? --keyword? --limit?
└── recent   [n]

topic
├── list     [limit]
├── info     <id>
├── runs     <id> [limit]
├── run      <run_id>
├── rename   <id> <name>
├── search   <id> <query>
└── fork     <id> <run_id> [name]

event
├── create   once|daily --prompt --at/--time --topic? --tz?
├── list     --topic? --all?
├── update   <id> --prompt? --tz?
└── cancel   <id>

config
├── (show)
├── set      <key> <value>
└── delete   <key>

pkg
├── list
├── search   <query>
├── pin      <clip>
├── unpin    <clip>
└── info     <clip>

<clip-name>  <command> [--params]
```

---

## 6. 迁移映射

### 命令重命名

| 现有 | 新 | 变更 |
|------|-----|------|
| `send` | `message send` | 归入 message 资源 |
| `create-topic` | `topic create` | 资源前置 |
| `list-topics` | `topic list` | 资源前置 + 加分页/筛选 |
| `get-topic` | `topic get` | 资源前置 |
| `delete-topic` | `topic delete` | 资源前置 |
| `topic-fork` | `topic fork` | 命名一致化 |
| `get-run` | `run get` | 资源前置 |
| `cancel-run` | `run cancel` | 资源前置 |
| (无) | `run list` | 新增 |
| (无) | `topic search` | 新增 |
| (无) | `topic update` | 新增 (原 tool-only rename) |
| `config` | `config get` | 显式动词 |
| `upload` | `attachment upload` | 明确资源 |
| `list-clips` | `clip list` | 资源前置 |
| `agent *` | `agent *` | 不变 |

### Response 变更

| 现有 | 新 |
|------|-----|
| 裸数组 `[]` | `{ data: [], has_more }` |
| 裸对象 `{}` | `{ data: {} }` |
| `{ id, deleted: true }` | `{ id }` |
| `{ id, status: "cancelled" }` | `{ data: Run }` (完整资源) |
| `"key = value"` (字符串) | `{ data: Config }` (完整 config) |
| list-topics 无分页元数据 | cursor + has_more |

### 不变的

- Tool Registry 输出格式 (纯文本) → 保持不变
- send 流式 JSONL → 保持不变 (type 字段已自描述)
- snake_case JSON 字段 → 保持不变

---

## 7. 现有问题清单

### 格式不一致
1. list-topics 返回裸数组，无分页元数据
2. agent list 无分页
3. delete 响应: `{ id, deleted: true }` vs cancel: `{ id, status }`
4. config set 返回字符串 `"key = value"`，不返回资源
5. get-run 用 `Record<string,unknown>`，无类型

### 路由不一致
6. delete-topic 不在 CLI router
7. run 命令 (测试) 不在 IPC router
8. event-check 独立于两套路由

### 命名不一致
9. create-topic (verb-noun) vs topic-fork (noun-verb)
10. list-topics (复数) vs list-clips (复数) vs get-topic (单数)

### Dead code
11. Fact 表: schema 存在，代码未使用
12. FS commands: `registerFSCommands` 从未调用

### 缺失
13. run list -- 无法按 topic 列出历史 runs (仅内部有)
14. topic update/rename -- 外部 API 无此命令
15. topic search -- 无跨话题全文搜索
16. topic list -- 无 agent_id / status 筛选

### 需要新增的索引
17. `topics(agent_id)` -- 支撑 topic list --agent_id
18. `runs(status, started_at)` -- 支撑跨话题 run list --status
