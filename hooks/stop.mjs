#!/usr/bin/env node
// Hook stub — see plugin ROADMAP.md Phase mapping below.
// Contract: read JSON event from stdin, write hook output JSON to stdout.
// Exit 0 on success; non-zero = hook error (Claude Code surfaces to user).

import { readFileSync } from "node:fs";

const event = JSON.parse(readFileSync(0, "utf-8"));

// Phase 3 (Auditor + Stop hook).
// Responsibilities (spec v0.2.1 Hooks Layer + T2/T4 mitigations):
//   - Invoke `auditor` subagent via the Claude Code subagent API; the subagent
//     checks out a clean repo, pins tests/ AND production files to session-start
//     hashes, re-runs verification in an MCP-provisioned sandbox whose credentials
//     the primary agent never held.
//   - Read Auditor evidence artifact (HMAC-signed, .acv/receipts/<id>.json).
//   - If verification receipt missing OR Verification-Quality Score below user
//     floor OR mutation-score-delta / property-count-delta < 0 → emit decision:"block".
// Claude Code hook contract (Stop/SubagentStop): decision: "block" | omitted.
// Omitting the field allows the stop. `approve` is NOT a valid value here.

// TODO(Phase 3): spawn auditor subagent, read receipt, compute score.

console.log(JSON.stringify({}));
