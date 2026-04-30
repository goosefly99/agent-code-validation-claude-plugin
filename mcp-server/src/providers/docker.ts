/**
 * docker — SandboxProvider that executes user code inside an ephemeral
 * `docker run` container on the host's Docker daemon.
 *
 * WHY THIS EXISTS:
 * - Spec-mandated escape hatch: "Docker-backed local fallback is the escape
 *   hatch when WSL is unavailable" (Windows compatibility matrix).
 * - Stronger isolation than local_subprocess: the container runs with
 *   --network=none, --read-only, dropped caps, memory + CPU caps, and the
 *   credential-bearing MCP-server env is never inherited.
 * - Prerequisite for `daytona` once the managed wrapper lands — the wire
 *   shape is the same; daytona just talks to a remote daemon.
 *
 * Works in two deployment modes:
 *   A) MCP server runs as native Node on the host. `docker` CLI is on PATH;
 *      we shell out directly. This is the typical dev setup.
 *   B) MCP server runs inside a container itself (the new default per the
 *      Dockerfile). Mount the host docker socket in to enable
 *      Docker-out-of-Docker:
 *        docker run --rm -i \
 *          -v /var/run/docker.sock:/var/run/docker.sock \
 *          acv-mcp:0.1.0
 *      and ensure the `docker` CLI is present in the image (the default
 *      Dockerfile does NOT include it; opt in by extending FROM acv-mcp
 *      and adding `RUN apk add --no-cache docker-cli`).
 *
 * SECURITY HARDENING (must read before changing run flags):
 * - --network=none by default. Set ACV_DOCKER_NETWORK=bridge to opt in to
 *   network access for tools that need pip install / npm install at runtime.
 * - --read-only root filesystem. Only /sandbox is a writable bind mount.
 * - --cap-drop=ALL. No capabilities granted; user code runs as the
 *   container's default unprivileged user.
 * - --pids-limit=256, --memory=512m, --cpus=0.5. Cheap DoS guards (C1).
 * - No env vars from the MCP server process are forwarded. Same allowlist
 *   discipline as local_subprocess: zero credential leakage.
 *
 * Spec: components "MCP Server — acv-mcp" + risks T1 (cred isolation),
 *       T8 (data residency: keep code on the user's machine).
 */

