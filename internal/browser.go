package internal

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

type browserRequest struct {
	ID          string `json:"id"`
	Action      string `json:"action"`
	URL         string `json:"url,omitempty"`
	Ref         string `json:"ref,omitempty"`
	Text        string `json:"text,omitempty"`
	Attribute   string `json:"attribute,omitempty"`
	Script      string `json:"script,omitempty"`
	Value       string `json:"value,omitempty"`
	Interactive bool   `json:"interactive,omitempty"`
	Selector    string `json:"selector,omitempty"`
	TabID       any    `json:"tabId,omitempty"`
	Index       *int   `json:"index,omitempty"`
	Key         string `json:"key,omitempty"`
	Direction   string `json:"direction,omitempty"`
	Pixels      *int   `json:"pixels,omitempty"`
	Filter      string `json:"filter,omitempty"`
}

type browserResponseData struct {
	Title        string `json:"title,omitempty"`
	URL          string `json:"url,omitempty"`
	TabID        int    `json:"tabId,omitempty"`
	SnapshotData *struct {
		Snapshot string `json:"snapshot"`
	} `json:"snapshotData,omitempty"`
	Value          string `json:"value,omitempty"`
	ScreenshotPath string `json:"screenshotPath,omitempty"`
	DataURL        string `json:"dataUrl,omitempty"`
	Result         any    `json:"result,omitempty"`
	Tabs           []struct {
		Index  int    `json:"index"`
		URL    string `json:"url"`
		Title  string `json:"title"`
		Active bool   `json:"active"`
		TabID  int    `json:"tabId"`
	} `json:"tabs,omitempty"`
}

type browserResponse struct {
	ID      string               `json:"id"`
	Success bool                 `json:"success"`
	Data    *browserResponseData `json:"data,omitempty"`
	Error   string               `json:"error,omitempty"`
}

// InvokeBrowser sends a command to bb-browser daemon and returns the result.
func InvokeBrowser(endpoint string, req *browserRequest) (*browserResponse, error) {
	if req.ID == "" {
		req.ID = uuid.NewString()
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal browser request: %w", err)
	}

	client := &http.Client{Timeout: 35 * time.Second}
	resp, err := client.Post(endpoint+"/command", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("browser daemon unreachable: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == 503 {
		return nil, fmt.Errorf("browser extension not connected")
	}
	if resp.StatusCode == 408 {
		return nil, fmt.Errorf("browser command timed out")
	}

	var result browserResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parse browser response: %w", err)
	}
	return &result, nil
}

// saveScreenshotFromDataURL decodes a data:image/png;base64,... URL and saves to data/images/.
func saveScreenshotFromDataURL(dataURL string) (bool, string) {
	// Parse data URL: data:image/png;base64,<data>
	const prefix = "base64,"
	idx := strings.Index(dataURL, prefix)
	if idx < 0 {
		return false, ""
	}
	b64Data := dataURL[idx+len(prefix):]

	data, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return false, ""
	}

	// Determine extension from mime type
	ext := ".png"
	if strings.Contains(dataURL[:idx], "jpeg") {
		ext = ".jpg"
	} else if strings.Contains(dataURL[:idx], "webp") {
		ext = ".webp"
	}

	// Generate filename with timestamp
	filename := fmt.Sprintf("screenshot-%d%s", time.Now().UnixMilli(), ext)
	relPath := filepath.Join("images", filename)

	absPath, err := resolvePath(relPath)
	if err != nil {
		return false, ""
	}
	os.MkdirAll(filepath.Dir(absPath), 0o755)

	if err := os.WriteFile(absPath, data, 0o644); err != nil {
		return false, ""
	}

	url := pinixDataURLPrefix + relPath
	return true, url
}

// formatBrowserResult converts a browser response to a human/LLM readable string.
func formatBrowserResult(resp *browserResponse) string {
	if !resp.Success {
		return fmt.Sprintf("[error] %s", resp.Error)
	}
	if resp.Data == nil {
		return "OK"
	}

	var parts []string

	if resp.Data.SnapshotData != nil {
		return resp.Data.SnapshotData.Snapshot
	}

	if resp.Data.Title != "" {
		parts = append(parts, fmt.Sprintf("Title: %s", resp.Data.Title))
	}
	if resp.Data.URL != "" {
		parts = append(parts, fmt.Sprintf("URL: %s", resp.Data.URL))
	}
	if resp.Data.Value != "" {
		parts = append(parts, resp.Data.Value)
	}
	if resp.Data.ScreenshotPath != "" {
		parts = append(parts, fmt.Sprintf("Screenshot: %s", resp.Data.ScreenshotPath))
	}
	// Auto-save screenshot from dataUrl to data/images/
	if resp.Data.DataURL != "" {
		if saved, url := saveScreenshotFromDataURL(resp.Data.DataURL); saved {
			parts = append(parts, fmt.Sprintf("Render: ![screenshot](%s)", url))
		}
	}
	if resp.Data.Result != nil {
		b, _ := json.Marshal(resp.Data.Result)
		parts = append(parts, string(b))
	}

	if len(resp.Data.Tabs) > 0 {
		var b strings.Builder
		for _, tab := range resp.Data.Tabs {
			marker := " "
			if tab.Active {
				marker = "*"
			}
			fmt.Fprintf(&b, "%s [%d] %s — %s\n", marker, tab.TabID, tab.Title, tab.URL)
		}
		parts = append(parts, b.String())
	}

	if len(parts) == 0 {
		return "OK"
	}
	return strings.Join(parts, "\n")
}

