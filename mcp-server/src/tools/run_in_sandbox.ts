// run_in_sandbox tool — foundational sandbox primitive
// Spec: component "MCP Server — acv-mcp" / phase 2.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import type { McpTool } from "../types.js";
import { resolveProvider } from "../providers/index.js";
import { log, digest } from "../provenance.js";

const InputSchema = z.object({
  code: z.string(),  // source code to execute
  language: z.enum(["python", "typescript", "javascript", "rust", "go"]),  // runtime
  timeout_s: z.number().optional().default(30),  // hard wall-clock timeout
  allowlist: z.array(z.string()).optional(),  // extra files to mount read-only
});

export const runInSandboxTool: McpTool = {
  name: "run_in_sandbox",
  description: "Execute code in an isolated sandbox (E2B/Daytona/Modal/local). Returns stdout/stderr/exit/timing.",
  inputSchema: {
    type: "object",
    properties: {
      "code": {
        "type": "string",
        "description": "source code to execute"
      },
      "language": {
        "type": "string",
        "enum": ["python", "typescript", "javascript", "rust", "go"],
        "description": "runtime"
      },
      "timeout_s": {
        "type": "number",
        "description": "hard wall-clock timeout"
      },
      "allowlist": {
        "type": "array",
        "items": { "type": "string" },
        "description": "extra files to mount read-only"
      }
    },
    required: ["code", "language"],
  },
  async handler(args) {
    const parsed: z.infer<typeof InputSchema> = InputSchema.parse(args);
    const { code, language, timeout_s, allowlist } = parsed;
    const args_digest = digest(parsed);
    const session_id = process.env.ACV_SESSION_ID ?? "unknown";

    // Resolve the sandbox provider (cached after first call).
    let provider: Awaited<ReturnType<typeof resolveProvider>>;
    try {
      provider = await resolveProvider();
    } catch (err) {
      const errorResult = { error: "sandbox_failed", reason: String(err) };
      await log({
        session_id,
        subagent: null,
        hook: null,
        skill: null,
        tool: "run_in_sandbox",
        sandbox_id: null,
        args_digest,
        result_digest: digest(errorResult),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(errorResult, null, 2) }],
      };
    }

    // Spawn a sandbox for this execution.
    let sandbox: Awaited<ReturnType<typeof provider.spawn>>;
    try {
      sandbox = await provider.spawn({ language, timeout_s });
    } catch (err) {
      const errorResult = { error: "sandbox_failed", reason: String(err) };
      await log({
        session_id,
        subagent: null,
        hook: null,
        skill: null,
        tool: "run_in_sandbox",
        sandbox_id: null,
        args_digest,
        result_digest: digest(errorResult),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(errorResult, null, 2) }],
      };
    }

    try {
      // Handle allowlist: copy each file's content into the sandbox dir.
      // TODO(Phase 3): true read-only mount via provider; current implementation copies
      // into sandbox dir which means user code could modify the copy.
      if (allowlist && allowlist.length > 0) {
        for (const filePath of allowlist) {
          let content: string;
          try {
            content = readFileSync(filePath, "utf-8");
          } catch (err) {
            const errorResult = {
              error: "allowlist_error",
              reason: `Failed to read allowlist file '${filePath}': ${String(err)}`,
            };
            await log({
              session_id,
              subagent: null,
              hook: null,
              skill: null,
              tool: "run_in_sandbox",
              sandbox_id: sandbox.id,
              args_digest,
              result_digest: digest(errorResult),
            });
            return {
              content: [{ type: "text", text: JSON.stringify(errorResult, null, 2) }],
            };
          }
          await sandbox.writeFile(basename(filePath), content);
        }
      }

      // Run the user's code.
      let runResult: Awaited<ReturnType<typeof sandbox.run>>;
      try {
        runResult = await sandbox.run(code);
      } catch (err) {
        const errorResult = { error: "sandbox_failed", reason: String(err) };
        await log({
          session_id,
          subagent: null,
          hook: null,
          skill: null,
          tool: "run_in_sandbox",
          sandbox_id: sandbox.id,
          args_digest,
          result_digest: digest(errorResult),
        });
        return {
          content: [{ type: "text", text: JSON.stringify(errorResult, null, 2) }],
        };
      }

      // Build the structured response.
      const responseData = {
        sandbox_id: sandbox.id,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        exit_code: runResult.exit_code,
        duration_ms: runResult.duration_ms,
      };

      const result = {
        content: [{ type: "text" as const, text: JSON.stringify(responseData, null, 2) }],
      };

      // Log the successful operation.
      await log({
        session_id,
        subagent: null,
        hook: null,
        skill: null,
        tool: "run_in_sandbox",
        sandbox_id: sandbox.id,
        args_digest,
        result_digest: digest(result),
      });

      return result;
    } finally {
      // Always dispose the sandbox, even on error.
      try {
        await sandbox.dispose();
      } catch (disposeErr) {
        console.error(
          `[run_in_sandbox] sandbox.dispose() failed for ${sandbox.id}: ${String(disposeErr)}`
        );
      }
    }
  },
};
