#!/usr/bin/env node
// PreCompact — refuse compaction while unresolved SUSPICIOUS verdicts exist,
// because compaction would drop the evidence the user needs to fix them.
// Opt-in gated; honors settings.pre_compact_block_on_suspicious.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isActivated, resolveProjectDir, acvDir, readSettings } from "./_lib/acv.mjs";

JSON.parse(readFileSync(0, "utf-8")); // consume the event

function main() {
  const projectDir = resolveProjectDir();
  if (!isActivated(projectDir)) { console.log(JSON.stringify({})); return; }
  const settings = readSettings(projectDir);
  if (settings.pre_compact_block_on_suspicious === false) { console.log(JSON.stringify({})); return; }

  const findingsPath = join(acvDir(projectDir), "findings.jsonl");
  if (existsSync(findingsPath)) {
    const unresolved = readFileSync(findingsPath, "utf-8").split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((f) => f && f.resolved === false);
    if (unresolved.length) {
      console.log(JSON.stringify({ decision: "block",
        reason: `agent_code_validation: ${unresolved.length} unresolved SUSPICIOUS finding(s); ` +
          `compaction would drop this evidence. Resolve them first.` }));
      return;
    }
  }
  console.log(JSON.stringify({}));
}
try { main(); } catch { console.log(JSON.stringify({})); }
