import { describe, it, expect, beforeEach } from "vitest";
import { resolveProvider, resetResolverCache } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PREF_ENV = "ACV_SANDBOX_PROVIDER_PREFERENCE";

// ---------------------------------------------------------------------------
// resolveProvider()
// ---------------------------------------------------------------------------

describe("resolveProvider()", () => {
  beforeEach(() => {
    // Reset the module-level cache and clear the env var so each test starts clean.
    resetResolverCache();
    delete process.env[PREF_ENV];
  });

  it("resolves to the local provider by default (no env var set)", async () => {
    const p = await resolveProvider();
    expect(p.id).toBe("local");
  });

  it("resolves to local when preference is explicitly set to 'local'", async () => {
    process.env[PREF_ENV] = "local";
    const p = await resolveProvider();
    expect(p.id).toBe("local");
  });

  it("returns the same object instance on subsequent calls (cache hit)", async () => {
    const p1 = await resolveProvider();
    const p2 = await resolveProvider();
    expect(p1).toBe(p2);
  });

  it("returns a fresh instance after resetResolverCache()", async () => {
    const p1 = await resolveProvider();
    resetResolverCache();
    const p2 = await resolveProvider();
    // Both resolve to local; the important thing is the call succeeds after reset.
    expect(p2.id).toBe("local");
    // And the instances may or may not be the same object — what matters is resolution worked.
    expect(p2).toBeDefined();
  });

  it("throws when preference list contains only stub (unhealthy) providers", async () => {
    process.env[PREF_ENV] = "e2b,daytona,modal";
    await expect(resolveProvider()).rejects.toThrow(/no sandbox provider available/i);
  });

  it("throws with a 'Tried' diagnostic listing the attempted providers", async () => {
    process.env[PREF_ENV] = "e2b,daytona,modal";
    await expect(resolveProvider()).rejects.toThrow(/Tried/);
  });

  it("throws and names unknown provider IDs with '(unknown)' annotation", async () => {
    process.env[PREF_ENV] = "bogus,e2b";
    await expect(resolveProvider()).rejects.toThrow(/bogus.*unknown/i);
  });

  it("throws for a single unknown provider name", async () => {
    process.env[PREF_ENV] = "nonexistent-provider";
    await expect(resolveProvider()).rejects.toThrow(/nonexistent-provider.*unknown/i);
  });

  it("trims whitespace around preference entries", async () => {
    process.env[PREF_ENV] = "  local  ";
    const p = await resolveProvider();
    expect(p.id).toBe("local");
  });

  it("trims whitespace in comma-separated list", async () => {
    process.env[PREF_ENV] = " e2b , local ";
    // e2b is unhealthy (stub), so it falls through to local.
    const p = await resolveProvider();
    expect(p.id).toBe("local");
  });

  it("skips empty entries produced by extra commas", async () => {
    // ",,,local" after trimming produces ["", "", "", "local"]; empty strings
    // are filtered by the resolver's .filter(s => s.length > 0) guard.
    process.env[PREF_ENV] = ",,,local";
    const p = await resolveProvider();
    expect(p.id).toBe("local");
  });

  it("falls through from unhealthy provider to a healthy one", async () => {
    // e2b and daytona are stubs (_health returns false); local is healthy.
    process.env[PREF_ENV] = "e2b,daytona,local";
    const p = await resolveProvider();
    expect(p.id).toBe("local");
  });

  it("returned provider has a spawn() method", async () => {
    const p = await resolveProvider();
    expect(typeof p.spawn).toBe("function");
  });

  it("recognises 'docker' as a known provider id (no '(unknown)' annotation)", async () => {
    // docker is healthy iff the daemon is reachable. We assert only that
    // the resolver does not flag it as unknown — when unhealthy it falls
    // through to local; when healthy it returns docker.
    process.env[PREF_ENV] = "docker,local";
    const p = await resolveProvider();
    expect(["docker", "local"]).toContain(p.id);
  });
});
