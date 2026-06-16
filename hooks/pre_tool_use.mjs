#!/usr/bin/env node
// PreToolUse — permission partitioning. tests/** is read-only to everyone but
// the `test-author` subagent. Uses the shared glob matcher (the old inline
// regex let `tests/foo.py` through) and handles Edit / Write / MultiEdit.
//
// Hook contract: read JSON event from stdin; write hook output to stdout.
//   hookSpecificOutput.permissionDecision ∈ {allow, deny, ask, defer}

import { readFileSync } from "node:fs";
import { isTestPath, readSettings, resolveProjectDir } from "./_lib/acv.mjs";

const event = JSON.parse(readFileSync(0, "utf-8"));

/** Every file path this tool call would write, across Edit/Write/MultiEdit shapes. */
function targetPaths(ev) {
  const ti = ev.tool_input ?? {};
  const paths = [];
  if (typeof ti.file_path === "string") paths.push(ti.file_path);
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) if (e && typeof e.file_path === "string") paths.push(e.file_path);
  }
  return paths;
}

const allowlist = readSettings(resolveProjectDir()).test_path_allowlist;
const paths = targetPaths(event);
const touchesTest = paths.some((p) => isTestPath(p, allowlist));
const callerIsTestAuthor = event.metadata?.subagent === "test-author";

if (touchesTest && !callerIsTestAuthor) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      permissionDecision: "deny",
      permissionDecisionReason:
        "agent_code_validation: tests/** is read-only to the primary agent. " +
        "Invoke the `test-author` subagent to write or modify tests.",
    },
  }));
  process.exit(0);
}

console.log(JSON.stringify({})); // allow (field omitted = default allow)
