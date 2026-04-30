---
name: tdd-red-green-refactor
description: Scaffold red-green-refactor TDD with per-phase subagent context isolation. Use this skill when When the user asks for TDD, test-driven development, or "write the test first". Also activated by the /tdd slash command. Key principle: each phase runs in its own subagent so contexts cannot cross-contaminate.
---

# Tdd Red Green Refactor

## When to invoke this skill

When the user asks for TDD, test-driven development, or "write the test first". Also activated by the /tdd slash command. Key principle: each phase runs in its own subagent so contexts cannot cross-contaminate.

## What this skill does

Scaffold red-green-refactor TDD with per-phase subagent context isolation.

## Steps

1. Red phase: spawn a `test-author` subagent whose sole output is a failing test. The subagent never sees the implementation.
2. Commit the failing test (it routes through the Meta ACH filter pipeline — build OK, fails, coverage-ready).
3. Green phase: spawn a separate implementation subagent whose input is the test + signature ONLY; it never sees the test-author's reasoning.
4. Refactor phase: spawn a refactor subagent that runs `differential-testing` against the green-phase impl to prove behavior preserved.
5. At every phase boundary, SubagentStop hook fires → Auditor re-runs → receipt emitted. Only proceed on PASS.

## Related

- MCP server: `acv-mcp` (see `.mcp.json`)
- Subagents: see `agents/`
- Spec: `pipeline_mcp_data/specs/acv_spec_28e6911d_v2_1.json` — component "Skills Set"
