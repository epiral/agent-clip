# Agent Clip

AI Agent as a [Pinix Clip](https://github.com/epiral/pinix) — agentic loop with memory, tool use, vision, and async execution.

## Quick Start

```bash
# Local development
make dev                              # build macOS binary + init data/
cd ui && pnpm install && cd ..        # install frontend deps (first time)

# Add your API key to data/config.yaml

# Chat
bin/agent-local send -p "hello"

# Build frontend
make ui                               # ui/ → web/
```

## Build & Deploy

```bash
# Development (workdir mode — Pinix reads repo directly)
make deploy                           # cross-compile linux/arm64 + build frontend

# Production (package for remote install)
make package                          # → dist/agent.clip
pinix clip install dist/agent.clip    # first time
pinix clip upgrade dist/agent.clip    # update (preserves data/)
```

| Make target | What it does |
|-------------|-------------|
| `make build-local` | Go binary for macOS |
| `make build` | Go binary for BoxLite VM (linux/arm64) |
| `make ui` | Build frontend `ui/` → `web/` |
| `make dev` | `build-local` + init `data/` from `seed/` |
| `make deploy` | `build` + `ui` (workdir mode, changes are live) |
| `make package` | ZIP → `dist/agent.clip` for `pinix clip install/upgrade` |
| `make clean` | Remove `bin/` `data/` `web/` `dist/` |

## Architecture

```
Agent Clip (this repo)
  │
  ├─ commands/          External interface (Pinix ClipService.Invoke)
  │   send, create-topic, list-topics, get-run, cancel-run, config
  │
  ├─ run(cmd, stdin?)   Single LLM function call
  │   ├─ File I/O:  ls, cat, write, stat, rm, cp, mv, mkdir
  │   ├─ Memory:    memory search/recent/store/facts/forget
  │   ├─ Topics:    topic list/info/runs/run/search/rename
  │   ├─ Clips:     clip <name> <command> [args...] / pull / push
  │   ├─ Browser:   browser <action> [params...] (auto-saves screenshots)
  │   ├─ Chaining:  cmd1 | cmd2 && cmd3 ; cmd4
  │   └─ Utils:     echo, time, help, grep, head, tail, wc
  │
  ├─ Topics             Named conversation namespaces (SQLite)
  ├─ Runs               One agentic loop per send (sync / async)
  ├─ Memory             Summaries + embeddings + facts + semantic search
  ├─ Vision             Browser screenshots auto-attached as vision content
  ├─ Images             pinix-data:// URLs for in-chat image rendering
  └─ Output             CLI (raw) / Web (jsonl) dual interface
```

## Core Concepts

### Topic

A named conversation namespace. All messages belong to a topic. Created automatically on first `send`, or explicitly via `create-topic`. Topics are sorted by last message time.

### Run

A single agentic loop cycle — from user message to LLM's `finish_reason: "stop"`. A Run may involve multiple LLM calls and tool executions. Runs within a topic form the conversation history.

### Memory

Three layers:
- **Facts** — persistent knowledge (`memory store/facts/forget`)
- **Summaries** — LLM-generated per-Run summary + embedding
- **Semantic search** — cosine similarity over summary embeddings

### Clip

External capabilities invoked via `run("clip <name> <command> [args...]")`. Each Clip is a separate service registered in `data/config.yaml`. Uses Pinix ClipService.Invoke protocol. Supports `clip pull/push` for cross-Clip file transfer.

### File I/O

Standard Linux-named commands (`ls`, `cat`, `write`, `stat`, `rm`, `cp`, `mv`, `mkdir`) operating on the `data/` directory. Image files saved via `write -b` return a `pinix-data://` URL for in-chat rendering.

### Vision

Browser screenshots are automatically saved to `data/images/` and attached as vision content to the LLM API call. The LLM can "see" screenshots it takes. Image URLs use `pinix-data://local/data/...` format for rendering in Clip Dock.

## Commands

### External (Pinix interface)

| Command | Usage | Description |
|---------|-------|-------------|
| `send` | `-p "msg" [-t topic] [-r run] [--async]` | Send message, run agentic loop |
| `create-topic` | `-n "name"` | Create a conversation topic |
| `list-topics` | | List all topics (sorted by last message time) |
| `get-run` | `<run-id>` | Show run status and output |
| `cancel-run` | `<run-id>` | Cancel an active run |
| `config` | `[set <key> <value>]` | View or update config |

### Internal (LLM tools via `run`)

| Command | Description |
|---------|-------------|
| `ls [dir]` | List files in data/ |
| `cat <path>` | Read file (`-b` for base64 output) |
| `write <path> [content]` | Write file (`-b` for base64 input, returns `pinix-data://` URL for images) |
| `stat <path>` | File info (size, MIME, mtime) |
| `rm <path>` | Remove file |
| `cp <src> <dst>` | Copy file |
| `mv <src> <dst>` | Move/rename file |
| `mkdir <dir>` | Create directory |
| `memory search <query> [-t id] [-k keyword]` | Semantic + keyword search |
| `memory recent [n]` | Recent conversation summaries |
| `memory store <note>` | Store a persistent fact |
| `memory facts` | List all facts |
| `memory forget <id>` | Delete a fact |
| `topic list [limit]` | List topics (default 10, newest first) |
| `topic info <id>` | Topic details + run history |
| `topic runs <id> [limit]` | List runs with summaries |
| `topic run <run-id>` | Show run's full messages |
| `topic search <id> <query>` | Search within a topic |
| `topic rename <id> <name>` | Rename a topic |
| `clip list` | List connected clips |
| `clip <name> <command> [args]` | Invoke a clip |
| `clip <name> pull <remote> [local]` | Pull file from clip to local data/ |
| `clip <name> push <local> <remote>` | Push local file to clip |
| `browser <action> [params]` | Control remote browser (screenshot auto-saves + vision) |
| `config [set <key> <value>]` | View/update agent config |
| `echo`, `time`, `help` | Utilities |
| `grep`, `head`, `tail`, `wc` | Text processing (pipe-friendly) |

## Image Rendering

Images saved to `data/images/` are rendered in the chat UI via `pinix-data://` protocol:

```
# Agent saves image
write -b images/chart.png    (stdin: base64)
→ "Written 32KB → images/chart.png
   Render: ![image](pinix-data://local/data/images/chart.png)"

# LLM uses the URL in its response
![chart](pinix-data://local/data/images/chart.png)

# Browser screenshots auto-save and return pinix-data:// URLs
browser screenshot
→ "Title: ...  Render: ![screenshot](pinix-data://local/data/images/screenshot-xxx.png)"
```

The `pinix-data://` protocol is handled by Clip Dock (Desktop/iOS), which fetches files via Pinix `ReadFile` RPC.

## Web UI

Built with React + Vite + Tailwind CSS v4. Markdown rendering via [Streamdown](https://github.com/vercel/streamdown) (Vercel) with plugins:

- **@streamdown/code** — Shiki syntax highlighting
- **@streamdown/cjk** — CJK typography optimization
- **@streamdown/math** — LaTeX equations (KaTeX)
- **@streamdown/mermaid** — Mermaid diagrams

## Configuration

`data/config.yaml` — multi-provider, managed via `config` command:

```yaml
name: pi
providers:
  openrouter:
    base_url: https://openrouter.ai/api/v1
    api_key: <key>

llm_provider: openrouter
llm_model: anthropic/claude-3.5-haiku
embedding_provider: openrouter
embedding_model: openai/text-embedding-3-small

system_prompt: |
  Your system prompt here.

clips:
  - name: sandbox
    url: http://localhost:9875
    token: <clip-token>
    commands: [bash, read, read-b64, write, write-b64, edit]

browser:
  endpoint: http://localhost:19824
```

## Directory Structure

```
agent-clip/
├── clip.yaml              # Pinix Clip metadata
├── Makefile
│
├── commands/              # External interface (shell wrappers → bin/agent)
│   ├── send
│   ├── create-topic
│   ├── list-topics
│   ├── get-run
│   ├── cancel-run
│   └── config
│
├── seed/                  # Template for data/ (schema + default config)
│   ├── schema.sql
│   └── config.yaml
│
├── cmd/agent/main.go      # CLI entry point (cobra)
├── internal/              # Go packages
│   ├── browser.go         # bb-browser HTTP client + screenshot auto-save
│   ├── chain.go           # Command chaining (&&, ;, |)
│   ├── clip.go            # Clip-to-Clip invocation + pull/push
│   ├── config.go          # Multi-provider config + CLI
│   ├── context.go         # Context building (Run Window, XML)
│   ├── db.go              # SQLite operations
│   ├── embed.go           # Embedding API + cosine similarity
│   ├── fs.go              # File I/O commands (ls, cat, write, stat, rm, cp, mv, mkdir)
│   ├── llm.go             # LLM streaming + tool calls + vision (multimodal)
│   ├── loop.go            # Agentic loop engine + image extraction for vision
│   ├── memory.go          # Summary, search, facts
│   ├── output.go          # CLI / JSONL dual output
│   ├── run.go             # Run lifecycle + atomic inject
│   └── tools.go           # Command registry + builtins
│
├── ui/                    # Frontend (Vite + React + Tailwind v4 + Streamdown)
│   ├── src/
│   ├── vite.config.ts     # builds to ../web/
│   └── package.json
│
├── web/                   # Build output (gitignored)
├── docs/                  # Design docs
├── bin/                   # Compiled Go binary (gitignored)
└── data/                  # Runtime data (gitignored)
    ├── agent.db
    ├── config.yaml
    └── images/            # Screenshots and saved images
```

### Three-layer model

| Layer | What | Mutable |
|-------|------|---------|
| **Workspace** (this repo) | Source code, build tools | dev time |
| **Package** (`.clip` ZIP) | `clip.yaml` + `commands/` + `bin/` + `seed/` + `web/` | immutable |
| **Instance** (on Pinix Server) | Package extracted + `data/` from `seed/` | `data/` only |

`seed/` initializes `data/` on install; `clip upgrade` replaces everything except `data/`.
