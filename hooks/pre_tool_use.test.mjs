import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "pre_tool_use.mjs");

function run(event) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), encoding: "utf-8" });
  return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : {} };
}
const denied = (o) => o.hookSpecificOutput?.permissionDecision === "deny";

test("denies tests/foo.py written by a non-test-author (old regex missed this)", () => {
  const { status, out } = run({ event: "PreToolUse", tool_name: "Write",
    tool_input: { file_path: "tests/foo.py", content: "x" }, metadata: { subagent: null } });
  assert.equal(status, 0);
  assert.ok(denied(out), "tests/foo.py must be denied");
});

test("allows tests/foo.py when caller is test-author", () => {
  const { out } = run({ event: "PreToolUse", tool_name: "Write",
    tool_input: { file_path: "tests/foo.py", content: "x" }, metadata: { subagent: "test-author" } });
  assert.equal(denied(out), false);
});

test("denies a MultiEdit that touches any test path", () => {
  const { out } = run({ event: "PreToolUse", tool_name: "MultiEdit",
    tool_input: { file_path: "src/app.py", edits: [
      { file_path: "src/app.py", old_string: "a", new_string: "b" },
      { file_path: "tests/test_app.py", old_string: "c", new_string: "d" } ] },
    metadata: { subagent: null } });
  assert.ok(denied(out), "MultiEdit touching tests/** must be denied");
});

test("allows a pure production write", () => {
  const { out } = run({ event: "PreToolUse", tool_name: "Edit",
    tool_input: { file_path: "src/app.py", old_string: "a", new_string: "b" }, metadata: { subagent: null } });
  assert.equal(denied(out), false);
});
