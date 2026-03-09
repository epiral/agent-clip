package internal

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

// --- Summary storage ---

type Summary struct {
	ID          int     `json:"id"`
	TopicID     string  `json:"topic_id"`
	SummaryText string  `json:"summary"`
	UserMessage string  `json:"user_message"`
	Similarity  float32 `json:"similarity,omitempty"`
	CreatedAt   int64   `json:"created_at"`
}

func StoreSummary(db *sql.DB, topicID, summary, userMessage string, embedding []float32) error {
	var embBlob []byte
	if len(embedding) > 0 {
		embBlob = EncodeEmbedding(embedding)
	}
	_, err := db.Exec(`INSERT INTO summaries (topic_id, summary, user_message, embedding, created_at) VALUES (?, ?, ?, ?, ?)`,
		topicID, summary, userMessage, embBlob, time.Now().Unix())
	return err
}

func GetRecentSummaries(db *sql.DB, limit int) ([]string, error) {
	rows, err := db.Query(`SELECT summary FROM summaries ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var summaries []string
	for rows.Next() {
		var s string
		rows.Scan(&s)
		summaries = append(summaries, s)
	}
	// reverse to chronological order
	for i, j := 0, len(summaries)-1; i < j; i, j = i+1, j-1 {
		summaries[i], summaries[j] = summaries[j], summaries[i]
	}
	return summaries, nil
}

// --- Search ---

func SearchMemorySemantic(db *sql.DB, queryEmbedding []float32, limit int) ([]Summary, error) {
	rows, err := db.Query(`SELECT id, topic_id, summary, user_message, embedding, created_at FROM summaries WHERE embedding IS NOT NULL`)
	if err != nil {
		return nil, fmt.Errorf("query summaries: %w", err)
	}
	defer rows.Close()

	type scored struct {
		Summary
		sim float32
	}
	var results []scored

	for rows.Next() {
		var s Summary
		var embBlob []byte
		if err := rows.Scan(&s.ID, &s.TopicID, &s.SummaryText, &s.UserMessage, &embBlob, &s.CreatedAt); err != nil {
			return nil, err
		}
		if len(embBlob) == 0 {
			continue
		}
		sim := CosineSimilarity(queryEmbedding, DecodeEmbedding(embBlob))
		if sim >= 0.5 {
			results = append(results, scored{s, sim})
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].sim > results[j].sim
	})
	if len(results) > limit {
		results = results[:limit]
	}

	out := make([]Summary, len(results))
	for i, r := range results {
		r.Summary.Similarity = r.sim
		out[i] = r.Summary
	}
	return out, nil
}

func SearchMemoryKeyword(db *sql.DB, query string, limit int) ([]Summary, error) {
	rows, err := db.Query(`
		SELECT s.id, s.topic_id, s.summary, s.user_message, s.created_at
		FROM summaries_fts fts
		JOIN summaries s ON s.id = fts.rowid
		WHERE summaries_fts MATCH ?
		ORDER BY rank
		LIMIT ?`, query, limit)
	if err != nil {
		return nil, fmt.Errorf("keyword search: %w", err)
	}
	defer rows.Close()

	var results []Summary
	for rows.Next() {
		var s Summary
		if err := rows.Scan(&s.ID, &s.TopicID, &s.SummaryText, &s.UserMessage, &s.CreatedAt); err != nil {
			return nil, err
		}
		results = append(results, s)
	}
	return results, rows.Err()
}

// --- Summary generation ---

// renderTrajectory formats a Run's messages into readable text for the summary LLM.
func renderTrajectory(msgs []Message) string {
	var b strings.Builder
	for _, m := range msgs {
		switch m.Role {
		case "user":
			if m.Content != nil {
				fmt.Fprintf(&b, "[user] %s\n", *m.Content)
			}
		case "assistant":
			if len(m.ToolCalls) > 0 {
				for _, tc := range m.ToolCalls {
					fmt.Fprintf(&b, "[tool_call] %s(%s)\n", tc.Function.Name, truncate(tc.Function.Arguments, 200))
				}
			}
			if m.Content != nil && *m.Content != "" {
				text := *m.Content
				if len(text) > 1500 {
					text = text[:1500] + "..."
				}
				fmt.Fprintf(&b, "[assistant] %s\n", text)
			}
		case "tool":
			if m.Content != nil {
				text := *m.Content
				if len(text) > 500 {
					text = text[:500] + "..."
				}
				fmt.Fprintf(&b, "[tool_result] %s\n", text)
			}
		}
	}
	return b.String()
}

// GenerateSummary creates a summary of a complete Run trajectory with recent context.
func GenerateSummary(db *sql.DB, cfg *Config, newMsgs []Message) (string, error) {
	trajectory := renderTrajectory(newMsgs)
	if len(trajectory) > 6000 {
		trajectory = trajectory[:6000] + "\n... (truncated)"
	}

	// get recent summaries for context
	var contextSection string
	recentSummaries, _ := GetRecentSummaries(db, 5)
	if len(recentSummaries) > 0 {
		contextSection = "近期对话摘要（作为上下文）:\n"
		for _, s := range recentSummaries {
			contextSection += "- " + s + "\n"
		}
		contextSection += "\n"
	}

	prompt := fmt.Sprintf(`%s请用1-3句话总结以下对话。包含：用户的意图、执行了什么操作、最终结果。

对话轨迹:
%s`, contextSection, trajectory)

	messages := []Message{
		TextMessage("system", "你是一个对话摘要生成器。只输出摘要，不要其他内容。中文输出。"),
		TextMessage("user", prompt),
	}

	resp, err := CallLLM(cfg, messages, nil, nil)
	if err != nil {
		// fallback: first user message
		for _, m := range newMsgs {
			if m.Role == "user" && m.Content != nil {
				text := *m.Content
				if len(text) > 100 {
					text = text[:100] + "..."
				}
				return text, nil
			}
		}
		return "", err
	}

	return strings.TrimSpace(resp.Content), nil
}

// --- Facts ---

type Fact struct {
	ID        int    `json:"id"`
	Content   string `json:"content"`
	Category  string `json:"category"`
	CreatedAt int64  `json:"created_at"`
}

func StoreFact(db *sql.DB, content, category string) error {
	if category == "" {
		category = "general"
	}
	_, err := db.Exec(`INSERT INTO facts (content, category, created_at) VALUES (?, ?, ?)`,
		content, category, time.Now().Unix())
	return err
}

func ListFacts(db *sql.DB) ([]Fact, error) {
	rows, err := db.Query(`SELECT id, content, category, created_at FROM facts ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var facts []Fact
	for rows.Next() {
		var f Fact
		if err := rows.Scan(&f.ID, &f.Content, &f.Category, &f.CreatedAt); err != nil {
			return nil, err
		}
		facts = append(facts, f)
	}
	return facts, rows.Err()
}

func DeleteFact(db *sql.DB, id int) error {
	_, err := db.Exec(`DELETE FROM facts WHERE id = ?`, id)
	return err
}

// --- Memory context for system prompt ---

func BuildMemoryContext(db *sql.DB, cfg *Config, userMessage string) string {
	var parts []string

	// facts
	facts, _ := ListFacts(db)
	if len(facts) > 0 {
		var fb strings.Builder
		fb.WriteString("## Known Facts\n")
		for _, f := range facts {
			fmt.Fprintf(&fb, "- [%s] %s\n", f.Category, f.Content)
		}
		parts = append(parts, fb.String())
	}

	// recent summaries
	recentSummaries, _ := GetRecentSummaries(db, 5)
	if len(recentSummaries) > 0 {
		var rb strings.Builder
		rb.WriteString("## Recent Conversations\n")
		for _, s := range recentSummaries {
			fmt.Fprintf(&rb, "- %s\n", s)
		}
		parts = append(parts, rb.String())
	}

	// semantic search
	queryEmb, err := GetEmbedding(cfg, userMessage)
	if err == nil && len(queryEmb) > 0 {
		results, err := SearchMemorySemantic(db, queryEmb, 3)
		if err == nil && len(results) > 0 {
			var sb strings.Builder
			sb.WriteString("## Relevant Past Conversations\n")
			for _, r := range results {
				fmt.Fprintf(&sb, "- (%.0f%% match) %s\n", r.Similarity*100, r.SummaryText)
			}
			parts = append(parts, sb.String())
		}
	}

	if len(parts) == 0 {
		return ""
	}
	return "\n\n" + strings.Join(parts, "\n") + "\n"
}

// ProcessMemory generates summary and embedding for a completed Run.
func ProcessMemory(db *sql.DB, cfg *Config, topicID string, newMsgs []Message) {
	// extract first user message for storage
	var userMessage string
	for _, m := range newMsgs {
		if m.Role == "user" && m.Content != nil {
			userMessage = *m.Content
			break
		}
	}

	summary, _ := GenerateSummary(db, cfg, newMsgs)
	if summary == "" {
		return
	}

	embedding, _ := GetEmbedding(cfg, summary)
	StoreSummary(db, topicID, summary, userMessage, embedding)
}
