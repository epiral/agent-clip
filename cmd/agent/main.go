package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
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
	root.AddCommand(getRunCmd())
	root.AddCommand(cancelRunCmd())
	root.AddCommand(workerCmd())

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
	internal.RegisterClipCommands(registry, cfg)
	internal.RegisterMemoryCommands(registry, db, cfg)
	return registry
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
			if message == "" {
				var input struct {
					Message string `json:"message"`
					TopicID string `json:"topic_id"`
					RunID   string `json:"run_id"`
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
			return runSync(db, topicID, message, out)
		},
	}

	cmd.Flags().StringVarP(&payload, "payload", "p", "", "Message to send")
	cmd.Flags().StringVarP(&topicID, "topic", "t", "", "Topic ID")
	cmd.Flags().StringVarP(&runID, "run", "r", "", "Inject into active run")
	cmd.Flags().BoolVar(&async, "async", false, "Run in background")

	return cmd
}

func runSync(db *sql.DB, topicID, message string, out internal.Output) error {
	cfg, err := internal.LoadConfig()
	if err != nil {
		return err
	}

	history, err := internal.LoadMessages(db, topicID)
	if err != nil {
		return err
	}

	run, err := internal.CreateRun(db, topicID, os.Getpid(), false)
	if err != nil {
		return err
	}

	registry := buildRegistry(db, cfg)
	rc := &internal.RunContext{DB: db, RunID: run.ID}

	newMsgs, err := internal.RunLoop(cfg, history, message, registry, out, rc)
	if err != nil {
		_ = internal.FinishRun(db, run.ID, "error")
		return err
	}

	if err := internal.SaveMessages(db, topicID, newMsgs); err != nil {
		_ = internal.FinishRun(db, run.ID, "error")
		return err
	}

	// process memory asynchronously
	internal.ProcessMemory(db, cfg, topicID, newMsgs)

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

	db.Exec("UPDATE runs SET pid = ? WHERE id = ?", cmd.Process.Pid, run.ID)

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

			db.Exec("UPDATE runs SET pid = ? WHERE id = ?", os.Getpid(), runID)

			history, err := internal.LoadMessages(db, topicID)
			if err != nil {
				_ = internal.FinishRun(db, runID, "error")
				return err
			}

			registry := buildRegistry(db, cfg)
			out := internal.AsyncFileOutput(runID)
			rc := &internal.RunContext{DB: db, RunID: runID}

			newMsgs, err := internal.RunLoop(cfg, history, message, registry, out, rc)
			if err != nil {
				out.Info(fmt.Sprintf("[error] %v", err))
				_ = internal.FinishRun(db, runID, "error")
				return err
			}

			if err := internal.SaveMessages(db, topicID, newMsgs); err != nil {
				_ = internal.FinishRun(db, runID, "error")
				return err
			}

			// process memory (sync in worker since it's already background)
			internal.ProcessMemory(db, cfg, topicID, newMsgs)

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
	return &cobra.Command{
		Use:   "list-topics",
		Short: "List all conversation topics",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()
			db, err := internal.OpenDB()
			if err != nil {
				return err
			}
			defer db.Close()

			topics, err := internal.ListTopics(db)
			if err != nil {
				return err
			}

			out.Result(topics)
			return nil
		},
	}
}
