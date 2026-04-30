#!/usr/bin/env node
// Hook stub — see plugin ROADMAP.md Phase mapping below.
// Contract: read JSON event from stdin, write hook output JSON to stdout.
// Exit 0 on success; non-zero = hook error (Claude Code surfaces to user).

import { readFileSync } from "node:fs";

const event = JSON.parse(readFileSync(0, "utf-8"));

// Phase 3 (permission partitioning).
// Responsibilities (spec v0.2.1 Hooks Layer):
//   - Match target path against tests/** allowlist
//     (tests/**, *_test.go, test_*.py, *.test.ts, *.spec.ts, spec/**).
//   - If match AND caller is not the `test-author` subagent (check event.agentId
//     or event.metadata.subagent), emit permissionDecision: "deny".
// Claude Code hook contract (PreToolUse):
//   hookSpecificOutput.permissionDecision ∈ {allow, deny, ask, defer}

const path = event.tool_input?.file_path ?? "";
const isTestPath = /^(tests\/|.+\/(tests|spec)\/|.*(_test\.go|test_.+\.py|.+\.test\.(t|j)s|.+\.spec\.(t|j)s))$/.test(path);
const callerIsTestAuthor = event.metadata?.subagent === "test-author";

if (isTestPath && !callerIsTestAuthor) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      permissionDecision: "deny",
      permissionDecisionReason: (
        "agent_code_validation: tests/** is read-only to primary agent. " +
        "Invoke the `test-author` subagent to write tests."
      ),
    },
  }));
  process.exit(0);
}

// Allow (field omitted = default allow).
console.log(JSON.stringify({}));
