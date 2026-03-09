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
	TopicName   string  `json:"topic_name,omitempty"`
	RunID       string  `json:"run_id,omitempty"`
	SummaryText string  `json:"summary"`
	UserMessage string  `json:"user_message"`
	Similarity  float32 `json:"similarity,omitempty"`
	CreatedAt   int64   `json:"created_at"`
}

func StoreSummary(db *sql.DB, topicID, runID, summary, userMessage string, embedding []float32, embeddingModel string) error {
	var embBlob []byte
	if len(embedding) > 0 {
		embBlob = EncodeEmbedding(embedding)
	}
	_, err := db.Exec(`INSERT INTO summaries (topic_id, run_id, summary, user_message, embedding, embedding_model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		topicID, runID, summary, userMessage, embBlob, embeddingModel, time.Now().Unix())
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
	for i, j := 0, len(summaries)-1; i < j; i, j = i+1, j-1 {
		summaries[i], summaries[j] = summaries[j], summaries[i]
	}
	return summaries, nil
}

// --- Search with filters ---

type SearchFilter struct {
	TopicID string // filter by topic
	Keyword string // keyword filter (applied after semantic/FTS)
	Limit   int
}

// SearchMemory combines semantic + keyword search with optional filters.
func SearchMemory(db *sql.DB, cfg *Config, query string, filter SearchFilter) ([]Summary, error) {
	if filter.Limit == 0 {
		filter.Limit = 5
	}

	var results []Summary

	// 1. semantic search
	queryEmb, err := GetEmbedding(cfg, query)
	if err == nil && len(queryEmb) > 0 {
		sem, _ := searchSemantic(db, queryEmb, filter, 10)
		results = append(results, sem...)
	}

	// 2. FTS keyword search (supplement)
	if len(results) < filter.Limit {
		kw, _ := searchKeyword(db, query, filter, 10)
		seen := make(map[int]bool)
		for _, r := range results {
			seen[r.ID] = true
		}
		for _, r := range kw {
			if !seen[r.ID] {
				results = append(results, r)
			}
		}
	}

	// 3. apply keyword post-filter if specified
	if filter.Keyword != "" {
		kw := strings.ToLower(filter.Keyword)
		var filtered []Summary
		for _, r := range results {
			if strings.Contains(strings.ToLower(r.SummaryText), kw) ||
				strings.Contains(strings.ToLower(r.UserMessage), kw) {
				filtered = append(filtered, r)
			}
		}
		results = filtered
	}

	if len(results) > filter.Limit {
		results = results[:filter.Limit]
	}

	// enrich with topic names
	enrichTopicNames(db, results)

	return results, nil
}

func searchSemantic(db *sql.DB, queryEmbedding []float32, filter SearchFilter, limit int) ([]Summary, error) {
	query := `SELECT s.id, s.topic_id, COALESCE(s.run_id,''), s.summary, s.user_message, s.embedding, s.created_at
		FROM summaries s WHERE s.embedding IS NOT NULL`
	var args []any
	if filter.TopicID != "" {
		query += ` AND s.topic_id = ?`
		args = append(args, filter.TopicID)
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
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
		if err := rows.Scan(&s.ID, &s.TopicID, &s.RunID, &s.SummaryText, &s.UserMessage, &embBlob, &s.CreatedAt); err != nil {
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

func searchKeyword(db *sql.DB, query string, filter SearchFilter, limit int) ([]Summary, error) {
	sqlQuery := `SELECT s.id, s.topic_id, COALESCE(s.run_id,''), s.summary, s.user_message, s.created_at
		FROM summaries_fts fts
		JOIN summaries s ON s.id = fts.rowid
		WHERE summaries_fts MATCH ?`
	args := []any{query}
	if filter.TopicID != "" {
		sqlQuery += ` AND s.topic_id = ?`
		args = append(args, filter.TopicID)
	}
	sqlQuery += ` ORDER BY rank LIMIT ?`
	args = append(args, limit)

	rows, err := db.Query(sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Summary
	for rows.Next() {
		var s Summary
		if err := rows.Scan(&s.ID, &s.TopicID, &s.RunID, &s.SummaryText, &s.UserMessage, &s.CreatedAt); err != nil {
			return nil, err
		}
		results = append(results, s)
	}
	return results, rows.Err()
}

func enrichTopicNames(db *sql.DB, summaries []Summary) {
	cache := make(map[string]string)
	for i := range summaries {
		tid := summaries[i].TopicID
		if name, ok := cache[tid]; ok {
			summaries[i].TopicName = name
			continue
		}
		var name string
		if err := db.QueryRow(`SELECT name FROM topics WHERE id = ?`, tid).Scan(&name); err == nil {
			cache[tid] = name
			summaries[i].TopicName = name
		}
	}
}

// FormatSearchResults renders search results with topic + run info.
func FormatSearchResults(results []Summary) string {
	if len(results) == 0 {
		return "No matching memories found."
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Found %d results:\n", len(results))
	for _, r := range results {
		ts := time.Unix(r.CreatedAt, 0).Format("01-02 15:04")
		sim := ""
		if r.Similarity > 0 {
			sim = fmt.Sprintf(" (%.0f%%)", r.Similarity*100)
		}
		topicLabel := r.TopicID[:8]
		if r.TopicName != "" {
			topicLabel = r.TopicName
		}
		fmt.Fprintf(&b, "  [%s]%s topic=%q", ts, sim, topicLabel)
		if r.RunID != "" {
			fmt.Fprintf(&b, " run=%s", r.RunID)
		}
		fmt.Fprintf(&b, "\n    %s\n", r.SummaryText)
	}
	return b.String()
}

// --- Legacy compatibility ---

func SearchMemorySemantic(db *sql.DB, queryEmbedding []float32, limit int) ([]Summary, error) {
	return searchSemantic(db, queryEmbedding, SearchFilter{}, limit)
}

// --- Summary generation ---

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

func GenerateSummary(db *sql.DB, cfg *Config, newMsgs []Message) (string, error) {
	trajectory := renderTrajectory(newMsgs)
	if len(trajectory) > 6000 {
		trajectory = trajectory[:6000] + "\n... (truncated)"
	}

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

	resp, err := CallLLM(cfg, messages, nil, nil, nil)
	if err != nil {
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

// ProcessMemory generates summary and embedding for a completed Run.
func ProcessMemory(db *sql.DB, cfg *Config, topicID, runID string, newMsgs []Message) {
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
	StoreSummary(db, topicID, runID, summary, userMessage, embedding, cfg.EmbeddingModel)
}
