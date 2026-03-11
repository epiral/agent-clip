package main

import (
	"fmt"

	"agent-clip/internal"

	"github.com/spf13/cobra"
)

type skillPayload struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
}

type skillSummary struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func skillCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "skill [subcommand]",
		Short: "Manage skills (list, get, save, delete)",
		RunE:  runSkillCmd,
	}
}

func runSkillCmd(cmd *cobra.Command, args []string) error {
	out := getOutput()
	internal.EnsureSkillsDir()

	if len(args) == 0 || args[0] == "list" {
		skills, err := internal.ListSkills()
		if err != nil {
			return err
		}
		result := make([]skillSummary, len(skills))
		for index, skill := range skills {
			result[index] = skillSummary{Name: skill.Name, Description: skill.Description}
		}
		out.Result(result)
		return nil
	}

	switch args[0] {
	case "get":
		if len(args) < 2 {
			return fmt.Errorf("usage: skill get <name>")
		}
		description, body, err := internal.LoadSkill(args[1])
		if err != nil {
			return err
		}
		out.Result(map[string]string{
			"name":        args[1],
			"description": description,
			"content":     body,
		})
		return nil
	case "save":
		var input skillPayload
		if err := decodeJSONFromStdin(&input); err != nil {
			return err
		}
		if input.Name == "" {
			return fmt.Errorf("name is required")
		}
		if err := saveSkill(input); err != nil {
			return err
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
	default:
		return fmt.Errorf("unknown: skill %s", args[0])
	}
}

func saveSkill(input skillPayload) error {
	_, _, err := internal.LoadSkill(input.Name)
	if err != nil {
		return internal.CreateSkill(input.Name, input.Description, input.Content)
	}
	return internal.UpdateSkill(input.Name, &input.Description, &input.Content)
}
