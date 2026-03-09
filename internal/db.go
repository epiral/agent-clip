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

	// migrate: add run_id column if missing
	db.Exec("ALTER TABLE messages ADD COLUMN run_id TEXT")
	db.Exec("ALTER TABLE summaries ADD COLUMN run_id TEXT")

	return db, nil
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
	return t, nil
}

type TopicSummary struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	MessageCount int    `json:"message_count"`
	CreatedAt    int64  `json:"created_at"`
}

func ListTopics(db *sql.DB) ([]TopicSummary, error) {
	rows, err := db.Query(`
		SELECT t.id, t.name, t.created_at, COUNT(m.id) as msg_count
		FROM topics t
		LEFT JOIN messages m ON m.topic_id = t.id
		GROUP BY t.id
		ORDER BY t.created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list topics: %w", err)
	}
	defer rows.Close()

	var topics []TopicSummary
	for rows.Next() {
		var t TopicSummary
		if err := rows.Scan(&t.ID, &t.Name, &t.CreatedAt, &t.MessageCount); err != nil {
			return nil, fmt.Errorf("scan topic: %w", err)
		}
		topics = append(topics, t)
	}
	return topics, rows.Err()
}

// --- Messages ---

func LoadMessages(db *sql.DB, topicID string) ([]Message, error) {
	rows, err := db.Query(`
		SELECT role, content, tool_calls, tool_call_id
		FROM messages
		WHERE topic_id = ?
		ORDER BY id ASC`, topicID)
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
		INSERT INTO messages (topic_id, run_id, role, content, tool_calls, tool_call_id, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`)
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

		if _, err := stmt.Exec(topicID, runID, msg.Role, content, toolCallsRaw, toolCallID, now); err != nil {
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
		)
		if err := rows.Scan(&role, &content, &toolCallsRaw, &toolCallID); err != nil {
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
		msgs = append(msgs, msg)
	}
	return msgs, rows.Err()
}
