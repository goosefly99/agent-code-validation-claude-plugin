#!/usr/bin/env node
// SessionStart hook — establishes the tamper-evident baseline.
//
// Contract: read JSON event from stdin, write hook output JSON to stdout.
// Exit 0 on success; non-zero = hook error (Claude Code surfaces to user).
//
// OPT-IN: does nothing unless the project is activated (acv.config.json present).
// This is the fix for ".acv litter in every project". When active, it:
//   1. ensures `.acv/` is in the project .gitignore BEFORE writing the key,
//   2. enumerates baseline files from `git ls-files` (bounded, no build artifacts),
//   3. hashes them via a streamed async digest,
//   4. writes an HMAC-signed snapshot atomically to .acv/session-start.json.

import { readFileSync, createReadStream } from "node:fs";
import { mkdir, open, rename, stat, writeFile } from "node:fs/promises";
import { opendir } from "node:fs/promises";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, relative } from "node:path";

import {
  isActivated,
  ensureGitignored,
  resolveProjectDir,
  acvDir,
  readSettings,
  isTestPath,
} from "./_lib/acv.mjs";

const execFileAsync = promisify(execFile);

// Read (and ignore the contents of) the hook event from stdin.
JSON.parse(readFileSync(0, "utf-8"));

// ─── constants ───────────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".acv", "__pycache__",
  ".pytest_cache", ".venv", "venv", "target", ".next", "coverage",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB — skip larger files from hashing
const MAX_WALK_FILES = 5000;            // hard cap for the non-git fallback walk
const WALK_SOFT_BUDGET_MS = 15_000;
const SCHEMA_VERSION = 2;

// ─── helpers ─────────────────────────────────────────────────────────────────

function generateUUID() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

/** Streamed SHA-256 — does not load the whole file into memory. */
function hashFileStream(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Enumerate baseline files. Prefer `git ls-files` (bounded; excludes build
 * artifacts and untracked junk by construction). Fall back to a capped walk
 * for non-git projects, marking the snapshot partial.
 */
async function enumerateFiles(projectDir) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectDir, "ls-files", "-z"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const files = stdout.split("\0").filter(Boolean);
    return { files, partial: false, source: "git" };
  } catch {
    // Not a git repo (or git unavailable): bounded walk fallback.
    const files = [];
    const startTime = Date.now();
    let partial = false;
    async function walk(dir) {
      if (files.length >= MAX_WALK_FILES) { partial = true; return; }
      if (Date.now() - startTime > WALK_SOFT_BUDGET_MS) { partial = true; return; }
      let handle;
      try { handle = await opendir(dir); } catch { return; }
      for await (const entry of handle) {
        if (files.length >= MAX_WALK_FILES) { partial = true; break; }
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          await walk(abs);
        } else if (entry.isFile()) {
          files.push(relative(projectDir, abs));
        }
      }
    }
    await walk(projectDir);
    return { files, partial, source: "walk" };
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const projectDir = resolveProjectDir();

  // Opt-in gate: write nothing unless the project activated the plugin.
  if (!isActivated(projectDir)) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          "agent_code_validation is installed but INACTIVE for this project " +
          "(no acv.config.json). It will not touch your repo. To enable the " +
          "validation/audit gate, add acv.config.json (see acv.config.example.json) " +
          "or run /verify.",
      },
    }));
    return;
  }

  // Active: ensure .acv/ is gitignored BEFORE writing any secret material.
  ensureGitignored(projectDir);

  const acv = acvDir(projectDir);
  try {
    await mkdir(acv, { recursive: true });
  } catch (err) {
    process.stderr.write(`[session_start] CRITICAL: cannot create ${acv}: ${err.message}\n`);
    process.exit(1);
  }

  const settings = readSettings(projectDir);
  const allowlist = settings.test_path_allowlist;

  const { files, partial, source } = await enumerateFiles(projectDir);

  const tests = {};
  const production = {};
  for (const rel of files) {
    const abs = join(projectDir, rel);
    let size;
    try { size = (await stat(abs)).size; } catch { continue; }
    if (size > MAX_FILE_SIZE) continue;
    let digest;
    try { digest = await hashFileStream(abs); } catch { continue; }
    const norm = rel.replace(/\\/g, "/");
    if (isTestPath(norm, allowlist)) tests[norm] = digest;
    else production[norm] = digest;
  }

  // Signing key (32 random bytes). Mode 0o600 is a POSIX hint; on Windows the
  // OS does not enforce it — that is why we gitignore .acv/ first.
  const signingKey = randomBytes(32);
  try {
    await writeFile(join(acv, ".session-key"), signingKey, { mode: 0o600 });
  } catch (err) {
    process.stderr.write(`[session_start] CRITICAL: cannot write session key: ${err.message}\n`);
    process.exit(1);
  }

  const session_id = generateUUID();
  const keyFingerprint = createHmac("sha256", signingKey).update("fingerprint").digest("hex").slice(0, 8);
  const counts = { tests: Object.keys(tests).length, production: Object.keys(production).length };

  const snapshot = {
    schema_version: SCHEMA_VERSION,
    session_id,
    created_at: new Date().toISOString(),
    project_dir: projectDir,
    enumeration: source,
    tests,
    production,
    counts,
    signing_key_fingerprint: keyFingerprint,
    ...(partial ? { partial_snapshot: true } : {}),
  };

  const signature = createHmac("sha256", signingKey).update(JSON.stringify(snapshot)).digest("hex");
  snapshot.signature = signature;

  // Atomic write: tmp + rename.
  const snapshotPath = join(acv, "session-start.json");
  try {
    await writeFile(snapshotPath + ".tmp", JSON.stringify(snapshot, null, 2), "utf-8");
    await rename(snapshotPath + ".tmp", snapshotPath);
  } catch (err) {
    process.stderr.write(`[session_start] CRITICAL: cannot write snapshot: ${err.message}\n`);
    process.exit(1);
  }

  // Initialize provenance log (touch — create empty if missing).
  try {
    const fh = await open(join(acv, "provenance.jsonl"), "a");
    await fh.close();
  } catch {
    // non-fatal
  }

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext:
        `agent_code_validation: session ${session_id} initialized; baseline at ` +
        `.acv/session-start.json (${counts.tests} test, ${counts.production} production ` +
        `files via ${source})` + (partial ? " [PARTIAL — enumeration capped]" : "") + ".",
    },
  }));
}

main().catch((err) => {
  process.stderr.write(`[session_start] Unhandled error: ${err.stack || err.message}\n`);
  process.exit(1);
});
