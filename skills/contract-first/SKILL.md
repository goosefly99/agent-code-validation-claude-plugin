---
name: contract-first
description: Require contracts/types before implementation so CrossHair can find counterexamples. Use this skill when When a function has non-trivial preconditions, postconditions, or invariants; when the user mentions "contracts", "design-by-contract", "icontract", "deal", "CrossHair", or "invariants". Also for any refactor where the contract is the ground truth.
---

# Contract First

## When to invoke this skill

When a function has non-trivial preconditions, postconditions, or invariants; when the user mentions "contracts", "design-by-contract", "icontract", "deal", "CrossHair", or "invariants". Also for any refactor where the contract is the ground truth.

## What this skill does

Require contracts/types before implementation so CrossHair can find counterexamples.

## Steps

1. Before writing the body, declare the contract: `icontract.@require` / `@ensure` (Python) or `deal.pre` / `deal.post` (Python) or TypeScript discriminated-union types.
2. Call MCP `crosshair_check(module, function)` to find counterexamples symbolically — if CrossHair produces one, treat it as a required test case.
3. Pair with `runtime-validation`: the contract is the compile-time view; Pydantic/zod is the runtime enforcement at boundaries.
4. When the contract includes quantified invariants (∀ input...), route to `property-based-testing` to generate Hypothesis strategies.
5. Never omit the contract because 'types cover it' — types are necessary but not sufficient for ordering, uniqueness, or numeric ranges.

## Related

- MCP server: `acv-mcp` (see `.mcp.json`)
- Subagents: see `agents/`
- Spec: `spec/acv_spec_v2_1.json` — component "Skills Set"
