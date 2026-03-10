package internal

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const pinixDataURLPrefix = "pinix-data://local/data/"

func dataRoot() string {
	return filepath.Join(clipBase(), "data")
}

// resolvePath resolves a relative path to an absolute path under data/.
// Returns error if path escapes data/.
func resolvePath(rel string) (string, error) {
	root := dataRoot()
	abs := filepath.Join(root, rel)
	abs = filepath.Clean(abs)
	if !strings.HasPrefix(abs, root) {
		return "", fmt.Errorf("path escapes data directory: %s", rel)
	}
	return abs, nil
}

func isImageFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp":
		return true
	}
	return false
}

func humanSize(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1fMB", float64(n)/float64(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1fKB", float64(n)/float64(1<<10))
	default:
		return fmt.Sprintf("%dB", n)
	}
}

func RegisterFSCommands(r *Registry) {
	r.Register("ls", "List files. Usage: ls [dir]", fsLs)
	r.Register("cat", "Read file content. Usage: cat <path>  Options: -b (base64 output for binary)", fsCat)
	r.Register("write", "Write file. Usage: write <path> [content] or stdin. Options: -b (base64 stdin for binary)", fsWrite)
	r.Register("stat", "File info. Usage: stat <path>", fsStat)
	r.Register("rm", "Remove file. Usage: rm <path>", fsRm)
	r.Register("cp", "Copy file. Usage: cp <src> <dst>", fsCp)
	r.Register("mv", "Move/rename file. Usage: mv <src> <dst>", fsMv)
	r.Register("mkdir", "Create directory. Usage: mkdir <dir>", fsMkdir)
}

func fsLs(args []string, stdin string) (string, error) {
	dir := ""
	if len(args) > 0 {
		dir = args[0]
	}
	abs, err := resolvePath(dir)
	if err != nil {
		return "", err
	}

	entries, err := os.ReadDir(abs)
	if err != nil {
		return "", fmt.Errorf("ls: %w", err)
	}

	var out strings.Builder
	for _, e := range entries {
		info, _ := e.Info()
		if e.IsDir() {
			fmt.Fprintf(&out, "d  %-8s %s/\n", "-", e.Name())
		} else if info != nil {
			fmt.Fprintf(&out, "f  %-8s %s\n", humanSize(info.Size()), e.Name())
		} else {
			fmt.Fprintf(&out, "f  %-8s %s\n", "?", e.Name())
		}
	}
	if out.Len() == 0 {
		return "(empty directory)", nil
	}
	return strings.TrimRight(out.String(), "\n"), nil
}

func fsCat(args []string, stdin string) (string, error) {
	b64 := false
	var path string
	for _, a := range args {
		if a == "-b" || a == "--base64" {
			b64 = true
		} else if path == "" {
			path = a
		}
	}
	if path == "" {
		return "", fmt.Errorf("usage: cat <path>")
	}

	abs, err := resolvePath(path)
	if err != nil {
		return "", err
	}

	data, err := os.ReadFile(abs)
	if err != nil {
		return "", fmt.Errorf("cat: %w", err)
	}

	if b64 {
		return base64.StdEncoding.EncodeToString(data), nil
	}
	return string(data), nil
}

func fsWrite(args []string, stdin string) (string, error) {
	b64 := false
	var path string
	var contentParts []string
	for _, a := range args {
		if a == "-b" || a == "--base64" {
			b64 = true
		} else if path == "" {
			path = a
		} else {
			contentParts = append(contentParts, a)
		}
	}
	if path == "" {
		return "", fmt.Errorf("usage: write <path> [content] or pipe stdin")
	}

	abs, err := resolvePath(path)
	if err != nil {
		return "", err
	}

	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", fmt.Errorf("mkdir: %w", err)
	}

	var data []byte
	if b64 {
		// Decode base64 from stdin or content
		src := stdin
		if src == "" && len(contentParts) > 0 {
			src = strings.Join(contentParts, " ")
		}
		src = strings.TrimSpace(src)
		data, err = base64.StdEncoding.DecodeString(src)
		if err != nil {
			return "", fmt.Errorf("base64 decode: %w", err)
		}
	} else {
		if len(contentParts) > 0 {
			data = []byte(strings.Join(contentParts, " "))
		} else {
			data = []byte(stdin)
		}
	}

	if err := os.WriteFile(abs, data, 0o644); err != nil {
		return "", fmt.Errorf("write: %w", err)
	}

	size := humanSize(int64(len(data)))
	result := fmt.Sprintf("Written %s → %s", size, path)

	if isImageFile(path) {
		url := pinixDataURLPrefix + path
		result += fmt.Sprintf("\n%s", url)
	}

	return result, nil
}

