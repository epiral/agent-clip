package main

import (
	"fmt"
	"strings"

	"agent-clip/internal"

	"github.com/spf13/cobra"
)

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
		RunE: runConfigCmd,
	}
}

func runConfigCmd(cmd *cobra.Command, args []string) error {
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
	default:
		return fmt.Errorf("unknown subcommand: %s", args[0])
	}
}
