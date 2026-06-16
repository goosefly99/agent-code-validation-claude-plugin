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
   PostToolUse, Stop, SubagentStop, PreCompact. All six are implemented as of
   Phase 3 (SessionStart + PreToolUse shipped at Phase 2). The Stop/SubagentStop/
   PostToolUse/PreCompact guardrails are **opt-in**: they act only when the
   project is activated (see Activation below).
5. **Commands** (5) — `/tdd`, `/pbt`, `/mutate`, `/verify`, `/audit`.

## Activation (opt-in / lazy)

The plugin is inert until a project is activated by creating `acv.config.json`
at its root (copy `acv.config.example.json`). Until then every hook and the MCP
server write **nothing** to the repo. When active, runtime state lives under a
gitignored `.acv/` directory.

## The contract the plugin enforces (when activated)

- `tests/**` is read-only to the primary agent. The `test-author` subagent is
  the only legitimate channel to write tests. The PreToolUse hook enforces this
  (this guard is always on — it does not require activation).
- 'done' is not a speech act. When activated, the Stop hook blocks any stop that
  lacks a valid HMAC-verified Auditor receipt whose Verification-Quality Score
  meets the user's configured floors, or that leaves unresolved SUSPICIOUS
  watchdog findings.
- When activated, tool calls, hook decisions, and sandbox spawns are logged to
  `.acv/provenance.jsonl`, and watchdog findings to `.acv/findings.jsonl`.
  `/audit` reconstructs what happened.

## Security model

- Sandbox provider credentials live in the MCP server's process env only. They
  never appear as MCP tool arguments. Mitigates T1 (primary agent env read).
- Verification receipts are HMAC-signed with a key written at SessionStart to a
  gitignored, 0600 `.acv/.session-key`. The key is shared between the MCP server
  (signs) and the hooks (verify), so the Stop hook can reject tampered receipts.
- Reward-Hacking Watchdog parses written content (AST for JS/TS, heuristics for
  Python) and is wired into PostToolUse — catches eval/exec, builtins/assertion
  monkey-patching, degenerate impls, and test logic outside `tests/**`. Mitigates T5.
- SessionStart writes a signed baseline snapshot of git-tracked files when the
  project is activated. (Stripping the primary agent's Edit/Write/Bash tools
  until the baseline is committed is a planned hardening, not yet implemented.)

## Design spec

Full spec: `spec/acv_spec_v2_1.json`
(v0.2.1, status: review, 8-phase implementation roadmap, T1–T8 threat model,
18 risks with mitigations, 18 success criteria).

## Roadmap

See `ROADMAP.md` for the 8-phase implementation plan. Each phase ships a usable
v0.x. Phase 0 publishes the cheating-agent corpus that measures catch rate as a
release metric.
