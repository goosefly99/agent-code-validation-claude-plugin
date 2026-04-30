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

## Build (TypeScript)

```
npm install
npm run build
```

## Build (Docker image)

The `.mcp.json` in this plugin launches the server via `docker run --rm -i`
by default. Build the image once before first use:

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

Bind-mount the host `.acv` directory so provenance and receipts survive
container exits — already wired up in the plugin's `.mcp.json`.

## Running the server inside Docker AND using docker as a sandbox provider

This is **Docker-out-of-Docker (DooD)**. The MCP container needs:
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
Signing key is generated at SessionStart and held only in this process.

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
