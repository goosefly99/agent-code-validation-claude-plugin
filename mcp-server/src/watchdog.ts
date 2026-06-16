// AST-based Reward-Hacking Watchdog (T5 mitigation).
//
// JS/TS: parsed with @babel/parser, walked with a dependency-free recursive
// visitor (we deliberately avoid @babel/traverse — not a dependency). Invalid
// syntax yields a low-severity `parse-failure` finding.
// Python: no AST lib available on the host, so we use conservative source
// heuristics (favor precision; PostToolUse blocks are feedback, not vetoes).

import { parse as parseBabel } from "@babel/parser";

export type WatchdogFinding = {
  rule: string;
  severity: "low" | "medium" | "high";
  snippet: string;
  explanation: string;
};

// ── JS / TS ──────────────────────────────────────────────────────────────────

function walk(node: unknown, visit: (n: any) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const c of node) walk(c, visit); return; }
  const n = node as any;
  if (typeof n.type === "string") visit(n);
  for (const k of Object.keys(n)) {
    if (k === "loc" || k === "start" || k === "end" || k === "range" ||
        k === "leadingComments" || k === "trailingComments" || k === "comments" || k === "tokens") continue;
    walk(n[k], visit);
  }
}

function memberName(node: any): string {
  // best-effort dotted name for a MemberExpression / Identifier
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const obj = memberName(node.object);
    const prop = node.computed ? "" : memberName(node.property);
    return obj && prop ? `${obj}.${prop}` : (obj || prop);
  }
  return "";
}

export function analyzeJs(source: string): WatchdogFinding[] {
  const findings: WatchdogFinding[] = [];
  let ast: unknown;
  try {
    ast = parseBabel(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (e) {
    return [{ rule: "parse-failure", severity: "low", snippet: "", explanation: String(e) }];
  }
  const TAMPER_TARGETS = new Set([
    "assert", "console.assert", "require.cache", "module._cache",
    "global.assert", "globalThis.assert",
  ]);
  walk(ast, (n) => {
    if (n.type === "CallExpression" || n.type === "NewExpression") {
      const callee = memberName(n.callee);
      if (callee === "eval" || callee === "Function") {
        findings.push({
          rule: "dynamic-eval", severity: "high", snippet: callee,
          explanation: `calls ${callee}() to execute dynamically constructed code (assertion-bypass risk)`,
        });
      } else if (/\.(skip|only)$/.test(callee)) {
        findings.push({
          rule: "test-skip-injection", severity: "high", snippet: callee,
          explanation: `injects ${callee}() to skip or narrow tests`,
        });
      }
    }
    if (n.type === "AssignmentExpression") {
      const target = memberName(n.left);
      if (TAMPER_TARGETS.has(target) || /(^|\.)assert$/.test(target)) {
        findings.push({
          rule: "assertion-tamper", severity: "high", snippet: target,
          explanation: `assigns to ${target}, which can disable assertions or runtime checks`,
        });
      }
    }
  });
  return findings;
}

// ── Python (heuristics) ──────────────────────────────────────────────────────

function stripPyComments(line: string): string {
  // naive: drop everything after an unquoted '#'. Good enough for detection.
  let out = "";
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { out += c; if (c === q && line[i - 1] !== "\\") q = null; continue; }
    if (c === "'" || c === '"') { q = c; out += c; continue; }
    if (c === "#") break;
    out += c;
  }
  return out;
}

const TRIVIAL_RETURN = /^return\s+(\[\s*\]|\{\s*\}|None|True|False|-?\d+(\.\d+)?|""|''|\(\s*\))\s*$/;

export function analyzePython(source: string): WatchdogFinding[] {
  const findings: WatchdogFinding[] = [];
  const code = source.replace(/\r\n/g, "\n");

  // 1) eval/exec on dynamically constructed code
  const evalM = code.match(/\b(eval|exec)\s*\(/);
  if (evalM) {
    findings.push({
      rule: "dynamic-eval", severity: "high", snippet: evalM[0],
      explanation: "uses eval()/exec() to execute dynamically constructed code (assertion-bypass risk)",
    });
  }

  // 2) monkeypatching builtins / assertion primitives
  if (/\bbuiltins\s*\.\s*\w+\s*=/.test(code) || /\b__builtins__\s*\[/.test(code)) {
    findings.push({
      rule: "assertion-tamper", severity: "high", snippet: "builtins.<attr> =",
      explanation: "monkeypatches builtins (e.g. builtins.assert), disabling runtime assertions",
    });
  }
  if (/\bunittest\b[^\n]*\.assert\w*\s*=/.test(code) || /\bsys\.modules\[[^\]]+\]\s*=/.test(code)) {
    findings.push({
      rule: "assertion-tamper", severity: "high", snippet: "assertion/module override",
      explanation: "overrides assertion methods or sys.modules entries to weaken verification",
    });
  }

  // 3) degenerate implementation: a def that takes args but whose body is a
  //    single trivial constant return (ignores its inputs).
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)def\s+\w+\s*\(([^)]*)\)\s*:/);
    if (!m) continue;
    const indent = m[1].length;
    const params = m[2].replace(/self\s*,?\s*/, "").trim();
    if (!/\w/.test(params)) continue; // no real params → not "ignoring inputs"
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (raw.trim() === "") continue;
      const lineIndent = raw.length - raw.trimStart().length;
      if (lineIndent <= indent) break; // dedent → end of function body
      const stmt = stripPyComments(raw).trim();
      if (stmt) body.push(stmt);
    }
    if (body.length === 1 && TRIVIAL_RETURN.test(body[0])) {
      findings.push({
        rule: "degenerate-impl", severity: "high", snippet: body[0],
        explanation: "degenerate implementation: function returns a constant empty/trivial value while ignoring its arguments",
      });
    }
  }

  return findings;
}
