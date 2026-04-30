/**
 * local_subprocess — SandboxProvider that spawns child processes on the host machine.
 *
 * SECURITY LIMITATIONS (must read before enabling):
 * - Native Windows lacks seccomp-bpf, so this provider provides ZERO syscall isolation.
 *   The temp dir gives lightweight path isolation by convention only; a malicious process
 *   can still read system files via absolute paths.
 * - On Linux/WSL deployments, future hardening should add a seccomp filter via a wrapper
 *   script (e.g., unshare/firejail) before execing the interpreter.
 *   TODO(Phase 3): Add seccomp-bpf wrapper for Linux/WSL to restrict syscalls.
 * - `spawn` is invoked with `shell: false` (the default) to avoid shell-injection vectors.
 *   Never set `shell: true` here.
 * - Subprocess environment is restricted to SAFE_ENV_KEYS only (see buildSandboxEnv).
 *   This prevents credential leakage (T1 threat: MCP server env vars like E2B_API_KEY,
 *   OPENAI_API_KEY, etc. are NOT inherited by sandboxed subprocesses).
 *
 * This provider is enabled via ACV_ALLOW_LOCAL_FALLBACK=true and is the last resort
 * when managed sandboxes (e2b, daytona, modal) are unavailable.
 *
 * Spec: components "MCP Server — acv-mcp" + risks T1 (cred isolation).
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

/** Maximum bytes accumulated per stream (stdout or stderr) before truncation. */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB

/** Timeout (ms) for runtime probe spawnSync calls (version checks). */
const RUNTIME_PROBE_TIMEOUT_MS = 5000;

/** Number of retries for Windows EBUSY/EPERM on dispose. */
const WINDOWS_DISPOSE_MAX_ATTEMPTS = 5;

/** Base delay (ms) for Windows dispose exponential back-off: base * 2^attempt. */
const WINDOWS_DISPOSE_BACKOFF_BASE_MS = 100;

// ---------------------------------------------------------------------------
// Language → file extension mapping
// ---------------------------------------------------------------------------

/** Languages fully supported end-to-end by this provider. */
const SUPPORTED_LANGUAGES = new Set(["python", "javascript", "typescript"]);

const LANG_EXT: Record<string, string> = {
  python: "py",
  javascript: "js",
  typescript: "ts",
};

// ---------------------------------------------------------------------------
// Environment allowlist (T1 credential isolation)
// ---------------------------------------------------------------------------

/**
 * Keys from process.env that are safe to pass to sandbox subprocesses.
 *
 * This list is intentionally narrow. Any key NOT in this list is dropped,
 * which means API keys, tokens, and secrets present in the MCP server's
 * environment are never inherited by sandboxed child processes.
 *
 * Rationale: the MCP server process may carry E2B_API_KEY, OPENAI_API_KEY,
 * ANTHROPIC_API_KEY, etc. Forwarding these to user-controlled code is exactly
 * the T1 credential-leakage attack vector this project must prevent.
 */
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  // Windows-specific keys needed for Node.js and system tools to work correctly.
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
];

/** Build a minimal, safe environment for sandbox child processes. */
function buildSandboxEnv(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const k of SAFE_ENV_KEYS) {
    const v = process.env[k];
    if (v !== undefined) safe[k] = v;
  }
  // No API keys, no tokens, no credentials.
  return safe;
}

// ---------------------------------------------------------------------------
// Path safety helper
// ---------------------------------------------------------------------------

/**
 * Resolve `userPath` relative to `sandboxDir` and verify it stays inside.
 * Throws if the resolved path escapes the sandbox directory.
 */
