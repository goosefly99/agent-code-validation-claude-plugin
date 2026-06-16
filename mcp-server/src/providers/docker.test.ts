/**
 * Tests for the docker SandboxProvider.
 *
 * These tests do NOT require Docker to be installed. They exercise:
 *   - the language allowlist (rejected at spawn before any docker call)
 *   - the health probe's no-throw contract (returns false instead of throwing)
 *   - the registry wiring (provider id is "docker")
 *
 * A small group of integration tests (commented `INTEGRATION:`) run only when
 * `docker version` succeeds. They are skipped automatically otherwise so CI
 * without Docker still passes.
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";

import { provider, _health } from "./docker.js";
import type { Sandbox } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sandboxes: Sandbox[] = [];

async function spawnAndTrack(language: string, timeoutS = 30): Promise<Sandbox> {
  const sb = await provider.spawn({ language, timeout_s: timeoutS });
  sandboxes.push(sb);
  return sb;
}

afterEach(async () => {
  const toDispose = sandboxes.splice(0);
  await Promise.all(toDispose.map((sb) => sb.dispose().catch(() => {})));
});

/**
 * Returns true iff `docker version` against the daemon succeeds. Used to
 * gate integration tests so they self-skip on machines without Docker.
 */
function dockerDaemonReachable(): boolean {
  try {
    const r = spawnSync(
      "docker",
      ["version", "--format", "{{.Server.Version}}"],
      { encoding: "utf8", timeout: 20000 },
    );
    return r.status === 0;
  } catch {
    return false;
  }
}

const HAS_DOCKER = dockerDaemonReachable();

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

describe("provider identity", () => {
  it("D01: provider.id === 'docker'", () => {
    expect(provider.id).toBe("docker");
  });
});

// ---------------------------------------------------------------------------
// Health check (must never throw, must reflect daemon reachability)
// ---------------------------------------------------------------------------

describe("_health()", () => {
  it("D02: never throws — returns boolean either way", async () => {
    const ok = await _health();
    expect(typeof ok).toBe("boolean");
  });

  it("D03: returns true iff daemon is reachable", async () => {
    const ok = await _health();
    expect(ok).toBe(HAS_DOCKER);
  });
});

// ---------------------------------------------------------------------------
// spawn() — language validation (these run regardless of Docker availability
// because the language gate fires before any docker invocation).
// ---------------------------------------------------------------------------

describe("provider.spawn() — language validation", () => {
  it("D04: throws for rust (unsupported, error before any docker call)", async () => {
    await expect(provider.spawn({ language: "rust", timeout_s: 10 })).rejects.toThrow(
      /unsupported language.*rust/i,
    );
  });

  it("D05: throws for go (unsupported)", async () => {
    await expect(provider.spawn({ language: "go", timeout_s: 10 })).rejects.toThrow(
      /unsupported language.*go/i,
    );
  });

  it("D06: throws for unknown language", async () => {
    await expect(provider.spawn({ language: "brainfuck", timeout_s: 10 })).rejects.toThrow(
      /unsupported language/i,
    );
  });
});

// ---------------------------------------------------------------------------
// spawn() — daemon-availability gating
// ---------------------------------------------------------------------------

describe("provider.spawn() — daemon gating", () => {
  it("D07: when daemon is unreachable, throws a clear `docker CLI ... unreachable` error", async () => {
    if (HAS_DOCKER) {
      // On a host with docker, spawn for a supported language must succeed.
      const sb = await spawnAndTrack("javascript");
      expect(sb.id).toMatch(/^docker-/);
      return;
    }
    // No docker: spawn for a supported language must throw with a helpful message.
    await expect(provider.spawn({ language: "javascript", timeout_s: 10 })).rejects.toThrow(
      /docker (CLI not on PATH|.*unreachable)/i,
    );
  });
});

// ---------------------------------------------------------------------------
// INTEGRATION (requires docker daemon) — JS round-trip
// ---------------------------------------------------------------------------

describe("integration — javascript round-trip", () => {
  it.skipIf(!HAS_DOCKER)("D08: prints to stdout and exits 0", async () => {
    const sb = await spawnAndTrack("javascript", 60);
    const result = await sb.run("console.log('hello-from-docker'); process.exit(0);");
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toMatch(/hello-from-docker/);
  }, 60000);

  it.skipIf(!HAS_DOCKER)("D09: non-zero exit propagates", async () => {
    const sb = await spawnAndTrack("javascript", 60);
    const result = await sb.run("process.exit(7);");
    expect(result.exit_code).toBe(7);
  }, 60000);
});

// ---------------------------------------------------------------------------
// INTEGRATION — sandbox isolation: --network=none means no DNS resolution.
// ---------------------------------------------------------------------------

describe("integration — network isolation default", () => {
  it.skipIf(!HAS_DOCKER)("D10: --network=none denies outbound DNS", async () => {
    const sb = await spawnAndTrack("javascript", 60);
    // dns.lookup on a public host should fail with EAI_AGAIN / ENOTFOUND
    // when the container has no network. We assert non-zero exit and a
    // recognisable error fragment.
    const result = await sb.run(
      "import('node:dns').then(d => d.promises.lookup('example.com')" +
        ".then(r => { console.log('LOOKUP_OK', r.address); process.exit(0); })" +
        ".catch(e => { console.error('LOOKUP_FAIL', e.code || e.message); process.exit(1); }))",
    );
    expect(result.exit_code).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/LOOKUP_FAIL|EAI_AGAIN|ENOTFOUND/);
  }, 60000);
});
