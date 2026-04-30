# AGENTS.md — agent-code-validation plugin

This plugin is an _agent tool_, not an agent service. Its audience is other
coding agents (Claude Code's primary agent, subagents spawned by the primary,
and optionally cross-model Verifier agents).

## What this plugin provides to agents

1. **MCP tools** for sandboxed test execution, PBT, mutation testing, fuzzing,
   differential testing, symbolic execution, schema validation, Inspect AI, audit.
2. **Skills** (8) — progressive-disclosure guides for when/how to use each
   technique. Agents discover them via description matching, not by name.
3. **Subagents** (6) — isolated execution contexts for specialized workflows:
   Auditor, Test-Author, PBT-Bug-Hunter, Mutation-Hunter, Sandbox-Runner, Verifier.
4. **Hooks** (6) — deterministic guardrails: SessionStart, PreToolUse,
   PostToolUse, Stop, SubagentStop, PreCompact.
5. **Commands** (5) — `/tdd`, `/pbt`, `/mutate`, `/verify`, `/audit`.

## The contract the plugin enforces

- `tests/**` is read-only to the primary agent. The `test-author` subagent is
  the only legitimate channel to write tests. The PreToolUse hook enforces this.
- 'done' is not a speech act. It requires a fresh HMAC-signed Auditor receipt
  whose Verification-Quality Score meets the user's configured floors. The Stop
  hook blocks any stop without a valid receipt.
- Every tool call, every hook decision, every sandbox spawn is logged to
  `.acv/provenance.jsonl`. `/audit` reconstructs what happened.

## Security model

- Sandbox provider credentials live in the MCP server's process env only. They
  never appear as MCP tool arguments. Mitigates T1 (primary agent env read).
- Verification receipts are HMAC-signed with a key generated at SessionStart
  and held only in the MCP server's memory. Mitigates receipt tampering.
- Reward-Hacking Watchdog is AST-based (not regex) — catches eval/exec/
  sys.modules writes/decorator injection that regex rulesets miss. Mitigates T5.
- SessionStart is atomic: primary agent has no Edit/Write/Bash tools until the
  baseline snapshot is written and signed. Mitigates T6 (baseline poisoning).

## Design spec

Full spec: `pipeline_mcp_data/specs/acv_spec_28e6911d_v2_1.json`
(v0.2.1, status: review, 8-phase implementation roadmap, T1–T8 threat model,
18 risks with mitigations, 18 success criteria).

## Roadmap

See `ROADMAP.md` for the 8-phase implementation plan. Each phase ships a usable
v0.x. Phase 0 publishes the cheating-agent corpus that measures catch rate as a
release metric.
