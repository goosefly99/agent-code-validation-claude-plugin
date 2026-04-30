#!/usr/bin/env node
// Hook stub — see plugin ROADMAP.md Phase mapping below.
// Contract: read JSON event from stdin, write hook output JSON to stdout.
// Exit 0 on success; non-zero = hook error (Claude Code surfaces to user).

import { readFileSync } from "node:fs";

const event = JSON.parse(readFileSync(0, "utf-8"));

// Phase 8 (PreCompact hook).
// Responsibilities (spec v0.2.1 Hooks Layer):
//   - Read .acv/session.json for any unresolved FAIL or SUSPICIOUS audit verdicts.
//   - Emit decision:"block" with reason if any exist — compaction would drop the
//     evidence the user needs to fix the issue.

// TODO(Phase 8): read session audit state, block if unresolved issues.

console.log(JSON.stringify({}));
