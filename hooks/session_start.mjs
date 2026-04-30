#!/usr/bin/env node
// Hook stub — see plugin ROADMAP.md Phase mapping below.
// Contract: read JSON event from stdin, write hook output JSON to stdout.
// Exit 0 on success; non-zero = hook error (Claude Code surfaces to user).

import { readFileSync } from "node:fs";
import {
  mkdir,
  open,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { opendir } from "node:fs/promises";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { join, relative } from "node:path";

const event = JSON.parse(readFileSync(0, "utf-8"));

// ─── constants ───────────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".acv", "__pycache__",
  ".pytest_cache", ".venv", "venv", "target", ".next", "coverage",
]);

// Test-file glob patterns compiled to regex matchers.
// Order matters: test patterns are checked first; anything else is production.
const TEST_MATCHERS = [
  /^tests\//,
  /^test\//,
  /^spec\//,
  /_test\.go$/,
  /\/test_[^/]+\.py$/, // **/test_*.py
  /^test_[^/]+\.py$/,  // test_*.py at root
  /\.test\.[jt]s$/,
  /\.spec\.[jt]s$/,
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const WALK_SOFT_BUDGET_MS = 25_000;
const SCHEMA_VERSION = 1;

// ─── helpers ─────────────────────────────────────────────────────────────────

function isTestFile(relPath) {
  // Normalise to forward slashes for consistent matching on Windows.
  const p = relPath.replace(/\\/g, "/");
  return TEST_MATCHERS.some((re) => re.test(p));
}

function generateUUID() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  // Read entire file into buffer — we already gate on MAX_FILE_SIZE before calling.
  const data = readFileSync(filePath); // sync: simpler, fine for single-threaded walk
  hash.update(data);
  return hash.digest("hex");
}

// ─── directory walker ────────────────────────────────────────────────────────

/**
 * Walk `dir` recursively, skipping IGNORED_DIRS at directory boundary.
 * Calls `onFile(absPath, relPath, sizeBytes)` for each regular file found.
 * Returns early if `stopSignal()` returns true (soft-budget exceeded).
 */
