package main

import (
	"fmt"
	"os"

	"agent-clip/internal"

	"github.com/spf13/cobra"
)

func uploadCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "upload",
		Short: "Upload a file to a topic directory",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := getOutput()
			var input internal.UploadInput
			if err := decodeJSONFromStdin(&input); err != nil {
				return err
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
	_ = spawnDetachedAgent("_process-memory", "--topic-id", topicID, "--run-id", runID)
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
