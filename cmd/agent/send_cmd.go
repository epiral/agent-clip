package main

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	"agent-clip/internal"

	"github.com/spf13/cobra"
)

type sendInput struct {
	Message     string   `json:"message"`
	TopicID     string   `json:"topic_id"`
	RunID       string   `json:"run_id"`
	Attachments []string `json:"attachments"`
}

func sendCmd() *cobra.Command {
	var payload, topicID, runID string
	var async bool

	cmd := &cobra.Command{
		Use:   "send",
		Short: "Send a message and run the agentic loop",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()
			message, attachments, err := resolveSendInput(payload, &topicID, &runID)
			if err != nil {
				return err
			}
			if message == "" {
				return fmt.Errorf("message is required (-p or stdin JSON)")
			}

			if runID != "" {
				return injectIntoRun(runID, message, out)
			}

			db, err := internal.OpenDB()
			if err != nil {
				return err
			}
			defer db.Close()

			topicID, err = ensureTopic(db, topicID, message, out)
			if err != nil {
				return err
			}

			internal.SetCurrentTopic(topicID)
			if len(attachments) > 0 {
				message = internal.AppendAttachments(message, attachments)
			}

			if err := ensureNoActiveRun(db, topicID); err != nil {
				return err
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

func resolveSendInput(payload string, topicID, runID *string) (string, []string, error) {
	message := payload
	var attachments []string
	if message != "" {
		return message, attachments, nil
	}

	var input sendInput
	if err := decodeJSONFromStdin(&input); err != nil {
		return "", nil, err
	}
	message = input.Message
	if *topicID == "" {
		*topicID = input.TopicID
	}
	if *runID == "" {
		*runID = input.RunID
	}
	return message, input.Attachments, nil
}

func injectIntoRun(runID, message string, out internal.Output) error {
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

func ensureTopic(db *sql.DB, topicID, message string, out internal.Output) (string, error) {
	if topicID != "" {
		return topicID, nil
	}
	name := message
	if len([]rune(name)) > 30 {
		name = string([]rune(name)[:30]) + "..."
	}
	topic, err := internal.CreateTopic(db, name)
	if err != nil {
		return "", err
	}
	out.Info(fmt.Sprintf("[topic] %s (%s)", topic.ID, topic.Name))
	return topic.ID, nil
}

func ensureNoActiveRun(db *sql.DB, topicID string) error {
	activeRun, err := internal.GetActiveRun(db, topicID)
	if err != nil {
		return err
	}
	if activeRun == nil {
		return nil
	}
	elapsed := time.Since(time.Unix(activeRun.StartedAt, 0)).Truncate(time.Second)
	return fmt.Errorf("topic %s has an active run (%s, running %s)\n  → inject:  send -p '...' -r %s\n  → watch:   get-run %s\n  → cancel:  cancel-run %s",
		topicID, activeRun.ID, elapsed, activeRun.ID, activeRun.ID, activeRun.ID)
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
	if err := spawnDetachedAgent("_run-worker", "--run-id", run.ID, "--topic-id", topicID, "--message", message); err != nil {
		_ = internal.FinishRun(db, run.ID, "error")
		return fmt.Errorf("start worker: %w", err)
	}

	workerRun, err := internal.GetRun(db, run.ID)
	if err != nil {
		_ = internal.FinishRun(db, run.ID, "error")
		return err
	}
	out.Info(fmt.Sprintf("[run] %s started (async, pid %d)", run.ID, workerRun.PID))
	out.Info(fmt.Sprintf("  → watch:   get-run %s", run.ID))
	out.Info(fmt.Sprintf("  → inject:  send -p '...' -r %s", run.ID))
	out.Info(fmt.Sprintf("  → cancel:  cancel-run %s", run.ID))
	return nil
}
