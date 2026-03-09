package internal

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/google/uuid"
)

type Run struct {
	ID         string `json:"id"`
	TopicID    string `json:"topic_id"`
	Status     string `json:"status"`
	PID        int    `json:"pid"`
	Async      bool   `json:"async"`
	StartedAt  int64  `json:"started_at"`
	FinishedAt *int64 `json:"finished_at,omitempty"`
}

func CreateRun(db *sql.DB, topicID string, pid int, async bool) (*Run, error) {
	r := &Run{
		ID:        uuid.NewString()[:8],
		TopicID:   topicID,
		Status:    "running",
		PID:       pid,
		Async:     async,
		StartedAt: time.Now().Unix(),
	}

	asyncInt := 0
	if async {
		asyncInt = 1
	}

	_, err := db.Exec(`INSERT INTO runs (id, topic_id, status, pid, async, started_at) VALUES (?, ?, ?, ?, ?, ?)`,
		r.ID, r.TopicID, r.Status, r.PID, asyncInt, r.StartedAt)
	if err != nil {
		return nil, fmt.Errorf("insert run: %w", err)
	}

	if async {
		dir := runDir(r.ID)
		os.MkdirAll(dir, 0o755)
		os.WriteFile(filepath.Join(dir, "output"), nil, 0o644)
	}

	return r, nil
}

func GetActiveRun(db *sql.DB, topicID string) (*Run, error) {
	r, err := scanRun(db.QueryRow(`SELECT id, topic_id, status, pid, async, started_at, finished_at FROM runs WHERE topic_id = ? AND status = 'running'`, topicID))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query active run: %w", err)
	}

	if !IsProcessAlive(r.PID) {
		_ = finishRunDirect(db, r.ID, "error")
		cleanupRunDir(r.ID)
		return nil, nil
	}

	return r, nil
}

func GetRun(db *sql.DB, runID string) (*Run, error) {
	r, err := scanRun(db.QueryRow(`SELECT id, topic_id, status, pid, async, started_at, finished_at FROM runs WHERE id = ?`, runID))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("run %s not found", runID)
	}
	if err != nil {
		return nil, fmt.Errorf("query run: %w", err)
	}
	return r, nil
}

func InjectMessage(db *sql.DB, runID string, message string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var status string
	err = tx.QueryRow(`SELECT status FROM runs WHERE id = ?`, runID).Scan(&status)
	if err != nil {
		return fmt.Errorf("run %s not found", runID)
	}
	if status != "running" {
		return fmt.Errorf("run %s is not active (status: %s)", runID, status)
	}

	_, err = tx.Exec(`INSERT INTO run_inbox (run_id, message) VALUES (?, ?)`, runID, message)
	if err != nil {
		return fmt.Errorf("insert inbox: %w", err)
	}

	return tx.Commit()
}

func DrainInbox(db *sql.DB, runID string) ([]string, error) {
	rows, err := db.Query(`SELECT message FROM run_inbox WHERE run_id = ? ORDER BY id ASC`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []string
	for rows.Next() {
		var msg string
		if err := rows.Scan(&msg); err != nil {
			return nil, err
		}
		msgs = append(msgs, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(msgs) > 0 {
		db.Exec(`DELETE FROM run_inbox WHERE run_id = ?`, runID)
	}
	return msgs, nil
}

func TryFinishRun(db *sql.DB, runID string, status string) ([]string, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	rows, err := tx.Query(`SELECT message FROM run_inbox WHERE run_id = ? ORDER BY id ASC`, runID)
	if err != nil {
		return nil, err
	}
	var msgs []string
	for rows.Next() {
		var msg string
		if err := rows.Scan(&msg); err != nil {
			rows.Close()
			return nil, err
		}
		msgs = append(msgs, msg)
	}
	rows.Close()

	if len(msgs) > 0 {
		_, err = tx.Exec(`DELETE FROM run_inbox WHERE run_id = ?`, runID)
		if err != nil {
			return nil, err
		}
		return msgs, tx.Commit()
	}

	now := time.Now().Unix()
	_, err = tx.Exec(`UPDATE runs SET status = ?, finished_at = ? WHERE id = ?`, status, now, runID)
	if err != nil {
		return nil, err
	}
	return nil, tx.Commit()
}

func FinishRun(db *sql.DB, runID string, status string) error {
	return finishRunDirect(db, runID, status)
}

func finishRunDirect(db *sql.DB, runID string, status string) error {
	now := time.Now().Unix()
	_, err := db.Exec(`UPDATE runs SET status = ?, finished_at = ? WHERE id = ?`, status, now, runID)
	return err
}

// --- Run output directory (async only) ---

func runDir(runID string) string {
	return filepath.Join(clipBase(), "data", "runs", runID)
}

func runOutputPath(runID string) string {
	return filepath.Join(runDir(runID), "output")
}

func ReadOutput(runID string) string {
	b, err := os.ReadFile(runOutputPath(runID))
	if err != nil {
		return ""
	}
	return string(b)
}

func cleanupRunDir(runID string) {
	os.RemoveAll(runDir(runID))
}

func IsProcessAlive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return p.Signal(syscall.Signal(0)) == nil
}

func scanRun(row *sql.Row) (*Run, error) {
	var r Run
	var asyncInt int
	var finishedAt sql.NullInt64
	err := row.Scan(&r.ID, &r.TopicID, &r.Status, &r.PID, &asyncInt, &r.StartedAt, &finishedAt)
	if err != nil {
		return nil, err
	}
	r.Async = asyncInt == 1
	if finishedAt.Valid {
		r.FinishedAt = &finishedAt.Int64
	}
	return &r, nil
}
