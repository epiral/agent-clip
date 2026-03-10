package internal

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

func OpenDB() (*sql.DB, error) {
	base := clipBase()
	dbPath := filepath.Join(base, "data", "agent.db")

	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	schemaPath := filepath.Join(base, "seed", "schema.sql")
	schema, err := os.ReadFile(schemaPath)
	if err != nil {
		schemaPath = filepath.Join(base, "data", "schema.sql")
		schema, err = os.ReadFile(schemaPath)
		if err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("read schema: %w", err)
		}
	}

	if _, err := db.Exec(string(schema)); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("init schema: %w", err)
	}

	// migrate: add columns if missing
	db.Exec("ALTER TABLE messages ADD COLUMN run_id TEXT")
	db.Exec("ALTER TABLE messages ADD COLUMN reasoning TEXT")
	db.Exec("ALTER TABLE summaries ADD COLUMN run_id TEXT")
	db.Exec("ALTER TABLE summaries ADD COLUMN embedding_model TEXT")

	// one-time data cleanup: move <think> from content to reasoning
	migrateThinkTags(db)

	return db, nil
}

func migrateThinkTags(db *sql.DB) {
	rows, err := db.Query(`SELECT rowid, content, reasoning FROM messages WHERE role = 'assistant' AND content LIKE '%<think>%'`)
	if err != nil {
		return
	}
	defer rows.Close()

	type fix struct {
		rowid     int64
		content   string
		reasoning string
	}
	var fixes []fix
	for rows.Next() {
		var rowid int64
		var contentPtr, reasoningPtr *string
		if err := rows.Scan(&rowid, &contentPtr, &reasoningPtr); err != nil {
			continue
		}
		content := ""
		if contentPtr != nil {
			content = *contentPtr
		}
		reasoning := ""
		if reasoningPtr != nil {
			reasoning = *reasoningPtr
		}
		cleanContent, cleanReasoning := ExtractThinking(content, reasoning)
		if cleanContent != content {
			fixes = append(fixes, fix{rowid, cleanContent, cleanReasoning})
		}
	}

	for _, f := range fixes {
		db.Exec("UPDATE messages SET content = ?, reasoning = ? WHERE rowid = ?", f.content, f.reasoning, f.rowid)
	}
}

// --- Topics ---

type Topic struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
}

func CreateTopic(db *sql.DB, name string) (*Topic, error) {
	t := &Topic{
		ID:        uuid.NewString()[:8],
		Name:      name,
		CreatedAt: time.Now().Unix(),
	}
	_, err := db.Exec("INSERT INTO topics (id, name, created_at) VALUES (?, ?, ?)",
		t.ID, t.Name, t.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert topic: %w", err)
	}
	// Create topic file directory
	_ = EnsureTopicDir(t.ID)
	return t, nil
}

type TopicSummary struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	MessageCount  int    `json:"message_count"`
	CreatedAt     int64  `json:"created_at"`
	LastMessageAt int64  `json:"last_message_at"`
}

