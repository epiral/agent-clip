package internal

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const (
	RunWindowMin = 3
	RunWindowMax = 7
)

// ContextResult holds the assembled context for a new Run.
type ContextResult struct {
	SystemPrompt string    // base + facts (stable, cacheable)
	Messages     []Message // topic history + recent runs + new user message
}

// BuildContext assembles the full LLM context for a new Run.
//
// Structure (optimized for prompt cache):
//
//	[system: base + facts]              ← stable
//	[user: topic history summaries]     ← changes only at compression boundary
//	[assistant: "了解"]                 ← stable
//	[recent Run messages...]            ← prefix grows, doesn't change
//	[user: <user>msg</user><recall>...<environment>...]  ← new, at end
func BuildContext(db *sql.DB, cfg *Config, topicID, userMessage string) (*ContextResult, error) {
	// 1. System prompt: base + facts only (stable)
	systemPrompt := cfg.SystemPrompt
	facts, _ := ListFacts(db)
	if len(facts) > 0 {
		var fb strings.Builder
		fb.WriteString("\n\n## Known Facts\n")
		for _, f := range facts {
			fmt.Fprintf(&fb, "- [%s] %s\n", f.Category, f.Content)
		}
		systemPrompt += fb.String()
	}

	// 2. Get completed Runs for this topic
	completedRuns, err := getCompletedRuns(db, topicID)
	if err != nil {
		return nil, err
	}

	var messages []Message

	if len(completedRuns) == 0 {
		// No history — just the new user message
		messages = append(messages, wrapUserMessage(cfg, db, userMessage))
		return &ContextResult{SystemPrompt: systemPrompt, Messages: messages}, nil
	}

	// 3. Determine window: how many Runs to load as full messages
	var summaryRuns, fullRuns []CompletedRun
	if len(completedRuns) <= RunWindowMax {
		fullRuns = completedRuns
	} else {
		// Keep last RunWindowMin as full, rest as summaries
		summaryRuns = completedRuns[:len(completedRuns)-RunWindowMin]
		fullRuns = completedRuns[len(completedRuns)-RunWindowMin:]
	}

	// 4. Topic history block (summaries of old Runs)
	if len(summaryRuns) > 0 {
		historyText := buildTopicHistory(db, summaryRuns)
		if historyText != "" {
			messages = append(messages, TextMessage("user", historyText))
			messages = append(messages, TextMessage("assistant", "了解"))
		}
	}

	// 5. Recent Runs: full messages
	for _, r := range fullRuns {
		runMsgs, err := LoadMessagesByRunID(db, r.ID)
		if err != nil {
			continue
		}
		messages = append(messages, runMsgs...)
	}

	// 6. New user message (with recall + environment)
	messages = append(messages, wrapUserMessage(cfg, db, userMessage))

	return &ContextResult{SystemPrompt: systemPrompt, Messages: messages}, nil
}

// wrapUserMessage creates the XML-structured user message.
func wrapUserMessage(cfg *Config, db *sql.DB, userMessage string) Message {
	var b strings.Builder

	// <user> tag
	fmt.Fprintf(&b, "<user>\n%s\n</user>", userMessage)

	// <recall> tag — semantic search results
	recall := buildRecall(db, cfg, userMessage)
	if recall != "" {
		fmt.Fprintf(&b, "\n\n<recall>\n%s</recall>", recall)
	}

	// <environment> tag
	env := buildEnvironment(cfg, db)
	if env != "" {
		fmt.Fprintf(&b, "\n\n<environment>\n%s</environment>", env)
	}

	return TextMessage("user", b.String())
}

func buildRecall(db *sql.DB, cfg *Config, userMessage string) string {
	queryEmb, err := GetEmbedding(cfg, userMessage)
	if err != nil || len(queryEmb) == 0 {
		return ""
	}

	results, err := SearchMemorySemantic(db, queryEmb, 3)
	if err != nil || len(results) == 0 {
		return ""
	}

	var b strings.Builder
	for _, r := range results {
		ts := time.Unix(r.CreatedAt, 0).Format("01-02 15:04")
		fmt.Fprintf(&b, "- [%s] (%.0f%%) %s\n", ts, r.Similarity*100, r.SummaryText)
	}
	return b.String()
}

func buildEnvironment(cfg *Config, db *sql.DB) string {
	var b strings.Builder
	fmt.Fprintf(&b, "<time>%s</time>\n", time.Now().Format("2006-01-02 15:04:05 MST"))

	// list connected clips
	if len(cfg.Clips) > 0 {
		b.WriteString("<clips>\n")
		for _, c := range cfg.Clips {
			cmds := strings.Join(c.Commands, ", ")
			fmt.Fprintf(&b, "  <clip name=%q commands=%q />\n", c.Name, cmds)
		}
		b.WriteString("</clips>\n")
	}

	return b.String()
}

func buildTopicHistory(db *sql.DB, runs []CompletedRun) string {
	var lines []string
	for _, r := range runs {
		summary := getSummaryForRun(db, r.ID, r.TopicID)
		if summary != "" {
			ts := time.Unix(r.StartedAt, 0).Format("15:04")
			lines = append(lines, fmt.Sprintf("- [%s] %s", ts, summary))
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return "以下是之前的对话摘要：\n" + strings.Join(lines, "\n")
}

func getSummaryForRun(db *sql.DB, runID, topicID string) string {
	// try by run_id first
	var summary string
	err := db.QueryRow(`SELECT summary FROM summaries WHERE run_id = ? LIMIT 1`, runID).Scan(&summary)
	if err == nil {
		return summary
	}
	// fallback: latest summary for this topic around this run's time
	err = db.QueryRow(`SELECT s.summary FROM summaries s
		JOIN runs r ON r.topic_id = s.topic_id
		WHERE r.id = ? AND s.topic_id = ?
		ORDER BY ABS(s.created_at - r.started_at) ASC LIMIT 1`, runID, topicID).Scan(&summary)
	if err == nil {
		return summary
	}
	return ""
}

// --- DB helpers ---

type CompletedRun struct {
	ID        string
	TopicID   string
	StartedAt int64
}

func getCompletedRuns(db *sql.DB, topicID string) ([]CompletedRun, error) {
	rows, err := db.Query(`SELECT id, topic_id, started_at FROM runs
		WHERE topic_id = ? AND status = 'done'
		ORDER BY started_at ASC`, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var runs []CompletedRun
	for rows.Next() {
		var r CompletedRun
		if err := rows.Scan(&r.ID, &r.TopicID, &r.StartedAt); err != nil {
			return nil, err
		}
		runs = append(runs, r)
	}
	return runs, rows.Err()
}

func LoadMessagesByRunID(db *sql.DB, runID string) ([]Message, error) {
	rows, err := db.Query(`SELECT role, content, tool_calls, tool_call_id
		FROM messages WHERE run_id = ? ORDER BY id ASC`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMessages(rows)
}
