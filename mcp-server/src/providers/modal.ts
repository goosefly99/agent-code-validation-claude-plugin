// gVisor, optimized for ML/GPU workloads.
// Spec: components "MCP Server — acv-mcp" + risks T1 (cred isolation).

import type { SandboxProvider } from "./index.js";

export const provider: SandboxProvider = {
  id: "modal",
  async spawn(_opts) {
    // TODO(Phase 4+): implement. Phase 2 ships local provider only; cloud providers
    // are deferred until PBT/mutation campaigns benefit from managed sandbox isolation.
    throw new Error("modal: not implemented");
  },
};

export async function _health(): Promise<boolean> {
  // TODO(Phase 4+): ping provider / check binary availability.
  return false;
}
