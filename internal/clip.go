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
	desc.WriteString("Invoke external clips (sandboxed environments, services).\n")
	desc.WriteString("Usage:\n")
	desc.WriteString("  clip list                              — list available clips\n")
	desc.WriteString("  clip <name> <command> [args...]         — invoke (args passed directly)\n")
	desc.WriteString("  clip <name> pull <remote-path> [name]   — pull file from clip to local data/\n")
	desc.WriteString("  clip <name> push <local-path> <remote>  — push local file to clip\n")

	if len(cfg.Clips) > 0 {
		desc.WriteString("\nAvailable clips:\n")
		for _, c := range cfg.Clips {
			if len(c.Commands) > 0 {
				for _, cmd := range c.Commands {
					fmt.Fprintf(&desc, "  clip %s %s\n", c.Name, cmd)
				}
			} else {
				fmt.Fprintf(&desc, "  clip %s <command>\n", c.Name)
			}
		}
		desc.WriteString("\nExamples:\n")
		desc.WriteString("  clip sandbox bash ls -la\n")
		desc.WriteString("  clip sandbox bash \"echo hello && pwd\"\n")
		desc.WriteString("  clip sandbox read /tmp/file.txt\n")
		desc.WriteString("  clip sandbox write /tmp/file.txt \"hello world\"\n")
		desc.WriteString("  clip sandbox edit /tmp/f.txt old new\n")
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
		fmt.Fprintf(&b, "  %s", c.Name)
		if len(c.Commands) > 0 {
			fmt.Fprintf(&b, " — commands: %s", strings.Join(c.Commands, ", "))
		}
		fmt.Fprintln(&b)
	}
	return b.String()
}

// clipPull reads a file from a remote clip (via read-b64) and saves to local data/.
func clipPull(clip *ClipConfig, args []string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("usage: clip %s pull <remote-path> [local-name]", clip.Name)
	}
	remotePath := args[0]

	// Determine local filename
	localName := filepath.Base(remotePath)
	if len(args) > 1 {
		localName = args[1]
	}

	// Ensure it goes to images/ for image files, otherwise files/
	subDir := "files"
	if isImageFile(localName) {
		subDir = "images"
	}
	localRel := filepath.Join(subDir, localName)

	// Try read-b64 first (binary-safe), fallback to read (text)
	b64Data, err := InvokeClip(clip, "read-b64", []string{remotePath}, "")
	if err != nil {
		// Fallback to text read
		textData, err2 := InvokeClip(clip, "read", []string{remotePath}, "")
		if err2 != nil {
			return "", fmt.Errorf("pull failed: %w", err)
		}
		// Save as text
		abs, err3 := resolvePath(localRel)
		if err3 != nil {
			return "", err3
		}
		os.MkdirAll(filepath.Dir(abs), 0o755)
		if err := os.WriteFile(abs, []byte(textData), 0o644); err != nil {
			return "", fmt.Errorf("write: %w", err)
		}
		result := fmt.Sprintf("Pulled %s:%s → %s (%s)", clip.Name, remotePath, localRel, humanSize(int64(len(textData))))
		if isImageFile(localRel) {
			result += "\n" + pinixDataURLPrefix + localRel
		}
		return result, nil
	}

	// Decode base64
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64Data))
	if err != nil {
		return "", fmt.Errorf("base64 decode: %w", err)
	}

	abs, err := resolvePath(localRel)
	if err != nil {
		return "", err
	}
	os.MkdirAll(filepath.Dir(abs), 0o755)
	if err := os.WriteFile(abs, data, 0o644); err != nil {
		return "", fmt.Errorf("write: %w", err)
	}

	result := fmt.Sprintf("Pulled %s:%s → %s (%s)", clip.Name, remotePath, localRel, humanSize(int64(len(data))))
	if isImageFile(localRel) {
		result += "\n" + pinixDataURLPrefix + localRel
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

	// Try write-b64 first (binary-safe), fallback to write (text)
	b64 := base64.StdEncoding.EncodeToString(data)
	_, err = InvokeClip(clip, "write-b64", []string{remotePath}, b64)
	if err != nil {
		// Fallback to text write
		_, err2 := InvokeClip(clip, "write", []string{remotePath, string(data)}, "")
		if err2 != nil {
			return "", fmt.Errorf("push failed: %w", err)
		}
	}

	return fmt.Sprintf("Pushed %s → %s:%s (%s)", localRel, clip.Name, remotePath, humanSize(int64(len(data)))), nil
}

func clipInfo(clip *ClipConfig) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Clip: %s\n", clip.Name)
	fmt.Fprintf(&b, "URL:  %s\n", clip.URL)
	if len(clip.Commands) > 0 {
		fmt.Fprintf(&b, "Commands:\n")
		for _, cmd := range clip.Commands {
			fmt.Fprintf(&b, "  %s\n", cmd)
		}
	}
	return b.String()
}
