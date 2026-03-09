package internal

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func RunToolDef(commands map[string]string) ToolDef {
	var desc strings.Builder
	desc.WriteString("Execute a command. Available commands:\n")
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
	parts := strings.Fields(command)
	if len(parts) == 0 {
		return "[error] empty command"
	}

	name := parts[0]
	args := parts[1:]

	handler, ok := r.handlers[name]
	if !ok {
		available := make([]string, 0, len(r.handlers))
		for n := range r.handlers {
			available = append(available, n)
		}
		return fmt.Sprintf("[error] unknown command: %s\nAvailable: %s", name, strings.Join(available, ", "))
	}

	out, err := handler(args, stdin)
	if err != nil {
		return fmt.Sprintf("[error] %s: %v", name, err)
	}
	return out
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
}

// RegisterMemoryCommands adds memory-related commands to the registry.
func RegisterMemoryCommands(r *Registry, db *sql.DB, cfg *Config) {
	r.Register("memory", `Search or manage memory.
  memory search <query>    — search past conversations (semantic + keyword)
  memory recent [n]        — show recent conversation summaries
  memory store <note>      — store a fact/note for long-term memory
  memory facts             — list all stored facts
  memory forget <id>       — delete a fact by ID`,
		func(args []string, stdin string) (string, error) {
			if len(args) == 0 {
				return "", fmt.Errorf("usage: memory search|recent|store|facts|forget")
			}

			switch args[0] {
			case "search":
				if len(args) < 2 {
					return "", fmt.Errorf("usage: memory search <query>")
				}
				query := strings.Join(args[1:], " ")
				return memorySearch(db, cfg, query)

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

func memorySearch(db *sql.DB, cfg *Config, query string) (string, error) {
	var results []Summary

	// try semantic search first
	queryEmb, err := GetEmbedding(cfg, query)
	if err == nil && len(queryEmb) > 0 {
		results, _ = SearchMemorySemantic(db, queryEmb, 5)
	}

	// fallback/supplement with keyword search
	if len(results) < 3 {
		kwResults, _ := SearchMemoryKeyword(db, query, 5)
		// deduplicate
		seen := make(map[int]bool)
		for _, r := range results {
			seen[r.ID] = true
		}
		for _, r := range kwResults {
			if !seen[r.ID] {
				results = append(results, r)
			}
		}
	}

	if len(results) == 0 {
		return "No matching memories found.", nil
	}

	var b strings.Builder
	for _, r := range results {
		ts := time.Unix(r.CreatedAt, 0).Format("2006-01-02 15:04")
		if r.Similarity > 0 {
			fmt.Fprintf(&b, "[%s] (%.0f%%) %s\n", ts, r.Similarity*100, r.SummaryText)
		} else {
			fmt.Fprintf(&b, "[%s] %s\n", ts, r.SummaryText)
		}
	}
	return b.String(), nil
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

	var b strings.Builder
	for _, f := range facts {
		fmt.Fprintf(&b, "  #%d [%s] %s\n", f.ID, f.Category, f.Content)
	}
	return b.String(), nil
}
