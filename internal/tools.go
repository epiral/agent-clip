package internal

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// tokenize splits a command string by whitespace, respecting single and double quotes.
// Quotes are stripped from the result: "hello world" → hello world.
func tokenize(input string) []string {
	var tokens []string
	var current strings.Builder
	inQuote := false
	var quoteChar rune

	for _, ch := range input {
		if inQuote {
			if ch == quoteChar {
				inQuote = false
			} else {
				current.WriteRune(ch)
			}
			continue
		}

		if ch == '\'' || ch == '"' {
			inQuote = true
			quoteChar = ch
			continue
		}

		if ch == ' ' || ch == '\t' {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			continue
		}

		current.WriteRune(ch)
	}

	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}

	return tokens
}

func RunToolDef(commands map[string]string) ToolDef {
	var desc strings.Builder
	desc.WriteString("Your ONLY tool. Execute commands via run(command=\"...\"). Supports chaining: cmd1 && cmd2, cmd1 | cmd2.\n\nAvailable commands:\n")
	for name, help := range commands {
		fmt.Fprintf(&desc, "  %s — %s\n", name, help)
	}

	return ToolDef{
		Type: "function",
		Function: ToolFunctionDef{
			Name:        "run",
			Description: desc.String(),
			Parameters: json.RawMessage(`{
				"type": "object",
				"properties": {
					"command": {
						"type": "string",
						"description": "Unix-style command to execute"
					},
					"stdin": {
						"type": "string",
						"description": "Standard input for the command"
					}
				},
				"required": ["command"]
			}`),
		},
	}
}

type CommandHandler func(args []string, stdin string) (string, error)

type Registry struct {
	handlers map[string]CommandHandler
	help     map[string]string
}

func NewRegistry() *Registry {
	r := &Registry{
		handlers: make(map[string]CommandHandler),
		help:     make(map[string]string),
	}
	r.registerBuiltins()
	return r
}

func (r *Registry) Register(name, description string, handler CommandHandler) {
	r.handlers[name] = handler
	r.help[name] = description
}

func (r *Registry) Help() map[string]string {
	return r.help
}

func (r *Registry) Exec(command, stdin string) string {
	segments := ParseChain(command)
	if len(segments) == 0 {
		return "[error] empty command"
	}

	var collected []string // accumulated outputs for && and ;
	var lastOutput string
	var lastErr bool
	pipeInput := stdin

	for i, seg := range segments {
		// && semantics: skip if previous failed
		if i > 0 && segments[i-1].Op == OpAnd && lastErr {
			break
		}

		// determine stdin for this segment
		segStdin := ""
		if i == 0 {
			segStdin = pipeInput
		} else if segments[i-1].Op == OpPipe {
			segStdin = lastOutput
		}

		lastOutput, lastErr = r.execSingle(seg.Raw, segStdin)

		// pipe: output flows to next command's stdin, don't collect yet
		// && or ;: collect output (like shell concatenates stdout)
		if i < len(segments)-1 && seg.Op == OpPipe {
			// piping — lastOutput will be next command's stdin
			continue
		}
		if lastOutput != "" {
			collected = append(collected, lastOutput)
		}
	}

	return strings.Join(collected, "\n")
}

func (r *Registry) execSingle(command, stdin string) (string, bool) {
	parts := tokenize(command)
	if len(parts) == 0 {
		return "[error] empty command", true
	}

	name := parts[0]
	args := parts[1:]

	handler, ok := r.handlers[name]
	if !ok {
		available := make([]string, 0, len(r.handlers))
		for n := range r.handlers {
			available = append(available, n)
		}
		return fmt.Sprintf("[error] unknown command: %s\nAvailable: %s", name, strings.Join(available, ", ")), true
	}

	out, err := handler(args, stdin)
	if err != nil {
		return fmt.Sprintf("[error] %s: %v", name, err), true
	}
	return out, false
}

