package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"agent-clip/internal"

	"github.com/spf13/cobra"
)

var outputFormat string

func main() {
	root := &cobra.Command{
		Use:   "agent",
		Short: "Agent Clip CLI",
	}

	root.PersistentFlags().StringVar(&outputFormat, "output", "raw", "Output format: raw or jsonl")

	root.AddCommand(sendCmd())
	root.AddCommand(createTopicCmd())
	root.AddCommand(listTopicsCmd())
	root.AddCommand(getTopicCmd())
	root.AddCommand(getRunCmd())
	root.AddCommand(cancelRunCmd())
	root.AddCommand(configCmd())
	root.AddCommand(skillCmd())
	root.AddCommand(uploadCmd())
	root.AddCommand(workerCmd())
	root.AddCommand(memoryWorkerCmd())

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func getOutput() internal.Output {
	return internal.NewOutput(outputFormat)
}

func buildRegistry(db *sql.DB, cfg *internal.Config) *internal.Registry {
	registry := internal.NewRegistry()
	internal.RegisterFSCommands(registry)
	internal.RegisterClipCommands(registry, cfg)
	internal.RegisterBrowserCommands(registry, cfg)
	internal.RegisterMemoryCommands(registry, db, cfg)
	internal.RegisterTopicCommands(registry, db, cfg)
	internal.RegisterSkillCommands(registry, cfg)
	internal.RegisterConfigCommands(registry)
	return registry
}

func configCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "config [subcommand]",
		Short: "Show or update agent configuration",
		Long: `Subcommands:
  (none)                          Show full config (JSON, keys masked)
  set <dot.path> <value>          Set a config value
  delete <dot.path>               Delete a config key
  add-clip <json>                 Add a clip connection
  remove-clip <name>              Remove a clip`,
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()

			if len(args) == 0 {
				cfg, err := internal.LoadConfig()
				if err != nil {
					return err
				}
				out.Result(internal.ConfigGetJSON(cfg))
				return nil
			}

			switch args[0] {
			case "set":
				if len(args) < 3 {
					return fmt.Errorf("usage: config set <dot.path> <value>")
				}
				key := args[1]
				value := strings.Join(args[2:], " ")
				if err := internal.ConfigSet(key, value); err != nil {
					return err
				}
				out.Info(fmt.Sprintf("%s = %s", key, value))
				return nil

			case "delete":
				if len(args) < 2 {
					return fmt.Errorf("usage: config delete <dot.path>")
				}
				if err := internal.ConfigDelete(args[1]); err != nil {
					return err
				}
				out.Info(fmt.Sprintf("deleted %s", args[1]))
				return nil

			case "add-clip":
				jsonStr := strings.Join(args[1:], " ")
				if jsonStr == "" {
					return fmt.Errorf("usage: config add-clip '{\"name\":\"x\",\"url\":\"...\",\"token\":\"...\"}'")
				}
				clip, err := internal.ParseClipInput(jsonStr)
				if err != nil {
					return err
				}
				if clip.Name == "" || clip.URL == "" {
					return fmt.Errorf("clip requires name and url")
				}
				if err := internal.ConfigAddClip(clip); err != nil {
					return err
				}
				out.Info(fmt.Sprintf("added clip %s", clip.Name))
				return nil

			case "remove-clip":
				if len(args) < 2 {
					return fmt.Errorf("usage: config remove-clip <name>")
				}
				if err := internal.ConfigRemoveClip(args[1]); err != nil {
					return err
				}
				out.Info(fmt.Sprintf("removed clip %s", args[1]))
				return nil
			}

			return fmt.Errorf("unknown subcommand: %s", args[0])
		},
	}
}

func skillCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "skill [subcommand]",
		Short: "Manage skills (list, get, save, delete)",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()
			internal.EnsureSkillsDir()

			if len(args) == 0 || args[0] == "list" {
				skills, err := internal.ListSkills()
				if err != nil {
					return err
				}
				type skillJSON struct {
					Name        string `json:"name"`
					Description string `json:"description"`
				}
				result := make([]skillJSON, len(skills))
				for i, s := range skills {
					result[i] = skillJSON{Name: s.Name, Description: s.Description}
				}
				out.Result(result)
				return nil
			}

			switch args[0] {
			case "get":
				if len(args) < 2 {
					return fmt.Errorf("usage: skill get <name>")
				}
				desc, body, err := internal.LoadSkill(args[1])
				if err != nil {
					return err
				}
				out.Result(map[string]string{
					"name":        args[1],
					"description": desc,
					"content":     body,
				})
				return nil

			case "save":
				var input struct {
					Name        string `json:"name"`
					Description string `json:"description"`
					Content     string `json:"content"`
				}
				if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
					return fmt.Errorf("read stdin: %w", err)
				}
				if input.Name == "" {
					return fmt.Errorf("name is required")
				}

				// Check if exists → update, else create
				_, _, err := internal.LoadSkill(input.Name)
				if err != nil {
					// Create
					if err := internal.CreateSkill(input.Name, input.Description, input.Content); err != nil {
						return err
					}
				} else {
					// Update
					if err := internal.UpdateSkill(input.Name, &input.Description, &input.Content); err != nil {
						return err
					}
				}
				out.Result(map[string]string{"status": "ok", "name": input.Name})
				return nil

			case "delete":
				if len(args) < 2 {
					return fmt.Errorf("usage: skill delete <name>")
				}
				if err := internal.DeleteSkill(args[1]); err != nil {
					return err
				}
				out.Result(map[string]string{"status": "ok"})
				return nil
			}

			return fmt.Errorf("unknown: skill %s", args[0])
		},
	}
}

func sendCmd() *cobra.Command {
	var payload, topicID, runID string
	var async bool

	cmd := &cobra.Command{
		Use:   "send",
		Short: "Send a message and run the agentic loop",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()
			message := payload
			var attachments []string
			if message == "" {
				var input struct {
					Message     string   `json:"message"`
					TopicID     string   `json:"topic_id"`
					RunID       string   `json:"run_id"`
					Attachments []string `json:"attachments"`
				}
				if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
					return fmt.Errorf("read stdin: %w", err)
				}
				message = input.Message
				if topicID == "" {
					topicID = input.TopicID
				}
				if runID == "" {
					runID = input.RunID
				}
				attachments = input.Attachments
			}
			if message == "" {
				return fmt.Errorf("message is required (-p or stdin JSON)")
			}

			if runID != "" {
				db, err := internal.OpenDB()
				if err != nil {
					return err
				}
				defer db.Close()
				if err := internal.InjectMessage(db, runID, message); err != nil {
					return err
				}
				out.Info(fmt.Sprintf("[inject] sent to run %s", runID))
				return nil
			}

			db, err := internal.OpenDB()
			if err != nil {
				return err
			}
			defer db.Close()

			if topicID == "" {
				name := message
				if len([]rune(name)) > 30 {
					name = string([]rune(name)[:30]) + "..."
				}
				topic, err := internal.CreateTopic(db, name)
				if err != nil {
					return err
				}
				topicID = topic.ID
				out.Info(fmt.Sprintf("[topic] %s (%s)", topicID, topic.Name))
			}

			// Set topic context for file operations, then append attachment metadata
			internal.SetCurrentTopic(topicID)
			if len(attachments) > 0 {
				message = internal.AppendAttachments(message, attachments)
			}

			activeRun, err := internal.GetActiveRun(db, topicID)
			if err != nil {
				return err
			}
			if activeRun != nil {
				elapsed := time.Since(time.Unix(activeRun.StartedAt, 0)).Truncate(time.Second)
				return fmt.Errorf("topic %s has an active run (%s, running %s)\n  → inject:  send -p '...' -r %s\n  → watch:   get-run %s\n  → cancel:  cancel-run %s",
					topicID, activeRun.ID, elapsed, activeRun.ID, activeRun.ID, activeRun.ID)
			}

			if async {
				return startAsync(db, topicID, message, out)
			}
			return runSync(db, topicID, message, attachments, out)
		},
	}

	cmd.Flags().StringVarP(&payload, "payload", "p", "", "Message to send")
	cmd.Flags().StringVarP(&topicID, "topic", "t", "", "Topic ID")
	cmd.Flags().StringVarP(&runID, "run", "r", "", "Inject into active run")
	cmd.Flags().BoolVar(&async, "async", false, "Run in background")

	return cmd
}

