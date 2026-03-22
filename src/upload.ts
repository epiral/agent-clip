import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ImageData } from "./media";
import { imageDataFromBytes, isImageFile, safeFilename } from "./media";
import { topicDir } from "./paths";
import { humanSize, resolvePath } from "./fs";

export interface UploadInput {
  name: string;
  mime: string;
  data: string;
  topic_id: string;
}

export interface UploadResult {
  path: string;
  size: number;
}

export function uploadFile(input: UploadInput): UploadResult {
  if (!input.name) {
    throw new Error("name is required");
  }
  if (!input.data) {
    throw new Error("data is required");
  }
  if (!input.topic_id) {
    throw new Error("topic_id is required");
  }

  const bytes = Buffer.from(input.data, "base64");
  const filename = safeFilename(input.name);
  const path = join(topicDir(input.topic_id), filename);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);

  return {
    path: filename,
    size: bytes.byteLength,
  };
}

export function appendAttachments(message: string, attachments: string[]): string {
  if (attachments.length === 0) {
    return message;
  }

  const lines = [message, "", "<attachments>"];
  for (const attachment of attachments) {
    const info = describeAttachment(attachment);
    if (isImageFile(attachment)) {
      lines.push(`- ${attachment}${info} (visible)`);
    } else {
      lines.push(`- ${attachment}${info}`);
    }
  }
  lines.push("</attachments>");
  return lines.join("\n");
}

export function readImageAttachments(attachments: string[]): ImageData[] {
  const images: ImageData[] = [];
  for (const attachment of attachments) {
    if (!isImageFile(attachment)) {
      continue;
    }
    try {
      const path = resolvePath(attachment);
      const bytes = readFileSync(path);
      images.push(imageDataFromBytes(attachment, bytes));
    } catch {
      // ignore unreadable attachments
    }
  }
  return images;
}

function describeAttachment(path: string): string {
  try {
    const info = statSync(resolvePath(path));
    const parts = [humanSize(info.size)];
    if (isImageFile(path)) {
      parts.unshift("image");
    }
    return ` (${parts.join(", ")})`;
  } catch {
    return "";
  }
}
