#!/usr/bin/env node
// Stop — the tamper-evident gate. 'done' is not a speech act.
//
// Opt-in: inactive projects (no acv.config.json) allow the stop. When active,
// block when (a) any unresolved SUSPICIOUS watchdog finding exists, or (b) no
// valid Auditor receipt exists for the session, or (c) the receipt's
// Verification-Quality Score is below the configured floor, or (d) a score
// delta regressed. Output shape: TOP-LEVEL { decision:"block", reason }.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { isActivated, resolveProjectDir, acvDir, readSettings } from "./_lib/acv.mjs";

const event = JSON.parse(readFileSync(0, "utf-8"));

function allow() { console.log(JSON.stringify({})); }
function block(reason) { console.log(JSON.stringify({ decision: "block", reason })); }

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

function receiptValid(receipt, keyBuf) {
  const { signature, ...rest } = receipt;
  if (typeof signature !== "string") return false;
  const expected = createHmac("sha256", keyBuf).update(canonical(rest)).digest("hex");
  return signature.length === expected.length && signature === expected;
}

function main() {
  const projectDir = resolveProjectDir();
  if (!isActivated(projectDir)) return allow();

  const dir = acvDir(projectDir);
  const settings = readSettings(projectDir);

  // (a) unresolved SUSPICIOUS findings
  const findingsPath = join(dir, "findings.jsonl");
  if (existsSync(findingsPath)) {
    const unresolved = readFileSync(findingsPath, "utf-8").split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((f) => f && f.resolved === false);
    if (unresolved.length) {
      return block(
        `agent_code_validation: ${unresolved.length} unresolved SUSPICIOUS finding(s) ` +
        `from the watchdog. Resolve them (or have the auditor clear them) before stopping. ` +
        `First: ${unresolved[0].reason ?? unresolved[0].file}`);
    }
  }

  // (b)/(c)/(d) receipt gate
  const keyPath = join(dir, ".session-key");
  const receiptsDir = join(dir, "receipts");
  if (!existsSync(keyPath) || !existsSync(receiptsDir)) {
    return block("agent_code_validation: no verification receipt for this session. " +
      "Run /verify (the Auditor) to produce a signed receipt before declaring done.");
  }
  let key, receipt;
  try {
    key = readFileSync(keyPath);
    const sid = event.session_id;
    const files = readdirSync(receiptsDir).filter((f) => f.endsWith(".json"));
    const target = sid && files.includes(`${sid}.json`) ? `${sid}.json` : files.sort().at(-1);
    if (!target) return block("agent_code_validation: no verification receipt found. Run /verify.");
    receipt = JSON.parse(readFileSync(join(receiptsDir, target), "utf-8"));
  } catch {
    return block("agent_code_validation: verification receipt unreadable. Run /verify.");
  }
  if (!receiptValid(receipt, key)) {
    return block("agent_code_validation: verification receipt failed HMAC validation " +
      "(tampered or signed with the wrong key). Run /verify in a clean sandbox.");
  }
  const floor = settings.verification_quality_floors?.coverage_pct ?? 0;
  if (typeof receipt.verification_quality_score === "number" &&
      receipt.verification_quality_score < floor) {
    return block(`agent_code_validation: Verification-Quality Score ` +
      `${receipt.verification_quality_score} is below the floor ${floor}.`);
  }
  if ((receipt.mutation_score_delta ?? 0) < 0 || (receipt.property_count_delta ?? 0) < 0) {
    return block("agent_code_validation: verification regressed " +
      "(mutation-score-delta or property-count-delta is negative).");
  }
  allow();
}

try { main(); } catch (e) {
  // A Stop hook that errors must not wedge the session — surface and allow.
  process.stderr.write(`[stop] ${e?.stack || e}\n`);
  allow();
}