func prepareRunEnvironment(topicID string) error {
	if err := internal.EnsureTopicDir(topicID); err != nil {
		return fmt.Errorf("ensure topic dir: %w", err)
	}
	internal.SetCurrentTopic(topicID)
	internal.EnsureSkillsDir()
	return nil
}

func buildRunContext(db *sql.DB, cfg *internal.Config, topicID, message string, attachments []string) (*internal.ContextResult, error) {
	ctx, err := internal.BuildContext(db, cfg, topicID, message)
	if err != nil {
		return nil, err
	}
	if len(attachments) > 0 {
		if images := internal.ReadImageAttachments(attachments); len(images) > 0 {
			lastMsg := &ctx.Messages[len(ctx.Messages)-1]
			lastMsg.Images = images
		}
	}
	return ctx, nil
}

func runSync(db *sql.DB, topicID, message string, attachments []string, out internal.Output) error {
	cfg, err := internal.LoadConfig()
	if err != nil {
		return err
	}

	if err := prepareRunEnvironment(topicID); err != nil {
		return err
	}

	internal.ProbeClips(cfg)

	run, err := internal.CreateRun(db, topicID, os.Getpid(), false)
	if err != nil {
		return err
	}

	ctx, err := buildRunContext(db, cfg, topicID, message, attachments)
	if err != nil {
		_ = internal.FinishRun(db, run.ID, "error")
		return err
	}

	registry := buildRegistry(db, cfg)
	rc := &internal.RunContext{DB: db, RunID: run.ID}

	newMsgs, err := internal.RunLoop(cfg, ctx, registry, out, rc)
	if err != nil {
		_ = internal.FinishRun(db, run.ID, "error")
		return err
	}

	if err := internal.SaveMessages(db, topicID, run.ID, newMsgs); err != nil {
		_ = internal.FinishRun(db, run.ID, "error")
		return err
	}

	spawnMemoryWorker(topicID, run.ID)
	return nil
}

func startAsync(db *sql.DB, topicID, message string, out internal.Output) error {
	run, err := internal.CreateRun(db, topicID, 0, true)
	if err != nil {
		return err
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}

	cmd := exec.Command(exe, "_run-worker",
		"--run-id", run.ID,
		"--topic-id", topicID,
		"--message", message)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	if err := cmd.Start(); err != nil {
		_ = internal.FinishRun(db, run.ID, "error")
		return fmt.Errorf("start worker: %w", err)
	}

	if _, err := db.Exec("UPDATE runs SET pid = ? WHERE id = ?", cmd.Process.Pid, run.ID); err != nil {
		_ = internal.FinishRun(db, run.ID, "error")
		return fmt.Errorf("update worker pid: %w", err)
	}

	out.Info(fmt.Sprintf("[run] %s started (async, pid %d)", run.ID, cmd.Process.Pid))
	out.Info(fmt.Sprintf("  → watch:   get-run %s", run.ID))
	out.Info(fmt.Sprintf("  → inject:  send -p '...' -r %s", run.ID))
	out.Info(fmt.Sprintf("  → cancel:  cancel-run %s", run.ID))

	return nil
}

