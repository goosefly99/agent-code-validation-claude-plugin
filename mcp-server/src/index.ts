// Entry point for acv-mcp. Registers every tool under src/tools/ and starts
// the stdio transport. Sandbox credentials are resolved once at boot and never
// surfaced as tool arguments (T1 mitigation).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { runInSandboxTool } from "./tools/run_in_sandbox.js";
import { pbtRunTool } from "./tools/pbt_run.js";
import { inferPropertiesTool } from "./tools/infer_properties.js";
import { mutationTestTool } from "./tools/mutation_test.js";
import { fuzzTool } from "./tools/fuzz.js";
import { diffTestTool } from "./tools/diff_test.js";
import { crosshairCheckTool } from "./tools/crosshair_check.js";
import { validateAgainstSchemaTool } from "./tools/validate_against_schema.js";
import { runInspectEvalTool } from "./tools/run_inspect_eval.js";
import { auditTool } from "./tools/audit.js";
import { initProvenance } from "./provenance.js";
import { initReceiptsKey } from "./receipts.js";

const TOOLS = [
  runInSandboxTool,
  pbtRunTool,
  inferPropertiesTool,
  mutationTestTool,
  fuzzTool,
  diffTestTool,
  crosshairCheckTool,
  validateAgainstSchemaTool,
  runInspectEvalTool,
  auditTool,
];

async function main() {
  await initProvenance(process.env.ACV_PROVENANCE_DIR ?? ".acv");
  await initReceiptsKey();

  const server = new Server(
    { name: "acv-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
    return await tool.handler(req.params.arguments ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
