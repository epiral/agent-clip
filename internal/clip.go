package internal

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	connect "connectrpc.com/connect"
	pinixv1 "github.com/epiral/pinix/gen/go/pinix/v1"
	"github.com/epiral/pinix/gen/go/pinix/v1/pinixv1connect"
)

// ClipManifest holds metadata discovered from a clip via GetInfo RPC.
type ClipManifest struct {
	Name        string
	Description string
	Commands    []string
	HasWeb      bool
}

// GetClipInfo calls ClipService.GetInfo to discover clip metadata.
func GetClipInfo(clip *ClipConfig) (*ClipManifest, error) {
	httpClient := &http.Client{
		Transport: &bearerTransport{
			token: clip.Token,
			base: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
	}

	client := pinixv1connect.NewClipServiceClient(httpClient, clip.URL, connect.WithGRPC())
	resp, err := client.GetInfo(context.Background(), connect.NewRequest(&pinixv1.GetInfoRequest{}))
	if err != nil {
		return nil, fmt.Errorf("clip %s GetInfo: %w", clip.Name, err)
	}

	return &ClipManifest{
		Name:        resp.Msg.GetName(),
		Description: resp.Msg.GetDescription(),
		Commands:    resp.Msg.GetCommands(),
		HasWeb:      resp.Msg.GetHasWeb(),
	}, nil
}

// ProbeClips calls GetInfo on each configured clip and populates Manifest.
// Falls back to config Commands if GetInfo fails.
func ProbeClips(cfg *Config) {
	for i := range cfg.Clips {
		clip := &cfg.Clips[i]
		manifest, err := GetClipInfo(clip)
		if err != nil {
			// Fallback: build manifest from config
			clip.Manifest = &ClipManifest{
				Name:     clip.Name,
				Commands: clip.Commands,
			}
			continue
		}
		clip.Manifest = manifest
	}
}

// InvokeClip calls a clip's command via Connect-RPC (ClipService.Invoke).
func InvokeClip(clip *ClipConfig, command string, cmdArgs []string, stdin string) (string, error) {
	httpClient := &http.Client{
		Transport: &bearerTransport{
			token: clip.Token,
			base: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
	}

	client := pinixv1connect.NewClipServiceClient(httpClient, clip.URL, connect.WithGRPC())

	stream, err := client.Invoke(context.Background(), connect.NewRequest(&pinixv1.InvokeRequest{
		Name:  command,
		Args:  cmdArgs,
		Stdin: stdin,
	}))
	if err != nil {
		return "", fmt.Errorf("clip %s %s: %w", clip.Name, command, err)
	}
	defer stream.Close()

	var stdout, stderr strings.Builder
	var exitCode int32
	for stream.Receive() {
		chunk := stream.Msg()
		switch p := chunk.Payload.(type) {
		case *pinixv1.InvokeChunk_Stdout:
			stdout.Write(p.Stdout)
		case *pinixv1.InvokeChunk_Stderr:
			stderr.Write(p.Stderr)
		case *pinixv1.InvokeChunk_ExitCode:
			exitCode = p.ExitCode
		}
	}
	if err := stream.Err(); err != nil {
		return "", fmt.Errorf("clip %s %s stream: %w", clip.Name, command, err)
	}

	output := stdout.String()
	if output == "" && exitCode != 0 {
		errMsg := stderr.String()
		if errMsg != "" {
			return "", fmt.Errorf("clip %s %s failed (exit %d): %s", clip.Name, command, exitCode, strings.TrimSpace(errMsg))
		}
		return "", fmt.Errorf("clip %s %s failed (exit %d)", clip.Name, command, exitCode)
	}

	return strings.TrimRight(output, "\n"), nil
}

// bearerTransport injects Authorization header into every HTTP request.
type bearerTransport struct {
	token string
	base  http.RoundTripper
}

func (t *bearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+t.token)
	return t.base.RoundTrip(req)
}

// RegisterClipCommands adds the "clip" command to the registry.
func RegisterClipCommands(r *Registry, cfg *Config) {
	var desc strings.Builder
	desc.WriteString("Operate external environments (sandboxes, services).\n")
	desc.WriteString("Usage:\n")
	desc.WriteString("  clip list                              — list available clips\n")
	desc.WriteString("  clip <name>                            — show clip details and commands\n")
	desc.WriteString("  clip <name> <command> [args...]         — invoke a command\n")
	desc.WriteString("  clip <name> pull <remote-path> [name]   — pull file from clip to local\n")
	desc.WriteString("  clip <name> push <local-path> <remote>  — push local file to clip\n")

	if len(cfg.Clips) > 0 {
		desc.WriteString("\nAvailable:\n")
		for _, c := range cfg.Clips {
			m := c.Manifest
			if m != nil && m.Description != "" {
				fmt.Fprintf(&desc, "  %s — %s\n", c.Name, m.Description)
			} else {
				fmt.Fprintf(&desc, "  %s\n", c.Name)
			}
		}
	}

	r.Register("clip", desc.String(), func(args []string, stdin string) (string, error) {
		if len(args) == 0 || (len(args) == 1 && args[0] == "list") {
			return clipList(cfg), nil
		}

		clipName := args[0]
		clip := cfg.GetClip(clipName)
		if clip == nil {
			return "", fmt.Errorf("clip %q not found. Use 'clip list' to see available clips", clipName)
		}

		if len(args) == 1 {
			return clipInfo(clip), nil
		}

		command := args[1]
		cmdArgs := args[2:]

		// clip <name> pull <remote-path> [local-name]
		if command == "pull" {
			return clipPull(clip, cmdArgs)
		}
		// clip <name> push <local-path> <remote-path>
		if command == "push" {
			return clipPush(clip, cmdArgs)
		}

		return InvokeClip(clip, command, cmdArgs, stdin)
	})
}

func clipList(cfg *Config) string {
	if len(cfg.Clips) == 0 {
		return "No clips configured."
	}
	var b strings.Builder
	for _, c := range cfg.Clips {
		m := c.Manifest
		if m != nil && m.Description != "" {
			fmt.Fprintf(&b, "  %s — %s\n", c.Name, m.Description)
			if len(m.Commands) > 0 {
				fmt.Fprintf(&b, "    commands: %s\n", strings.Join(m.Commands, ", "))
			}
		} else {
			fmt.Fprintf(&b, "  %s", c.Name)
			if len(c.Commands) > 0 {
				fmt.Fprintf(&b, " — commands: %s", strings.Join(c.Commands, ", "))
			}
			fmt.Fprintln(&b)
		}
	}
	return b.String()
}

// clipPull reads a file from a remote clip and saves to local topic directory.
// Uses `read` directly — stdout is binary-safe via gRPC bytes transport.
func clipPull(clip *ClipConfig, args []string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("usage: clip %s pull <remote-path> [local-name]", clip.Name)
	}
	remotePath := args[0]

	localName := filepath.Base(remotePath)
	if len(args) > 1 {
		localName = args[1]
	}

	data, err := InvokeClip(clip, "read", []string{remotePath}, "")
	if err != nil {
		return "", fmt.Errorf("pull: %w", err)
	}

	abs, err := resolvePath(localName)
	if err != nil {
		return "", err
	}
	os.MkdirAll(filepath.Dir(abs), 0o755)
	if err := os.WriteFile(abs, []byte(data), 0o644); err != nil {
		return "", fmt.Errorf("write: %w", err)
	}

	result := fmt.Sprintf("Pulled %s:%s → %s (%s)", clip.Name, remotePath, localName, humanSize(int64(len(data))))
	if IsImageFile(localName) {
		relForURL := resolvePathToRelative(localName)
		result += fmt.Sprintf("\nRender: ![image](%s%s)", pinixDataURLPrefix, relForURL)
	}
	return result, nil
}

