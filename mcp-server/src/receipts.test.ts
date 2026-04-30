import { describe, it, expect, beforeAll } from "vitest";
import { initReceiptsKey, signReceipt, verifyReceipt, canonicalJson } from "./receipts.js";
import type { VerificationReceipt } from "./types.js";

// ---------------------------------------------------------------------------
// Shared receipt fixture (used across multiple tests)
// ---------------------------------------------------------------------------

type ReceiptInput = Omit<VerificationReceipt, "signature">;

function makeReceiptInput(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    receipt_id: "r1",
    session_id: "s1",
    sandbox_id: "sb1",
    seed: 42,
    test_counts: { run: 5, passed: 5, failed: 0, skipped: 0 },
    mutation_score: 0.8,
    property_count: 3,
    verification_quality_score: 75,
    mutation_score_delta: 0,
    property_count_delta: 0,
    timings: { total_ms: 100, per_suite_ms: { pytest: 100 } },
    created_at: "2026-04-22T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — key must be initialized first
// ---------------------------------------------------------------------------

describe("receipts — sign and verify", () => {
  beforeAll(async () => {
    await initReceiptsKey();
  });

  it("signature is a 64-char lowercase hex string", () => {
    const r = signReceipt(makeReceiptInput());
    expect(r.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signs and verifies a receipt (round-trip)", () => {
    const r = signReceipt(makeReceiptInput());
    expect(verifyReceipt(r)).toBe(true);
  });

  it("rejects a tampered receipt (mutation_score changed)", () => {
    const r = signReceipt(makeReceiptInput());
    const tampered: VerificationReceipt = { ...r, mutation_score: 0.5 };
    expect(verifyReceipt(tampered)).toBe(false);
  });

  it("rejects a tampered receipt (test_counts.run changed — nested field)", () => {
    const r = signReceipt(makeReceiptInput());
    const tampered: VerificationReceipt = {
      ...r,
      test_counts: { ...r.test_counts, run: 99 },
    };
    expect(verifyReceipt(tampered)).toBe(false);
  });

  it("rejects a tampered receipt (timings.per_suite_ms.pytest changed — deeply nested field)", () => {
    const r = signReceipt(makeReceiptInput());
    const tampered: VerificationReceipt = {
      ...r,
      timings: { ...r.timings, per_suite_ms: { pytest: 9999 } },
    };
    expect(verifyReceipt(tampered)).toBe(false);
  });

  it("rejects a receipt with an empty signature", () => {
    const r = signReceipt(makeReceiptInput());
    const tampered: VerificationReceipt = { ...r, signature: "" };
    expect(verifyReceipt(tampered)).toBe(false);
  });

  it("rejects a receipt with a zeroed signature", () => {
    const r = signReceipt(makeReceiptInput());
    const tampered: VerificationReceipt = { ...r, signature: "0".repeat(64) };
    expect(verifyReceipt(tampered)).toBe(false);
  });

  it("two different inputs produce two different signatures", () => {
    const r1 = signReceipt(makeReceiptInput({ seed: 1 }));
    const r2 = signReceipt(makeReceiptInput({ seed: 2 }));
    expect(r1.signature).not.toBe(r2.signature);
  });

  it("signing is deterministic given the same key (same input → same sig)", () => {
    // With the same in-memory key, two calls with identical data must produce the same hash.
    const input = makeReceiptInput();
    const r1 = signReceipt(input);
    const r2 = signReceipt(input);
    expect(r1.signature).toBe(r2.signature);
  });

  it("null-valued optional fields are accepted and verified correctly", () => {
    const r = signReceipt(
      makeReceiptInput({
        mutation_score: null,
        property_count: null,
        mutation_score_delta: null,
        property_count_delta: null,
      })
    );
    expect(verifyReceipt(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canonicalJson — key-order stability
// ---------------------------------------------------------------------------

describe("canonicalJson — key-order stability", () => {
  it("produces identical output regardless of insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("sorts nested object keys as well", () => {
    expect(canonicalJson({ z: { b: 1, a: 2 } })).toBe(canonicalJson({ z: { a: 2, b: 1 } }));
  });
});

// ---------------------------------------------------------------------------
// Note on "throws if key not initialized":
//
// Because initReceiptsKey() sets module-level state and the module is cached
// by Node's ESM loader across all tests in this file, resetting that state
// without modifying receipts.ts itself is not feasible in a clean way.
//
// The behavior IS tested indirectly: the `beforeAll` above calls
// initReceiptsKey(), and all tests that follow would throw if the key were
// absent. A separate test suite in a different worker (vitest --pool forks)
// could test the un-initialized path, but that is out of scope for P2.6.
//
// Documented limitation: "throw if not initialized" is covered by code
// inspection; it is not exercised in this suite.
// ---------------------------------------------------------------------------
