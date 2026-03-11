package internal

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
)

var httpClient = &http.Client{
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	},
}

// --- Message types ---

type Message struct {
	Role       string      `json:"role"`
	Content    *string     `json:"content"`
	ToolCalls  []ToolCall  `json:"tool_calls,omitempty"`
	ToolCallID string      `json:"tool_call_id,omitempty"`
	Reasoning  *string     `json:"-"`
	Images     []ImageData `json:"-"` // vision content; not persisted to DB, only for LLM API
}

type ImageData struct {
	Base64   string
	MimeType string
}

type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function FunctionCall `json:"function"`
}

type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

func TextMessage(role, content string) Message {
	return Message{Role: role, Content: &content}
}

func ToolResultMessage(toolCallID, content string) Message {
	return Message{Role: "tool", Content: &content, ToolCallID: toolCallID}
}

// --- Tool definition ---

type ToolDef struct {
	Type     string          `json:"type"`
	Function ToolFunctionDef `json:"function"`
}

type ToolFunctionDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

// --- LLM call ---

type LLMResponse struct {
	Content   string
	Reasoning string
	ToolCalls []ToolCall
}

type chatRequest struct {
	Model     string          `json:"model"`
	Messages  json.RawMessage `json:"messages"`
	Tools     []ToolDef       `json:"tools,omitempty"`
	Stream    bool            `json:"stream"`
	MaxTokens int             `json:"max_tokens,omitempty"`
}

// apiMessage is the wire format for LLM API messages, supporting multimodal content.
type apiMessage struct {
	Role       string      `json:"role"`
	Content    interface{} `json:"content"`
	ToolCalls  []ToolCall  `json:"tool_calls,omitempty"`
	ToolCallID string      `json:"tool_call_id,omitempty"`
}

type contentPart struct {
	Type     string    `json:"type"`
	Text     string    `json:"text,omitempty"`
	ImageURL *imageURL `json:"image_url,omitempty"`
}

type imageURL struct {
	URL    string `json:"url"`
	Detail string `json:"detail,omitempty"`
}

// messagesToAPI converts internal Messages to API wire format,
// expanding multimodal content when Images are present.
func messagesToAPI(msgs []Message) json.RawMessage {
	apiMsgs := make([]apiMessage, 0, len(msgs))
	for _, m := range msgs {
		am := apiMessage{
			Role:       m.Role,
			ToolCalls:  m.ToolCalls,
			ToolCallID: m.ToolCallID,
		}

		if len(m.Images) > 0 {
			// Multimodal: content is array of parts
			parts := []contentPart{}
			if m.Content != nil && *m.Content != "" {
				parts = append(parts, contentPart{Type: "text", Text: *m.Content})
			}
			for _, img := range m.Images {
				parts = append(parts, contentPart{
					Type: "image_url",
					ImageURL: &imageURL{
						URL:    fmt.Sprintf("data:%s;base64,%s", img.MimeType, img.Base64),
						Detail: "low",
					},
				})
			}
			am.Content = parts
		} else if m.Content != nil {
			am.Content = *m.Content
		}

		apiMsgs = append(apiMsgs, am)
	}

	b, _ := json.Marshal(apiMsgs)
	return b
}

type streamDelta struct {
	Content          string           `json:"content"`
	ReasoningContent string           `json:"reasoning_content"`
	ToolCalls        []streamToolCall `json:"tool_calls"`
}

type streamToolCall struct {
	Index    int    `json:"index"`
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type streamChunk struct {
	Choices []struct {
		Delta        streamDelta `json:"delta"`
		FinishReason *string     `json:"finish_reason"`
	} `json:"choices"`
}

// CallLLM dispatches to the appropriate protocol based on provider config.
func CallLLM(cfg *Config, messages []Message, tools []ToolDef, onToken func(string), onThinking func(string)) (*LLMResponse, error) {
	provider, err := cfg.GetLLMProvider()
	if err != nil {
		return nil, err
	}
	if provider.APIKey == "" {
		return nil, fmt.Errorf("no api_key for llm provider %q", cfg.LLMProvider)
	}

	switch provider.Protocol {
	case "anthropic":
		return callAnthropic(provider, cfg.LLMModel, messages, tools, onToken, onThinking)
	default:
		return callOpenAI(provider, cfg.LLMModel, messages, tools, onToken, onThinking)
	}
}

// callOpenAI implements the OpenAI ChatCompletion streaming protocol.
func callOpenAI(provider *ProviderConfig, model string, messages []Message, tools []ToolDef, onToken func(string), onThinking func(string)) (*LLMResponse, error) {
	body, err := json.Marshal(chatRequest{
		Model:     model,
		Messages:  messagesToAPI(messages),
		Tools:     tools,
		Stream:    true,
		MaxTokens: 16384,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := provider.BaseURL + "/chat/completions"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+provider.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("LLM error %d: %s", resp.StatusCode, string(b))
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var contentBuf strings.Builder
	var reasoningBuf strings.Builder
	tcMap := make(map[int]*ToolCall)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk streamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) == 0 {
			continue
		}

		delta := chunk.Choices[0].Delta

		if delta.ReasoningContent != "" {
			reasoningBuf.WriteString(delta.ReasoningContent)
			if onThinking != nil {
				onThinking(delta.ReasoningContent)
			}
		}

		if delta.Content != "" {
			contentBuf.WriteString(delta.Content)
			if onToken != nil {
				onToken(delta.Content)
			}
		}

		for _, stc := range delta.ToolCalls {
			tc, ok := tcMap[stc.Index]
			if !ok {
				tc = &ToolCall{ID: stc.ID, Type: "function"}
				tcMap[stc.Index] = tc
			}
			if stc.Function.Name != "" {
				tc.Function.Name = stc.Function.Name
			}
			tc.Function.Arguments += stc.Function.Arguments
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read stream: %w", err)
	}

	result := &LLMResponse{Content: contentBuf.String(), Reasoning: reasoningBuf.String()}

	if len(tcMap) > 0 {
		indices := make([]int, 0, len(tcMap))
		for i := range tcMap {
			indices = append(indices, i)
		}
		sort.Ints(indices)
		for _, i := range indices {
			result.ToolCalls = append(result.ToolCalls, *tcMap[i])
		}
	}

	return result, nil
}
