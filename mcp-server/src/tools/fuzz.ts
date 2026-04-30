// fuzz tool — Atheris + libFuzzer wrapper
// Spec: component "MCP Server — acv-mcp" / phase 6.

import { z } from "zod";
import type { McpTool } from "../types.js";

const InputSchema = z.object({
  target: z.string(),  // entry function or binary
  reference: z.string().optional(),  // reference impl for differential fuzzing
  budget_seconds: z.number().optional().default(60),  // time budget
});

export const fuzzTool: McpTool = {
  name: "fuzz",
  description: "Fuzz a target via Atheris / libFuzzer. If `reference` given, differential-fuzz vs that impl.",
  inputSchema: {
    type: "object",
    properties: {
            "target": {
                  "type": "string",
                  "description": "entry function or binary"
            },
            "reference": {
                  "type": "string",
                  "description": "reference impl for differential fuzzing"
            },
            "budget_seconds": {
                  "type": "number",
                  "description": "time budget"
            }
      },
    required: ["target"],
  },
  async handler(args) {
    const parsed: z.infer<typeof InputSchema> = InputSchema.parse(args);
    // TODO(Phase 6): shell out to Atheris, stream coverage + crashes; if reference impl supplied, diff outputs per input.
    return {
      content: [
        { type: "text", text: JSON.stringify({ status: "not_implemented", parsed }, null, 2) },
      ],
    };
  },
};
