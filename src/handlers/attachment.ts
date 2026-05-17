/**
 * Attachment handler — resource-oriented commands for file uploads.
 *
 * Clip Commands:
 *   attachment upload  (stdin: { name, mime, data, topic_id })
 */

import type { InvocationInput } from "../args";
import { uploadFile, type UploadInput, type UploadResult } from "../upload";
import { ok, type DataResponse } from "./response";
import { readString } from "./params";
import { safeJSONParse } from "../shared";

// --- Response types ---

export interface UploadData extends UploadResult {
  topic_id: string;
}

// --- Handlers ---

export function handleAttachmentUpload(input: InvocationInput): DataResponse<UploadData> {
  // Read from stdin JSON or from named fields
  const stdin = typeof input.stdin === "string" ? input.stdin : "";
  let uploadInput: UploadInput;

  if (stdin) {
    const parsed = safeJSONParse<UploadInput>(stdin);
    if (!parsed) throw new Error("invalid stdin JSON");
    uploadInput = parsed;
  } else {
    uploadInput = {
      name: readString(input, ["name"]),
      mime: readString(input, ["mime"]),
      data: readString(input, ["data"]),
      topic_id: readString(input, ["topic_id", "topicId"]),
    };
  }

  if (!uploadInput.name) throw new Error("name is required");
  if (!uploadInput.data) throw new Error("data is required");
  if (!uploadInput.topic_id) throw new Error("topic_id is required");

  const result = uploadFile(uploadInput);
  return ok({ ...result, topic_id: uploadInput.topic_id });
}
