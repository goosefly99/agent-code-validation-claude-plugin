import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Module import: we re-import per suite using a workaround because provenance
// uses module-level state (logPath). For this suite we call initProvenance()
// in each beforeEach with a fresh temp dir so tests don't bleed into each other.
// The "log throws if not initialized" case cannot be tested cleanly without
// resetting module-level state; see the documented note at the bottom.
// ---------------------------------------------------------------------------
import { initProvenance, log, digest } from "./provenance.js";
import type { ProvenanceEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LogInput = Omit<ProvenanceEntry, "ts">;

function makeEntry(overrides: Partial<LogInput> = {}): LogInput {
  return {
    session_id: "s1",
    subagent: null,
    hook: null,
    skill: null,
    tool: "test-tool",
    sandbox_id: null,
    args_digest: "abc123",
    result_digest: "def456",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// digest() — pure function, no I/O
// ---------------------------------------------------------------------------

describe("digest()", () => {
  it("is deterministic for identical inputs", () => {
    expect(digest({ a: 1, b: 2 })).toBe(digest({ a: 1, b: 2 }));
  });

  it("differs for different inputs", () => {
    expect(digest({ a: 1 })).not.toBe(digest({ a: 2 }));
  });

  it("returns a 16-char lowercase hex string", () => {
    expect(digest("hello")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("handles null / undefined / nested objects", () => {
    const d1 = digest(null);
    const d2 = digest({ x: { y: [1, 2, 3] } });
    expect(d1).toMatch(/^[0-9a-f]{16}$/);
    expect(d2).toMatch(/^[0-9a-f]{16}$/);
    expect(d1).not.toBe(d2);
  });

  it("empty string and empty object produce different digests", () => {
    expect(digest("")).not.toBe(digest({}));
  });
});

// ---------------------------------------------------------------------------
// initProvenance() + log() — file I/O
// ---------------------------------------------------------------------------

describe("provenance log", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "acv-prov-"));
    // Re-initialize provenance to point at our fresh temp dir.
    await initProvenance(dir);
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; don't mask test failures.
    }
  });

  it("log appends a JSONL line with a ts field", async () => {
    await log(makeEntry({ tool: "my-tool" }));

    const raw = readFileSync(join(dir, "provenance.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]) as ProvenanceEntry;
    expect(entry.tool).toBe("my-tool");
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("ts field is an ISO 8601 timestamp", async () => {
    await log(makeEntry());

    const raw = readFileSync(join(dir, "provenance.jsonl"), "utf-8");
    const entry = JSON.parse(raw.trim()) as ProvenanceEntry;
    const d = new Date(entry.ts);
    expect(Number.isNaN(d.getTime())).toBe(false);
  });

  it("log writes all ProvenanceEntry fields", async () => {
    const input = makeEntry({
      session_id: "sess-99",
      subagent: "agent-A",
      hook: "SessionStart",
      skill: "my-skill",
      tool: "run_in_sandbox",
      sandbox_id: "sb-42",
      args_digest: "aaa",
      result_digest: "bbb",
    });
    await log(input);

    const raw = readFileSync(join(dir, "provenance.jsonl"), "utf-8");
    const entry = JSON.parse(raw.trim()) as ProvenanceEntry;
    expect(entry.session_id).toBe("sess-99");
    expect(entry.subagent).toBe("agent-A");
    expect(entry.hook).toBe("SessionStart");
    expect(entry.skill).toBe("my-skill");
    expect(entry.tool).toBe("run_in_sandbox");
    expect(entry.sandbox_id).toBe("sb-42");
    expect(entry.args_digest).toBe("aaa");
    expect(entry.result_digest).toBe("bbb");
  });

  it("multiple log calls append multiple lines", async () => {
    await log(makeEntry({ tool: "tool-A" }));
    await log(makeEntry({ tool: "tool-B" }));
    await log(makeEntry({ tool: "tool-C" }));

    const raw = readFileSync(join(dir, "provenance.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(3);

    const tools = lines.map((l) => (JSON.parse(l) as ProvenanceEntry).tool);
    expect(tools).toEqual(["tool-A", "tool-B", "tool-C"]);
  });

  it("log creates provenance.jsonl in the given directory", async () => {
    await log(makeEntry());

    // File must exist and be non-empty.
    const raw = readFileSync(join(dir, "provenance.jsonl"), "utf-8");
    expect(raw.length).toBeGreaterThan(0);
  });

  it("each line is valid JSON (no stray newlines inside the JSON object)", async () => {
    await log(makeEntry({ tool: "check-json" }));

    const raw = readFileSync(join(dir, "provenance.jsonl"), "utf-8");
    // Each line, parsed independently, must succeed.
    for (const line of raw.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Opt-in / lazy behavior — the fix for ".acv litter in every project".
// When the project is not activated (active:false), provenance must write
// nothing and must not create a .acv/ directory. When active, the directory
// is created lazily on the first write (never eagerly at init).
// ---------------------------------------------------------------------------

describe("provenance opt-in (active flag)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "acv-prov-optin-"));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("log is a no-op and creates nothing when active:false", async () => {
    const acv = join(dir, "nested", ".acv");
    await initProvenance(acv, { active: false });
    await log(makeEntry());
    expect(existsSync(join(acv, "provenance.jsonl"))).toBe(false);
    expect(existsSync(acv)).toBe(false); // not even the directory
  });

  it("does not create the directory at init time (lazy)", async () => {
    const acv = join(dir, "nested", ".acv");
    await initProvenance(acv, { active: true });
    expect(existsSync(acv)).toBe(false);
  });

  it("lazily creates the directory and writes when active:true", async () => {
    const acv = join(dir, "nested", ".acv");
    await initProvenance(acv, { active: true });
    await log(makeEntry({ tool: "lazy" }));
    const raw = readFileSync(join(acv, "provenance.jsonl"), "utf-8");
    expect((JSON.parse(raw.trim()) as ProvenanceEntry).tool).toBe("lazy");
  });
});

// ---------------------------------------------------------------------------
// Note on "log when not initialized":
//
// provenance.ts uses a module-level `logPath` variable. Because ESM module
// state is shared across all tests in the same worker process, and because
// the `beforeEach` above calls `initProvenance()` (which sets `logPath`),
// there is no safe way to reset logPath to null within this test suite
// without modifying provenance.ts.
//
// log() is intentionally a silent no-op when logPath is null OR the project is
// inactive (never throws) — provenance must never crash a hook or the server.
// The active:false no-op path is exercised by the "provenance opt-in" suite above.
// ---------------------------------------------------------------------------