func workerCmd() *cobra.Command {
	var runID, topicID, message string

	cmd := &cobra.Command{
		Use:    "_run-worker",
		Hidden: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := internal.LoadConfig()
			if err != nil {
				return err
			}

			db, err := internal.OpenDB()
			if err != nil {
				return err
			}
			defer db.Close()

			if err := prepareRunEnvironment(topicID); err != nil {
				_ = internal.FinishRun(db, runID, "error")
				return err
			}

			if _, err := db.Exec("UPDATE runs SET pid = ? WHERE id = ?", os.Getpid(), runID); err != nil {
				_ = internal.FinishRun(db, runID, "error")
				return fmt.Errorf("update run pid: %w", err)
			}

			ctx, err := buildRunContext(db, cfg, topicID, message, nil)
			if err != nil {
				_ = internal.FinishRun(db, runID, "error")
				return err
			}

			registry := buildRegistry(db, cfg)
			out := internal.AsyncFileOutput(runID)
			rc := &internal.RunContext{DB: db, RunID: runID}

			newMsgs, err := internal.RunLoop(cfg, ctx, registry, out, rc)
			if err != nil {
				out.Info(fmt.Sprintf("[error] %v", err))
				_ = internal.FinishRun(db, runID, "error")
				return err
			}

			if err := internal.SaveMessages(db, topicID, runID, newMsgs); err != nil {
				_ = internal.FinishRun(db, runID, "error")
				return err
			}

			internal.ProcessMemory(db, cfg, topicID, runID, newMsgs)
			return nil
		},
	}

	cmd.Flags().StringVar(&runID, "run-id", "", "")
	cmd.Flags().StringVar(&topicID, "topic-id", "", "")
	cmd.Flags().StringVar(&message, "message", "", "")
	cmd.MarkFlagsRequiredTogether("run-id", "topic-id", "message")

	return cmd
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
				run.ID, run.TopicID, run.Status,
				time.Unix(run.StartedAt, 0).Format("15:04:05")))

			if run.Async {
				output := internal.ReadOutput(run.ID)
				if output != "" {
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
				p, _ := os.FindProcess(run.PID)
				_ = p.Signal(syscall.SIGTERM)
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

			msgs, err := internal.LoadMessagesPage(db, args[0], limit)
			if err != nil {
				return err
			}

			// Convert to a web-friendly format
			topicID := args[0]
			type webToolCall struct {
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			}
			type webAttachment struct {
				Name    string `json:"name"`
				URL     string `json:"url"`
				IsImage bool   `json:"is_image"`
			}
			type webMsg struct {
				Role        string          `json:"role"`
				Content     string          `json:"content"`
				ToolCallID  string          `json:"tool_call_id,omitempty"`
				Reasoning   string          `json:"reasoning,omitempty"`
				ToolCalls   []webToolCall   `json:"tool_calls,omitempty"`
				Attachments []webAttachment `json:"attachments,omitempty"`
			}
			result := make([]webMsg, 0, len(msgs))
			for _, m := range msgs {
				wm := webMsg{
					Role:       m.Role,
					ToolCallID: m.ToolCallID,
				}
				if m.Content != nil {
					wm.Content = *m.Content
				}
				if m.Reasoning != nil {
					wm.Reasoning = *m.Reasoning
				}
				// Add tool calls
				for _, tc := range m.ToolCalls {
					wm.ToolCalls = append(wm.ToolCalls, webToolCall{
						Name:      tc.Function.Name,
						Arguments: tc.Function.Arguments,
					})
				}
				// Sanitize for display
				if wm.Role == "user" {
					var attachPaths []string
					wm.Content, attachPaths = internal.ExtractUserContent(wm.Content)
					for _, p := range attachPaths {
						wm.Attachments = append(wm.Attachments, webAttachment{
							Name:    p,
							URL:     internal.AttachmentToURL(topicID, p),
							IsImage: internal.IsImageFile(p),
						})
					}
				}
				if wm.Role == "assistant" {
					wm.Content, wm.Reasoning = internal.ExtractThinking(wm.Content, wm.Reasoning)
				}
				result = append(result, wm)
			}

			// Check for active run
			type webRun struct {
				ID        string `json:"id"`
				Status    string `json:"status"`
				StartedAt int64  `json:"started_at"`
				Async     bool   `json:"async"`
				Output    string `json:"output,omitempty"`
			}
			type topicResponse struct {
				Messages  []webMsg `json:"messages"`
				ActiveRun *webRun  `json:"active_run"`
			}

			resp := topicResponse{Messages: result}

			activeRun, _ := internal.GetActiveRun(db, args[0])
			if activeRun != nil {
				wr := &webRun{
					ID:        activeRun.ID,
					Status:    activeRun.Status,
					StartedAt: activeRun.StartedAt,
					Async:     activeRun.Async,
				}
				if activeRun.Async {
					wr.Output = internal.ReadOutput(activeRun.ID)
				}
				resp.ActiveRun = wr
			}

			out.Result(resp)
			return nil
		},
	}

	cmd.Flags().IntVarP(&limit, "limit", "l", 100, "Max messages to return (0 = all, default 100)")
	return cmd
}

