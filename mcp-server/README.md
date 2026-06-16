# acv-mcp

MCP server for `agent-code-validation`. Exposes the sandbox + test-runner tool
surface to Claude Code; holds sandbox provider credentials so the primary agent
never sees them (mitigates T1).

## Tools exposed

| Tool | Purpose | Spec phase |
|---|---|---|
| `run_in_sandbox` | Execute code in an isolated sandbox | 2 |
| `pbt_run` | Hypothesis ghostwriter + runner | 4 |
| `infer_properties` | Signature/docstring → property suggestions | 4 |
| `mutation_test` | Stryker/mutmut/cargo-mutants/Mutahunter | 4 |
| `fuzz` | Atheris / libFuzzer | 6 |
| `diff_test` | Differential testing between two impls | 6 |
| `crosshair_check` | Symbolic execution on pure functions | 5 |
| `validate_against_schema` | Pydantic / zod validation | 5 |
| `run_inspect_eval` | Delegate Inspect AI run to Sandbox-Runner | 7 |
| `audit` | Read current Auditor receipts + return verdict | 3 |

> **Backend status:** `run_in_sandbox` and `audit` are functional. The
> language-toolchain tools (`pbt_run`, `mutation_test`, `crosshair_check`,
> `fuzz`, `infer_properties`, `diff_test`, `validate_against_schema`,
> `run_inspect_eval`) depend on a Python/JS toolchain that runs **inside the
> sandbox provider's execution environment**, not on the MCP host. That backend
> wiring is not yet complete; those tools should return a clear "toolchain
> unavailable" error rather than silently passing.

## Sandbox providers

Order resolved by `ACV_SANDBOX_PROVIDER_PREFERENCE` (first healthy wins):

| ID | Backing | Status |
|---|---|---|
| `e2b` | Firecracker microVM, ~150 ms cold start | stub (Phase 4+) |
| `daytona` | Docker/Kata/Sysbox, ~90 ms cold start | stub (Phase 4+) |
| `modal` | gVisor, sub-second start | stub (Phase 4+) |
| `docker` | Local Docker daemon, ephemeral `--rm` containers | **implemented** |
| `local` | Host subprocess + temp dir, no syscall isolation | implemented |

The `docker` provider is the spec-mandated escape hatch for native Windows
without WSL ("Docker-backed local fallback is the escape hatch when WSL is
unavailable") and the data-residency-safe default for GDPR-scope projects
(no source-code egress to managed clouds).

## Build (default — this is how `.mcp.json` runs the server)

`.mcp.json` launches the server as a host **Node process over stdio**
(`node ${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js`). Build `dist/` once
before first use:

```
npm install
npm -w mcp-server run build
```

## Build (optional — Docker image for the DooD sandbox path)

A Docker image is **not** used to launch the server by default. It is only
needed for the advanced Docker-out-of-Docker scenario below (running the MCP
server itself inside a container so it can use the `docker` sandbox provider
from there). Build it with:

```
npm run docker:build           # builds dist/ then `docker build -t acv-mcp:0.1.0 .`
```

The image:
- multi-stage `node:20-alpine` (final image ≈ 200 MB)
- runs as non-root user `acv` (uid 100)
- carries no credentials — every secret is passed in at `docker run` time
- stdio transport: read MCP frames from stdin, write to stdout
- `ENTRYPOINT` is `node dist/index.js`, so `docker run -i acv-mcp:0.1.0`
  behaves identically to `node dist/index.js`

When running the server in a container you can bind-mount the host `.acv`
directory so provenance and receipts survive container exits. The **default
stdio launch is not containerized**, so no bind-mount is involved — the host
Node process writes `.acv/` directly under `CLAUDE_PROJECT_DIR` (and only when
the project is activated via `acv.config.json`).

## Running the server inside Docker AND using docker as a sandbox provider

This is an **optional, advanced** deployment — the default launch is the host
Node stdio process above, not a container. **Docker-out-of-Docker (DooD)**
runs the MCP server itself in a container; that container needs:
1. The host docker socket mounted in: `-v /var/run/docker.sock:/var/run/docker.sock`
2. A `docker` CLI present in the image. The default `acv-mcp:0.1.0` does
   NOT bundle the CLI to keep the attack surface small. To opt in:

   ```Dockerfile
   FROM acv-mcp:0.1.0
   USER root
   RUN apk add --no-cache docker-cli
   USER acv
   ```

   Tag this as `acv-mcp:0.1.0-dood` and use it in `.mcp.json` with the
   socket mount added to `args`.

If the docker socket is not mounted, the `docker` provider's health probe
returns false and resolution falls through to `local`.

## Provenance + receipts

Every sandbox spawn is logged to `${ACV_PROVENANCE_DIR}/provenance.jsonl`. Every
verification emits an HMAC-signed receipt to `${ACV_PROVENANCE_DIR}/receipts/`.
The signing key is written at SessionStart to a gitignored, 0600
`.acv/.session-key` and is **shared** between this server (which signs receipts)
and the hooks (which verify them) — so the Stop hook can reject tampered
receipts. Provenance/receipts are written only when the project is activated.

## Container hardening defaults (docker provider)

Every `docker run` from `providers/docker.ts` ships these flags:

- `--rm` — auto-remove container on exit
- `--network=none` — no outbound network (override with `ACV_DOCKER_NETWORK=bridge`)
- `--read-only` — root filesystem is read-only; only `/sandbox` is writable
- `--cap-drop=ALL` — no Linux capabilities granted
- `--pids-limit=256`, `--memory=512m`, `--cpus=0.5` — DoS guards (override with
  `ACV_DOCKER_PIDS_LIMIT`, `ACV_DOCKER_MEMORY`, `ACV_DOCKER_CPUS`)
- `--stop-timeout=N+1` — bounded by the per-call `timeout_s`
- No env forwarded — only `PATH` is set on the docker invocation; user code
  inherits whatever the chosen image's defaults are
