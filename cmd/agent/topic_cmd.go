package main

import (
	"database/sql"
	"fmt"
	"os"
	"syscall"
	"time"

	"agent-clip/internal"

	"github.com/spf13/cobra"
)

type webToolCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type webAttachment struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	IsImage bool   `json:"is_image"`
}

type webMessage struct {
	Role        string          `json:"role"`
	Content     string          `json:"content"`
	ToolCallID  string          `json:"tool_call_id,omitempty"`
	Reasoning   string          `json:"reasoning,omitempty"`
	ToolCalls   []webToolCall   `json:"tool_calls,omitempty"`
	Attachments []webAttachment `json:"attachments,omitempty"`
}

type webRun struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	StartedAt int64  `json:"started_at"`
	Async     bool   `json:"async"`
	Output    string `json:"output,omitempty"`
}

type topicResponse struct {
	Messages  []webMessage `json:"messages"`
	ActiveRun *webRun      `json:"active_run"`
}

type createTopicInput struct {
	Name string `json:"name"`
}

type webTopic struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	MessageCount  int    `json:"message_count"`
	CreatedAt     int64  `json:"created_at"`
	LastMessageAt int64  `json:"last_message_at"`
	HasActiveRun  bool   `json:"has_active_run,omitempty"`
}

func getRunCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "get-run [run-id]",
		Short: "Show run status and output",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()
			db, err := internal.OpenDB()
			if err != nil {
				return err
			}
			defer db.Close()

			run, err := internal.GetRun(db, args[0])
			if err != nil {
				return err
			}
			if run.Status == "running" && !internal.IsProcessAlive(run.PID) {
				_ = internal.FinishRun(db, run.ID, "error")
				run.Status = "error"
			}

			out.Info(fmt.Sprintf("[run] %s  topic=%s  status=%s  started=%s",
				run.ID, run.TopicID, run.Status, time.Unix(run.StartedAt, 0).Format("15:04:05")))
			if run.Async {
				if output := internal.ReadOutput(run.ID); output != "" {
					out.Result(map[string]string{"output": output})
				}
			}
			return nil
		},
	}
}

func cancelRunCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "cancel-run [run-id]",
		Short: "Cancel an active run",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()
			db, err := internal.OpenDB()
			if err != nil {
				return err
			}
			defer db.Close()

			run, err := internal.GetRun(db, args[0])
			if err != nil {
				return err
			}
			if run.Status != "running" {
				return fmt.Errorf("run %s is not active (status: %s)", run.ID, run.Status)
			}
			if internal.IsProcessAlive(run.PID) {
				process, _ := os.FindProcess(run.PID)
				_ = process.Signal(syscall.SIGTERM)
			}
			_ = internal.FinishRun(db, run.ID, "cancelled")
			out.Info(fmt.Sprintf("[run] %s cancelled", run.ID))
			return nil
		},
	}
}

func getTopicCmd() *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   "get-topic <topic-id>",
		Short: "Get topic messages",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()
			db, err := internal.OpenDB()
			if err != nil {
				return err
			}
			defer db.Close()

			response, err := buildTopicResponse(db, args[0], limit)
			if err != nil {
				return err
			}
			out.Result(response)
			return nil
		},
	}

	cmd.Flags().IntVarP(&limit, "limit", "l", 100, "Max messages to return (0 = all, default 100)")
	return cmd
}

func buildTopicResponse(db *sql.DB, topicID string, limit int) (*topicResponse, error) {
	msgs, err := internal.LoadMessagesPage(db, topicID, limit)
	if err != nil {
		return nil, err
	}

	response := &topicResponse{Messages: make([]webMessage, 0, len(msgs))}
	for _, message := range msgs {
		response.Messages = append(response.Messages, toWebMessage(topicID, message))
	}

	activeRun, err := internal.GetActiveRun(db, topicID)
	if err == nil && activeRun != nil {
		response.ActiveRun = &webRun{
			ID:        activeRun.ID,
			Status:    activeRun.Status,
			StartedAt: activeRun.StartedAt,
			Async:     activeRun.Async,
		}
		if activeRun.Async {
			response.ActiveRun.Output = internal.ReadOutput(activeRun.ID)
		}
	}
	return response, nil
}

func toWebMessage(topicID string, message internal.Message) webMessage {
	result := webMessage{Role: message.Role, ToolCallID: message.ToolCallID}
	if message.Content != nil {
		result.Content = *message.Content
	}
	if message.Reasoning != nil {
		result.Reasoning = *message.Reasoning
	}
	for _, toolCall := range message.ToolCalls {
		result.ToolCalls = append(result.ToolCalls, webToolCall{Name: toolCall.Function.Name, Arguments: toolCall.Function.Arguments})
	}
	if result.Role == "user" {
		var attachmentPaths []string
		result.Content, attachmentPaths = internal.ExtractUserContent(result.Content)
		for _, path := range attachmentPaths {
			result.Attachments = append(result.Attachments, webAttachment{
				Name:    path,
				URL:     internal.AttachmentToURL(topicID, path),
				IsImage: internal.IsImageFile(path),
			})
		}
	}
	if result.Role == "assistant" {
		result.Content, result.Reasoning = internal.ExtractThinking(result.Content, result.Reasoning)
	}
	return result
}

func createTopicCmd() *cobra.Command {
	var name string

	cmd := &cobra.Command{
		Use:   "create-topic",
		Short: "Create a new conversation topic",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()
			if name == "" {
				var input createTopicInput
				if err := decodeJSONFromStdin(&input); err != nil {
					return err
				}
				name = input.Name
			}
			if name == "" {
				return fmt.Errorf("name is required (-n or stdin JSON)")
			}

			db, err := internal.OpenDB()
			if err != nil {
				return err
			}
			defer db.Close()

			topic, err := internal.CreateTopic(db, name)
			if err != nil {
				return err
			}
			out.Result(topic)
			return nil
		},
	}

	cmd.Flags().StringVarP(&name, "name", "n", "", "Topic name")
	return cmd
}

func listTopicsCmd() *cobra.Command {
	var limit, offset int

	cmd := &cobra.Command{
		Use:   "list-topics",
		Short: "List conversation topics",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()
			db, err := internal.OpenDB()
			if err != nil {
				return err
			}
			defer db.Close()

			topics, err := internal.ListTopicsPage(db, limit, offset)
			if err != nil {
				return err
			}
			activeTopics := internal.GetActiveRunTopics(db)

			result := make([]webTopic, 0, len(topics))
			for _, topic := range topics {
				result = append(result, webTopic{
					ID:            topic.ID,
					Name:          topic.Name,
					MessageCount:  topic.MessageCount,
					CreatedAt:     topic.CreatedAt,
					LastMessageAt: topic.LastMessageAt,
					HasActiveRun:  activeTopics[topic.ID],
				})
			}
			out.Result(result)
			return nil
		},
	}

	cmd.Flags().IntVarP(&limit, "limit", "l", 20, "Max topics to return")
	cmd.Flags().IntVar(&offset, "offset", 0, "Skip first N topics")
	return cmd
}
