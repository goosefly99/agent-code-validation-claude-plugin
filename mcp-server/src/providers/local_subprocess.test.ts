/**
 * Smoke tests for local_subprocess provider.
 *
 * These are integration tests that spawn real child processes.
 * They require Node ≥ 20 (always true — we're running inside it).
 *
 * Run with: npm test
 */

import { describe, it, expect, afterEach } from "vitest";
import { provider, _health } from "./local_subprocess.js";
import type { Sandbox } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sandboxes: Sandbox[] = [];

async function spawnAndTrack(language: string, timeoutS = 10): Promise<Sandbox> {
  const sb = await provider.spawn({ language, timeout_s: timeoutS });
  sandboxes.push(sb);
  return sb;
}

afterEach(async () => {
  // Dispose all sandboxes created during a test, even if the test threw.
  const toDispose = sandboxes.splice(0);
  await Promise.all(toDispose.map((sb) => sb.dispose().catch(() => {})));
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe("_health()", () => {
  it("T01: returns true on Node ≥ 20", async () => {
    const result = await _health();
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// spawn() validation
// ---------------------------------------------------------------------------

describe("provider.spawn() — language validation", () => {
  it("T02: spawn succeeds for javascript", async () => {
    const sb = await spawnAndTrack("javascript");
    expect(sb.id).toMatch(/^local-/);
  });

  it("T03: spawn succeeds for python (skips if python unavailable)", async () => {
    // We attempt spawn; if Python is absent the provider will throw — that's correct behavior.
    // We just verify the throw is a clear message, not a crash.
    try {
      await spawnAndTrack("python");
      // If we get here, Python is available — that's fine.
    } catch (err) {
      expect(String(err)).toMatch(/python/i);
    }
  });

  it("T04: spawn throws for rust (I2 — throw at spawn, not run)", async () => {
    await expect(provider.spawn({ language: "rust", timeout_s: 10 })).rejects.toThrow(
      /unsupported language.*rust/i
    );
  });

  it("T05: spawn throws for go (I2 — throw at spawn, not run)", async () => {
    await expect(provider.spawn({ language: "go", timeout_s: 10 })).rejects.toThrow(
      /unsupported language.*go/i
    );
  });

  it("T06: spawn throws for unknown language", async () => {
    await expect(provider.spawn({ language: "brainfuck", timeout_s: 10 })).rejects.toThrow(
      /unsupported language/i
    );
  });

  it("T07: spawn returns sandbox with unique IDs", async () => {
    const sb1 = await spawnAndTrack("javascript");
    const sb2 = await spawnAndTrack("javascript");
    expect(sb1.id).not.toEqual(sb2.id);
  });
});

// ---------------------------------------------------------------------------
// run() — JavaScript
// ---------------------------------------------------------------------------

describe("run() — javascript", () => {
  it("T08: captures stdout from console.log", async () => {
    const sb = await spawnAndTrack("javascript");
    const result = await sb.run(`console.log("hello world");`);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.exit_code).toBe(0);
    expect(result.duration_ms).toBeGreaterThan(0);
  });

  it("T09: captures stderr from console.error", async () => {
    const sb = await spawnAndTrack("javascript");
    const result = await sb.run(`console.error("oops");`);
    expect(result.stderr.trim()).toBe("oops");
    expect(result.exit_code).toBe(0);
  });

  it("T10: reports non-zero exit code", async () => {
    const sb = await spawnAndTrack("javascript");
    const result = await sb.run(`process.exit(42);`);
    expect(result.exit_code).toBe(42);
  });

  it("T11: catches runtime errors in stderr, exit 1", async () => {
    const sb = await spawnAndTrack("javascript");
    const result = await sb.run(`throw new Error("kaboom");`);
    expect(result.exit_code).not.toBe(0);
    expect(result.stderr).toMatch(/kaboom/);
  });

  it("T12: timeout fires and sets exit_code 124", async () => {
    const sb = await spawnAndTrack("javascript", 1);
    const result = await sb.run(`while(true){}`);
    expect(result.exit_code).toBe(124);
    expect(result.stderr).toMatch(/timed out after 1s/);
  }, 10_000);

  it("T13: arithmetic and multi-line output", async () => {
    const sb = await spawnAndTrack("javascript");
    const result = await sb.run(`
      for (let i = 1; i <= 5; i++) {
        console.log(i * i);
      }
    `);
    expect(result.exit_code).toBe(0);
    const lines = result.stdout.trim().split("\n").map(Number);
    expect(lines).toEqual([1, 4, 9, 16, 25]);
  });

  it("T14: empty script exits 0 with no output", async () => {
    const sb = await spawnAndTrack("javascript");
    const result = await sb.run(``);
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

// ---------------------------------------------------------------------------
// writeFile / readFile
// ---------------------------------------------------------------------------

describe("writeFile / readFile", () => {
  it("T15: write then read a file inside sandbox", async () => {
    const sb = await spawnAndTrack("javascript");
    await sb.writeFile("data.txt", "hello from file");
    const content = await sb.readFile("data.txt");
    expect(content).toBe("hello from file");
  });

  it("T16: writeFile rejects path traversal (absolute path)", async () => {
    const sb = await spawnAndTrack("javascript");
    await expect(sb.writeFile("/etc/passwd", "evil")).rejects.toThrow(
      /outside sandbox/i
    );
  });

  it("T17: writeFile rejects path traversal (../)", async () => {
    const sb = await spawnAndTrack("javascript");
    await expect(sb.writeFile("../../etc/shadow", "evil")).rejects.toThrow(
      /outside sandbox/i
    );
  });

  it("T18: run() can read a file written with writeFile", async () => {
    const sb = await spawnAndTrack("javascript");
    await sb.writeFile("input.json", JSON.stringify({ value: 42 }));
    const result = await sb.run(`
      const fs = require("fs");
      const data = JSON.parse(fs.readFileSync("input.json", "utf8"));
      console.log(data.value * 2);
    `);
    expect(result.stdout.trim()).toBe("84");
    expect(result.exit_code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe("dispose()", () => {
  it("T19: dispose removes the sandbox directory without error", async () => {
    // We do NOT add to sandboxes[] here so afterEach doesn't double-dispose.
    const sb = await provider.spawn({ language: "javascript", timeout_s: 10 });
    await expect(sb.dispose()).resolves.not.toThrow();
    // A second dispose should also not throw (force: true).
    await expect(sb.dispose()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// C1: stdout/stderr output capping (new test — OOM guard)
// ---------------------------------------------------------------------------

describe("C1 — output buffer cap (MAX_OUTPUT_BYTES = 10 MB)", () => {
  it("T20 (C1): stdout is capped and truncation marker is appended", async () => {
    // Write a script that emits well over 10 MB to stdout using a tight loop.
    // We use process.stdout.write to avoid newline overhead counting against us.
    // We write 11 MB worth of data in chunks: 1100 iterations × ~10 KB each.
    const sb = await spawnAndTrack("javascript", 30);
    const result = await sb.run(`
      const chunk = "A".repeat(10 * 1024); // 10 KB per iteration
      for (let i = 0; i < 1200; i++) {    // 12 MB total
        process.stdout.write(chunk);
      }
    `);

    // The marker must be present.
    expect(result.stdout).toContain("[acv-local] stdout truncated at");

    // The total output (including marker) must be bounded near 10 MB.
    // We allow a small margin for the marker text itself (~100 bytes).
    const TEN_MB = 10 * 1024 * 1024;
    expect(result.stdout.length).toBeLessThan(TEN_MB + 200);

    // exit_code may be 0 (process finishes writing) or non-zero (pipe broken).
    // We don't assert on it — what matters is the cap.
  }, 60_000);

  it("T20b (C1): stderr is capped and truncation marker is appended", async () => {
    const sb = await spawnAndTrack("javascript", 30);
    const result = await sb.run(`
      const chunk = "E".repeat(10 * 1024); // 10 KB per iteration
      for (let i = 0; i < 1200; i++) {    // 12 MB total
        process.stderr.write(chunk);
      }
    `);

    expect(result.stderr).toContain("[acv-local] stderr truncated at");

    const TEN_MB = 10 * 1024 * 1024;
    expect(result.stderr.length).toBeLessThan(TEN_MB + 200);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// I5: env isolation — no credential leakage (new test)
// ---------------------------------------------------------------------------

describe("I5 — environment isolation (SAFE_ENV_KEYS allowlist)", () => {
  it("T21 (I5): SECRET_TEST_KEY set on host is NOT visible in sandbox", async () => {
    // Simulate a credential present in the MCP server process environment.
    process.env["SECRET_TEST_KEY"] = "should-not-leak";

    try {
      const sb = await spawnAndTrack("javascript");
      const result = await sb.run(`
        console.log(process.env.SECRET_TEST_KEY);
      `);

      // The output must be "undefined" (the key was not forwarded).
      expect(result.stdout.trim()).toBe("undefined");
      expect(result.exit_code).toBe(0);
    } finally {
      // Clean up the test pollution even if an assertion throws.
      delete process.env["SECRET_TEST_KEY"];
    }
  });

  it("T22 (I5): PATH is forwarded (sandbox can find node/system tools)", async () => {
    // PATH must be present or the subprocess cannot find its own executable.
    const sb = await spawnAndTrack("javascript");
    const result = await sb.run(`
      console.log(typeof process.env.PATH !== "undefined" ? "has-path" : "no-path");
    `);
    expect(result.stdout.trim()).toBe("has-path");
    expect(result.exit_code).toBe(0);
  });
});
