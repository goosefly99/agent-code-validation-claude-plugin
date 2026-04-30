// AST-based Reward-Hacking Watchdog (T5 mitigation).
// Static regex rulesets are bypassable via eval / importlib / sys.modules writes;
// this module parses the edited content and flags semantic patterns instead.

import { parse as parseBabel } from "@babel/parser";

export type WatchdogFinding = {
  rule: string;
  severity: "low" | "medium" | "high";
  snippet: string;
  explanation: string;
};

export function analyzeJs(source: string): WatchdogFinding[] {
  const findings: WatchdogFinding[] = [];
  try {
    const ast = parseBabel(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
    // TODO(Phase 3): walk ast and detect:
    //   - CallExpression to eval / Function
    //   - Assignments to `assert`, `console`, `require.cache`, `module._cache`
    //   - Decorator injection that silences assertions
    //   - `.skip()` or `.only()` added to describe/it/test
    void ast;
  } catch (e) {
    findings.push({ rule: "parse-failure", severity: "low", snippet: "", explanation: String(e) });
  }
  return findings;
}

export function analyzePython(source: string): WatchdogFinding[] {
  // TODO(Phase 3): shell out to a tiny Python helper that uses `ast` module and
  // prints findings as JSON — easier than reimplementing Python AST in TS.
  void source;
  return [];
}
