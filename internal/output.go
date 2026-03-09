package internal

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// Output abstracts how commands emit results.
// CLI and Web are two implementations of the same interface.
type Output interface {
	// All commands
	Info(msg string)
	Result(v any)

	// Streaming (send)
	Thinking(token string)
	Text(token string)
	ToolCall(name, args string)
	ToolResult(content string)
	Inject(content string)
	Done()
}

// --- CLIOutput: human-readable, stdout + stderr ---

type CLIOutput struct {
	out io.Writer
	err io.Writer
}

func NewCLIOutput(out, err io.Writer) *CLIOutput {
	return &CLIOutput{out: out, err: err}
}

func DefaultCLIOutput() *CLIOutput {
	return NewCLIOutput(os.Stdout, os.Stderr)
}

func (o *CLIOutput) Info(msg string)       { fmt.Fprintln(o.err, msg) }
func (o *CLIOutput) Result(v any)          { json.NewEncoder(o.out).Encode(v) }
func (o *CLIOutput) Thinking(token string) { fmt.Fprint(o.err, token) }
func (o *CLIOutput) Text(token string)     { fmt.Fprint(o.out, token) }
func (o *CLIOutput) Done()                 { fmt.Fprintln(o.out) }

func (o *CLIOutput) ToolCall(name, args string) {
	fmt.Fprintf(o.err, "[tool] %s(%s)\n", name, truncate(args, 80))
}

func (o *CLIOutput) ToolResult(content string) {
	fmt.Fprintf(o.err, "  → %s\n", content)
}

func (o *CLIOutput) Inject(content string) {
	fmt.Fprintf(o.err, "[injected] %s\n", content)
}

// --- JSONLOutput: structured, all on stdout ---

type JSONLOutput struct {
	enc *json.Encoder
}

func NewJSONLOutput() *JSONLOutput {
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	return &JSONLOutput{enc: enc}
}

func (o *JSONLOutput) emit(v any) { o.enc.Encode(v) }

func (o *JSONLOutput) Info(msg string) {
	o.emit(map[string]string{"type": "info", "message": msg})
}

func (o *JSONLOutput) Result(v any) {
	o.emit(map[string]any{"type": "result", "data": v})
}

func (o *JSONLOutput) Thinking(token string) {
	o.emit(map[string]string{"type": "thinking", "content": token})
}

func (o *JSONLOutput) Text(token string) {
	o.emit(map[string]string{"type": "text", "content": token})
}

func (o *JSONLOutput) ToolCall(name, args string) {
	o.emit(map[string]string{"type": "tool_call", "name": name, "arguments": args})
}

func (o *JSONLOutput) ToolResult(content string) {
	o.emit(map[string]string{"type": "tool_result", "content": content})
}

func (o *JSONLOutput) Inject(content string) {
	o.emit(map[string]string{"type": "inject", "content": content})
}

func (o *JSONLOutput) Done() {
	o.emit(map[string]string{"type": "done"})
}

// NewOutput creates an Output based on format string ("raw" or "jsonl").
func NewOutput(format string) Output {
	if format == "jsonl" {
		return NewJSONLOutput()
	}
	return DefaultCLIOutput()
}

// AsyncFileOutput writes to a run's output file (for background workers).
func AsyncFileOutput(runID string) *CLIOutput {
	path := runOutputPath(runID)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o644)
	if err != nil {
		return NewCLIOutput(io.Discard, io.Discard)
	}
	return NewCLIOutput(f, f)
}
