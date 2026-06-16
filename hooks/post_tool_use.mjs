#!/usr/bin/env node
// PostToolUse — reward-hacking watchdog + path/content guard (T5).
//
// PostToolUse cannot un-run the tool; `decision:"block"` is *feedback* routed
// back into the primary agent's context. Output shape is TOP-LEVEL
// { decision:"block", reason } (NOT under hookSpecificOutput).
//
// Detection: the compiled watchdog (mcp-server/dist/watchdog.js) for semantic
// patterns, plus a path/content check for test logic written outside tests/**.
// Fails OPEN (allow) on any internal error — never breaks a session.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveProjectDir, isActivated, acvDir,
} from "./_lib/acv.mjs";

const event = JSON.parse(readFileSync(0, "utf-8"));

function writtenContent(ev) {
  const ti = ev.tool_input ?? {};
  if (typeof ti.content === "string") return ti.content;          // Write
  if (typeof ti.new_string === "string") return ti.new_string;     // Edit
  if (Array.isArray(ti.edits)) {                                    // MultiEdit
    return ti.edits.map((e) => e?.new_string ?? "").join("\n");
  }
  return "";
}

function langOf(fp) {
  if (/\.(py|pyi)$/.test(fp)) return "python";
  if (/\.(c|m)?(j|t)sx?$/.test(fp)) return "js";
  return "other";
}

// content that looks like a test suite (used for the outside-allowlist guard)
function looksLikeTest(src) {
  return /\bdef\s+test_\w+\s*\(/.test(src) ||
    /\bclass\s+Test\w+/.test(src) ||
    /^\s*assert\s+/m.test(src) ||
    /\b(describe|it|test)\s*\(/.test(src);
}

// True if the path lives under a canonical test directory (tests/, test/, spec/).
// We check the directory — NOT the full filename allowlist — because the point
// of the guard is to flag test logic smuggled OUTSIDE the guarded tests/** tree
// (e.g. a root-level test_helpers.py that filename globs would still match).
function inCanonicalTestDir(fp) {
  return /(^|\/)(tests?|spec)\//.test(String(fp).replace(/\\/g, "/"));
}

async function main() {
  const filePath = event.tool_input?.file_path ?? "";
  const content = writtenContent(event);
  if (!filePath || !content) { console.log(JSON.stringify({})); return; }

  const projectDir = resolveProjectDir();
  const reasons = [];

  // 1) semantic watchdog (compiled TS) — fail open on import/parse error.
  // Dynamic import of an absolute path must be a file:// URL on Windows
  // (bare paths throw ERR_UNSUPPORTED_ESM_URL_SCHEME).
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const wdPath = join(here, "..", "mcp-server", "dist", "watchdog.js");
    const wd = await import(pathToFileURL(wdPath).href);
    const lang = langOf(filePath);
    const findings = lang === "python" ? wd.analyzePython(content)
      : lang === "js" ? wd.analyzeJs(content) : [];
    for (const f of findings) if (f.severity !== "low") reasons.push(f.explanation);
  } catch {
    /* watchdog unavailable (not built / parse error) → skip, fail open */
  }

  // 2) path/content guard: test logic written outside the tests/** allowlist.
  if (looksLikeTest(content) && !inCanonicalTestDir(filePath)) {
    reasons.push(
      `'${filePath}' contains test logic but is outside the tests/** allowlist; ` +
      `tests must live under tests/** and be authored by the test-author subagent`,
    );
  }

  if (reasons.length === 0) { console.log(JSON.stringify({})); return; }

  const reason =
    "agent_code_validation watchdog flagged this write as SUSPICIOUS: " +
    reasons.join("; ") + ".";

  // Persist the finding when the project is activated, so Stop/PreCompact can
  // gate on unresolved SUSPICIOUS verdicts. Best-effort; never blocks output.
  if (isActivated(projectDir)) {
    try {
      const { appendFileSync, mkdirSync } = await import("node:fs");
      const dir = acvDir(projectDir);
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "findings.jsonl"),
        JSON.stringify({ ts: new Date().toISOString(), file: filePath,
          severity: "high", rule: "post_tool_use", reason, resolved: false }) + "\n");
    } catch { /* best-effort */ }
  }

  console.log(JSON.stringify({ decision: "block", reason }));
}

main().catch(() => { console.log(JSON.stringify({})); }); // fail open