// clipPush reads a local file from data/ and writes to a remote clip.
func clipPush(clip *ClipConfig, args []string) (string, error) {
	if len(args) < 2 {
		return "", fmt.Errorf("usage: clip %s push <local-path> <remote-path>", clip.Name)
	}
	localRel := args[0]
	remotePath := args[1]

	abs, err := resolvePath(localRel)
	if err != nil {
		return "", err
	}

	data, err := os.ReadFile(abs)
	if err != nil {
		return "", fmt.Errorf("read local: %w", err)
	}

	// Send as base64 via write -b (stdin is protobuf string, must be UTF-8)
	b64 := base64.StdEncoding.EncodeToString(data)
	_, err = InvokeClip(clip, "write", []string{"-b", remotePath}, b64)
	if err != nil {
		return "", fmt.Errorf("push: %w", err)
	}

	return fmt.Sprintf("Pushed %s → %s:%s (%s)", localRel, clip.Name, remotePath, humanSize(int64(len(data)))), nil
}

func clipInfo(clip *ClipConfig) string {
	var b strings.Builder
	m := clip.Manifest

	fmt.Fprintf(&b, "Clip: %s\n", clip.Name)
	if m != nil && m.Description != "" {
		fmt.Fprintf(&b, "Description: %s\n", m.Description)
	}

	// Commands from manifest (auto-discovered), fallback to config
	commands := clip.Commands
	if m != nil && len(m.Commands) > 0 {
		commands = m.Commands
	}
	if len(commands) > 0 {
		fmt.Fprintf(&b, "\nCommands:\n")
		for _, cmd := range commands {
			fmt.Fprintf(&b, "  clip %s %s\n", clip.Name, cmd)
		}
	}

	fmt.Fprintf(&b, "\nFile transfer:\n")
	fmt.Fprintf(&b, "  clip %s pull <remote-path> [local-name]\n", clip.Name)
	fmt.Fprintf(&b, "  clip %s push <local-path> <remote-path>\n", clip.Name)
	fmt.Fprintf(&b, "\nUse 'clip %s <command> --help' for detailed flags.\n", clip.Name)
	return b.String()
}
