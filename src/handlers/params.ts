/**
 * Unified parameter resolution for resource-oriented handlers.
 *
 * Reads from both named fields (IPC: { topic_id: "xxx" })
 * and CLI args (--topic_id xxx). Named fields take precedence.
 */

import type { InvocationInput } from "../args";

/** Read a string param from input fields or --flag args */
export function readString(input: InvocationInput, fields: string[], flags?: string[]): string {
  // 1. Named fields (IPC)
  for (const field of fields) {
    const value = input[field];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }

  // 2. CLI args (--flag value)
  if (flags) {
    const args = getArgs(input);
    for (let i = 0; i < args.length; i++) {
      if (flags.includes(args[i]) && i + 1 < args.length) {
        return args[i + 1];
      }
    }
  }

  return "";
}

/** Read an integer param from input fields or --flag args */
export function readInt(input: InvocationInput, fields: string[], flags?: string[], defaultValue?: number): number | undefined {
  // 1. Named fields
  for (const field of fields) {
    const value = input[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  // 2. CLI args
  if (flags) {
    const args = getArgs(input);
    for (let i = 0; i < args.length; i++) {
      if (flags.includes(args[i]) && i + 1 < args.length) {
        const parsed = Number.parseInt(args[i + 1], 10);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }

  return defaultValue;
}

/** Read a boolean param from input fields or --flag args */
export function readBool(input: InvocationInput, fields: string[], flags?: string[]): boolean {
  // 1. Named fields
  for (const field of fields) {
    const value = input[field];
    if (typeof value === "boolean") return value;
  }

  // 2. CLI args (presence = true)
  if (flags) {
    const args = getArgs(input);
    for (const arg of args) {
      if (flags.includes(arg)) return true;
    }
  }

  return false;
}

/** Read positional arg by index */
export function readPositional(input: InvocationInput, position: number): string {
  const args = getArgs(input);
  return args[position] ?? "";
}

/** Read positional arg OR named field (common pattern for resource IDs) */
export function readId(input: InvocationInput, position: number, fields: string[]): string {
  const positional = readPositional(input, position);
  if (positional) return positional;
  return readString(input, fields);
}

function getArgs(input: InvocationInput): string[] {
  return Array.isArray(input.args)
    ? input.args.filter((v): v is string => typeof v === "string")
    : [];
}