// RegisterBrowserCommands adds browser commands to the registry.
func RegisterBrowserCommands(r *Registry, cfg *Config) {
	if cfg.Browser == nil || cfg.Browser.Endpoint == "" {
		return
	}
	endpoint := cfg.Browser.Endpoint

	r.Register("browser", `Control the user's Chrome browser via bb-browser.
  browser open <url>                  — open URL in current tab
  browser snapshot [--interactive]    — get page accessibility tree
  browser click <ref>                 — click element (e.g. @5 or 5)
  browser fill <ref> <text>           — clear input and fill text
  browser type <ref> <text>           — type text without clearing
  browser press <key>                 — press key (Enter, Tab, Escape, etc.)
  browser scroll <dir> [pixels]       — scroll: up/down/left/right (default 300)
  browser eval <script>               — execute JavaScript
  browser get text|url|title [<ref>]  — get element text or page info
  browser screenshot                  — take screenshot
  browser close                       — close current tab
  browser back|forward|refresh        — navigate
  browser tabs                        — list open tabs
  browser tab-new [url]               — open new tab
  browser tab-select <tabId>          — switch to tab
  browser tab-close [tabId]           — close tab`,
		func(args []string, stdin string) (string, error) {
			if len(args) == 0 {
				return "", fmt.Errorf("usage: browser <action> [args...]")
			}

			req := parseBrowserArgs(args)
			if req == nil {
				return "", fmt.Errorf("unknown browser action: %s", args[0])
			}

			resp, err := InvokeBrowser(endpoint, req)
			if err != nil {
				return "", err
			}
			return formatBrowserResult(resp), nil
		})
}

func parseBrowserArgs(args []string) *browserRequest {
	action := args[0]
	rest := args[1:]

	switch action {
	case "open":
		if len(rest) == 0 {
			return nil
		}
		return &browserRequest{Action: "open", URL: rest[0]}

	case "snapshot":
		req := &browserRequest{Action: "snapshot"}
		for _, a := range rest {
			if a == "--interactive" || a == "-i" {
				req.Interactive = true
			}
		}
		return req

	case "click":
		if len(rest) == 0 {
			return nil
		}
		return &browserRequest{Action: "click", Ref: normalizeRef(rest[0])}

	case "hover":
		if len(rest) == 0 {
			return nil
		}
		return &browserRequest{Action: "hover", Ref: normalizeRef(rest[0])}

	case "fill":
		if len(rest) < 2 {
			return nil
		}
		return &browserRequest{Action: "fill", Ref: normalizeRef(rest[0]), Text: strings.Join(rest[1:], " ")}

	case "type":
		if len(rest) < 2 {
			return nil
		}
		return &browserRequest{Action: "type", Ref: normalizeRef(rest[0]), Text: strings.Join(rest[1:], " ")}

	case "press":
		if len(rest) == 0 {
			return nil
		}
		return &browserRequest{Action: "press", Key: rest[0]}

	case "scroll":
		if len(rest) == 0 {
			return nil
		}
		req := &browserRequest{Action: "scroll", Direction: rest[0]}
		if len(rest) > 1 {
			var px int
			if _, err := fmt.Sscanf(rest[1], "%d", &px); err == nil {
				req.Pixels = &px
			}
		}
		return req

	case "eval":
		if len(rest) == 0 {
			return nil
		}
		return &browserRequest{Action: "eval", Script: strings.Join(rest, " ")}

	case "get":
		if len(rest) == 0 {
			return nil
		}
		req := &browserRequest{Action: "get", Attribute: rest[0]}
		if len(rest) > 1 {
			req.Ref = normalizeRef(rest[1])
		}
		return req

	case "screenshot":
		return &browserRequest{Action: "screenshot"}

	case "close":
		return &browserRequest{Action: "close"}

	case "back":
		return &browserRequest{Action: "back"}

	case "forward":
		return &browserRequest{Action: "forward"}

	case "refresh":
		return &browserRequest{Action: "refresh"}

	case "tabs":
		return &browserRequest{Action: "tab_list"}

	case "tab-new":
		req := &browserRequest{Action: "tab_new"}
		if len(rest) > 0 {
			req.URL = rest[0]
		}
		return req

	case "tab-select":
		if len(rest) == 0 {
			return nil
		}
		return &browserRequest{Action: "tab_select", TabID: rest[0]}

	case "tab-close":
		req := &browserRequest{Action: "tab_close"}
		if len(rest) > 0 {
			req.TabID = rest[0]
		}
		return req

	default:
		return nil
	}
}

// normalizeRef strips leading @ from ref strings (e.g. "@5" → "5").
func normalizeRef(ref string) string {
	return strings.TrimPrefix(ref, "@")
}
