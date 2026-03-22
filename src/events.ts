import { Database } from "bun:sqlite";
import { getCurrentTopic } from "./fs";
import { nowUnix, randomID } from "./shared";

export const EventStatusScheduled = "scheduled";
export const EventStatusCanceled = "canceled";
export const EventStatusDone = "done";

export const EventScheduleOnce = "once";
export const EventScheduleDaily = "daily";

export interface Event {
  id: string;
  topic_id: string;
  prompt: string;
  schedule_kind: string;
  schedule_value: string;
  timezone: string;
  next_run_at: number;
  last_run_at?: number;
  status: string;
  created_at: number;
  canceled_at?: number;
}

export interface DueEvent extends Event {
  run_message: string;
}

type RegisterFn = (
  name: string,
  description: string,
  handler: (args: string[], stdin: string) => Promise<string> | string,
) => void;

function transaction<T>(db: Database, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw error;
  }
}

export function createEvent(
  db: Database,
  topicId: string,
  prompt: string,
  scheduleKind: string,
  scheduleValue: string,
  timezone: string,
): Event {
  if (!topicId) {
    throw new Error("topic_id is required");
  }
  if (!prompt) {
    throw new Error("prompt is required");
  }

  const { nextRunAt, normalizedValue, normalizedTimezone } = computeInitialNextRun(scheduleKind, scheduleValue, timezone);
  const event: Event = {
    id: randomID(),
    topic_id: topicId,
    prompt,
    schedule_kind: scheduleKind,
    schedule_value: normalizedValue,
    timezone: normalizedTimezone,
    next_run_at: nextRunAt,
    status: EventStatusScheduled,
    created_at: nowUnix(),
  };

  db.query(
    `INSERT INTO events (id, topic_id, prompt, schedule_kind, schedule_value, timezone, next_run_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id,
    event.topic_id,
    event.prompt,
    event.schedule_kind,
    event.schedule_value,
    event.timezone,
    event.next_run_at,
    event.status,
    event.created_at,
  );

  return event;
}

export function listEvents(db: Database, topicId = "", includeCanceled = false): Event[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (topicId) {
    clauses.push("topic_id = ?");
    values.push(topicId);
  }
  if (!includeCanceled) {
    clauses.push("status != ?");
    values.push(EventStatusCanceled);
  }

  const sql = `
    SELECT id, topic_id, prompt, schedule_kind, schedule_value, timezone, next_run_at,
      last_run_at, status, created_at, canceled_at
    FROM events
    ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY next_run_at ASC, created_at ASC
  `;

  const rows = db.query<{
    id: string;
    topic_id: string;
    prompt: string;
    schedule_kind: string;
    schedule_value: string;
    timezone: string;
    next_run_at: number;
    last_run_at: number | null;
    status: string;
    created_at: number;
    canceled_at: number | null;
  }, Array<string | number>>(sql).all(...values);

  return rows.map(toEvent);
}

export function updateEvent(
  db: Database,
  eventId: string,
  updates: Record<string, string>,
): Event {
  const sets: string[] = [];
  const values: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    switch (key) {
      case "topic":
        sets.push("topic_id = ?");
        values.push(value);
        break;
      case "prompt":
        sets.push("prompt = ?");
        values.push(value);
        break;
      case "tz":
        sets.push("timezone = ?");
        values.push(resolveTimeZone(value));
        break;
      default:
        throw new Error(`unsupported update field: ${key}`);
    }
  }

  if (sets.length === 0) {
    throw new Error("nothing to update");
  }

  const result = db.query(
    `UPDATE events SET ${sets.join(", ")} WHERE id = ? AND status = ?`,
  ).run(...values, eventId, EventStatusScheduled);

  if (!result.changes) {
    throw new Error(`event ${eventId} not found or not scheduled`);
  }

  const row = db.query<{
    id: string;
    topic_id: string;
    prompt: string;
    schedule_kind: string;
    schedule_value: string;
    timezone: string;
    next_run_at: number;
    last_run_at: number | null;
    status: string;
    created_at: number;
    canceled_at: number | null;
  }, [string]>(
    `SELECT id, topic_id, prompt, schedule_kind, schedule_value, timezone, next_run_at,
      last_run_at, status, created_at, canceled_at
     FROM events WHERE id = ?`,
  ).get(eventId);

  if (!row) {
    throw new Error(`event ${eventId} not found`);
  }

  return toEvent(row);
}

export function cancelEvent(db: Database, eventId: string): void {
  const canceledAt = nowUnix();
  const result = db.query(
    "UPDATE events SET status = ?, canceled_at = ? WHERE id = ? AND status = ?",
  ).run(EventStatusCanceled, canceledAt, eventId, EventStatusScheduled);

  if (!result.changes) {
    throw new Error(`event ${eventId} not found or not scheduled`);
  }
}

export function claimDueEvents(db: Database, limit = 10): DueEvent[] {
  return transaction(db, () => {
    const maxItems = limit > 0 ? limit : 10;
    const firedAt = nowUnix();
    const rows = db.query<{
      id: string;
      topic_id: string;
      prompt: string;
      schedule_kind: string;
      schedule_value: string;
      timezone: string;
      next_run_at: number;
      last_run_at: number | null;
      status: string;
      created_at: number;
      canceled_at: number | null;
    }, [string, number, number]>(
      `SELECT id, topic_id, prompt, schedule_kind, schedule_value, timezone, next_run_at,
         last_run_at, status, created_at, canceled_at
       FROM events
       WHERE status = ? AND next_run_at <= ?
       ORDER BY next_run_at ASC, created_at ASC
       LIMIT ?`,
    ).all(EventStatusScheduled, firedAt, maxItems);

    const update = db.query(
      "UPDATE events SET last_run_at = ?, next_run_at = ?, status = ? WHERE id = ? AND status = ?",
    );

    const due: DueEvent[] = [];
    for (const row of rows) {
      const event = toEvent(row);
      const { nextRunAt, nextStatus } = advanceEventSchedule(event, firedAt);
      update.run(firedAt, nextRunAt, nextStatus, event.id, EventStatusScheduled);
      due.push({
        ...event,
        run_message: formatEventMessage(event, firedAt),
      });
    }

    due.sort((left, right) => left.next_run_at - right.next_run_at);
    return due;
  });
}

export function formatEventMessage(event: Event, firedAt: number): string {
  return `[scheduled event ${event.id} fired at ${new Date(firedAt * 1000).toISOString()}] ${event.prompt}`;
}

export function formatEventLine(event: Event): string {
  return `${event.id} [${event.status}] topic=${event.topic_id} next=${new Date(event.next_run_at * 1000).toISOString()} schedule=${event.schedule_kind}:${event.schedule_value} tz=${event.timezone} prompt=${JSON.stringify(event.prompt)}`;
}

function toEvent(row: {
  id: string;
  topic_id: string;
  prompt: string;
  schedule_kind: string;
  schedule_value: string;
  timezone: string;
  next_run_at: number;
  last_run_at: number | null;
  status: string;
  created_at: number;
  canceled_at: number | null;
}): Event {
  return {
    id: row.id,
    topic_id: row.topic_id,
    prompt: row.prompt,
    schedule_kind: row.schedule_kind,
    schedule_value: row.schedule_value,
    timezone: row.timezone,
    next_run_at: row.next_run_at,
    last_run_at: row.last_run_at ?? undefined,
    status: row.status,
    created_at: row.created_at,
    canceled_at: row.canceled_at ?? undefined,
  };
}

function computeInitialNextRun(
  scheduleKind: string,
  scheduleValue: string,
  timezone: string,
): { nextRunAt: number; normalizedValue: string; normalizedTimezone: string } {
  const normalizedTimezone = resolveTimeZone(timezone);
  const now = new Date();

  switch (scheduleKind) {
    case EventScheduleOnce: {
      const next = parseFutureTime(scheduleValue, normalizedTimezone, now);
      return {
        nextRunAt: Math.floor(next.getTime() / 1000),
        normalizedValue: next.toISOString(),
        normalizedTimezone,
      };
    }
    case EventScheduleDaily: {
      const { hour, minute, normalized } = parseDailyTime(scheduleValue);
      const current = getZonedParts(now, normalizedTimezone);
      let candidate = zonedDateFromParts({
        year: current.year,
        month: current.month,
        day: current.day,
        hour,
        minute,
        second: 0,
      }, normalizedTimezone);

      if (candidate.getTime() <= now.getTime()) {
        const nextDay = addDays(current.year, current.month, current.day, 1);
        candidate = zonedDateFromParts({
          year: nextDay.year,
          month: nextDay.month,
          day: nextDay.day,
          hour,
          minute,
          second: 0,
        }, normalizedTimezone);
      }

      return {
        nextRunAt: Math.floor(candidate.getTime() / 1000),
        normalizedValue: normalized,
        normalizedTimezone,
      };
    }
    default:
      throw new Error(`unsupported schedule kind: ${scheduleKind}`);
  }
}

function advanceEventSchedule(
  event: Event,
  nowUnix: number,
): { nextRunAt: number; nextStatus: string } {
  switch (event.schedule_kind) {
    case EventScheduleOnce:
      return { nextRunAt: event.next_run_at, nextStatus: EventStatusDone };
    case EventScheduleDaily: {
      const timezone = resolveTimeZone(event.timezone);
      const { hour, minute } = parseDailyTime(event.schedule_value);
      const now = new Date(nowUnix * 1000);
      const current = getZonedParts(now, timezone);
      let nextDay = { year: current.year, month: current.month, day: current.day };
      let next = zonedDateFromParts({ ...nextDay, hour, minute, second: 0 }, timezone);
      while (next.getTime() <= now.getTime()) {
        nextDay = addDays(nextDay.year, nextDay.month, nextDay.day, 1);
        next = zonedDateFromParts({ ...nextDay, hour, minute, second: 0 }, timezone);
      }
      return {
        nextRunAt: Math.floor(next.getTime() / 1000),
        nextStatus: EventStatusScheduled,
      };
    }
    default:
      throw new Error(`unsupported schedule kind: ${event.schedule_kind}`);
  }
}

function parseFutureTime(value: string, timezone: string, now: Date): Date {
  const trimmed = value.trim();
  const zonedMarker = /(?:Z|[+-]\d{2}:?\d{2})$/;
  if (zonedMarker.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("invalid once schedule, use RFC3339 or YYYY-MM-DD HH:MM");
    }
    if (parsed.getTime() <= now.getTime()) {
      throw new Error("scheduled time must be in the future");
    }
    return parsed;
  }

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    throw new Error("invalid once schedule, use RFC3339 or YYYY-MM-DD HH:MM");
  }

  const parsed = zonedDateFromParts({
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
    hour: Number.parseInt(match[4], 10),
    minute: Number.parseInt(match[5], 10),
    second: Number.parseInt(match[6] ?? "0", 10),
  }, timezone);

  if (parsed.getTime() <= now.getTime()) {
    throw new Error("scheduled time must be in the future");
  }
  return parsed;
}

function parseDailyTime(value: string): { hour: number; minute: number; normalized: string } {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error("daily schedule must be HH:MM");
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23) {
    throw new Error("invalid daily hour");
  }
  if (minute < 0 || minute > 59) {
    throw new Error("invalid daily minute");
  }

  return {
    hour,
    minute,
    normalized: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function resolveTimeZone(name: string): string {
  const value = name && !/^local$/i.test(name)
    ? name.trim()
    : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
  } catch {
    throw new Error(`load timezone: unknown timezone ${JSON.stringify(name)}`);
  }

  return value;
}

function getZonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number.parseInt(values.year, 10),
    month: Number.parseInt(values.month, 10),
    day: Number.parseInt(values.day, 10),
    hour: Number.parseInt(values.hour, 10),
    minute: Number.parseInt(values.minute, 10),
    second: Number.parseInt(values.second, 10),
  };
}

function timeZoneOffsetMilliseconds(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

function zonedDateFromParts(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): Date {
  const targetUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = targetUTC;

  for (let index = 0; index < 4; index += 1) {
    const offset = timeZoneOffsetMilliseconds(new Date(guess), timeZone);
    const next = targetUTC - offset;
    if (next === guess) {
      break;
    }
    guess = next;
  }

  return new Date(guess);
}

function addDays(year: number, month: number, day: number, count: number): {
  year: number;
  month: number;
  day: number;
} {
  const date = new Date(Date.UTC(year, month - 1, day + count, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function registerEventCommands(register: RegisterFn, db: Database): void {
  register(
    "event",
    `Manage scheduled events.
Subcommands:
  event create once --prompt "..." --at "2026-03-11T18:00:00-07:00" [--topic TOPIC] [--tz America/Los_Angeles]
  event create daily --prompt "..." --time HH:MM [--topic TOPIC] [--tz America/Los_Angeles]
  event list [--topic TOPIC] [--all]
  event update <event-id> [--topic TOPIC] [--prompt "..."] [--tz TIMEZONE]
  event cancel <event-id>`,
    async (args) => {
      if (args.length === 0) {
        throw new Error("usage: event <create|list|update|cancel> ...");
      }

      switch (args[0]) {
        case "create":
          return eventCreateCommand(db, args.slice(1));
        case "list":
          return eventListCommand(db, args.slice(1));
        case "update":
          return eventUpdateCommand(db, args.slice(1));
        case "cancel":
          return eventCancelCommand(db, args.slice(1));
        default:
          throw new Error(`unknown event subcommand: ${args[0]}`);
      }
    },
  );
}

function eventCreateCommand(db: Database, args: string[]): string {
  if (args.length === 0) {
    throw new Error("usage: event create <once|daily> ...");
  }

  const kind = args[0];
  const values = parseLongFlags(args.slice(1));
  let topicId = values.topic ?? "";
  if (!topicId) {
    topicId = getCurrentTopic();
  }
  if (!topicId) {
    throw new Error("topic is required");
  }

  const prompt = values.prompt ?? "";
  const timezone = values.tz ?? "";
  const scheduleValue = kind === EventScheduleDaily ? values.time ?? "" : values.at ?? "";
  const event = createEvent(db, topicId, prompt, kind, scheduleValue, timezone);
  return formatEventLine(event);
}

function eventListCommand(db: Database, args: string[]): string {
  let topicId = "";
  let includeCanceled = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--topic":
        if (!args[index + 1]) {
          throw new Error("missing value for --topic");
        }
        topicId = args[index + 1];
        index += 1;
        break;
      case "--all":
        includeCanceled = true;
        break;
      default:
        throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (!topicId) {
    topicId = getCurrentTopic();
  }

  const events = listEvents(db, topicId, includeCanceled);
  if (events.length === 0) {
    return "no events";
  }
  return events.map(formatEventLine).join("\n");
}

function eventUpdateCommand(db: Database, args: string[]): string {
  if (args.length < 2) {
    throw new Error("usage: event update <event-id> [--topic TOPIC] [--prompt \"...\"] [--tz TIMEZONE]");
  }

  const eventId = args[0];
  const updates = parseLongFlags(args.slice(1));
  const event = updateEvent(db, eventId, updates);
  return formatEventLine(event);
}

function eventCancelCommand(db: Database, args: string[]): string {
  if (args.length !== 1) {
    throw new Error("usage: event cancel <event-id>");
  }

  cancelEvent(db, args[0]);
  return `canceled ${args[0]}`;
}

function parseLongFlags(args: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected argument: ${arg}`);
    }
    const value = args[index + 1];
    if (value == null) {
      throw new Error(`missing value for ${arg}`);
    }
    values[arg.slice(2)] = value;
    index += 1;
  }
  return values;
}
