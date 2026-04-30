// run_inspect_eval tool — Inspect AI via Sandbox-Runner
// Spec: component "MCP Server — acv-mcp" / phase 7.

import { z } from "zod";
import type { McpTool } from "../types.js";

const InputSchema = z.object({
  task: z.string(),  // Inspect AI task file or module:function
  sandbox: z.string().optional(),  // sandbox provider override
});

export const runInspectEvalTool: McpTool = {
  name: "run_inspect_eval",
  description: "Delegate Inspect AI eval to Sandbox-Runner subagent (subprocess). Engineering choice — Inspect does support in-process eval() but we isolate for stdio/sandbox separation.",
  inputSchema: {
    type: "object",
    properties: {
            "task": {
                  "type": "string",
                  "description": "Inspect AI task file or module:function"
            },
            "sandbox": {
                  "type": "string",
                  "description": "sandbox provider override"
            }
      },
    required: ["task"],
  },
  async handler(args) {
    const parsed: z.infer<typeof InputSchema> = InputSchema.parse(args);
    // TODO(Phase 7): send campaign spec to Sandbox-Runner, poll status, marshal final report back.
    return {
      content: [
        { type: "text", text: JSON.stringify({ status: "not_implemented", parsed }, null, 2) },
      ],
    };
  },
};
