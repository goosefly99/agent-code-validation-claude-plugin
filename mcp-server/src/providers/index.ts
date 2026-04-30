import * as e2b from "./e2b.js";
import * as daytona from "./daytona.js";
import * as modal from "./modal.js";
import * as docker from "./docker.js";
import * as localSubprocess from "./local_subprocess.js";

export type ProviderId = "e2b" | "daytona" | "modal" | "docker" | "local";

export interface SandboxProvider {
  id: ProviderId;
  spawn(opts: { language: string; timeout_s: number }): Promise<Sandbox>;
}

export interface Sandbox {
  id: string;
  run(code: string): Promise<{ stdout: string; stderr: string; exit_code: number; duration_ms: number }>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDER: ProviderId = "local";

const REGISTRY: Record<ProviderId, { provider: SandboxProvider; health: () => Promise<boolean> }> = {
  e2b: { provider: e2b.provider, health: e2b._health },
  daytona: { provider: daytona.provider, health: daytona._health },
  modal: { provider: modal.provider, health: modal._health },
  docker: { provider: docker.provider, health: docker._health },
  local: { provider: localSubprocess.provider, health: localSubprocess._health },
};

// ---------------------------------------------------------------------------
// Resolver cache
// ---------------------------------------------------------------------------

let _cachedProvider: SandboxProvider | null = null;

/** Clear the resolver cache. Intended for use in tests only. */
export function resetResolverCache(): void {
  _cachedProvider = null;
}

// ---------------------------------------------------------------------------
// resolveProvider
// ---------------------------------------------------------------------------

/**
 * Return the first healthy provider per the preference order defined by
 * the ACV_SANDBOX_PROVIDER_PREFERENCE environment variable.
 *
 * Defaults to "local" when the env var is unset or empty (e2b/daytona/modal
 * are stubs that always return false from _health()).
 *
 * Throws if no provider in the preference list passes its health check.
 */
export async function resolveProvider(): Promise<SandboxProvider> {
  // Return cached provider on subsequent calls.
  if (_cachedProvider !== null) {
    return _cachedProvider;
  }

  // Parse preference list.
  const raw = process.env.ACV_SANDBOX_PROVIDER_PREFERENCE ?? "";
  const trimmed = raw.trim();
  const prefList = trimmed.length > 0
    ? trimmed.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    : [DEFAULT_PROVIDER];

  // tried entries are formatted as "name" or "name (unknown)" for diagnostics.
  const tried: string[] = [];

  for (const name of prefList) {
    const entry = (REGISTRY as Record<string, { provider: SandboxProvider; health: () => Promise<boolean> }>)[name];
    if (entry === undefined) {
      tried.push(`${name} (unknown)`);
      console.error(JSON.stringify({ event: "provider_unknown", provider: name, ts: new Date().toISOString() }));
      continue;
    }

    let ok: boolean;
    try {
      ok = await entry.health();
    } catch {
      ok = false;
    }

    tried.push(ok ? name : `${name} (unhealthy)`);

    console.error(JSON.stringify({ event: "provider_health_check", provider: name, ok, ts: new Date().toISOString() }));

    if (ok) {
      console.error(JSON.stringify({ event: "provider_resolved", provider: name, ts: new Date().toISOString() }));
      _cachedProvider = entry.provider;
      return _cachedProvider;
    }
  }

  throw new Error(
    `acv-mcp: no sandbox provider available. Tried: [${tried.join(", ")}]. ` +
      "Set ACV_SANDBOX_PROVIDER_PREFERENCE=e2b,local or fix runtime availability."
  );
}
