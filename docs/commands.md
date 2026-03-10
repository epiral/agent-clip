# Commands Reference

## External Commands (Pinix interface)

These are files in `commands/` — invocable via Pinix `ClipService.Invoke`. Each is a shell wrapper to `bin/agent <subcommand>`.

All commands support `--output raw` (default, CLI) or `--output jsonl` (Web).

### send

Send a message and run the agentic loop.

```bash
send -p "hello"                        # new topic, sync
send -p "hello" -t abc123              # continue in topic
send -p "hello" --async                # background
send -p "hello" -t abc123 --async      # background in topic
send -p "more info" -r a1b2c3          # inject into active run
echo '{"message":"hi"}' | send         # stdin JSON (Pinix protocol)
echo '{"message":"hi","topic_id":"abc"}' | send
```

| Flag | Description |
|------|-------------|
| `-p, --payload` | Message text |
| `-t, --topic` | Topic ID (auto-creates if omitted) |
| `-r, --run` | Run ID for injection |
| `--async` | Run in background |

### create-topic

```bash
create-topic -n "project discussion"
echo '{"name":"project discussion"}' | create-topic
```

### list-topics

```bash
list-topics
list-topics --output jsonl
```

Returns topics sorted by `last_message_at` DESC. Each topic includes `last_message_at` timestamp.

### get-run

```bash
get-run <run-id>
```

Shows run status and output (for async runs).

### cancel-run

```bash
cancel-run <run-id>
```

Sends SIGTERM to the worker process and marks the run as cancelled.

---

## Internal Commands (LLM tools via `run`)

The LLM has a single function call: `run(command, stdin?)`. These commands are available inside the agentic loop.

### Command Chaining

Commands can be chained:

```
cmd1 | cmd2       # pipe: cmd1's output → cmd2's stdin
cmd1 && cmd2      # sequential: cmd2 runs only if cmd1 succeeds
cmd1 ; cmd2       # independent: cmd2 runs regardless
```

### File I/O

Standard Linux-named commands operating on the `data/` directory:

```
ls [dir]                   List files (default: data/ root)
cat <path>                 Read file content (text)
cat -b <path>              Read file as base64 (binary)
write <path> [content]     Write text (content from args or stdin)
write -b <path>            Write binary (stdin: base64, auto-detects images)
stat <path>                File info (size, MIME, modified time)
rm <path>                  Remove file or directory
cp <src> <dst>             Copy file
mv <src> <dst>             Move/rename file
mkdir <dir>                Create directory (mkdir -p)
```

Image files saved via `write -b` return a rendering tip:
```
> write -b images/screenshot.png (stdin: base64)

Written 145KB → images/screenshot.png
Render: ![image](pinix-data://local/data/images/screenshot.png)
```

### memory

```
memory search <query>              Search across all topics (semantic + keyword)
memory search <query> -t <id>      Search within a specific topic
memory search <query> -k <word>    Post-filter results by keyword
memory recent [n]                  Show recent n summaries (default 5)
memory store <note>                Store a persistent fact
memory facts                       List all stored facts
memory forget <id>                 Delete a fact by ID
```

### topic

```
topic list [limit]                 List topics (default 10, newest first)
topic info <id>                    Topic details + last 5 runs
topic runs <id> [limit]            List runs with summaries (default 10)
topic run <run-id>                 Show run's full messages
topic search <id> <query>          Search within a topic's runs
topic rename <id> <new-name>       Rename a topic
```

### clip

```
clip list                          List connected clips
clip <name> <command> [args...]    Invoke a clip's command
clip <name> pull <remote> [name]   Pull file from clip to local data/
clip <name> push <local> <remote>  Push local file to clip
```

Examples:
```
clip sandbox bash ls -la           Execute shell in sandbox VM
clip sandbox read /tmp/file.txt    Read file from sandbox
clip sandbox write /tmp/f.txt      Write (stdin = content)
clip sandbox edit /tmp/f.txt "old" "new"
clip sandbox pull /tmp/chart.png   Pull image → data/images/chart.png
clip sandbox push notes/data.csv /tmp/data.csv
```

### browser

```
browser open <url>                 Open URL in current tab
browser screenshot                 Take screenshot (auto-saves to data/images/, returns pinix-data:// URL)
browser snapshot                   Get page DOM tree with element refs
browser click <ref>                Click element by ref number
browser fill <ref> <text>          Fill input field
browser type <text>                Type at current focus
browser press <key>                Press key (Enter, Escape, etc.)
browser scroll <direction>         Scroll (up/down/left/right)
browser eval <script>              Execute JavaScript
browser get <ref> <attr>           Get element attribute (text/url/title)
browser tab_list                   List tabs
browser tab_new [url]              New tab
browser close                      Close tab
```

Screenshots are auto-saved to `data/images/screenshot-{timestamp}.png` and the image is automatically attached as vision content to the LLM API call, allowing the LLM to "see" the screenshot.

### Text Processing

```
grep [-i] [-v] [-c] <pattern>     Filter lines matching pattern
head [n]                           Show first n lines (default 10)
tail [n]                           Show last n lines (default 10)
wc [-l|-w|-c]                      Count lines/words/chars
```

Best used with pipes:
```
clip sandbox bash ls /etc | grep conf | head 5
topic list | grep Go
help | grep memory
memory recent | wc -l
```

### Utilities

```
echo [text]                        Echo text (or stdin)
time                               Current time
help                               List all available commands
```

---

## JSONL Output Protocol

When `--output jsonl` is used, all output is JSON Lines on stdout:

| Type | Fields | When |
|------|--------|------|
| `info` | `message` | Metadata (topic created, run started, etc.) |
| `text` | `content` | LLM streaming token |
| `thinking` | `content` | LLM thinking/reasoning token |
| `tool_call` | `name`, `arguments` | LLM invokes a tool |
| `tool_result` | `content` | Tool execution result |
| `inject` | `content` | Injected message received |
| `result` | `data` | Structured result (create-topic, list-topics) |
| `done` | | Run completed |

Example stream:
```jsonl
{"type":"info","message":"[topic] abc (hello)"}
{"type":"tool_call","name":"run","arguments":"{\"command\":\"browser screenshot\"}"}
{"type":"tool_result","content":"Title: X\nRender: ![screenshot](pinix-data://local/data/images/screenshot-xxx.png)"}
{"type":"text","content":"Here's "}
{"type":"text","content":"the screenshot."}
{"type":"done"}
```
