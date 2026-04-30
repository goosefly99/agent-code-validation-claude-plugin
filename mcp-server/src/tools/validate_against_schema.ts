// validate_against_schema tool — runtime type validation
// Spec: component "MCP Server — acv-mcp" / phase 5.

import { z } from "zod";
import type { McpTool } from "../types.js";

const InputSchema = z.object({
  value: z.any(),  // JSON value to validate
  schema: z.any(),  // schema (JSON Schema 2020-12 or Pydantic export or zod export)
  schema_kind: z.enum(["jsonschema", "pydantic", "zod"]).optional().default("jsonschema"),  // schema dialect
});

export const validateAgainstSchemaTool: McpTool = {
  name: "validate_against_schema",
  description: "Validate a JSON value against a Pydantic / zod / JSON Schema definition.",
  inputSchema: {
    type: "object",
    properties: {
      "value": {
        "description": "JSON value to validate"
      },
      "schema": {
        "description": "schema (JSON Schema 2020-12 or Pydantic export or zod export)"
      },
      "schema_kind": {
        "type": "string",
        "enum": ["jsonschema", "pydantic", "zod"],
        "description": "schema dialect"
      }
    },
    required: ["value", "schema"],
  },
  async handler(args) {
    const parsed: z.infer<typeof InputSchema> = InputSchema.parse(args);
    // TODO(Phase 5): accept schema in one of {pydantic-json, zod-json, jsonschema}; return {valid, errors[]}.
    return {
      content: [
        { type: "text", text: JSON.stringify({ status: "not_implemented", parsed }, null, 2) },
      ],
    };
  },
};
