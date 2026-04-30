export type McpTool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[] };
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string } | { type: string; [k: string]: unknown }>;
  }>;
};

export type VerificationReceipt = {
  receipt_id: string;
  session_id: string;
  sandbox_id: string;
  seed: number;
  test_counts: { run: number; passed: number; failed: number; skipped: number };
  mutation_score: number | null;
  property_count: number | null;
  verification_quality_score: number;
  mutation_score_delta: number | null;
  property_count_delta: number | null;
  timings: { total_ms: number; per_suite_ms: Record<string, number> };
  created_at: string;
  signature: string; // HMAC-SHA256 over canonical JSON of all other fields
};

export type ProvenanceEntry = {
  ts: string;
  session_id: string;
  subagent: string | null;
  hook: string | null;
  skill: string | null;
  tool: string;
  sandbox_id: string | null;
  args_digest: string;
  result_digest: string;
};
