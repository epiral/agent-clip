package internal

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
)

// --- Anthropic request types ---

type anthRequest struct {
	Model     string        `json:"model"`
	System    string        `json:"system,omitempty"`
	MaxTokens int           `json:"max_tokens"`
	Stream    bool          `json:"stream"`
	Messages  []anthMessage `json:"messages"`
	Tools     []anthTool    `json:"tools,omitempty"`
}

type anthMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"` // string or []anthBlock
}

// anthBlock represents a content block in the Anthropic protocol.
// Fields are type-specific; omitempty ensures only relevant fields appear.
type anthBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`        // text block
	Thinking  string          `json:"thinking,omitempty"`    // thinking block
	Signature string          `json:"signature,omitempty"`   // thinking block signature
	ID        string          `json:"id,omitempty"`          // tool_use block
	Name      string          `json:"name,omitempty"`        // tool_use block
	Input     json.RawMessage `json:"input,omitempty"`       // tool_use block
	ToolUseID string          `json:"tool_use_id,omitempty"` // tool_result block
	Content   string          `json:"content,omitempty"`     // tool_result block result
}

type anthTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

// --- Anthropic streaming response types ---

type anthSSEvent struct {
	Type         string `json:"type"`
	Index        int    `json:"index"`
	ContentBlock struct {
		Type string `json:"type"`
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"content_block"`
	Delta struct {
		Type        string `json:"type"`
		Text        string `json:"text"`
		Thinking    string `json:"thinking"`
		PartialJSON string `json:"partial_json"`
	} `json:"delta"`
}

// --- Message conversion: internal → Anthropic ---

func convertMessagesForAnthropic(messages []Message) (string, []anthMessage) {
	var system string
	var result []anthMessage

	i := 0
	for i < len(messages) {
		msg := messages[i]

		// Extract system prompt
		if msg.Role == "system" {
			if msg.Content != nil {
				system = *msg.Content
			}
			i++
			continue
		}

		// User message
		if msg.Role == "user" {
			content := ""
			if msg.Content != nil {
				content = *msg.Content
			}
			userBlock := anthBlock{Type: "text", Text: content}

			// Check if we can merge with previous user message (e.g., tool_results followed by user)
			if len(result) > 0 && result[len(result)-1].Role == "user" {
				if blocks, ok := result[len(result)-1].Content.([]anthBlock); ok {
					result[len(result)-1].Content = append(blocks, userBlock)
				}
			} else {
				result = append(result, anthMessage{
					Role:    "user",
					Content: []anthBlock{userBlock},
				})
			}
			i++
			continue
		}

		// Assistant message
		if msg.Role == "assistant" {
			var blocks []anthBlock
			if msg.Reasoning != nil && *msg.Reasoning != "" {
				blocks = append(blocks, anthBlock{Type: "thinking", Thinking: *msg.Reasoning})
			}
			if msg.Content != nil && *msg.Content != "" {
				blocks = append(blocks, anthBlock{Type: "text", Text: *msg.Content})
			}
			for _, tc := range msg.ToolCalls {
				input := json.RawMessage(tc.Function.Arguments)
				blocks = append(blocks, anthBlock{
					Type:  "tool_use",
					ID:    tc.ID,
					Name:  tc.Function.Name,
					Input: input,
				})
			}
			if len(blocks) == 0 {
				blocks = append(blocks, anthBlock{Type: "text", Text: ""})
			}
			result = append(result, anthMessage{Role: "assistant", Content: blocks})
			i++
			continue
		}

		// Tool result — merge consecutive tool messages into one user message
		if msg.Role == "tool" {
			var toolBlocks []anthBlock
			for i < len(messages) && messages[i].Role == "tool" {
				content := ""
				if messages[i].Content != nil {
					content = *messages[i].Content
				}
				toolBlocks = append(toolBlocks, anthBlock{
					Type:      "tool_result",
					ToolUseID: messages[i].ToolCallID,
					Content:   content,
				})
				i++
			}
			// Merge with previous user message if any, otherwise create new
			if len(result) > 0 && result[len(result)-1].Role == "user" {
				if blocks, ok := result[len(result)-1].Content.([]anthBlock); ok {
					result[len(result)-1].Content = append(blocks, toolBlocks...)
				}
			} else {
				result = append(result, anthMessage{
					Role:    "user",
					Content: toolBlocks,
				})
			}
			continue
		}

		i++
	}

	return system, result
}

// --- Tool conversion: OpenAI → Anthropic ---

func convertToolsForAnthropic(tools []ToolDef) []anthTool {
	out := make([]anthTool, 0, len(tools))
	for _, t := range tools {
		out = append(out, anthTool{
			Name:        t.Function.Name,
			Description: t.Function.Description,
			InputSchema: t.Function.Parameters,
		})
	}
	return out
}

// --- Anthropic streaming call ---

func callAnthropic(provider *ProviderConfig, model string, messages []Message, tools []ToolDef, onToken func(string), onThinking func(string)) (*LLMResponse, error) {
	system, anthMsgs := convertMessagesForAnthropic(messages)
	anthTools := convertToolsForAnthropic(tools)

	body, err := json.Marshal(anthRequest{
		Model:     model,
		System:    system,
		MaxTokens: 16384,
		Stream:    true,
		Messages:  anthMsgs,
		Tools:     anthTools,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal anthropic request: %w", err)
	}

	url := provider.BaseURL + "/v1/messages"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("x-api-key", provider.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("anthropic error %d: %s", resp.StatusCode, string(b))
	}

	return parseAnthropicStream(resp.Body, onToken, onThinking)
}

type blockState struct {
	blockType string
	toolID    string
	toolName  string
	argsBuf   strings.Builder
}

func parseAnthropicStream(body io.Reader, onToken func(string), onThinking func(string)) (*LLMResponse, error) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var contentBuf strings.Builder
	var reasoningBuf strings.Builder
	blocks := make(map[int]*blockState)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")

		var event anthSSEvent
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		switch event.Type {
		case "content_block_start":
			blocks[event.Index] = &blockState{
				blockType: event.ContentBlock.Type,
				toolID:    event.ContentBlock.ID,
				toolName:  event.ContentBlock.Name,
			}

		case "content_block_delta":
			bs := blocks[event.Index]
			if bs == nil {
				continue
			}
			switch event.Delta.Type {
			case "thinking_delta":
				reasoningBuf.WriteString(event.Delta.Thinking)
				if onThinking != nil {
					onThinking(event.Delta.Thinking)
				}
			case "text_delta":
				contentBuf.WriteString(event.Delta.Text)
				if onToken != nil {
					onToken(event.Delta.Text)
				}
			case "input_json_delta":
				bs.argsBuf.WriteString(event.Delta.PartialJSON)
			}

		case "message_stop":
			// done
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read anthropic stream: %w", err)
	}

	result := &LLMResponse{
		Content:   contentBuf.String(),
		Reasoning: reasoningBuf.String(),
	}

	// Collect tool calls
	var toolIndices []int
	for idx, bs := range blocks {
		if bs.blockType == "tool_use" {
			toolIndices = append(toolIndices, idx)
		}
	}
	sort.Ints(toolIndices)
	for _, idx := range toolIndices {
		bs := blocks[idx]
		result.ToolCalls = append(result.ToolCalls, ToolCall{
			ID:   bs.toolID,
			Type: "function",
			Function: FunctionCall{
				Name:      bs.toolName,
				Arguments: bs.argsBuf.String(),
			},
		})
	}

	return result, nil
}