func (r *Registry) registerBuiltins() {
	r.Register("echo", "Echo back the input", func(args []string, stdin string) (string, error) {
		if stdin != "" {
			return stdin, nil
		}
		return strings.Join(args, " "), nil
	})

	r.Register("time", "Return the current time", func(args []string, stdin string) (string, error) {
		return time.Now().Format("2006-01-02 15:04:05 MST"), nil
	})

	r.Register("help", "List available commands", func(args []string, stdin string) (string, error) {
		var b strings.Builder
		for name, desc := range r.help {
			fmt.Fprintf(&b, "  %s — %s\n", name, desc)
		}
		return b.String(), nil
	})

	r.Register("grep", "Filter lines matching a pattern (supports -i, -v, -c)", func(args []string, stdin string) (string, error) {
		if len(args) == 0 {
			return "", fmt.Errorf("usage: grep [-i] [-v] [-c] <pattern>")
		}
		ignoreCase := false
		invert := false
		countOnly := false
		var pattern string
		for _, a := range args {
			switch a {
			case "-i":
				ignoreCase = true
			case "-v":
				invert = true
			case "-c":
				countOnly = true
			default:
				pattern = a
			}
		}
		if pattern == "" {
			return "", fmt.Errorf("pattern required")
		}
		if ignoreCase {
			pattern = strings.ToLower(pattern)
		}

		lines := strings.Split(stdin, "\n")
		var matched []string
		for _, line := range lines {
			haystack := line
			if ignoreCase {
				haystack = strings.ToLower(line)
			}
			match := strings.Contains(haystack, pattern)
			if invert {
				match = !match
			}
			if match {
				matched = append(matched, line)
			}
		}
		if countOnly {
			return fmt.Sprintf("%d", len(matched)), nil
		}
		return strings.Join(matched, "\n"), nil
	})

	r.Register("head", "Show first N lines (default 10). Usage: head 5 or head -n 5", func(args []string, stdin string) (string, error) {
		n := 10
		for i, a := range args {
			if a == "-n" && i+1 < len(args) {
				fmt.Sscanf(args[i+1], "%d", &n)
			} else {
				cleaned := strings.TrimLeft(a, "-")
				if v, err := strconv.Atoi(cleaned); err == nil && v > 0 {
					n = v
				}
			}
		}
		lines := strings.Split(stdin, "\n")
		if n > 0 && len(lines) > n {
			lines = lines[:n]
		}
		return strings.Join(lines, "\n"), nil
	})

	r.Register("tail", "Show last N lines (default 10). Usage: tail 5 or tail -n 5", func(args []string, stdin string) (string, error) {
		n := 10
		for i, a := range args {
			if a == "-n" && i+1 < len(args) {
				fmt.Sscanf(args[i+1], "%d", &n)
			} else {
				cleaned := strings.TrimLeft(a, "-")
				if v, err := strconv.Atoi(cleaned); err == nil && v > 0 {
					n = v
				}
			}
		}
		lines := strings.Split(stdin, "\n")
		if n > 0 && len(lines) > n {
			lines = lines[len(lines)-n:]
		}
		return strings.Join(lines, "\n"), nil
	})

	r.Register("wc", "Count lines, words, chars (-l lines, -w words, -c chars)", func(args []string, stdin string) (string, error) {
		lines := len(strings.Split(stdin, "\n"))
		words := len(strings.Fields(stdin))
		chars := len(stdin)
		if len(args) > 0 {
			switch args[0] {
			case "-l":
				return fmt.Sprintf("%d", lines), nil
			case "-w":
				return fmt.Sprintf("%d", words), nil
			case "-c":
				return fmt.Sprintf("%d", chars), nil
			}
		}
		return fmt.Sprintf("%d lines, %d words, %d chars", lines, words, chars), nil
	})
}

