/**
 * Smoke test — end-to-end MCP tool round-trip for run_in_sandbox via local provider.
 *
 * Run from the repo root:
 *   node tests/smoke/e2e_run_in_sandbox.mjs
 *
 * Exits 0 on PASS, 1 on FAIL.
 */

import { runInSandboxTool } from "../../mcp-server/dist/tools/run_in_sandbox.js";
import { initProvenance } from "../../mcp-server/dist/provenance.js";

await initProvenance("./.acv");

const result = await runInSandboxTool.handler({
  code: "console.log(JSON.stringify({ok: true, lang: 'js'}))",
  language: "javascript",
  timeout_s: 5,
});

const text = result.content[0].text;
const parsed = JSON.parse(text);

if (parsed.exit_code !== 0) {
  console.error("FAIL: non-zero exit");
  process.exit(1);
}
if (!parsed.stdout.includes('"ok":true')) {
  console.error("FAIL: stdout missing");
  process.exit(1);
}
console.log("PASS: " + parsed.stdout.trim());
