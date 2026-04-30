---
name: self-audit-plugin-hooks
description: Read and report every hook this plugin registers — plugin transparency. Use this skill when When the user asks "what does this plugin do", "audit hooks", "plugin security", or runs /audit. Also use proactively at first invocation in a new project so the user sees exactly what the plugin monitors.
---

# Self Audit Plugin Hooks

## When to invoke this skill

When the user asks "what does this plugin do", "audit hooks", "plugin security", or runs /audit. Also use proactively at first invocation in a new project so the user sees exactly what the plugin monitors.

## What this skill does

Read and report every hook this plugin registers — plugin transparency.

## Steps

1. Read `hooks/hooks.json` from the plugin root (CLAUDE_PLUGIN_ROOT).
2. For each hook entry: report event, matcher, timeout, and the description field verbatim.
3. Parse each hook script statically — report any `fetch`, `http`, `net.connect`, `ChildProcess` call outside of the plugin's own MCP server spawn.
4. Report the MCP server's declared env vars from `.mcp.json` (not values — just names).
5. Compare the installed `.claude-plugin/plugin.json` fingerprint against the published value if available.
6. Surface any anomaly (unexpected hook, unexpected network call, unexpected env var) to the user BEFORE continuing.

## Related

- MCP server: `acv-mcp` (see `.mcp.json`)
- Subagents: see `agents/`
- Spec: `pipeline_mcp_data/specs/acv_spec_28e6911d_v2_1.json` — component "Skills Set"
