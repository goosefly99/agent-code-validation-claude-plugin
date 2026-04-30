#!/usr/bin/env node
// Hook stub — see plugin ROADMAP.md Phase mapping below.
// Contract: read JSON event from stdin, write hook output JSON to stdout.
// Exit 0 on success; non-zero = hook error (Claude Code surfaces to user).

import { readFileSync } from "node:fs";

const event = JSON.parse(readFileSync(0, "utf-8"));

// Phase 3 (Watchdog) + Phase 5 (type-checker integration).
// Responsibilities (spec v0.2.1 Hooks Layer + T5 mitigation):
//   - If production-code write: run scoped pyright/tsc --strict + ruff/eslint
//     (touched file + direct importers). Budget ≤ 2 s p95.
//   - AST-based Reward-Hacking Watchdog (@babel/parser for JS/TS, `ast` for Python):
//     flag eval/exec, dynamic-attr on assertion libs, decorator mutation,
//     sys.modules / require.cache writes, .skip markers added.
//   - On SUSPICIOUS: emit decision:"block" + reason so feedback reaches the primary
//     agent's context; forward evidence to Auditor via provenance log.
//   - PostToolUse cannot un-run the tool — block is feedback-based, not a veto.
// Claude Code hook contract (PostToolUse): decision: "block" | omitted, reason: string

// TODO(Phase 3): wire src/watchdog.ts to analyze event.tool_input.new_string/content.
// TODO(Phase 5): wire scoped type-checker invocation via MCP server.

console.log(JSON.stringify({}));