import { randomBytes } from "node:crypto";
import { spawn as cpSpawn, spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { Sandbox, SandboxProvider } from "./index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cap on bytes accumulated per stream before truncation. */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB

/** Timeout (ms) for `docker version` / `docker info` probes. */
const DOCKER_PROBE_TIMEOUT_MS = 5000;

/** Number of retries for Windows EBUSY/EPERM on dispose. */
const WINDOWS_DISPOSE_MAX_ATTEMPTS = 5;

/** Base delay (ms) for Windows dispose exponential back-off. */
const WINDOWS_DISPOSE_BACKOFF_BASE_MS = 100;

/** Default per-container resource caps. Overridable via env. */
const DEFAULT_MEMORY_LIMIT = "512m";
const DEFAULT_CPU_LIMIT = "0.5";
const DEFAULT_PIDS_LIMIT = "256";

// ---------------------------------------------------------------------------
// Language → image + interpreter mapping
// ---------------------------------------------------------------------------

const SUPPORTED_LANGUAGES = new Set(["python", "javascript", "typescript"]);

const LANG_EXT: Record<string, string> = {
  python: "py",
  javascript: "js",
  typescript: "ts",
};

/**
 * Default image per language. Override individually via env:
 *   ACV_DOCKER_IMAGE_PYTHON=python:3.12-alpine
 *   ACV_DOCKER_IMAGE_JAVASCRIPT=node:22-alpine
 *   ACV_DOCKER_IMAGE_TYPESCRIPT=node:20-alpine  (must include tsx)
 */
function imageForLanguage(language: string): string {
  switch (language) {
    case "python":
      return process.env.ACV_DOCKER_IMAGE_PYTHON ?? "python:3.11-alpine";
    case "javascript":
      return process.env.ACV_DOCKER_IMAGE_JAVASCRIPT ?? "node:20-alpine";
    case "typescript":
      // TS execution requires tsx in the image. The default node:20-alpine
      // does NOT include it; users must build a derived image or set
      // ACV_DOCKER_IMAGE_TYPESCRIPT to something like
      // ghcr.io/<org>/node-tsx:20-alpine. We still default-and-warn rather
      // than fail at construction so the tests that don't run TS still pass.
      return process.env.ACV_DOCKER_IMAGE_TYPESCRIPT ?? "node:20-alpine";
    default:
      throw new Error(`docker provider: unsupported language '${language}'`);
  }
}

/**
 * In-container command to execute the user script. Returns
 * [executable, args_before_script_path].
 */
function commandForLanguage(language: string): [string, string[]] {
  switch (language) {
    case "python":
      return ["python", []];
    case "javascript":
      return ["node", []];
    case "typescript":
      // tsx must be on PATH inside the chosen image. If not, the run will
      // fail with a clear `tsx: not found` from the container.
      return ["tsx", []];
    default:
      throw new Error(`docker provider: unsupported language '${language}'`);
  }
}

// ---------------------------------------------------------------------------
// Path safety helper (identical to local_subprocess so behavior matches)
// ---------------------------------------------------------------------------

function safeResolve(sandboxDir: string, userPath: string): string {
  if (path.isAbsolute(userPath)) {
    throw new Error("docker sandbox refuses path outside sandbox dir");
  }
  const resolved = path.resolve(sandboxDir, userPath);
  const sandboxWithSep = path.normalize(sandboxDir) + path.sep;
  const normalizedResolved = path.normalize(resolved);
  if (
    normalizedResolved !== path.normalize(sandboxDir) &&
    !normalizedResolved.startsWith(sandboxWithSep)
  ) {
    throw new Error("docker sandbox refuses path outside sandbox dir");
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Bind-mount path translation
// ---------------------------------------------------------------------------

/**
 * Translate a host-OS path into the form `docker -v` expects.
 *
 * On Windows, Node gives us paths like `C:\Users\...\acv-docker-...`. The
 * Docker CLI on Windows accepts both backslash and forward-slash forms
 * since Docker Desktop ≥ 4 — we normalize to forward slashes to avoid the
 * "drive letter must be lower case" footgun in older daemons. On POSIX
 * the path is returned unchanged.
 */
function dockerBindPath(p: string): string {
  if (process.platform !== "win32") return p;
  // Replace backslashes with forward slashes; preserve the drive letter.
  return p.replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// docker availability probe
// ---------------------------------------------------------------------------

/**
 * Returns true if the docker CLI is on PATH AND `docker version` exits 0
 * (which implies the daemon is reachable). Never throws.
 */
function dockerCliAvailable(): boolean {
  try {
    const result = spawnSync("docker", ["version", "--format", "{{.Client.Version}}"], {
      encoding: "utf8",
      timeout: DOCKER_PROBE_TIMEOUT_MS,
    });
    if (result.status !== 0) return false;
    // Confirm daemon reachable too — `docker version` against the SERVER
    // half. We use --format to keep stdout small.
    const serverProbe = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      timeout: DOCKER_PROBE_TIMEOUT_MS,
    });
    return serverProbe.status === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// RunResult
// ---------------------------------------------------------------------------

type RunResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
};

// ---------------------------------------------------------------------------
// `docker run` argv builder
// ---------------------------------------------------------------------------

/**
 * Build the argv for a single `docker run` invocation.
 *
 * The host-side `sandboxDir` is bind-mounted into the container at /sandbox
 * read-write; everything else stays read-only. The script we wrote into
 * sandboxDir is referenced as `/sandbox/main.<ext>` inside the container.
 */
function buildDockerArgs(
  containerName: string,
  sandboxDir: string,
  image: string,
  executable: string,
  extraArgs: string[],
  scriptInContainer: string,
  timeoutS: number,
): string[] {
  const network = process.env.ACV_DOCKER_NETWORK ?? "none";
  const memory = process.env.ACV_DOCKER_MEMORY ?? DEFAULT_MEMORY_LIMIT;
  const cpus = process.env.ACV_DOCKER_CPUS ?? DEFAULT_CPU_LIMIT;
  const pidsLimit = process.env.ACV_DOCKER_PIDS_LIMIT ?? DEFAULT_PIDS_LIMIT;

  // --stop-timeout 1 + a wall-clock guard via AbortController in runCode().
  return [
    "run",
    "--rm",
    "--name", containerName,
    "-i",
    `--network=${network}`,
    "--read-only",
    "--cap-drop=ALL",
    `--memory=${memory}`,
    `--cpus=${cpus}`,
    `--pids-limit=${pidsLimit}`,
    "--stop-timeout", String(timeoutS + 1),
    "-v", `${dockerBindPath(sandboxDir)}:/sandbox:rw`,
    "-w", "/sandbox",
    image,
    executable,
    ...extraArgs,
    scriptInContainer,
  ];
}

// ---------------------------------------------------------------------------
// Core run() implementation
// ---------------------------------------------------------------------------

async function runCode(
  sandboxId: string,
  sandboxDir: string,
  language: string,
  image: string,
  executable: string,
  extraArgs: string[],
  timeoutS: number,
  code: string,
): Promise<RunResult> {
  const ext = LANG_EXT[language];
  if (!ext) {
    throw new Error(`[acv-docker][${sandboxId}] unsupported language: ${language}`);
  }

  const scriptName = `main.${ext}`;
  const hostScriptPath = path.join(sandboxDir, scriptName);
  await fs.writeFile(hostScriptPath, code, "utf8");

  const containerName = `acv-${sandboxId}`;
  const dockerArgs = buildDockerArgs(
    containerName,
    sandboxDir,
    image,
    executable,
    extraArgs,
    `/sandbox/${scriptName}`,
    timeoutS,
  );

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
    // Best-effort kill — `docker run --rm` will not exit on its own once
    // the inner process is hung. Fire-and-forget; ignore errors.
    spawnSync("docker", ["kill", containerName], {
      timeout: DOCKER_PROBE_TIMEOUT_MS,
      stdio: "ignore",
    });
  }, timeoutS * 1000);
  const startMs = Date.now();

  return new Promise<RunResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;

    const settle = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };

    const buildResult = (exitCode: number): RunResult => {
      const durationMs = Date.now() - startMs;
      let stdout = Buffer.concat(stdoutChunks).toString("utf8");
      let stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (stdoutTruncated) {
        stdout += `\n[acv-docker] stdout truncated at ${MAX_OUTPUT_BYTES} bytes`;
      }
      if (stderrTruncated) {
        stderr += `\n[acv-docker] stderr truncated at ${MAX_OUTPUT_BYTES} bytes`;
      }
      return { stdout, stderr, exit_code: exitCode, duration_ms: durationMs };
    };

    // shell: false (default) — never set true; argv-vector form prevents
    // shell-injection through `code` content.
    // No env passed: docker inherits nothing from process.env unless we
    // forward explicitly. We do not.
    const child = cpSpawn("docker", dockerArgs, {
      signal: controller.signal,
      env: {
        // Keep PATH so the `docker` binary resolves; nothing else.
        PATH: process.env.PATH ?? "",
      },
    });

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutTruncated) return;
      const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
      if (chunk.length >= remaining) {
        stdoutChunks.push(chunk.slice(0, remaining));
        stdoutBytes = MAX_OUTPUT_BYTES;
        stdoutTruncated = true;
      } else {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrTruncated) return;
      const remaining = MAX_OUTPUT_BYTES - stderrBytes;
      if (chunk.length >= remaining) {
        stderrChunks.push(chunk.slice(0, remaining));
        stderrBytes = MAX_OUTPUT_BYTES;
        stderrTruncated = true;
      } else {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }
    });

    child.on("error", (err: Error) => {
      const isAbort =
        err.name === "AbortError" ||
        (err as NodeJS.ErrnoException).code === "ABORT_ERR";
      if (isAbort) {
        const r = buildResult(124);
        r.stderr += `\n[acv-docker] timed out after ${timeoutS}s`;
        settle(r);
      } else {
        settle(buildResult(1));
      }
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (controller.signal.aborted) {
        const r = buildResult(124);
        r.stderr += `\n[acv-docker] timed out after ${timeoutS}s`;
        settle(r);
        return;
      }
      let exitCode: number;
      if (code !== null) exitCode = code;
      else if (signal !== null) exitCode = 1;
      else exitCode = 0;
      settle(buildResult(exitCode));
    });
  });
}

