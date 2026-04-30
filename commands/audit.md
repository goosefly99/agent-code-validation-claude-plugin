---
name: audit
description: Produce plugin self-audit report (hooks, permissions, sandbox provider, credentials source)
---

# /audit

**Usage:** `/audit`

Produce plugin self-audit report (hooks, permissions, sandbox provider, credentials source).

## What happens

1. Invoke the `self-audit-plugin-hooks` skill
2. Report: each hook event + matcher + timeout + description
3. Report: MCP server env vars declared (names only, never values)
4. Report: installed plugin.json fingerprint vs published (when available)
5. Report: SBOM delta — pinned vs installed versions for all wrapped CLIs
6. Any anomaly (unexpected hook, unexpected network call, unexpected env var) is surfaced explicitly

## Related

- Subagents / skills invoked: see steps above
- Spec: component "Commands" in `pipeline_mcp_data/specs/acv_spec_28e6911d_v2_1.json`
