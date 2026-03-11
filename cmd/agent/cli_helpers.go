package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"syscall"

	"agent-clip/internal"
)

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

func decodeJSONFromStdin(target any) error {
	if err := json.NewDecoder(os.Stdin).Decode(target); err != nil {
		return fmt.Errorf("read stdin: %w", err)
	}
	return nil
}

func spawnDetachedAgent(args ...string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start detached agent: %w", err)
	}
	return nil
}
