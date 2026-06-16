#!/usr/bin/env node
// Smoke test: the .mcp.json launch path. Pipes an MCP initialize + tools/list
// handshake into the built stdio server and asserts all 10 tools answer.
// Run: node tests/smoke/mcp_handshake.mjs  (after `npm -w mcp-server run build`)

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const server = join(root, "mcp-server", "dist", "index.js");
const EXPECTED = [
  "run_in_sandbox", "pbt_run", "infer_properties", "mutation_test", "fuzz",
  "diff_test", "crosshair_check", "validate_against_schema", "run_inspect_eval", "audit",
];

const proc = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "inherit"] });
const send = (o) => proc.stdin.write(JSON.stringify(o) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

let buf = "";
const timer = setTimeout(() => { console.error("FAIL: timed out"); proc.kill(); process.exit(1); }, 15000);
proc.stdout.on("data", (d) => {
  buf += d.toString();
  for (const line of buf.split("\n")) {
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 2) {
      clearTimeout(timer);
      const names = (msg.result?.tools ?? []).map((t) => t.name).sort();
      const missing = EXPECTED.filter((n) => !names.includes(n));
      proc.kill();
      if (missing.length) { console.error("FAIL: missing tools", missing); process.exit(1); }
      console.log("PASS: handshake returned all 10 tools");
      process.exit(0);
    }
  }
});
proc.on("error", (e) => { console.error("FAIL: spawn error", e); process.exit(1); });
