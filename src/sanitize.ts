import { join } from "node:path";

export function extractAttachments(content: string): string[] {
  const start = content.indexOf("<attachments>");
  const end = content.indexOf("</attachments>");
  if (start < 0 || end <= start) {
    return [];
  }

  const body = content.slice(start + "<attachments>".length, end);
  const paths: string[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) {
      continue;
    }
    let entry = line.slice(2).trim();
    const infoIndex = entry.indexOf(" (");
    if (infoIndex > 0) {
      entry = entry.slice(0, infoIndex).trim();
    }
    if (entry) {
      paths.push(entry);
    }
  }
  return paths;
}

export function extractUserContent(content: string): { content: string; attachments: string[] } {
  const start = content.indexOf("<user>");
  const end = content.indexOf("</user>");
  const userText = start >= 0 && end > start
    ? content.slice(start + "<user>".length, end).trim()
    : content;

  const attachments = extractAttachments(userText);
  const attachmentsStart = userText.indexOf("<attachments>");
  const attachmentsEnd = userText.indexOf("</attachments>");
  const cleanContent = attachmentsStart >= 0 && attachmentsEnd > attachmentsStart
    ? (userText.slice(0, attachmentsStart) + userText.slice(attachmentsEnd + "</attachments>".length)).trim()
    : userText;

  return {
    content: cleanContent,
    attachments,
  };
}

export function attachmentToURL(topicId: string, filename: string): string {
  return `pinix-data://local/data/${join("topics", topicId, filename)}`;
}

export function extractThinking(content: string, existingReasoning = ""): { content: string; reasoning: string } {
  const start = content.indexOf("<think>");
  if (start < 0) {
    return { content, reasoning: existingReasoning };
  }

  const end = content.indexOf("</think>");
  if (end < 0) {
    const thinking = content.slice(start + "<think>".length).trim();
    return {
      content: content.slice(0, start).trim(),
      reasoning: existingReasoning || thinking,
    };
  }

  const thinking = content.slice(start + "<think>".length, end).trim();
  const cleanContent = (content.slice(0, start) + content.slice(end + "</think>".length)).trim();
  return {
    content: cleanContent,
    reasoning: existingReasoning || thinking,
  };
}
