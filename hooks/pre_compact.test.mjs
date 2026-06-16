import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "pre_compact.mjs");
function run(projectDir) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ event: "PreCompact" }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir }, encoding: "utf-8" });
  return r.stdout.trim() ? JSON.parse(r.stdout) : {};
}

test("inactive: allows compaction", () => {
  assert.deepEqual(run(mkdtempSync(join(tmpdir(), "acv-pc-i-"))), {});
});
test("active with unresolved SUSPICIOUS: blocks compaction", () => {
  const d = mkdtempSync(join(tmpdir(), "acv-pc-s-"));
  writeFileSync(join(d, "acv.config.json"), JSON.stringify({ enabled: true }));
  mkdirSync(join(d, ".acv"), { recursive: true });
  writeFileSync(join(d, ".acv", "findings.jsonl"),
    JSON.stringify({ file: "x.py", reason: "bad", resolved: false }) + "\n");
  const out = run(d);
  assert.equal(out.decision, "block");
});
