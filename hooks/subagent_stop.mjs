#!/usr/bin/env node
// SubagentStop — same tamper-evident gate as Stop, applied when a subagent
// stops. Opt-in gated. A subagent that claims success must leave the session
// with no unresolved SUSPICIOUS findings and a valid receipt.
//
// Importing stop.mjs runs its gate against the same stdin event + env. The
// receipt/findings model is session-scoped today; split this out if a
// subagent-diff-only scope is ever needed.
import "./stop.mjs";
