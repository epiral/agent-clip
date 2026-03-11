package internal

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Note: ImageData is defined in llm.go

// UploadFile saves a file to the topic directory.
// Returns the relative path within the topic (just the filename).
type UploadInput struct {
	Name    string `json:"name"`
	Mime    string `json:"mime"`
	Data    string `json:"data"` // base64
	TopicID string `json:"topic_id"`
}

type UploadResult struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

func UploadFile(input *UploadInput) (*UploadResult, error) {
	if input.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if input.Data == "" {
		return nil, fmt.Errorf("data is required")
	}
	if input.TopicID == "" {
		return nil, fmt.Errorf("topic_id is required")
	}

	data, err := base64.StdEncoding.DecodeString(input.Data)
	if err != nil {
		return nil, fmt.Errorf("base64 decode: %w", err)
	}

	// Clean the filename
	name := filepath.Base(input.Name)

	// Ensure topic directory exists
	if err := EnsureTopicDir(input.TopicID); err != nil {
		return nil, err
	}

	// Save to topic directory
	absPath := filepath.Join(TopicDir(input.TopicID), name)
	if err := os.WriteFile(absPath, data, 0o644); err != nil {
		return nil, fmt.Errorf("write: %w", err)
	}

	return &UploadResult{
		Path: name,
		Size: int64(len(data)),
	}, nil
}

// AppendAttachments appends attachment metadata to the user message.
// Images are marked "visible" since they'll be auto-attached as vision content.
func AppendAttachments(message string, attachments []string) string {
	if len(attachments) == 0 {
		return message
	}

	var b strings.Builder
	b.WriteString(message)
	b.WriteString("\n\n<attachments>\n")
	for _, path := range attachments {
		info := describeAttachment(path)
		if IsImageFile(path) {
			b.WriteString(fmt.Sprintf("- %s%s (visible)\n", path, info))
		} else {
			b.WriteString(fmt.Sprintf("- %s%s\n", path, info))
		}
	}
	b.WriteString("</attachments>")
	return b.String()
}

// ReadImageAttachments reads image files from attachments and returns vision data.
// Non-image files are skipped.
func ReadImageAttachments(attachments []string) []ImageData {
	var images []ImageData
	for _, path := range attachments {
		if !IsImageFile(path) {
			continue
		}
		abs, err := resolvePath(path)
		if err != nil {
			continue
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			continue
		}

		images = append(images, imageDataFromBytes(path, data))
	}
	return images
}

// describeAttachment returns a brief description of a file (type, size).
func describeAttachment(path string) string {
	// Try to stat the file to get size
	// The path is relative to the topic dir (currentTopicID should be set by now)
	abs, err := resolvePath(path)
	if err != nil {
		return ""
	}
	info, err := os.Stat(abs)
	if err != nil {
		return ""
	}

	parts := []string{}
	if IsImageFile(path) {
		parts = append(parts, "image")
	}
	parts = append(parts, humanSize(info.Size()))
	return " (" + strings.Join(parts, ", ") + ")"
}
