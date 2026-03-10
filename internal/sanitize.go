package internal

import (
	"path/filepath"
	"strings"
)

// ExtractUserContent strips XML wrappers from user messages,
// returning the <user> tag inner content and any attachment paths.
// Input: "<user>\nhello\n</user>\n\n<attachments>\n- photo.png (image, 145KB, visible)\n</attachments>\n\n<environment>...</environment>"
// Output: "hello", ["photo.png"]
func ExtractUserContent(content string) (string, []string) {
	var text string
	start := strings.Index(content, "<user>")
	end := strings.Index(content, "</user>")
	if start >= 0 && end > start {
		text = strings.TrimSpace(content[start+len("<user>") : end])
	} else {
		text = content
	}

	attachments := extractAttachments(text)

	// Strip <attachments>...</attachments> from display text
	aStart := strings.Index(text, "<attachments>")
	aEnd := strings.Index(text, "</attachments>")
	if aStart >= 0 && aEnd > aStart {
		text = strings.TrimSpace(text[:aStart] + text[aEnd+len("</attachments>"):])
	}

	return text, attachments
}

// extractAttachments parses <attachments> tag and returns file paths.
func extractAttachments(content string) []string {
	start := strings.Index(content, "<attachments>")
	end := strings.Index(content, "</attachments>")
	if start < 0 || end <= start {
		return nil
	}

	body := content[start+len("<attachments>") : end]
	var paths []string
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "- ") {
			continue
		}
		// "- photo.png (image, 145KB, visible)" → "photo.png"
		entry := strings.TrimPrefix(line, "- ")
		// Take everything before the first " ("
		if idx := strings.Index(entry, " ("); idx > 0 {
			entry = entry[:idx]
		}
		entry = strings.TrimSpace(entry)
		if entry != "" {
			paths = append(paths, entry)
		}
	}
	return paths
}

// AttachmentToURL converts a filename to a pinix-data URL for a given topic.
func AttachmentToURL(topicID, filename string) string {
	relPath := filepath.Join("topics", topicID, filename)
	return "pinix-data://local/data/" + relPath
}

// ExtractThinking splits <think>...</think> from assistant content
// into separate content and reasoning strings.
func ExtractThinking(content, existingReasoning string) (cleanContent, reasoning string) {
	start := strings.Index(content, "<think>")
	if start < 0 {
		return content, existingReasoning
	}

	end := strings.Index(content, "</think>")
	if end < 0 {
		// unclosed <think> tag — everything after <think> is thinking
		thinking := strings.TrimSpace(content[start+len("<think>"):])
		clean := strings.TrimSpace(content[:start])
		if existingReasoning == "" {
			return clean, thinking
		}
		return clean, existingReasoning
	}

	thinking := strings.TrimSpace(content[start+len("<think>") : end])
	clean := strings.TrimSpace(content[:start] + content[end+len("</think>"):])

	if existingReasoning == "" {
		return clean, thinking
	}
	return clean, existingReasoning
}