async function walkDir(dir, baseDir, onFile, stopSignal) {
  let dirHandle;
  try {
    dirHandle = await opendir(dir);
  } catch (err) {
    process.stderr.write(`[session_start] Warning: cannot open dir ${dir}: ${err.message}\n`);
    return;
  }

  for await (const entry of dirHandle) {
    if (stopSignal()) return;

    const absPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue; // prune at boundary
      await walkDir(absPath, baseDir, onFile, stopSignal);
    } else if (entry.isFile()) {
      let fileSize = 0;
      try {
        const s = await stat(absPath);
        fileSize = s.size;
      } catch (err) {
        process.stderr.write(`[session_start] Warning: cannot stat ${absPath}: ${err.message}\n`);
        continue;
      }
      const relPath = relative(baseDir, absPath);
      await onFile(absPath, relPath, fileSize);
    }
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const cwd = process.cwd();
  const acvDir = join(cwd, ".acv");

  // 1. Ensure .acv/ exists — critical: exit non-zero if we can't create it.
  try {
    await mkdir(acvDir, { recursive: true });
  } catch (err) {
    process.stderr.write(
      `[session_start] CRITICAL: cannot create .acv/ directory: ${err.message}\n` +
      `  Path: ${acvDir}\n` +
      `  Claude Code will refuse to register agent_code_validation tools.\n`
    );
    process.exit(1);
  }

  // 2. Check for git repo (non-fatal; just log).
  try {
    await stat(join(cwd, ".git"));
  } catch {
    process.stderr.write(
      `[session_start] Info: working directory is not a git repo. Plugin will still function.\n`
    );
  }

  // 3. Walk working directory to build baseline snapshot.
  const tests = {};
  const production = {};
  const startTime = Date.now();
  let softBudgetTriggered = false;

  const stopSignal = () => {
    if (!softBudgetTriggered && Date.now() - startTime > WALK_SOFT_BUDGET_MS) {
      softBudgetTriggered = true;
      process.stderr.write(
        `[session_start] Warning: 25s soft budget exceeded during file walk. ` +
        `Snapshot will be partial.\n`
      );
    }
    return softBudgetTriggered;
  };

  await walkDir(cwd, cwd, async (absPath, relPath, fileSize) => {
    if (fileSize > MAX_FILE_SIZE) {
      process.stderr.write(
        `[session_start] Warning: file larger than 10 MB skipped from hash: ${relPath} (${fileSize} bytes)\n`
      );
      return;
    }

    let digest;
    try {
      digest = await hashFile(absPath);
    } catch (err) {
      process.stderr.write(
        `[session_start] Warning: cannot read ${relPath}: ${err.message}\n`
      );
      return;
    }

    if (isTestFile(relPath)) {
      tests[relPath.replace(/\\/g, "/")] = digest;
    } else {
      production[relPath.replace(/\\/g, "/")] = digest;
    }
  }, stopSignal);

  const wallMs = Date.now() - startTime;

  // 4. Generate signing key (32 random bytes) and write to .acv/.session-key.
  //    Mode 0o600 is a POSIX concept; on Windows the mode is a hint only and
  //    the OS does not enforce it — this is documented here for transparency.
  const signingKey = randomBytes(32);
  const sessionKeyPath = join(acvDir, ".session-key");
  try {
    await writeFile(sessionKeyPath, signingKey, { mode: 0o600 });
  } catch (err) {
    process.stderr.write(
      `[session_start] CRITICAL: cannot write session key: ${err.message}\n`
    );
    process.exit(1);
  }

  // 5. Build snapshot object (without signature yet).
  const session_id = generateUUID();
  const keyFingerprint = createHmac("sha256", signingKey)
    .update("fingerprint")
    .digest("hex")
    .slice(0, 8);

  const counts = {
    tests: Object.keys(tests).length,
    production: Object.keys(production).length,
  };

  const snapshot = {
    schema_version: SCHEMA_VERSION,
    session_id,
    created_at: new Date().toISOString(),
    cwd,
    tests,
    production,
    counts,
    signing_key_fingerprint: keyFingerprint,
    ...(softBudgetTriggered ? { partial_snapshot: true } : {}),
    walk_duration_ms: wallMs,
  };

  // 6. Sign the snapshot: HMAC-SHA256(key, canonical JSON without signature field).
  const canonicalJson = JSON.stringify(snapshot); // snapshot has no `signature` yet
  const signature = createHmac("sha256", signingKey)
    .update(canonicalJson)
    .digest("hex");
  snapshot.signature = signature;

  // 7. Write snapshot atomically: write to .tmp then rename.
  const snapshotPath = join(acvDir, "session-start.json");
  const snapshotTmpPath = snapshotPath + ".tmp";
  try {
    await writeFile(snapshotTmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
    await rename(snapshotTmpPath, snapshotPath);
  } catch (err) {
    process.stderr.write(
      `[session_start] CRITICAL: cannot write snapshot: ${err.message}\n`
    );
    process.exit(1);
  }

  // 8. Initialize provenance log (touch — create empty if missing).
  const provenancePath = join(acvDir, "provenance.jsonl");
  try {
    // open with 'a' flag: creates if missing, does not truncate if exists.
    const fh = await open(provenancePath, "a");
    await fh.close();
  } catch (err) {
    process.stderr.write(
      `[session_start] Warning: cannot initialize provenance log: ${err.message}\n`
    );
    // Non-fatal — don't exit 1 for this.
  }

  // 9. Emit hook output.
  const additionalContext =
    `agent_code_validation: session ${session_id} initialized; ` +
    `baseline snapshot at .acv/session-start.json ` +
    `(${counts.tests} test files, ${counts.production} production files).` +
    (softBudgetTriggered ? " [PARTIAL SNAPSHOT — walk budget exceeded]" : "");

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
    })
  );
}

main().catch((err) => {
  process.stderr.write(`[session_start] Unhandled error: ${err.stack || err.message}\n`);
  process.exit(1);
});