func CountTopics(db *sql.DB) (int, error) {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM topics`).Scan(&count)
	return count, err
}

func ListTopics(db *sql.DB) ([]TopicSummary, error) {
	return ListTopicsPage(db, 0, 0)
}

func ListTopicsPage(db *sql.DB, limit, offset int) ([]TopicSummary, error) {
	query := `
		SELECT t.id, t.name, t.created_at, COUNT(m.id) as msg_count,
		       COALESCE(MAX(m.created_at), t.created_at) as last_msg_at
		FROM topics t
		LEFT JOIN messages m ON m.topic_id = t.id
		GROUP BY t.id
		ORDER BY last_msg_at DESC`

	var rows *sql.Rows
	var err error
	if limit > 0 {
		rows, err = db.Query(query+` LIMIT ? OFFSET ?`, limit, offset)
	} else {
		rows, err = db.Query(query)
	}
	if err != nil {
		return nil, fmt.Errorf("list topics: %w", err)
	}
	defer rows.Close()

	var topics []TopicSummary
	for rows.Next() {
		var t TopicSummary
		if err := rows.Scan(&t.ID, &t.Name, &t.CreatedAt, &t.MessageCount, &t.LastMessageAt); err != nil {
			return nil, fmt.Errorf("scan topic: %w", err)
		}
		topics = append(topics, t)
	}
	return topics, rows.Err()
}

func RenameTopic(db *sql.DB, id, name string) error {
	res, err := db.Exec("UPDATE topics SET name = ? WHERE id = ?", name, id)
	if err != nil {
		return fmt.Errorf("rename topic: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("topic %s not found", id)
	}
	return nil
}

func GetTopic(db *sql.DB, id string) (*Topic, error) {
	var t Topic
	err := db.QueryRow("SELECT id, name, created_at FROM topics WHERE id = ?", id).Scan(&t.ID, &t.Name, &t.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("topic %s not found", id)
	}
	return &t, nil
}

// --- Messages ---

func LoadMessages(db *sql.DB, topicID string) ([]Message, error) {
	return LoadMessagesPage(db, topicID, 0)
}

// LoadMessagesPage loads messages for a topic. If limit > 0, returns the last N messages.
func LoadMessagesPage(db *sql.DB, topicID string, limit int) ([]Message, error) {
	var query string
	var rows *sql.Rows
	var err error

	if limit > 0 {
		// Get last N messages by wrapping in subquery to preserve ASC order
		query = `SELECT role, content, tool_calls, tool_call_id, reasoning FROM (
			SELECT role, content, tool_calls, tool_call_id, reasoning, id
			FROM messages WHERE topic_id = ? ORDER BY id DESC LIMIT ?
		) sub ORDER BY id ASC`
		rows, err = db.Query(query, topicID, limit)
	} else {
		query = `SELECT role, content, tool_calls, tool_call_id, reasoning
			FROM messages WHERE topic_id = ? ORDER BY id ASC`
		rows, err = db.Query(query, topicID)
	}
	if err != nil {
		return nil, fmt.Errorf("load messages: %w", err)
	}
	defer rows.Close()
	return scanMessages(rows)
}

func SaveMessages(db *sql.DB, topicID, runID string, msgs []Message) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO messages (topic_id, run_id, role, content, tool_calls, tool_call_id, reasoning, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare insert: %w", err)
	}
	defer stmt.Close()

	now := time.Now().Unix()
	for _, msg := range msgs {
		var content sql.NullString
		if msg.Content != nil {
			content = sql.NullString{String: *msg.Content, Valid: true}
		}

		var toolCallsRaw sql.NullString
		if len(msg.ToolCalls) > 0 {
			b, err := json.Marshal(msg.ToolCalls)
			if err != nil {
				return fmt.Errorf("marshal tool_calls: %w", err)
			}
			toolCallsRaw = sql.NullString{String: string(b), Valid: true}
		}

		var toolCallID sql.NullString
		if msg.ToolCallID != "" {
			toolCallID = sql.NullString{String: msg.ToolCallID, Valid: true}
		}

		var reasoning sql.NullString
		if msg.Reasoning != nil {
			reasoning = sql.NullString{String: *msg.Reasoning, Valid: true}
		}

		if _, err := stmt.Exec(topicID, runID, msg.Role, content, toolCallsRaw, toolCallID, reasoning, now); err != nil {
			return fmt.Errorf("insert message: %w", err)
		}
	}

	return tx.Commit()
}

func scanMessages(rows *sql.Rows) ([]Message, error) {
	var msgs []Message
	for rows.Next() {
		var (
			role         string
			content      sql.NullString
			toolCallsRaw sql.NullString
			toolCallID   sql.NullString
			reasoning    sql.NullString
		)
		if err := rows.Scan(&role, &content, &toolCallsRaw, &toolCallID, &reasoning); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}

		msg := Message{Role: role}
		if content.Valid {
			msg.Content = &content.String
		}
		if toolCallID.Valid {
			msg.ToolCallID = toolCallID.String
		}
		if toolCallsRaw.Valid && toolCallsRaw.String != "" {
			if err := json.Unmarshal([]byte(toolCallsRaw.String), &msg.ToolCalls); err != nil {
				return nil, fmt.Errorf("unmarshal tool_calls: %w", err)
			}
		}
		if reasoning.Valid {
			msg.Reasoning = &reasoning.String
		}
		msgs = append(msgs, msg)
	}
	return msgs, rows.Err()
}
