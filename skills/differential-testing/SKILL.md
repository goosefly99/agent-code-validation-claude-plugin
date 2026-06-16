---
name: differential-testing
description: Safety-net refactors by running both old and new implementations on random inputs. Use this skill when When the agent is refactoring a function, switching algorithms, or porting between languages, and the user mentions "refactor", "differential testing", or "make sure the new code matches the old". Also use automatically before accepting any multi-file refactor.
---

# Differential Testing

## When to invoke this skill

When the agent is refactoring a function, switching algorithms, or porting between languages, and the user mentions "refactor", "differential testing", or "make sure the new code matches the old". Also use automatically before accepting any multi-file refactor.

## What this skill does

Safety-net refactors by running both old and new implementations on random inputs.

## Steps

1. Before the refactor: snapshot pre-refactor behavior — collect Hypothesis seed corpus + N random inputs via MCP `diff_test`.
2. After the refactor: call `diff_test(impl_a=old, impl_b=new, strategy, n_cases)` and report any divergence.
3. Classify divergences: value mismatch, new exception, changed exception type, performance regression.
4. For any divergence, confirm with the user before accepting — silent behavior changes are reward-hacking-adjacent.
5. For the metamorphic-relations library (sort idempotence, encode/decode roundtrip, determinism, monotonicity, commutativity), match against the target signature before generating bespoke properties.

## Related

- MCP server: `acv-mcp` (see `.mcp.json`)
- Subagents: see `agents/`
- Spec: `spec/acv_spec_v2_1.json` — component "Skills Set"