func fsStat(args []string, stdin string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("usage: stat <path>")
	}

	abs, err := resolvePath(args[0])
	if err != nil {
		return "", err
	}

	info, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("stat: %w", err)
	}

	mime := "application/octet-stream"
	if isImageFile(args[0]) {
		ext := strings.ToLower(filepath.Ext(args[0]))
		switch ext {
		case ".png":
			mime = "image/png"
		case ".jpg", ".jpeg":
			mime = "image/jpeg"
		case ".gif":
			mime = "image/gif"
		case ".webp":
			mime = "image/webp"
		case ".svg":
			mime = "image/svg+xml"
		}
	}

	var out strings.Builder
	fmt.Fprintf(&out, "File: %s\n", args[0])
	fmt.Fprintf(&out, "Size: %s (%d bytes)\n", humanSize(info.Size()), info.Size())
	fmt.Fprintf(&out, "Type: %s\n", mime)
	fmt.Fprintf(&out, "Modified: %s\n", info.ModTime().Format(time.RFC3339))
	if info.IsDir() {
		fmt.Fprintf(&out, "Kind: directory\n")
	}
	return strings.TrimRight(out.String(), "\n"), nil
}

func fsRm(args []string, stdin string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("usage: rm <path>")
	}

	abs, err := resolvePath(args[0])
	if err != nil {
		return "", err
	}

	if err := os.RemoveAll(abs); err != nil {
		return "", fmt.Errorf("rm: %w", err)
	}
	return fmt.Sprintf("Removed %s", args[0]), nil
}

func fsCp(args []string, stdin string) (string, error) {
	if len(args) < 2 {
		return "", fmt.Errorf("usage: cp <src> <dst>")
	}

	srcAbs, err := resolvePath(args[0])
	if err != nil {
		return "", err
	}
	dstAbs, err := resolvePath(args[1])
	if err != nil {
		return "", err
	}

	data, err := os.ReadFile(srcAbs)
	if err != nil {
		return "", fmt.Errorf("cp read: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(dstAbs), 0o755); err != nil {
		return "", fmt.Errorf("cp mkdir: %w", err)
	}

	if err := os.WriteFile(dstAbs, data, 0o644); err != nil {
		return "", fmt.Errorf("cp write: %w", err)
	}
	return fmt.Sprintf("Copied %s → %s (%s)", args[0], args[1], humanSize(int64(len(data)))), nil
}

func fsMv(args []string, stdin string) (string, error) {
	if len(args) < 2 {
		return "", fmt.Errorf("usage: mv <src> <dst>")
	}

	srcAbs, err := resolvePath(args[0])
	if err != nil {
		return "", err
	}
	dstAbs, err := resolvePath(args[1])
	if err != nil {
		return "", err
	}

	if err := os.MkdirAll(filepath.Dir(dstAbs), 0o755); err != nil {
		return "", fmt.Errorf("mv mkdir: %w", err)
	}

	if err := os.Rename(srcAbs, dstAbs); err != nil {
		return "", fmt.Errorf("mv: %w", err)
	}
	return fmt.Sprintf("Moved %s → %s", args[0], args[1]), nil
}

func fsMkdir(args []string, stdin string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("usage: mkdir <dir>")
	}

	abs, err := resolvePath(args[0])
	if err != nil {
		return "", err
	}

	if err := os.MkdirAll(abs, 0o755); err != nil {
		return "", fmt.Errorf("mkdir: %w", err)
	}
	return fmt.Sprintf("Created %s", args[0]), nil
}
