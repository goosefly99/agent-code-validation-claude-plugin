# Roadmap

Implementation is staged in 8 phases. Each ships a usable v0.x before the next
starts. This file maps the design-spec phases to the scaffold files they will
populate.

## Phase 0 — Cheating-agent corpus + baseline dogfooding

**Status: ✅ Done** — harness implemented, 10 scenarios + fixtures present, README + SCHEMA documented.
**Populates:** `tests/cheating_corpus/` (scenarios + harness).
**Ship metric:** catch rate published on v0.1.0 release notes. Current: 0.4 (4/10 — stubs for Phase 3–8 hooks account for the gap).

## Phase 2 — Foundation: MCP server + sandbox + manifest

**Status: ✅ Done** — MCP server skeleton wired, run_in_sandbox tool functional via local provider, provenance + receipts modules done, SessionStart hook implements baseline snapshot. **Containerized:** the server itself now ships as a Docker image (`acv-mcp:0.1.0`) and `.mcp.json` launches it via `docker run --rm -i`, putting credential-bearing process in a separate PID namespace (T1 defense-in-depth). A first-class `docker` SandboxProvider is now implemented — it is the spec-mandated escape hatch for native Windows without WSL and the data-residency-safe default.
**Populates:** `mcp-server/src/index.ts`, `mcp-server/src/tools/run_in_sandbox.ts`,
`mcp-server/src/providers/{e2b,daytona,modal,docker,local_subprocess}.ts`,
`mcp-server/src/provenance.ts`, `mcp-server/src/receipts.ts`,
`mcp-server/Dockerfile`, `mcp-server/.dockerignore`.
**Ship:** `.claude-plugin/plugin.json` + `hooks/hooks.json` + `.mcp.json` v0.1.0,
end-to-end `/verify` smoke test, `npm run docker:build` produces the runnable image.

## Phase 3 — Tamper-evident Auditor + permission partitioning

**Populates:** `agents/auditor.md` impl, `hooks/{session_start,pre_tool_use,post_tool_use,stop,subagent_stop}.mjs`,
`mcp-server/src/watchdog.ts`, `skills/self-audit-plugin-hooks/`, `skills/verification-before-completion/`.
**Ship:** 5 hooks live, cheating-agent integration test passes for scenarios 1-3.

## Phase 4 — PBT + Mutation skills

**Populates:** `mcp-server/src/tools/{pbt_run,infer_properties,mutation_test}.ts`,
`agents/{pbt-bug-hunter,mutation-hunter,test-author}.md` impls,
`skills/{property-based-testing,mutation-testing}/`, `commands/{pbt,mutate}.md` impls.
**Ship:** unified mutant descriptor + 4 backend adapters.

## Phase 5 — Runtime + contract layer

**Populates:** `mcp-server/src/tools/{crosshair_check,validate_against_schema}.ts`,
`skills/{runtime-validation,contract-first}/`, PostToolUse type-checker integration.

## Phase 6 — Fuzz + differential + metamorphic

**Populates:** `mcp-server/src/tools/{fuzz,diff_test}.ts`,
`skills/differential-testing/`, metamorphic-relations library.

## Phase 7 — Eval harness + Verification-Quality Score

**Populates:** `mcp-server/src/tools/run_inspect_eval.ts`,
Verification-Quality Score module (aggregator in MCP server),
`skills/write-eval/` (new).

## Phase 8 — Ensemble verifier + self-audit + release polish

**Populates:** `agents/verifier.md` impl, `commands/{tdd,audit}.md` impls,
`hooks/pre_compact.mjs` impl, end-to-end tests, v1.0.0 docs.

## Open questions (routed from debate dt-b7153d0f → future validation)

1. Same-model vs cross-model Auditor default (cost/coverage tradeoff).
2. p95 PostToolUse latency verification on reference 10k LOC project.
3. POSIX-user isolation for MCP server on Linux/WSL (defense-in-depth for T1).
4. Inspect AI harness API for agent-session child-process.
5. Cost UX for deep thoroughness (estimate → confirm before run).
6. Anthropic plugin-registry signature support (mitigates plugin-self-tamper risk).
7. 2026-Q1+ hook contract tracking (Claude Code hook semantics may evolve).
