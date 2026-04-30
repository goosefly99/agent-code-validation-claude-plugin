// infer_properties tool — signature → property template mapping
// Spec: component "MCP Server — acv-mcp" / phase 4.

import { z } from "zod";
import type { McpTool } from "../types.js";

const InputSchema = z.object({
  signature: z.string(),  // function signature (type-annotated preferred)
  docstring: z.string().optional(),  // docstring for additional hints
});

export const inferPropertiesTool: McpTool = {
  name: "infer_properties",
  description: "Infer candidate Hypothesis ghostwriter templates from signature + docstring. Returns ordered list.",
  inputSchema: {
    type: "object",
    properties: {
            "signature": {
                  "type": "string",
                  "description": "function signature (type-annotated preferred)"
            },
            "docstring": {
                  "type": "string",
                  "description": "docstring for additional hints"
            }
      },
    required: ["signature"],
  },
  async handler(args) {
    const parsed: z.infer<typeof InputSchema> = InputSchema.parse(args);
    // TODO(Phase 4): map signature shape to ghostwriter templates {magic, fuzz, idempotent, roundtrip, equivalent, binary_operation, ufunc}. `--errors-equivalent` is a mode on `equivalent`, not a separate template.
    return {
      content: [
        { type: "text", text: JSON.stringify({ status: "not_implemented", parsed }, null, 2) },
      ],
    };
  },
};
