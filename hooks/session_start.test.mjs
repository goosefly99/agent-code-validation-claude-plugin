// Tests for the SessionStart hook. Run: node --test hooks/session_start.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "session_start.mjs");

function runHook(projectDir) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "SessionStart" }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: "utf-8",
  });
}

test("inactive project: writes nothing, exits 0, reports inactive", () => {
  const d = mkdtempSync(join(tmpdir(), "acv-ss-inactive-"));
  const res = runHook(d);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(existsSync(join(d, ".acv")), false, "must not create .acv when inactive");
  const out = JSON.parse(res.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /inactive/i);
});

test("active git project: snapshots only tracked files, gitignores .acv, writes key", () => {
  const d = mkdtempSync(join(tmpdir(), "acv-ss-active-"));
  execFileSync("git", ["init", "-q"], { cwd: d });
  execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: d });
  execFileSync("git", ["config", "user.name", "t"], { cwd: d });
  writeFileSync(join(d, "app.py"), "print(1)\n");
  writeFileSync(join(d, "test_app.py"), "def test_x():\n    assert True\n");
  writeFileSync(join(d, "acv.config.json"), JSON.stringify({ enabled: true }));
  writeFileSync(join(d, "big.bin"), Buffer.alloc(2048)); // untracked — must be excluded
  execFileSync("git", ["add", "app.py", "test_app.py", "acv.config.json"], { cwd: d });

  const res = runHook(d);
  assert.equal(res.status, 0, res.stderr);

  assert.ok(existsSync(join(d, ".acv", "session-start.json")), "snapshot written");
  assert.ok(existsSync(join(d, ".acv", ".session-key")), "signing key written");
  assert.match(readFileSync(join(d, ".gitignore"), "utf-8"), /\.acv\//, ".acv/ gitignored");

  const snap = JSON.parse(readFileSync(join(d, ".acv", "session-start.json"), "utf-8"));
  const all = { ...snap.tests, ...snap.production };
  assert.ok("app.py" in snap.production, "app.py classified as production");
  assert.ok("test_app.py" in snap.tests, "test_app.py classified as test");
  assert.ok(!("big.bin" in all), "untracked binary excluded from snapshot");
  assert.equal(typeof snap.signature, "string", "snapshot is signed");
});
