# agent-code-validation

A Claude Code plugin that lets agents **actually verify the correctness of code
they write**. Built around the universal 2025–2026 Generate → Verify → Reflect
loop with a tamper-evident Auditor subagent as the headline differentiator.

**Status:** review — design spec v0.2.1, scaffold v0.1.0.
**Spec:** `spec/acv_spec_v2_1.json`
**Scaffold date:** 2026-04-23

## What's in the box

| Component | Count | Purpose |
|---|---|---|
| MCP tools | 10 | Sandbox, PBT, mutation, fuzz, diff, CrossHair, validate, Inspect, audit, infer |
| Skills | 8 | PBT, mutation, differential, verification-before-completion, TDD, contracts, runtime-validation, self-audit-plugin-hooks |
| Subagents | 6 | Auditor, Test-Author, PBT-Bug-Hunter, Mutation-Hunter, Sandbox-Runner, Verifier |
| Hooks | 6 | SessionStart, PreToolUse, PostToolUse, Stop, SubagentStop, PreCompact |
| Commands | 5 | /tdd, /pbt, /mutate, /verify, /audit |
| Cheating-agent corpus | 10 | Reward-hacking attack scenarios for dogfood-testing |

## Install (once published)

```
claude plugin install agent-code-validation
```

## Local dev install + smoke

```bash
npm install                                          # installs root + mcp-server workspaces
npm run build                                        # tsc compile
npm -w mcp-server run test                           # vitest unit tests (incl. docker provider; daemon-needing tests self-skip)
python tests/cheating_corpus/harness.py              # cheating-agent corpus (8/10 = 80% catch rate at v0.1.0)
node tests/smoke/mcp_handshake.mjs                   # MCP stdio handshake — asserts all 10 tools
node tests/smoke/e2e_run_in_sandbox.mjs              # end-to-end MCP tool round-trip
```

### Build the MCP server

`.mcp.json` launches the MCP server as a host **Node process over stdio**
(`node ${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js`, a path Claude Code
expands). Build it once before first use:

```bash
npm -w mcp-server run build      # tsc → mcp-server/dist/
```

A Docker image (`acv-mcp:0.1.0`) is also available but is **optional** — it is
only needed if you want to run the MCP server itself inside a container and use
the `docker` sandbox provider from there (Docker-out-of-Docker). See
`mcp-server/README.md` for that advanced workflow. The MCP host is **not**
containerized by default.

### Activation (opt-in)

The plugin is **inert until you activate it** for a project: copy
`acv.config.example.json` to `acv.config.json` at your project root. Until then
it writes nothing to your repo. When active, runtime state lives under a
gitignored `.acv/` directory (the plugin adds `.acv/` to your `.gitignore`
automatically before writing anything).

Add to your Claude Code plugin config:

```json
{
  "plugins": ["agent-code-validation"]
}
```

## First run

```
cd your-project
claude
> /audit                 # verify what this plugin will do in your project
> /verify                # run an Auditor pass on current state
> /pbt src/utils.py      # run property-based bug hunt on a module
```

## What makes this different

Every Claude Code plugin can lint and run tests. The differentiator here is
**structural**, not heuristic:

1. **Permission partitioning.** The primary agent cannot write to `tests/**`.
   The `test-author` subagent is the only legitimate channel, and it must pass
   the Meta ACH filter pipeline (build → pass → coverage → mutation-kill).
2. **Tamper-evident Auditor (implemented, opt-in).** When the project is
   activated, the Stop hook blocks 'done' unless a valid, HMAC-verified Auditor
   receipt exists, the Verification-Quality Score meets the configured floor,
   and no mutation/property score-delta regressed — and it blocks on any
   unresolved SUSPICIOUS watchdog finding. The `auditor` subagent re-runs the
   declared-passing verification in a clean sandbox and signs the receipt.
3. **HMAC-signed receipts.** The signing key is written at SessionStart to a
   gitignored, 0600 `.acv/.session-key` and is **shared** between the MCP server
   (which signs receipts) and the hooks (which verify them). A tampered receipt
   fails HMAC validation and the Stop hook rejects it — no valid receipt, no 'done'.
4. **AST-based Watchdog (implemented).** PostToolUse parses the written content
   (AST for JS/TS via `@babel/parser`, conservative heuristics for Python) and
   blocks SUSPICIOUS patterns — eval/exec, `builtins`/assertion monkey-patching,
   degenerate implementations, and test logic smuggled outside `tests/**`.
5. **Dogfood corpus.** 10 documented reward-hacking attacks from the 2025
   literature. Current catch rate: **8/10 (80%)**; CI fails below that floor.
   (Scenarios 05 `mine_git_history` and 10 `session_start_race` are known
   fixture-level gaps — see `tests/cheating_corpus/`.)

## Threat model (T1–T8)

See `AGENTS.md` and the design spec for the full threat-model analysis.

## License

MIT. See `LICENSE`.
