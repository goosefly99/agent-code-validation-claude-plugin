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
python tests/cheating_corpus/harness.py              # cheating-agent corpus (~40% catch rate at v0.1.0)
node tests/smoke/e2e_run_in_sandbox.mjs              # end-to-end MCP tool round-trip
```

### Docker build (default for `.mcp.json`)

The plugin's `.mcp.json` launches the MCP server inside a container so
sandbox credentials live in a separate PID namespace from the primary
agent's Bash tool (T1 mitigation). Build the image once before first use:

```bash
npm run docker:build           # builds dist/ then `docker build -t acv-mcp:0.1.0 mcp-server`
```

If you'd rather run the server as native Node — useful while iterating —
swap the `command` block in `.mcp.json` back to:

```json
"command": "node",
"args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"]
```

See `mcp-server/README.md` for the full Docker workflow including
Docker-out-of-Docker if you want the in-container server to also use the
`docker` sandbox provider.

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
2. **Tamper-evident Auditor.** Stop hook invokes an Auditor subagent in a clean
   sandbox the primary agent never touched. Auditor pins BOTH tests/ AND
   production-file hashes to the session-start baseline, re-runs the suite, and
   computes mutation-score-delta + property-count-delta. Any score-delta drop
   triggers SUSPICIOUS — catching the rigged-impl-to-match-test attack (T2).
3. **HMAC-signed receipts.** Signing key is generated at SessionStart and lives
   only in the MCP server's memory. A tampered receipt is rejected by the Stop
   hook — no receipt, no 'done'.
4. **AST-based Watchdog.** PostToolUse runs an AST analyzer (not regex) that
   catches dynamic dispatch bypass patterns: eval/exec, sys.modules writes,
   decorator injection, assertion-lib monkey-patching.
5. **Dogfood corpus.** 10 documented reward-hacking attacks from the 2025
   literature. Plugin's catch rate is a published release metric (target ≥ 80%).

## Threat model (T1–T8)

See `AGENTS.md` and the design spec for the full threat-model analysis.

## License

MIT. See `LICENSE`.
