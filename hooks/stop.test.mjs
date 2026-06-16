import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "stop.mjs");
function run(projectDir) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ event: "Stop", session_id: "s1" }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir }, encoding: "utf-8" });
  return r.stdout.trim() ? JSON.parse(r.stdout) : {};
}

test("inactive project: allows the stop (no acv.config.json)", () => {
  const d = mkdtempSync(join(tmpdir(), "acv-stop-inactive-"));
  assert.deepEqual(run(d), {});
});

test("active project with an unresolved SUSPICIOUS finding: blocks", () => {
  const d = mkdtempSync(join(tmpdir(), "acv-stop-susp-"));
  writeFileSync(join(d, "acv.config.json"), JSON.stringify({ enabled: true }));
  mkdirSync(join(d, ".acv"), { recursive: true });
  writeFileSync(join(d, ".acv", "findings.jsonl"),
    JSON.stringify({ file: "x.py", reason: "bad", resolved: false }) + "\n");
  const out = run(d);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /SUSPICIOUS|unresolved/i);
});

test("active project, no findings and no receipt: blocks (no verification receipt)", () => {
  const d = mkdtempSync(join(tmpdir(), "acv-stop-noreceipt-"));
  writeFileSync(join(d, "acv.config.json"), JSON.stringify({ enabled: true }));
  mkdirSync(join(d, ".acv"), { recursive: true });
  const out = run(d);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /receipt/i);
});
