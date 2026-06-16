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
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const receiptsDir = join(projectDir, ".acv", "receipts");
    let verdict: Record<string, unknown> = { status: "no_receipt" };
    try {
      const files = readdirSync(receiptsDir).filter((f) => f.endsWith(".json"));
      const target = parsed.session_id
        ? `${parsed.session_id}.json`
        : files.sort().at(-1);
      if (target && files.includes(target)) {
        const receipt = JSON.parse(readFileSync(join(receiptsDir, target), "utf-8"));
        const { verifyReceipt } = await import("../receipts.js");
        verdict = {
          status: "ok",
          receipt_valid: verifyReceipt(receipt),
          verification_quality_score: receipt.verification_quality_score,
          mutation_score_delta: receipt.mutation_score_delta,
          property_count_delta: receipt.property_count_delta,
        };
      }
    } catch (e) {
      verdict = { status: "error", error: String(e) };
    }
    return { content: [{ type: "text", text: JSON.stringify(verdict, null, 2) }] };
  },
};
