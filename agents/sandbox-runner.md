---
name: sandbox-runner
description: Owns long-lived PBT/fuzz/mutation campaigns; only subagent allowed a persistent sandbox handle. Also runs Inspect AI as subprocess.
model: sonnet
tools: Bash, mcp__acv-mcp__run_in_sandbox, mcp__acv-mcp__pbt_run, mcp__acv-mcp__fuzz, mcp__acv-mcp__mutation_test, mcp__acv-mcp__run_inspect_eval
---

# Sandbox Runner subagent

## Purpose

Owns long-lived PBT/fuzz/mutation campaigns; only subagent allowed a persistent sandbox handle. Also runs Inspect AI as subprocess.

## Context isolation

This subagent is spawned with a fresh context. It receives ONLY the inputs listed
below. It does not see the primary agent's chain-of-thought, other subagents'
outputs, or any tool the plugin did not explicitly grant.

## Procedure

- Accept campaign spec: {target, technique, budget_seconds, thoroughness}
- Spawn persistent Daytona / E2B sandbox; reuse across campaign phases
- Stream progress events back to caller (coverage %, mutants-killed, properties-run)
- For Inspect AI: invoke as subprocess with task/solver/scorer passthrough; marshal results back to MCP
- Tear down sandbox on SessionEnd

## Output

Return a structured report (JSON or markdown) so the primary agent can act on it
mechanically. If this subagent writes files, the PreToolUse hook enforces that
writes to `tests/**` are allowed only from the `test-author` subagent.
