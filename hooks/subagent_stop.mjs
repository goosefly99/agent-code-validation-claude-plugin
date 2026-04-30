#!/usr/bin/env node
// Hook stub — see plugin ROADMAP.md Phase mapping below.
// Contract: read JSON event from stdin, write hook output JSON to stdout.
// Exit 0 on success; non-zero = hook error (Claude Code surfaces to user).

import { readFileSync } from "node:fs";

const event = JSON.parse(readFileSync(0, "utf-8"));

// Phase 3 (Auditor + SubagentStop hook).
// Same contract as Stop, but scoped to the stopped subagent's output rather than
// the whole session. Runs Auditor against the diff produced by that subagent only.
//   - If subagent claims success without a valid receipt → decision:"block".
//   - If subagent is `test-author`: run Meta ACH filter pipeline before accepting.

// TODO(Phase 3): spawn auditor against subagent output only.

console.log(JSON.stringify({}));
