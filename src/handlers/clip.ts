/**
 * Clip handler — resource-oriented commands for runtime clips.
 *
 * Clip Commands:
 *   clip list
 */

import { listClips } from "@pinixai/core";
import type { InvocationInput } from "../args";
import { ok, type DataResponse } from "./response";

// --- Response types ---

export interface ClipInfo {
  name: string;
  package: string;
  version: string;
  commands: string[];
}

// --- Handlers ---

export async function handleClipList(_input: InvocationInput): Promise<DataResponse<ClipInfo[]>> {
  const clips = await listClips();
  const data: ClipInfo[] = clips.map((clip) => ({
    name: clip.name,
    package: clip.package ?? "",
    version: clip.version ?? "",
    commands: (clip.commands ?? []).map((cmd) => cmd.name ?? ""),
  }));
  return ok(data);
}