// RegisterMemoryCommands adds memory-related commands to the registry.
func RegisterMemoryCommands(r *Registry, db *sql.DB, cfg *Config) {
	r.Register("memory", `Search or manage memory.
  memory search <query>              — search across all topics (semantic + keyword)
  memory search <query> -t <id>      — search within a specific topic
  memory search <query> -k <keyword> — filter results by keyword
  memory recent [n]                  — show recent conversation summaries
  memory store <note>                — store a fact/note
  memory facts                       — list all stored facts
  memory forget <id>                 — delete a fact by ID`,
		func(args []string, stdin string) (string, error) {
			if len(args) == 0 {
				return "", fmt.Errorf("usage: memory search|recent|store|facts|forget")
			}

			switch args[0] {
			case "search":
				if len(args) < 2 {
					return "", fmt.Errorf("usage: memory search <query> [-t topic_id] [-k keyword]")
				}
				return memorySearchCmd(db, cfg, args[1:])

			case "recent":
				limit := 5
				if len(args) > 1 {
					if n, err := strconv.Atoi(args[1]); err == nil {
						limit = n
					}
				}
				return memoryRecent(db, limit)

			case "store":
				if len(args) < 2 && stdin == "" {
					return "", fmt.Errorf("usage: memory store <note>")
				}
				note := strings.Join(args[1:], " ")
				if note == "" {
					note = stdin
				}
				if err := StoreFact(db, note, "general"); err != nil {
					return "", err
				}
				return "fact stored", nil

			case "facts":
				return memoryFacts(db)

			case "forget":
				if len(args) < 2 {
					return "", fmt.Errorf("usage: memory forget <id>")
				}
				id, err := strconv.Atoi(args[1])
				if err != nil {
					return "", fmt.Errorf("invalid id: %s", args[1])
				}
				if err := DeleteFact(db, id); err != nil {
					return "", err
				}
				return fmt.Sprintf("fact %d deleted", id), nil

			default:
				return "", fmt.Errorf("unknown: memory %s. Use: search|recent|store|facts|forget", args[0])
			}
		})
}

func memorySearchCmd(db *sql.DB, cfg *Config, args []string) (string, error) {
	var queryParts []string
	filter := SearchFilter{Limit: 5}

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-t":
			if i+1 < len(args) {
				filter.TopicID = args[i+1]
				i++
			}
		case "-k":
			if i+1 < len(args) {
				filter.Keyword = args[i+1]
				i++
			}
		default:
			queryParts = append(queryParts, args[i])
		}
	}

	query := strings.Join(queryParts, " ")
	if query == "" {
		return "", fmt.Errorf("query is required")
	}

	results, err := SearchMemory(db, cfg, query, filter)
	if err != nil {
		return "", err
	}

	return FormatSearchResults(results), nil
}

