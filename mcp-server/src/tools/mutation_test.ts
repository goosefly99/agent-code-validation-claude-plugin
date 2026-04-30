// mutation_test tool — unified mutant descriptor output
// Spec: component "MCP Server — acv-mcp" / phase 4.

import { z } from "zod";
import type { McpTool } from "../types.js";

const InputSchema = z.object({
  paths: z.array(z.string()),  // source paths to mutate
  backend: z.enum(["auto", "stryker", "mutmut", "cargo-mutants", "mutahunter"]).optional().default("auto"),  // backend selection
  incremental: z.boolean().optional().default(true),  // touched-files-only (git diff)
});

export const mutationTestTool: McpTool = {
  name: "mutation_test",
  description: "Run mutation testing on target paths. Auto-selects Stryker (JS/TS) / mutmut (Python) / cargo-mutants (Rust) / Mutahunter.",
  inputSchema: {
    type: "object",
    properties: {
      "paths": {
        "type": "array",
        "items": { "type": "string" },
        "description": "source paths to mutate"
      },
      "backend": {
        "type": "string",
        "enum": ["auto", "stryker", "mutmut", "cargo-mutants", "mutahunter"],
        "description": "backend selection"
      },
      "incremental": {
        "type": "boolean",
        "description": "touched-files-only (git diff)"
      }
    },
    required: ["paths"],
  },
  async handler(args) {
    const parsed: z.infer<typeof InputSchema> = InputSchema.parse(args);
    // TODO(Phase 4): shell out to backend CLI, parse JSON output, normalize to unified descriptor: {id, origin_path, span, operator, status, backend}.
    return {
      content: [
        { type: "text", text: JSON.stringify({ status: "not_implemented", parsed }, null, 2) },
      ],
    };
  },
};
