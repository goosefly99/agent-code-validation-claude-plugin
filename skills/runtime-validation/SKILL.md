---
name: runtime-validation
description: Require Pydantic / zod schemas at every agent-facing boundary. Use this skill when When writing any function that agents, users, or external APIs will invoke — MCP tools, HTTP handlers, CLI entry points, public library surface. Use when you see untyped `dict`, `any`, `Record<string, unknown>`, or ad-hoc validation code.
---

# Runtime Validation

## When to invoke this skill

When writing any function that agents, users, or external APIs will invoke — MCP tools, HTTP handlers, CLI entry points, public library surface. Use when you see untyped `dict`, `any`, `Record<string, unknown>`, or ad-hoc validation code.

## What this skill does

Require Pydantic / zod schemas at every agent-facing boundary.

## Steps

1. Identify every boundary: function parameter from agent/user, response to agent/user, I/O to external service.
2. Declare a Pydantic BaseModel (Python) or zod schema (TypeScript) for each; never accept `dict`/`any` unvalidated.
3. For Pydantic AI specifically: retries are opt-in. Declare `output_validators` that raise `ModelRetry` on constraint violations to trigger retry up to `max_retries`. Retries are NOT automatic on every schema failure.
4. At boundary: parse → use validated model. At boundary exit: validate response against declared schema.
5. Unknown-union boundaries (tool_result from LLM, webhook body): use `z.object({}).passthrough()` or Pydantic `model_config = ConfigDict(extra='allow')` with explicit post-validation.

## Related

- MCP server: `acv-mcp` (see `.mcp.json`)
- Subagents: see `agents/`
- Spec: `pipeline_mcp_data/specs/acv_spec_28e6911d_v2_1.json` — component "Skills Set"
