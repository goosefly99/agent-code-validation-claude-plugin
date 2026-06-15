// Append-only provenance log. Every sandbox spawn, every MCP tool call, every
// hook decision writes one JSONL line to .acv/provenance.jsonl. Used by /audit.
//
// Opt-in / lazy: when the project is not activated (no acv.config.json), the
// server passes active:false and log() is a silent no-op that creates nothing.
// This is the fix for ".acv litter in every project". The directory is created
// lazily on the first real write, never eagerly at init.

import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ProvenanceEntry } from "./types.js";

let logDir: string | null = null;
let logPath: string | null = null;
let active = true;

/**
 * @param provenanceDir the `.acv` directory where provenance.jsonl lives.
 * @param opts.active    whether the project opted in. Defaults to true so the
 *                       module is usable standalone (and in unit tests); the
 *                       server computes this from acv.config.json presence.
 */
export async function initProvenance(
  provenanceDir: string,
  opts: { active?: boolean } = {},
): Promise<void> {
  logDir = provenanceDir;
  logPath = join(provenanceDir, "provenance.jsonl");
  active = opts.active ?? true;
  // Intentionally NO mkdir here — see header. Created lazily in log().
}

export async function log(entry: Omit<ProvenanceEntry, "ts">): Promise<void> {
  if (!active || !logDir || !logPath) return; // silent no-op; never throws
  await mkdir(logDir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  await appendFile(logPath, line, "utf-8");
}

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