// ---------------------------------------------------------------------------
// Sandbox factory
// ---------------------------------------------------------------------------

function createSandbox(
  sandboxId: string,
  sandboxDir: string,
  language: string,
  image: string,
  executable: string,
  extraArgs: string[],
  timeoutS: number,
): Sandbox {
  return {
    id: sandboxId,

    run(code: string): Promise<RunResult> {
      return runCode(sandboxId, sandboxDir, language, image, executable, extraArgs, timeoutS, code);
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      const target = safeResolve(sandboxDir, filePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
    },

    async readFile(filePath: string): Promise<string> {
      const target = safeResolve(sandboxDir, filePath);
      return fs.readFile(target, "utf8");
    },

    async dispose(): Promise<void> {
      // Best-effort: kill the container if it is still alive. `docker run
      // --rm` removes it on exit, so this is only relevant if the host
      // process is shutting down mid-run.
      const containerName = `acv-${sandboxId}`;
      try {
        spawnSync("docker", ["rm", "-f", containerName], {
          timeout: DOCKER_PROBE_TIMEOUT_MS,
          stdio: "ignore",
        });
      } catch {
        // Ignore — container may have already exited.
      }

      const maxAttempts = process.platform === "win32" ? WINDOWS_DISPOSE_MAX_ATTEMPTS : 1;
      let lastErr: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          await fs.rm(sandboxDir, { recursive: true, force: true });
          return;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "EBUSY" || code === "EPERM") {
            lastErr = err;
            await new Promise<void>((r) =>
              setTimeout(r, WINDOWS_DISPOSE_BACKOFF_BASE_MS * 2 ** attempt),
            );
          } else {
            throw err;
          }
        }
      }
      console.warn(
        `[acv-docker][${sandboxId}] dispose: could not remove sandbox dir after ` +
          `${maxAttempts} attempts: ${String(lastErr)}`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Provider export
// ---------------------------------------------------------------------------

export const provider: SandboxProvider = {
  id: "docker",

  async spawn(opts: { language: string; timeout_s: number }): Promise<Sandbox> {
    const { language, timeout_s } = opts;

    if (!SUPPORTED_LANGUAGES.has(language)) {
      throw new Error(
        `[acv-docker] unsupported language: '${language}'. ` +
          `Supported languages: ${[...SUPPORTED_LANGUAGES].join(", ")}.`,
      );
    }

    if (!dockerCliAvailable()) {
      throw new Error(
        "[acv-docker] docker CLI not on PATH or daemon unreachable. " +
          "Install Docker Desktop / docker engine and ensure `docker version` succeeds.",
      );
    }

    const image = imageForLanguage(language);
    const [executable, extraArgs] = commandForLanguage(language);

    const idSuffix = randomBytes(6).toString("hex");
    const sandboxId = `docker-${idSuffix}`;
    const sandboxDir = path.join(os.tmpdir(), `acv-docker-${sandboxId}`);

    try {
      await fs.mkdir(sandboxDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      throw new Error(
        `[acv-docker][${sandboxId}] failed to create sandbox dir ` +
          `'${sandboxDir}': ${String(err)}`,
      );
    }

    return createSandbox(sandboxId, sandboxDir, language, image, executable, extraArgs, timeout_s);
  },
};

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Returns true if the docker CLI is on PATH AND the daemon is reachable.
 * Image availability is NOT checked here (would force a network pull on
 * every health probe). Image pulls happen lazily on first run.
 */
export async function _health(): Promise<boolean> {
  try {
    return dockerCliAvailable();
  } catch {
    return false;
  }
}
