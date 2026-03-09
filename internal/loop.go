package internal

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const maxIterations = 20

type RunContext struct {
	DB    *sql.DB
	RunID string
}

// RunLoop executes the agentic loop.
// All output goes through the Output interface.
func RunLoop(cfg *Config, history []Message, userMessage string, registry *Registry, out Output, rc *RunContext) ([]Message, error) {
	context := []Message{TextMessage("system", cfg.SystemPrompt)}
	context = append(context, history...)

	userMsg := TextMessage("user", userMessage)
	context = append(context, userMsg)
	newMsgs := []Message{userMsg}

	tools := []ToolDef{RunToolDef(registry.Help())}

	for i := 0; i < maxIterations; i++ {
		// check inbox
		if rc != nil && rc.DB != nil {
			if injected, _ := DrainInbox(rc.DB, rc.RunID); len(injected) > 0 {
				for _, msg := range injected {
					out.Inject(msg)
					injectMsg := TextMessage("user", msg)
					context = append(context, injectMsg)
					newMsgs = append(newMsgs, injectMsg)
				}
			}
		}

		resp, err := CallLLM(cfg, context, tools, func(token string) {
			out.Text(token)
		})
		if err != nil {
			return nil, err
		}

		// --- tool_calls ---
		if len(resp.ToolCalls) > 0 {
			assistantMsg := Message{Role: "assistant", ToolCalls: resp.ToolCalls}
			if resp.Content != "" {
				assistantMsg.Content = &resp.Content
			}
			context = append(context, assistantMsg)
			newMsgs = append(newMsgs, assistantMsg)

			for _, tc := range resp.ToolCalls {
				out.ToolCall(tc.Function.Name, tc.Function.Arguments)
				result := execToolCall(registry, tc)
				out.ToolResult(result)
				toolResult := ToolResultMessage(tc.ID, result)
				context = append(context, toolResult)
				newMsgs = append(newMsgs, toolResult)
			}
			continue
		}

		// --- stop → atomic finish ---
		assistantText := resp.Content

		if rc != nil && rc.DB != nil {
			injected, err := TryFinishRun(rc.DB, rc.RunID, "done")
			if err != nil {
				return nil, fmt.Errorf("finish run: %w", err)
			}
			if len(injected) > 0 {
				newMsgs = append(newMsgs, TextMessage("assistant", assistantText))
				context = append(context, TextMessage("assistant", assistantText))
				for _, msg := range injected {
					out.Inject(msg)
					injectMsg := TextMessage("user", msg)
					context = append(context, injectMsg)
					newMsgs = append(newMsgs, injectMsg)
				}
				continue
			}
		}

		newMsgs = append(newMsgs, TextMessage("assistant", assistantText))
		out.Done()
		return newMsgs, nil
	}

	return nil, fmt.Errorf("agentic loop exceeded %d iterations", maxIterations)
}

func execToolCall(registry *Registry, tc ToolCall) string {
	if tc.Function.Name != "run" {
		return fmt.Sprintf("[error] unknown tool: %s", tc.Function.Name)
	}

	var args struct {
		Command string `json:"command"`
		Stdin   string `json:"stdin"`
	}
	if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
		return fmt.Sprintf("[error] parse arguments: %v", err)
	}

	return registry.Exec(args.Command, args.Stdin)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
