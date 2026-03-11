package main

import (
	"fmt"
	"os"

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
