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
		if sim >= 0.5 { // relevance threshold
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

func GenerateSummary(cfg *Config, userMessage, assistantReply string) (string, error) {
	reply := assistantReply
	if len(reply) > 2000 {
		reply = reply[:2000] + "..."
	}

	messages := []Message{
		TextMessage("system", "You are a summarizer. Output only the summary, nothing else. Use Chinese."),
		TextMessage("user", fmt.Sprintf("用1-2句话总结这段对话。重点是用户问了什么、结果是什么。\n\n用户: %s\n\n回复: %s", userMessage, reply)),
	}

	resp, err := CallLLM(cfg, messages, nil, nil)
	if err != nil {
		// fallback: use first 100 chars of user message
		if len(userMessage) > 100 {
			return userMessage[:100] + "...", nil
		}
		return userMessage, nil
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

	// recent summaries (last 5)
	rows, err := db.Query(`SELECT summary FROM summaries ORDER BY created_at DESC LIMIT 5`)
	if err == nil {
		defer rows.Close()
		var recents []string
		for rows.Next() {
			var s string
			rows.Scan(&s)
			recents = append(recents, s)
		}
		if len(recents) > 0 {
			var rb strings.Builder
			rb.WriteString("## Recent Conversations\n")
			for i := len(recents) - 1; i >= 0; i-- {
				fmt.Fprintf(&rb, "- %s\n", recents[i])
			}
			parts = append(parts, rb.String())
		}
	}

	// semantic search (if we have embeddings)
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

// ProcessMemoryAsync generates summary and embedding for a completed conversation.
// Called asynchronously after a Run completes.
func ProcessMemoryAsync(db *sql.DB, cfg *Config, topicID, userMessage, assistantReply string) {
	summary, _ := GenerateSummary(cfg, userMessage, assistantReply)
	if summary == "" {
		return
	}

	embedding, _ := GetEmbedding(cfg, summary)
	StoreSummary(db, topicID, summary, userMessage, embedding)
}
