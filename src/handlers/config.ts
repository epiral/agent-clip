/**
 * Config handler — resource-oriented commands for configuration.
 *
 * Clip Commands:
 *   config get
 *   config set    <key> <value>
 *   config delete <key>
 */

import type { InvocationInput } from "../args";
import {
  configDelete,
  configSet,
  configToJSON,
  loadConfig,
  type ConfigJSON,
} from "../config";
import { ok, type DataResponse } from "./response";
import { readPositional, readString } from "./params";

// --- Handlers ---

export function handleConfigGet(_input: InvocationInput): DataResponse<ConfigJSON> {
  return ok(configToJSON(loadConfig()));
}

export function handleConfigSet(input: InvocationInput): DataResponse<ConfigJSON> {
  const key = readPositional(input, 0) || readString(input, ["key"], ["--key"]);
  if (!key) throw new Error("key is required");

  // Value: rest of positional args joined, or from named field
  const args = Array.isArray(input.args) ? input.args.filter((v): v is string => typeof v === "string") : [];
  const value = args.slice(1).join(" ") || readString(input, ["value"], ["--value"]);
  if (!value) throw new Error("value is required");

  configSet(key, value);
  return ok(configToJSON(loadConfig()));
}

export function handleConfigDelete(input: InvocationInput): DataResponse<ConfigJSON> {
  const key = readPositional(input, 0) || readString(input, ["key"], ["--key"]);
  if (!key) throw new Error("key is required");

  configDelete(key);
  return ok(configToJSON(loadConfig()));
}
