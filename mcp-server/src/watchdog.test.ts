import { describe, it, expect } from "vitest";
import { analyzeJs, analyzePython } from "./watchdog.js";
import type { WatchdogFinding } from "./watchdog.js";

// ---------------------------------------------------------------------------
// analyzeJs()
// ---------------------------------------------------------------------------

describe("analyzeJs()", () => {
  it("returns empty findings for clean, valid JavaScript", () => {
    const findings = analyzeJs("const x = 1;");
    expect(findings).toEqual([]);
  });

  it("returns empty findings for an empty string", () => {
    const findings = analyzeJs("");
    expect(findings).toEqual([]);
  });

  it("returns empty findings for a multi-statement clean snippet", () => {
    const findings = analyzeJs(`
      function add(a, b) { return a + b; }
      const result = add(1, 2);
      console.log(result);
    `);
    expect(findings).toEqual([]);
  });

  it("returns empty findings for valid TypeScript (tsx plugin active)", () => {
    const findings = analyzeJs(`
      const greet = (name: string): string => \`Hello, \${name}\`;
      export default greet;
    `);
    expect(findings).toEqual([]);
  });

  it("returns empty findings for valid JSX", () => {
    const findings = analyzeJs(`
      function App() { return <div className="app">Hello</div>; }
    `);
    expect(findings).toEqual([]);
  });

  it("returns parse-failure finding for invalid syntax", () => {
    const findings = analyzeJs("this is not js {[}");
    expect(findings.length).toBeGreaterThan(0);

    const failure = findings.find((f: WatchdogFinding) => f.rule === "parse-failure");
    expect(failure).toBeDefined();
    expect(failure!.severity).toBe("low");
  });

  it("parse-failure finding includes explanation with parse error info", () => {
    const findings = analyzeJs("!@#$%^&*(");
    const failure = findings.find((f: WatchdogFinding) => f.rule === "parse-failure");
    expect(failure).toBeDefined();
    // explanation must be a non-empty string (the stringified SyntaxError)
    expect(failure!.explanation.length).toBeGreaterThan(0);
  });

  it("parse-failure finding has an empty snippet field", () => {
    const findings = analyzeJs("{{{{");
    const failure = findings.find((f: WatchdogFinding) => f.rule === "parse-failure");
    expect(failure).toBeDefined();
    expect(failure!.snippet).toBe("");
  });

  it("returns empty findings for a well-formed async function", () => {
    const findings = analyzeJs(`
      async function fetchData(url) {
        const res = await fetch(url);
        return res.json();
      }
    `);
    expect(findings).toEqual([]);
  });

  // NOTE: The following patterns (eval, assert reassignment, .skip/.only injection)
  // are listed as TODO(Phase 3) in watchdog.ts and are NOT yet detected.
  // These tests document the CURRENT (stub) behavior — they must be updated when
  // Phase 3 rules are implemented.

  it("(Phase 3 stub) does NOT yet flag eval() calls", () => {
    const findings = analyzeJs(`eval("process.exit(0)");`);
    // Current behavior: no findings (stub). Phase 3 should flip this.
    expect(findings).toEqual([]);
  });

  it("(Phase 3 stub) does NOT yet flag describe.skip injection", () => {
    const findings = analyzeJs(`describe.skip("all tests", () => { it("x", () => {}); });`);
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// analyzePython()
// ---------------------------------------------------------------------------

describe("analyzePython()", () => {
  it("is a stub — always returns empty findings", () => {
    expect(analyzePython("import os")).toEqual([]);
  });

  it("returns empty findings for any input (stub)", () => {
    expect(analyzePython("exec('import sys; sys.exit(0)')")).toEqual([]);
    expect(analyzePython("")).toEqual([]);
    expect(analyzePython("x = 1 + 1")).toEqual([]);
  });
});
