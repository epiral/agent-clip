package internal

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const maxIterations = 20

type RunContext struct {
	DB    *sql.DB
	RunID string
}

// RunLoop executes the agentic loop.
// contextResult comes from BuildContext (pre-assembled system prompt + messages).
func RunLoop(cfg *Config, ctx *ContextResult, registry *Registry, out Output, rc *RunContext) ([]Message, error) {
	context := []Message{TextMessage("system", ctx.SystemPrompt)}
	context = append(context, ctx.Messages...)

	// newMsgs tracks messages generated in THIS Run (for saving)
	// the last message in ctx.Messages is the new user message
	lastMsg := ctx.Messages[len(ctx.Messages)-1]
	newMsgs := []Message{lastMsg}

	tools := []ToolDef{RunToolDef(registry.Help())}

	for i := 0; i < maxIterations; i++ {
		// check inbox
		if rc != nil && rc.DB != nil {
			if injected, _ := DrainInbox(rc.DB, rc.RunID); len(injected) > 0 {
				for _, msg := range injected {
					out.Inject(msg)
					injectMsg := TextMessage("user", fmt.Sprintf("<user>\n%s\n</user>", msg))
					context = append(context, injectMsg)
					newMsgs = append(newMsgs, injectMsg)
				}
			}
		}

		thinkingStarted := false
		resp, err := CallLLM(cfg, context, tools, func(token string) {
			out.Text(token)
		}, func(token string) {
			if !thinkingStarted {
				out.Thinking("[thinking] ")
				thinkingStarted = true
			}
			out.Thinking(token)
		})
		if err != nil {
			return nil, err
		}

		// No trailing \n for thinking — the UI handles block boundaries

		// --- tool_calls ---
		if len(resp.ToolCalls) > 0 {
			assistantMsg := Message{Role: "assistant", ToolCalls: resp.ToolCalls}
			if resp.Content != "" {
				assistantMsg.Content = &resp.Content
			}
			if resp.Reasoning != "" {
				assistantMsg.Reasoning = &resp.Reasoning
			}
			context = append(context, assistantMsg)
			newMsgs = append(newMsgs, assistantMsg)

			for _, tc := range resp.ToolCalls {
				out.ToolCall(tc.Function.Name, tc.Function.Arguments)
				result := execToolCall(registry, tc)
				out.ToolResult(result)
				toolResult := ToolResultMessage(tc.ID, result)
				// Auto-attach vision data for images referenced in tool results
				toolResult.Images = extractImagesFromResult(result)
				context = append(context, toolResult)
				newMsgs = append(newMsgs, toolResult)
			}
			continue
		}

		// --- stop → atomic finish ---
		assistantMsg := TextMessage("assistant", resp.Content)
		if resp.Reasoning != "" {
			assistantMsg.Reasoning = &resp.Reasoning
		}

		if rc != nil && rc.DB != nil {
			injected, err := TryFinishRun(rc.DB, rc.RunID, "done")
			if err != nil {
				return nil, fmt.Errorf("finish run: %w", err)
			}
			if len(injected) > 0 {
				newMsgs = append(newMsgs, assistantMsg)
				context = append(context, assistantMsg)
				for _, msg := range injected {
					out.Inject(msg)
					injectMsg := TextMessage("user", fmt.Sprintf("<user>\n%s\n</user>", msg))
					context = append(context, injectMsg)
					newMsgs = append(newMsgs, injectMsg)
				}
				continue
			}
		}

		newMsgs = append(newMsgs, assistantMsg)
		out.Done()
		return newMsgs, nil
	}

	return nil, fmt.Errorf("agentic loop exceeded %d iterations", maxIterations)
}

func execToolCall(registry *Registry, tc ToolCall) string {
	var args struct {
		Command string `json:"command"`
		Stdin   string `json:"stdin"`
	}
	if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
		return fmt.Sprintf("[error] parse arguments: %v", err)
	}

	// If LLM uses a command name as the tool name instead of "run",
	// prepend it to the command string (avoid double-prefix).
	if tc.Function.Name != "run" {
		if args.Command == "" || !strings.HasPrefix(args.Command, tc.Function.Name) {
			cmd := tc.Function.Name
			if args.Command != "" {
				cmd += " " + args.Command
			}
			args.Command = cmd
		}
	}

	if args.Command == "" {
		return "[error] empty command"
	}

	return registry.Exec(args.Command, args.Stdin)
}

// pinixDataURLRe matches pinix-data://local/data/images/xxx.png paths in tool results
var pinixDataURLRe = regexp.MustCompile(`pinix-data://local/data/(images/[^\s)]+)`)

// extractImagesFromResult scans a tool result for pinix-data:// image URLs,
// reads the corresponding files from data/, and returns ImageData for vision.
func extractImagesFromResult(result string) []ImageData {
	matches := pinixDataURLRe.FindAllStringSubmatch(result, -1)
	if len(matches) == 0 {
		return nil
	}

	var images []ImageData
	for _, m := range matches {
		relPath := m[1] // e.g., "images/screenshot-xxx.png"
		if !isImageFile(relPath) {
			continue
		}

		absPath := filepath.Join(dataRoot(), relPath)
		data, err := os.ReadFile(absPath)
		if err != nil {
			continue
		}

		// Determine MIME type
		mime := "image/png"
		ext := strings.ToLower(filepath.Ext(relPath))
		switch ext {
		case ".jpg", ".jpeg":
			mime = "image/jpeg"
		case ".webp":
			mime = "image/webp"
		case ".gif":
			mime = "image/gif"
		}

		images = append(images, ImageData{
			Base64:   base64.StdEncoding.EncodeToString(data),
			MimeType: mime,
		})
	}

	return images
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "..."
}
