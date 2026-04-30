// Append-only provenance log. Every sandbox spawn, every MCP tool call, every
// hook decision writes one JSONL line to .acv/provenance.jsonl. Used by /audit.

import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ProvenanceEntry } from "./types.js";

let logPath: string | null = null;

export async function initProvenance(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  logPath = join(dir, "provenance.jsonl");
}

export async function log(entry: Omit<ProvenanceEntry, "ts">): Promise<void> {
  if (!logPath) throw new Error("provenance not initialized");
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  await appendFile(logPath, line, "utf-8");
}

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
