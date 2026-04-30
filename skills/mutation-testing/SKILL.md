---
name: mutation-testing
description: Run mutation testing to verify the test suite actually catches bugs. Use this skill when When the user asks about "mutation testing", "mutation score", "test adequacy", or "how strong is my test suite". Also use proactively when the Verification-Quality Score reports mutation score below the configured floor.
---

# Mutation Testing

## When to invoke this skill

When the user asks about "mutation testing", "mutation score", "test adequacy", or "how strong is my test suite". Also use proactively when the Verification-Quality Score reports mutation score below the configured floor.

## What this skill does

Run mutation testing to verify the test suite actually catches bugs.

## Steps

1. Call MCP `mutation_test(paths, backend='auto', incremental=true)` — auto-picks Stryker (JS/TS), mutmut (Python), cargo-mutants (Rust), Mutahunter (LLM-authored).
2. Incremental mode (default) scopes to `git diff`-touched files + direct importers; use `incremental=false` for a full baseline run only when the user asks.
3. Compute mutation-score-delta vs session-start baseline. A drop triggers SUSPICIOUS in the Auditor's next verdict — don't silently proceed.
4. For every survived mutant, invoke the `mutation-hunter` subagent to propose a killing test; route it through `test-author` for filter pipeline.
5. Output the unified mutant descriptor: {id, origin_path, span, operator, status, backend}.

## Related

- MCP server: `acv-mcp` (see `.mcp.json`)
- Subagents: see `agents/`
- Spec: `pipeline_mcp_data/specs/acv_spec_28e6911d_v2_1.json` — component "Skills Set"
