/**
 * Event handler — resource-oriented commands for scheduled events.
 *
 * Clip Commands:
 *   event create  --topic_id, --prompt, --schedule_kind, --schedule_value, --tz?
 *   event list    --topic_id?, --status?, --limit?, --cursor?
 *   event update  <id> --prompt?, --tz?
 *   event cancel  <id>
 */

import type { InvocationInput } from "../args";
import { openDB } from "../db";
import {
  cancelEvent,
  createEvent,
  listEvents,
  updateEvent,
  type Event,
} from "../events";
import { ok, encodeCursor, decodeCursor, paginate, type DataResponse, type ListResponse } from "./response";
import { readId, readInt, readString } from "./params";

// --- Handlers ---

export function handleEventCreate(input: InvocationInput): DataResponse<Event> {
  const topicId = readString(input, ["topic_id", "topicId"], ["--topic_id", "--topic", "-t"]);
  if (!topicId) throw new Error("--topic_id is required");

  const prompt = readString(input, ["prompt"], ["--prompt"]);
  if (!prompt) throw new Error("--prompt is required");

  const scheduleKind = readString(input, ["schedule_kind", "scheduleKind"], ["--schedule_kind", "--kind"]);
  if (!scheduleKind) throw new Error("--schedule_kind is required (once | daily)");

  const scheduleValue = readString(input, ["schedule_value", "scheduleValue"], ["--schedule_value", "--at", "--time"]);
  if (!scheduleValue) throw new Error("--schedule_value is required");

  const timezone = readString(input, ["timezone", "tz"], ["--tz", "--timezone"]) || "Local";

  const db = openDB();
  const event = createEvent(db, topicId, prompt, scheduleKind, scheduleValue, timezone);
  return ok(event);
}

export function handleEventList(input: InvocationInput): ListResponse<Event> {
  const topicId = readString(input, ["topic_id", "topicId"], ["--topic_id", "--topic", "-t"]);
  const status = readString(input, ["status"], ["--status"]) || "scheduled";
  const limit = readInt(input, ["limit"], ["-l", "--limit"], 20) ?? 20;
  const cursorStr = readString(input, ["cursor"], ["--cursor"]);

  const db = openDB();
  const includeCanceled = status === "all" || status === "canceled";
  const events = listEvents(db, topicId || undefined, includeCanceled);

  // Post-filter by status
  let filtered = events;
  if (status !== "all") {
    filtered = events.filter((e) => e.status === status);
  }

  // Apply cursor
  if (cursorStr) {
    const cursor = decodeCursor(cursorStr);
    if (cursor) {
      const idx = filtered.findIndex((e) => e.id === cursor.id);
      if (idx >= 0) {
        filtered = filtered.slice(idx + 1);
      }
    }
  }

  const result = paginate(filtered, limit, (item) =>
    encodeCursor(item.next_run_at, item.id),
  );

  return { data: result.data, has_more: result.has_more, ...(result.cursor ? { cursor: result.cursor } : {}) };
}

export function handleEventUpdate(input: InvocationInput): DataResponse<Event> {
  const eventId = readId(input, 0, ["event_id", "eventId", "id"]);
  if (!eventId) throw new Error("event id is required");

  const updates: Record<string, string> = {};

  const prompt = readString(input, ["prompt"], ["--prompt"]);
  if (prompt) updates.prompt = prompt;

  const tz = readString(input, ["timezone", "tz"], ["--tz", "--timezone"]);
  if (tz) updates.timezone = tz;

  const topicId = readString(input, ["topic_id", "topicId"], ["--topic_id", "--topic"]);
  if (topicId) updates.topic_id = topicId;

  const db = openDB();
  const event = updateEvent(db, eventId, updates);
  return ok(event);
}

export function handleEventCancel(input: InvocationInput): DataResponse<Event> {
  const eventId = readId(input, 0, ["event_id", "eventId", "id"]);
  if (!eventId) throw new Error("event id is required");

  const db = openDB();
  cancelEvent(db, eventId);

  // Read back the updated event
  const events = listEvents(db, undefined, true);
  const event = events.find((e) => e.id === eventId);
  if (!event) throw new Error(`event ${eventId} not found after cancel`);

  return ok(event);
}