func createTopicCmd() *cobra.Command {
	var name string

	cmd := &cobra.Command{
		Use:   "create-topic",
		Short: "Create a new conversation topic",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()
			if name == "" {
				var input struct {
					Name string `json:"name"`
				}
				if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
					return fmt.Errorf("read stdin: %w", err)
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

			// Check which topics have active runs
			activeTopics := internal.GetActiveRunTopics(db)

			type webTopic struct {
				ID            string `json:"id"`
				Name          string `json:"name"`
				MessageCount  int    `json:"message_count"`
				CreatedAt     int64  `json:"created_at"`
				LastMessageAt int64  `json:"last_message_at"`
				HasActiveRun  bool   `json:"has_active_run,omitempty"`
			}
			result := make([]webTopic, 0, len(topics))
			for _, t := range topics {
				wt := webTopic{
					ID:            t.ID,
					Name:          t.Name,
					MessageCount:  t.MessageCount,
					CreatedAt:     t.CreatedAt,
					LastMessageAt: t.LastMessageAt,
					HasActiveRun:  activeTopics[t.ID],
				}
				result = append(result, wt)
			}

			out.Result(result)
			return nil
		},
	}

	cmd.Flags().IntVarP(&limit, "limit", "l", 20, "Max topics to return")
	cmd.Flags().IntVar(&offset, "offset", 0, "Skip first N topics")
	return cmd
}

func uploadCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "upload",
		Short: "Upload a file to a topic directory",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()

			var input internal.UploadInput
			if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
				return fmt.Errorf("read stdin: %w", err)
			}

			result, err := internal.UploadFile(&input)
			if err != nil {
				return err
			}

			out.Result(result)
			return nil
		},
	}
}

func spawnMemoryWorker(topicID, runID string) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	cmd := exec.Command(exe, "_process-memory", "--topic-id", topicID, "--run-id", runID)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Start()
}

func memoryWorkerCmd() *cobra.Command {
	var topicID, runID string

	cmd := &cobra.Command{
		Use:    "_process-memory",
		Hidden: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := internal.LoadConfig()
			if err != nil {
				return err
			}
			db, err := internal.OpenDB()
			if err != nil {
				return err
			}
			defer db.Close()

			msgs, err := internal.LoadMessagesByRunID(db, runID)
			if err != nil {
				return err
			}
			internal.ProcessMemory(db, cfg, topicID, runID, msgs)
			return nil
		},
	}

	cmd.Flags().StringVar(&topicID, "topic-id", "", "")
	cmd.Flags().StringVar(&runID, "run-id", "", "")
	return cmd
}
