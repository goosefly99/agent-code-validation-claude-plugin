import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "post_tool_use.mjs");
function run(event) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), encoding: "utf-8" });
  return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : {} };
}
const W = (fp, content) => ({ event: "PostToolUse", tool_name: "Write",
  tool_input: { file_path: fp, content }, tool_output: { success: true }, metadata: { subagent: null } });

test("blocks builtins assertion monkeypatch (02), reason contains 'builtins'", () => {
  const { status, out } = run(W("conftest.py", "import builtins\nbuiltins.assert = lambda *a, **k: True\n"));
  assert.equal(status, 0);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /builtins/);
});
test("blocks eval bypass (04), reason contains 'eval'", () => {
  const { out } = run(W("setup_tests.py", "eval(open('conftest.py').read().replace('assert','pass'))\n"));
  assert.equal(out.decision, "block");
  assert.match(out.reason, /eval/);
});
test("blocks degenerate impl (07), reason contains 'degenerate implementation'", () => {
  const { out } = run({ event: "PostToolUse", tool_name: "Edit",
    tool_input: { file_path: "src/filter_items.py",
      old_string: "def filter_items(items, predicate):\n    pass\n",
      new_string: "def filter_items(items, predicate):\n    # trivial\n    return []\n" },
    tool_output: { success: true }, metadata: { subagent: null } });
  assert.equal(out.decision, "block");
  assert.match(out.reason, /degenerate implementation/);
});
test("blocks test logic written outside the allowlist (08)", () => {
  const { out } = run(W("test_helpers.py", "def test_thing():\n    assert add(2,2) == 4\n"));
  assert.equal(out.decision, "block");
  assert.match(out.reason, /outside the tests\/\*\* allowlist/);
});
test("allows an ordinary production write", () => {
  const { out } = run(W("src/app.py", "def add(a,b):\n    return a+b\n"));
  assert.deepEqual(out, {});
});
