---
name: verification-before-completion
description: Require fresh Auditor receipt before declaring a task done. Use this skill when Use at the end of ANY task the user would consider 'done' — bug fix, feature, refactor, test addition. Blocks any 'done' declaration that lacks an Auditor receipt. Triggers on language like 'task complete', 'done', 'finished', 'ready to ship', 'done with this'.
---

# Verification Before Completion

## When to invoke this skill

Use at the end of ANY task the user would consider 'done' — bug fix, feature, refactor, test addition. Blocks any 'done' declaration that lacks an Auditor receipt. Triggers on language like 'task complete', 'done', 'finished', 'ready to ship', 'done with this'.

## What this skill does

Require fresh Auditor receipt before declaring a task done.

## Steps

1. Before announcing completion, call MCP `audit(session_id)` to read the current Auditor evidence.
2. If no fresh receipt (older than last production-code write): request one by letting the Stop hook run; do NOT short-circuit by declaring done without it.
3. Verify receipt.signature via the HMAC check embedded in MCP response — a missing or invalid signature means you must re-run.
4. Verify receipt.verification_quality_score ≥ user-configured floor (default: coverage 80%, mutation 60%, properties ≥ 1).
5. Verify mutation_score_delta and property_count_delta are non-negative — any drop is a SUSPICIOUS flag.
6. Report the composite grade + per-dimension breakdown to the user as part of the 'done' message.

## Related

- MCP server: `acv-mcp` (see `.mcp.json`)
- Subagents: see `agents/`
- Spec: `pipeline_mcp_data/specs/acv_spec_28e6911d_v2_1.json` — component "Skills Set"