func memoryRecent(db *sql.DB, limit int) (string, error) {
	rows, err := db.Query(`SELECT summary, created_at FROM summaries ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	var b strings.Builder
	for rows.Next() {
		var summary string
		var createdAt int64
		rows.Scan(&summary, &createdAt)
		ts := time.Unix(createdAt, 0).Format("2006-01-02 15:04")
		fmt.Fprintf(&b, "[%s] %s\n", ts, summary)
	}
	if b.Len() == 0 {
		return "No conversation summaries yet.", nil
	}
	return b.String(), nil
}

func memoryFacts(db *sql.DB) (string, error) {
	facts, err := ListFacts(db)
	if err != nil {
		return "", err
	}
	if len(facts) == 0 {
		return "No facts stored.", nil
	}

	total := len(facts)
	showing := facts
	if len(showing) > 50 {
		showing = showing[:50]
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Facts (%d of %d):\n", len(showing), total)
	for _, f := range showing {
		fmt.Fprintf(&b, "  #%d [%s] %s\n", f.ID, f.Category, f.Content)
	}
	if total > len(showing) {
		fmt.Fprintf(&b, "  ... %d more (use memory forget <id> to clean up)\n", total-len(showing))
	}
	return b.String(), nil
}

// RegisterTopicCommands adds topic management commands to the registry.
func RegisterTopicCommands(r *Registry, db *sql.DB, cfg *Config) {
	r.Register("topic", `Manage conversation topics.
  topic list [limit]               — list topics (default: 10, newest first)
  topic info <id>                  — show topic details and run history
  topic runs <id> [limit]          — list runs (default: 10, newest first)
  topic run <run-id>               — show a run's full messages
  topic rename <id> <new-name>     — rename a topic
  topic search <id> <query>        — search within a topic`,
		func(args []string, stdin string) (string, error) {
			if len(args) == 0 {
				return "", fmt.Errorf("usage: topic list|info|rename|current")
			}

			switch args[0] {
			case "list":
				limit := 10
				if len(args) > 1 {
					if n, err := strconv.Atoi(args[1]); err == nil {
						limit = n
					}
				}
				return topicList(db, limit)

			case "info":
				if len(args) < 2 {
					return "", fmt.Errorf("usage: topic info <id>")
				}
				return topicInfo(db, args[1])

			case "rename":
				if len(args) < 3 {
					return "", fmt.Errorf("usage: topic rename <id> <new-name>")
				}
				newName := strings.Join(args[2:], " ")
				if err := RenameTopic(db, args[1], newName); err != nil {
					return "", err
				}
				return fmt.Sprintf("topic %s renamed to %q", args[1], newName), nil

			case "runs":
				if len(args) < 2 {
					return "", fmt.Errorf("usage: topic runs <id> [limit]")
				}
				limit := 10
				if len(args) > 2 {
					if n, err := strconv.Atoi(args[2]); err == nil {
						limit = n
					}
				}
				return topicRuns(db, args[1], limit)

			case "run":
				if len(args) < 2 {
					return "", fmt.Errorf("usage: topic run <run-id>")
				}
				return topicRunDetail(db, args[1])

			case "search":
				if len(args) < 3 {
					return "", fmt.Errorf("usage: topic search <topic-id> <query>")
				}
				topicID := args[1]
				query := strings.Join(args[2:], " ")
				results, err := SearchMemory(db, cfg, query, SearchFilter{TopicID: topicID, Limit: 10})
				if err != nil {
					return "", err
				}
				return FormatSearchResults(results), nil

			default:
				return "", fmt.Errorf("unknown: topic %s. Use: list|info|runs|run|search|rename", args[0])
			}
		})
}

func topicList(db *sql.DB, limit int) (string, error) {
	total, err := CountTopics(db)
	if err != nil {
		return "", err
	}
	if total == 0 {
		return "No topics.", nil
	}

	topics, err := ListTopicsPage(db, limit, 0)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Topics (%d of %d, newest first):\n", len(topics), total)
	for _, t := range topics {
		ts := time.Unix(t.CreatedAt, 0).Format("01-02 15:04")
		fmt.Fprintf(&b, "  %s  %s  (%d msgs)  %s\n", t.ID, t.Name, t.MessageCount, ts)
	}
	return b.String(), nil
}

func topicInfo(db *sql.DB, id string) (string, error) {
	t, err := GetTopic(db, id)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Topic: %s (%s)\n", t.Name, t.ID)
	fmt.Fprintf(&b, "Created: %s\n", time.Unix(t.CreatedAt, 0).Format("2006-01-02 15:04:05"))

	// list recent runs with summaries and tool counts
	total, _ := countTopicRuns(db, id)
	if total > 0 {
		runs, _ := getTopicRunsPage(db, id, 5, 0)
		fmt.Fprintf(&b, "Runs: %d (showing last %d)\n\n", total, len(runs))
		for _, r := range runs {
			ts := time.Unix(r.StartedAt, 0).Format("15:04:05")
			duration := ""
			if r.FinishedAt > 0 {
				d := time.Duration(r.FinishedAt-r.StartedAt) * time.Second
				duration = fmt.Sprintf(" (%s)", d)
			}
			fmt.Fprintf(&b, "  %s [%s]%s  status=%s  tools=%d\n", r.ID, ts, duration, r.Status, r.ToolCount)
			if r.Summary != "" {
				fmt.Fprintf(&b, "    %s\n", r.Summary)
			}
		}
	} else {
		fmt.Fprintf(&b, "Runs: 0\n")
	}

	return b.String(), nil
}

type topicRunInfo struct {
	ID         string
	Status     string
	StartedAt  int64
	FinishedAt int64
	ToolCount  int
	Summary    string
}

func countTopicRuns(db *sql.DB, topicID string) (int, error) {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM runs WHERE topic_id = ?`, topicID).Scan(&count)
	return count, err
}

func getTopicRuns(db *sql.DB, topicID string) ([]topicRunInfo, error) {
	return getTopicRunsPage(db, topicID, 0, 0)
}

