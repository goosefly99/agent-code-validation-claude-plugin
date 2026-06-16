// Unit tests for the shared hook library. Run: node --test hooks/_lib/acv.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isTestPath,
  DEFAULT_TEST_ALLOWLIST,
  isActivated,
  ensureGitignored,
  resolveProjectDir,
  acvDir,
} from "./acv.mjs";

function tmp() {
  return mkdtempSync(join(tmpdir(), "acv-test-"));
}

test("isTestPath matches canonical layouts the old pre_tool_use regex missed", () => {
  for (const p of [
    "tests/foo.py",          // <- the canonical case the old anchored regex let through
    "tests/conftest.py",
    "tests/helpers.py",
    "test/foo.py",
    "spec/foo_spec.rb",
    "pkg/foo_test.go",
    "foo_test.go",
    "src/a.test.ts",
    "src/a.spec.js",
    "test_thing.py",
    "a/b/test_x.py",
  ]) {
    assert.equal(isTestPath(p, DEFAULT_TEST_ALLOWLIST), true, `expected test: ${p}`);
  }
});

test("isTestPath rejects production files", () => {
  for (const p of [
    "src/app.py",
    "lib/index.ts",
    "README.md",
    "testing.py",          // 'test' substring but not a test file
    "src/contestant.go",   // contains 'test' but not '_test.go'
  ]) {
    assert.equal(isTestPath(p, DEFAULT_TEST_ALLOWLIST), false, `expected production: ${p}`);
  }
});

test("isTestPath normalises Windows backslashes", () => {
  assert.equal(isTestPath("tests\\foo.py", DEFAULT_TEST_ALLOWLIST), true);
});

test("isActivated is false without acv.config.json", () => {
  const d = tmp();
  assert.equal(isActivated(d), false);
});

test("isActivated is true when acv.config.json present and not disabled", () => {
  const d = tmp();
  writeFileSync(join(d, "acv.config.json"), JSON.stringify({ enabled: true }));
  assert.equal(isActivated(d), true);
});

test("isActivated honours enabled:false", () => {
  const d = tmp();
  writeFileSync(join(d, "acv.config.json"), JSON.stringify({ enabled: false }));
  assert.equal(isActivated(d), false);
});

test("isActivated treats unparseable config as opted-in (file present = intent)", () => {
  const d = tmp();
  writeFileSync(join(d, "acv.config.json"), "{not json");
  assert.equal(isActivated(d), true);
});

test("ensureGitignored creates .gitignore with .acv/ when missing", () => {
  const d = tmp();
  ensureGitignored(d);
  const gi = readFileSync(join(d, ".gitignore"), "utf-8");
  assert.match(gi, /(^|\n)\.acv\/(\n|$)/);
});

test("ensureGitignored is idempotent and does not duplicate", () => {
  const d = tmp();
  writeFileSync(join(d, ".gitignore"), "node_modules/\n.acv/\n");
  ensureGitignored(d);
  const gi = readFileSync(join(d, ".gitignore"), "utf-8");
  assert.equal((gi.match(/\.acv\//g) || []).length, 1);
});

test("ensureGitignored appends to an existing .gitignore without .acv/", () => {
  const d = tmp();
  writeFileSync(join(d, ".gitignore"), "node_modules/\n");
  ensureGitignored(d);
  const gi = readFileSync(join(d, ".gitignore"), "utf-8");
  assert.match(gi, /node_modules\//);
  assert.match(gi, /\.acv\//);
});

test("resolveProjectDir prefers CLAUDE_PROJECT_DIR", () => {
  const prev = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = "/some/project";
  assert.equal(resolveProjectDir(), "/some/project");
  if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  else process.env.CLAUDE_PROJECT_DIR = prev;
});

test("acvDir joins .acv under the project dir", () => {
  assert.equal(acvDir("/p"), join("/p", ".acv"));
});
