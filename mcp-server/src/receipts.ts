// HMAC-signed verification receipts. Signing key generated at SessionStart and
// kept only in this process's memory — not persisted, not exposed via any tool.
// Mitigates T1 (credential recovery) + enables Stop hook to reject tampered receipts.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { VerificationReceipt } from "./types.js";

let signingKey: Buffer | null = null;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(k => JSON.stringify(k) + ":" + canonicalJson(obj[k]));
  return "{" + parts.join(",") + "}";
}

export async function initReceiptsKey(): Promise<void> {
  signingKey = randomBytes(32);
}

export function signReceipt(r: Omit<VerificationReceipt, "signature">): VerificationReceipt {
  if (!signingKey) throw new Error("receipts key not initialized");
  const canonical = canonicalJson(r);
  const sig = createHmac("sha256", signingKey).update(canonical).digest("hex");
  return { ...r, signature: sig };
}

export function verifyReceipt(r: VerificationReceipt): boolean {
  if (!signingKey) throw new Error("receipts key not initialized");
  const { signature, ...rest } = r;
  const canonical = canonicalJson(rest);
  const expected = createHmac("sha256", signingKey).update(canonical).digest("hex");
  // Use timing-safe compare to prevent timing attacks
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}
