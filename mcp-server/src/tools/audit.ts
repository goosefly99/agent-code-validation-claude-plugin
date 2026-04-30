// audit tool — read Auditor receipts
// Spec: component "MCP Server — acv-mcp" / phase 3.

import { z } from "zod";
import type { McpTool } from "../types.js";

const InputSchema = z.object({
  session_id: z.string().optional(),  // defaults to current session
});

export const auditTool: McpTool = {
  name: "audit",
  description: "Return the most recent Auditor evidence + Verification-Quality Score for the current session.",
  inputSchema: {
    type: "object",
    properties: {
            "session_id": {
                  "type": "string",
                  "description": "defaults to current session"
            }
      },
    required: [],
  },
  async handler(args) {
    const parsed: z.infer<typeof InputSchema> = InputSchema.parse(args);
    // TODO(Phase 3): read .acv/receipts/*.json, verify HMAC signatures, return composite verdict.
    return {
      content: [
        { type: "text", text: JSON.stringify({ status: "not_implemented", parsed }, null, 2) },
      ],
    };
  },
};