function safeResolve(sandboxDir: string, userPath: string): string {
  if (path.isAbsolute(userPath)) {
    throw new Error("local sandbox refuses path outside sandbox dir");
  }
  const resolved = path.resolve(sandboxDir, userPath);
  // Ensure the resolved path is within sandboxDir (trailing sep handles exact-match)
  const sandboxWithSep = path.normalize(sandboxDir) + path.sep;
  const normalizedResolved = path.normalize(resolved);
  if (
    normalizedResolved !== path.normalize(sandboxDir) &&
    !normalizedResolved.startsWith(sandboxWithSep)
  ) {
    throw new Error("local sandbox refuses path outside sandbox dir");
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Runtime resolution
// ---------------------------------------------------------------------------

/**
 * Pick the Python executable. Returns null if neither python nor python3 is on PATH.
 * On Windows prefer `python`; on Unix prefer `python3`.
 */
function resolvePython(): string | null {
  const candidates =
    process.platform === "win32"
      ? ["python", "python3"]
      : ["python3", "python"];

  for (const cmd of candidates) {
    const result = spawnSync(cmd, ["--version"], {
      encoding: "utf8",
      timeout: RUNTIME_PROBE_TIMEOUT_MS,
    });
    if (result.status === 0) return cmd;
  }
  return null;
}

/**
 * Derive the command + args to run user code for a given language.
 * Returns [executable, args_before_script].
 * Throws with a clear message if the required runtime is missing.
 *
 * Supported languages: python, javascript, typescript.
 * Unsupported languages should be rejected at spawn() time before this is called.
 */
function runtimeForLanguage(language: string): [string, string[]] {
  switch (language) {
    case "python": {
      const py = resolvePython();
      if (py === null) {
        throw new Error(
          "local provider: no Python interpreter found on PATH " +
            "(tried python and python3)"
        );
      }
      return [py, []];
    }

    case "javascript":
      // Node is always present — we are running inside it.
      return ["node", []];

    case "typescript": {
      // Prefer tsx on PATH.
      const tsxCheck = spawnSync("tsx", ["--version"], {
        encoding: "utf8",
        timeout: RUNTIME_PROBE_TIMEOUT_MS,
      });
      if (tsxCheck.status === 0) {
        return ["tsx", []];
      }
      // Fallback: node --import tsx (requires tsx installed globally/locally).
      const nodeImportCheck = spawnSync(
        "node",
        ["--import", "tsx", "--eval", "process.exit(0)"],
        { encoding: "utf8", timeout: RUNTIME_PROBE_TIMEOUT_MS }
      );
      if (nodeImportCheck.status === 0) {
        return ["node", ["--import", "tsx"]];
      }
      throw new Error(
        "local provider: TypeScript execution requires tsx on PATH. " +
          "Install it with: npm install -g tsx"
      );
    }

    default:
      throw new Error(
        `local provider: unsupported language '${language}'`
      );
  }
}

// ---------------------------------------------------------------------------
// RunResult type (mirrors Sandbox.run return shape)
// ---------------------------------------------------------------------------

type RunResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
};

// ---------------------------------------------------------------------------
// Core run() implementation
// ---------------------------------------------------------------------------

/**
 * Execute `code` inside `sandboxDir` using the pre-resolved `executable` + `extraArgs`.
 * Enforces `timeoutS` using AbortController.
 * Caps stdout and stderr at MAX_OUTPUT_BYTES each to prevent OOM (C1).
 * Never throws on non-zero exit — that's normal program failure.
 *
 * @param sandboxId - Used for diagnostic messages only.
 * @param sandboxDir - Working directory and script destination.
 * @param language - Language key; used only for file extension.
 * @param executable - Pre-resolved runtime binary (e.g. "node", "python3").
 * @param extraArgs - Pre-resolved extra args before the script path.
 * @param timeoutS - Hard wall-clock timeout in seconds.
 * @param code - Source code to execute.
 */
async function runCode(
  sandboxId: string,
  sandboxDir: string,
  language: string,
  executable: string,
  extraArgs: string[],
  timeoutS: number,
  code: string
): Promise<RunResult> {
  const ext = LANG_EXT[language];
  if (!ext) {
    throw new Error(
      `[acv-local][${sandboxId}] unsupported language: ${language}`
    );
  }

  const scriptPath = path.join(sandboxDir, `main.${ext}`);
  await fs.writeFile(scriptPath, code, "utf8");

  const args = [...extraArgs, scriptPath];

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutS * 1000);
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

      // Append truncation markers exactly once per stream if capped (C1).
      if (stdoutTruncated) {
        stdout += `\n[acv-local] stdout truncated at ${MAX_OUTPUT_BYTES} bytes`;
      }
      if (stderrTruncated) {
        stderr += `\n[acv-local] stderr truncated at ${MAX_OUTPUT_BYTES} bytes`;
      }

      return { stdout, stderr, exit_code: exitCode, duration_ms: durationMs };
    };

    // shell: false is the default — never set to true (anti-injection).
    // env is restricted to SAFE_ENV_KEYS allowlist to prevent credential leakage (I5/T1).
    const child = cpSpawn(executable, args, {
      cwd: sandboxDir,
      signal: controller.signal,
      env: buildSandboxEnv(), // No API keys, no tokens, no credentials.
    });

    // C1: Cap stdout accumulation at MAX_OUTPUT_BYTES. Drop new data once limit is hit.
    // The subprocess continues running — only timeout kills it. We just stop buffering.
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutTruncated) return;
      const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
      if (chunk.length >= remaining) {
        // Take only up to the cap, then mark truncated.
        stdoutChunks.push(chunk.slice(0, remaining));
        stdoutBytes = MAX_OUTPUT_BYTES;
        stdoutTruncated = true;
      } else {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      }
    });

    // C1: Same cap for stderr.
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
      // AbortError is raised when AbortController.abort() fires (our timeout path).
      const isAbort =
        err.name === "AbortError" ||
        (err as NodeJS.ErrnoException).code === "ABORT_ERR";

      if (isAbort) {
        const result = buildResult(124);
        result.stderr += `\n[acv-local] timed out after ${timeoutS}s`;
        settle(result);
      } else {
        settle(buildResult(1));
      }
    });

    child.on(
      "close",
      (code: number | null, signal: NodeJS.Signals | null) => {
        let exitCode: number;
        if (controller.signal.aborted) {
          const result = buildResult(124);
          result.stderr += `\n[acv-local] timed out after ${timeoutS}s`;
          settle(result);
          return;
        } else if (code !== null) {
          exitCode = code;
        } else if (signal !== null) {
          // Killed by external signal (not our abort).
          exitCode = 1;
        } else {
          exitCode = 0;
        }

        settle(buildResult(exitCode));
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Sandbox factory
// ---------------------------------------------------------------------------

/**
 * Create a Sandbox object wrapping the given sandboxDir.
 *
 * @param sandboxId - Unique ID for diagnostics.
 * @param sandboxDir - Pre-created temp directory.
 * @param language - Language this sandbox runs (validated before this call).
 * @param executable - Pre-resolved runtime binary (resolved once at spawn time).
 * @param extraArgs - Pre-resolved extra runtime args (resolved once at spawn time).
 * @param timeoutS - Default timeout for run().
 */
function createSandbox(
  sandboxId: string,
  sandboxDir: string,
  language: string,
  executable: string,
  extraArgs: string[],
  timeoutS: number
): Sandbox {
  return {
    id: sandboxId,

    run(code: string): Promise<RunResult> {
      return runCode(sandboxId, sandboxDir, language, executable, extraArgs, timeoutS, code);
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
      // On Windows, a freshly-killed process can hold file locks briefly (EBUSY).
      // Retry a few times with exponential back-off before giving up.
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
              setTimeout(r, WINDOWS_DISPOSE_BACKOFF_BASE_MS * 2 ** attempt)
            );
          } else {
            // Non-retriable error (e.g., permission denied for a different reason)
            throw err;
          }
        }
      }
      // All retries exhausted — log and move on; don't crash the caller.
      // The OS will clean up temp files on reboot.
      console.warn(
        `[acv-local][${sandboxId}] dispose: could not remove sandbox dir after ` +
          `${maxAttempts} attempts: ${String(lastErr)}`
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Provider export
// ---------------------------------------------------------------------------

export const provider: SandboxProvider = {
  id: "local",

  /**
   * Spawn a new local sandbox for the given language.
   *
   * Supported languages: python, javascript, typescript.
   * Throws immediately for unsupported or not-yet-implemented languages
   * (rust, go, and anything else) so the caller gets a clear error at
   * construction time rather than at run() invocation.
   *
   * Security note: The sandbox temp directory is created with mode 0o700
   * (owner-only) to prevent other local users from reading sandbox files.
   * On Windows, this mode is a no-op (NTFS uses ACLs); Windows security
   * relies on the OS-level user isolation instead.
   */
  async spawn(opts: { language: string; timeout_s: number }): Promise<Sandbox> {
    const { language, timeout_s } = opts;

    // I2: Throw at spawn() for any unsupported language, including rust/go.
    // This is cleaner than letting run() throw later (which could leak the temp dir
    // if the caller forgets to dispose on error).
    if (!SUPPORTED_LANGUAGES.has(language)) {
      throw new Error(
        `[acv-local] unsupported language: '${language}'. ` +
          `Supported languages: ${[...SUPPORTED_LANGUAGES].join(", ")}.`
      );
    }

    // m2+I3: Resolve the runtime once at spawn time, not on every run() call.
    // This avoids repeated PATH probing and tsx availability checks.
    const [executable, extraArgs] = runtimeForLanguage(language);

    const idSuffix = randomBytes(6).toString("hex");
    const sandboxId = `local-${idSuffix}`;
    const sandboxDir = path.join(os.tmpdir(), `acv-local-${sandboxId}`);

    try {
      // I1: mode: 0o700 restricts the directory to the owner only on POSIX systems.
      // On Windows this is a no-op (NTFS ACLs govern access instead).
      await fs.mkdir(sandboxDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      throw new Error(
        `[acv-local][${sandboxId}] failed to create sandbox dir ` +
          `'${sandboxDir}': ${String(err)}`
      );
    }

    return createSandbox(sandboxId, sandboxDir, language, executable, extraArgs, timeout_s);
  },
};

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Returns true if this provider can handle at least one supported language.
 * Never throws — returns false on any unexpected error.
 *
 * Note: This is an "is-the-provider-usable-at-all" check, NOT a check that
 * every supported language is available. Specifically:
 *   - Node ≥ 20 is sufficient for JavaScript sandboxes and is always present.
 *   - TypeScript requires tsx (not checked here — checked at spawn time).
 *   - Python availability is not checked here — checked at spawn time.
 * Use spawn() + run() to verify a specific language is fully functional.
 *
 * Checks:
 *   1. Node.js major version ≥ 20 (required by package.json engines).
 *   2. At least one supported runtime is reachable:
 *      - Node is always available (JS sandboxes work without Python or tsx).
 */
export async function _health(): Promise<boolean> {
  try {
    // 1. Node version check.
    const nodeVersionStr = process.versions.node;
    const nodeMajor = parseInt(nodeVersionStr.split(".")[0] ?? "0", 10);
    if (nodeMajor < 20) return false;

    // 2. Node ≥ 20 is sufficient for JS sandboxes (we are inside Node, so it's present).
    //    Python and tsx availability are checked per-spawn, not here.
    return true;
  } catch {
    return false;
  }
}