func getTopicRunsPage(db *sql.DB, topicID string, limit, offset int) ([]topicRunInfo, error) {
	query := `
		SELECT r.id, r.status, r.started_at, COALESCE(r.finished_at, 0),
			(SELECT COUNT(*) FROM messages m WHERE m.run_id = r.id AND m.role = 'tool'),
			COALESCE((SELECT s.summary FROM summaries s WHERE s.run_id = r.id LIMIT 1), '')
		FROM runs r
		WHERE r.topic_id = ?
		ORDER BY r.started_at DESC`

	var rows *sql.Rows
	var err error
	if limit > 0 {
		rows, err = db.Query(query+` LIMIT ? OFFSET ?`, topicID, limit, offset)
	} else {
		rows, err = db.Query(query, topicID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var runs []topicRunInfo
	for rows.Next() {
		var r topicRunInfo
		if err := rows.Scan(&r.ID, &r.Status, &r.StartedAt, &r.FinishedAt, &r.ToolCount, &r.Summary); err != nil {
			return nil, err
		}
		runs = append(runs, r)
	}
	return runs, rows.Err()
}

func topicRuns(db *sql.DB, topicID string, limit int) (string, error) {
	total, err := countTopicRuns(db, topicID)
	if err != nil {
		return "", err
	}
	if total == 0 {
		return "No runs in this topic.", nil
	}

	runs, err := getTopicRunsPage(db, topicID, limit, 0)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Runs (%d of %d, newest first):\n", len(runs), total)
	for _, r := range runs {
		ts := time.Unix(r.StartedAt, 0).Format("15:04:05")
		duration := ""
		if r.FinishedAt > 0 {
			d := time.Duration(r.FinishedAt-r.StartedAt) * time.Second
			duration = fmt.Sprintf(" (%s)", d)
		}
		fmt.Fprintf(&b, "  %s [%s]%s  status=%s  tools=%d\n", r.ID, ts, duration, r.Status, r.ToolCount)
		if r.Summary != "" {
			fmt.Fprintf(&b, "     %s\n", r.Summary)
		}
	}
	return b.String(), nil
}

func topicRunDetail(db *sql.DB, runID string) (string, error) {
	run, err := getRunInfo(db, runID)
	if err != nil {
		return "", err
	}

	msgs, err := LoadMessagesByRunID(db, runID)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	ts := time.Unix(run.StartedAt, 0).Format("2006-01-02 15:04:05")
	fmt.Fprintf(&b, "Run %s  [%s]  status=%s  tools=%d\n", run.ID, ts, run.Status, run.ToolCount)
	if run.Summary != "" {
		fmt.Fprintf(&b, "Summary: %s\n", run.Summary)
	}
	fmt.Fprintf(&b, "\nMessages (%d):\n", len(msgs))

	for _, m := range msgs {
		switch m.Role {
		case "user":
			if m.Content != nil {
				text := *m.Content
				if len(text) > 300 {
					text = text[:300] + "..."
				}
				fmt.Fprintf(&b, "\n[user] %s\n", text)
			}
		case "assistant":
			if len(m.ToolCalls) > 0 {
				for _, tc := range m.ToolCalls {
					fmt.Fprintf(&b, "[tool_call] %s(%s)\n", tc.Function.Name, truncate(tc.Function.Arguments, 100))
				}
			}
			if m.Content != nil && *m.Content != "" {
				text := *m.Content
				if len(text) > 500 {
					text = text[:500] + "..."
				}
				fmt.Fprintf(&b, "[assistant] %s\n", text)
			}
		case "tool":
			if m.Content != nil {
				text := *m.Content
				if len(text) > 200 {
					text = text[:200] + "..."
				}
				fmt.Fprintf(&b, "[tool_result] %s\n", text)
			}
		}
	}
	return b.String(), nil
}

func getRunInfo(db *sql.DB, runID string) (*topicRunInfo, error) {
	var r topicRunInfo
	err := db.QueryRow(`
		SELECT r.id, r.status, r.started_at, COALESCE(r.finished_at, 0),
			(SELECT COUNT(*) FROM messages m WHERE m.run_id = r.id AND m.role = 'tool'),
			COALESCE((SELECT s.summary FROM summaries s WHERE s.run_id = r.id LIMIT 1), '')
		FROM runs r
		WHERE r.id = ?`, runID).Scan(&r.ID, &r.Status, &r.StartedAt, &r.FinishedAt, &r.ToolCount, &r.Summary)
	if err != nil {
		return nil, fmt.Errorf("run %s not found", runID)
	}
	return &r, nil
}
