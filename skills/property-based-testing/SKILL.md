---
name: property-based-testing
description: Generate property-based tests for a function with Hypothesis + ghostwriter. Use this skill when When the agent writes or reviews a pure function (math, parser, codec, data transformation) or when the user mentions "property-based testing", "PBT", "Hypothesis", or "fuzz a function". Also use when a function is about to be refactored — differential-testing is the refactor-safety variant.
---

# Property Based Testing

## When to invoke this skill

When the agent writes or reviews a pure function (math, parser, codec, data transformation) or when the user mentions "property-based testing", "PBT", "Hypothesis", or "fuzz a function". Also use when a function is about to be refactored — differential-testing is the refactor-safety variant.

## What this skill does

Generate property-based tests for a function with Hypothesis + ghostwriter.

## Steps

1. Call MCP `infer_properties(signature, docstring)` to get candidate ghostwriter templates.
2. Templates available (Hypothesis ghostwriter): magic, fuzz, idempotent, roundtrip, equivalent, binary_operation, ufunc. The `--errors-equivalent` flag is a mode on `equivalent` (treats same-typed exceptions as equal), NOT a standalone template.
3. Call `pbt_run(target, strategies, thoroughness)` with the selected templates.
4. On any failing example: reflect — is this a real defect or a property misstatement? Surface only validated bugs.
5. Route every surviving property to the `test-author` subagent so it lands in `tests/` via the Meta ACH filter pipeline (build → pass → coverage → mutation-kill).
6. Never declare 'no bugs' if `thoroughness=quick` — escalate to `standard` or `deep` before concluding.

## Related

- MCP server: `acv-mcp` (see `.mcp.json`)
- Subagents: see `agents/`
- Spec: `spec/acv_spec_v2_1.json` — component "Skills Set"
