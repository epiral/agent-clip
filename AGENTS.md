# Agent Clip — Development Guide

## Project Overview

Agent Clip is an AI agent packaged as a [Pinix Clip](https://github.com/epiral/pinix). It provides an agentic loop with memory, tool use, and async execution. Built in Go, uses SQLite for persistence, OpenRouter for LLM and embeddings.

## Architecture

### Three-Layer Clip Model

```
Workspace (this repo)  →  Package (.clip ZIP)  →  Instance (Pinix Server)
├── Source code            ├── bin/agent            ├── bin/agent
├── go.mod, Makefile       ├── commands/            ├── commands/
├── seed/                  ├── seed/                ├── data/ (from seed/)
├── commands/              └── clip.yaml            └── clip.yaml
└── clip.yaml
```

- `seed/` contents initialize `data/` on install
- `data/` is the ONLY mutable directory (survives upgrades)
- `bin/` and `data/` are gitignored

### Code Organization

| File | Responsibility |
|------|---------------|
| `cmd/agent/main.go` | CLI entry (cobra), command wiring, sync/async dispatch |
| `internal/loop.go` | Agentic loop: LLM → tool_calls → execute → repeat |
| `internal/context.go` | Context assembly: Run Window, XML wrapping, recall injection |
| `internal/llm.go` | LLM API: streaming, tool support, multimodal/vision messages |
| `internal/tools.go` | Command registry, builtins (memory, topic, grep, etc.) |
| `internal/chain.go` | Command chain parser (`&&`, `;`, `\|`) |
| `internal/memory.go` | Summary generation, semantic/keyword search, facts |
| `internal/embed.go` | Embedding API + cosine similarity (in-process, no vec0) |
| `internal/run.go` | Run lifecycle: create, finish, inject, inbox (SQLite transactions) |
| `internal/clip.go` | External Clip invocation via Connect-RPC + pull/push |
| `internal/fs.go` | File I/O commands: ls, cat, write, stat, rm, cp, mv, mkdir |
| `internal/browser.go` | bb-browser HTTP client + screenshot auto-save + vision |
| `internal/db.go` | SQLite: topics, messages, schema migration |
| `internal/config.go` | Config loading from `data/config.yaml` |
| `internal/output.go` | Output interface: CLIOutput (raw) / JSONLOutput (jsonl) |

### Key Design Decisions

1. **One function call**: LLM has a single `run(command, stdin?)` tool. All capabilities are Unix-style commands routed through a Registry.

2. **Process-per-invocation**: Each `send` is a fresh process (no daemon). State lives in SQLite. Context rebuilt from DB every time.

3. **Run Window 3→7**: Recent 3-7 Runs loaded as full messages, older Runs as summaries. Optimized for prompt cache (~80% hit rate).

4. **Atomic inject**: SQLite transactions prevent race conditions between inject and Run finish. Messages never lost.

5. **Dual output**: Every command works for both CLI (raw) and Web (jsonl) via the Output interface.

6. **Vision auto-attach**: Browser screenshots auto-save to `data/images/` and are attached as base64 vision content to tool result messages. The LLM can "see" every screenshot it takes.

7. **Image rendering**: Images in `data/images/` are referenced via `pinix-data://local/data/images/...` URLs. Clip Dock handles the protocol via ReadFile RPC. Streamdown renders `![](pinix-data://...)` natively (rehype-sanitize schema extended).

## Development

### Build & Test

```bash
make build          # go build → bin/agent
make dev            # build + init data/ from seed/
make clean          # rm bin/ data/

# Manual test
commands/send -p "hello"
commands/send -p "hello" --output jsonl
```

### Adding a New Internal Command

1. In `internal/tools.go`, add to `registerBuiltins()` or create a new `Register*Commands()` function:

```go
r.Register("mycommand", "Description for LLM", func(args []string, stdin string) (string, error) {
    // args = parsed from command string
    // stdin = from run(command, stdin) second parameter or pipe
    return "output", nil
})
```

2. Register in `cmd/agent/main.go` `buildRegistry()` if it needs DB/Config access.

### Adding a New External Command

1. Create `commands/mycommand`:
```sh
#!/bin/sh
exec "$(dirname "$0")/../bin/agent" mycommand "$@"
```

2. Add the cobra subcommand in `cmd/agent/main.go`.
3. Use `out := getOutput()` for all output — never write directly to stdout/stderr.

### Database Changes

1. Update `seed/schema.sql` with new tables/columns.
2. For migrations on existing DBs, add `db.Exec("ALTER TABLE ...")` in `OpenDB()` (see `internal/db.go` for examples).

## Conventions

### Git

- Commit message: `<type>(<scope>): <summary>` (English)
- Types: `feat`, `fix`, `refactor`, `perf`, `chore`, `docs`
- Always verify build passes before committing

### Code Style

- Go standard formatting (`gofmt`)
- Error messages: lowercase, no period
- Public functions: document with `//` comment
- Internal helpers: unexported (lowercase)

### Output

- All user-facing output goes through the `Output` interface
- Never `fmt.Print` directly in command handlers
- `Info()` for metadata, `Result()` for structured data, `Text()` for streaming
- JSONL types: `info`, `result`, `text`, `tool_call`, `tool_result`, `inject`, `done`

### Command Design

- Accept both `-p "msg"` flags and stdin JSON (for Pinix compatibility)
- Default limits on list commands (show "X of Y" counts)
- Support command chaining via `|`, `&&`, `;`
- Use `run_id` not sequence numbers for stable references
