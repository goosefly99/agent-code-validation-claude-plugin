// Shared library for agent_code_validation hooks.
// Single source of truth for: opt-in detection, project-dir resolution,
// gitignore management, settings, and the (correct) test-path matcher.
//
// Design notes:
//  - The plugin is OPT-IN. Nothing is written into a user's repo until the
//    project is activated by the presence of `acv.config.json`. This is the
//    fix for the "litters .acv into every project" complaint.
//  - When active, runtime state lives under a gitignored `.acv/`. We append
//    `.acv/` to the project .gitignore BEFORE writing the signing key, so the
//    HMAC key can never land in a tracked location.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Mirrors settings.json:test_path_allowlist. Kept here so hooks have a correct
// default even if settings.json is unreadable.
export const DEFAULT_TEST_ALLOWLIST = [
  "tests/**",
  "test/**",
  "spec/**",
  "**/*_test.go",
  "**/test_*.py",
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/*.test.js",
  "**/*.spec.js",
];

// ── glob matching ────────────────────────────────────────────────────────────

const _globCache = new Map();

/** Compile a (subset) glob to an anchored RegExp. Supports ** , * , and literals. */
function globToRegExp(glob) {
  const cached = _globCache.get(glob);
  if (cached) return cached;

  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?"; // **/ → zero or more leading path segments
        } else {
          re += ".*"; // ** → anything, including slashes
        }
      } else {
        re += "[^/]*"; // * → anything except a slash
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  re += "$";
  const compiled = new RegExp(re);
  _globCache.set(glob, compiled);
  return compiled;
}

/**
 * True if `relPath` is a test file per the allowlist globs.
 * Normalises Windows backslashes. Replaces the broken anchored regex in the
 * old pre_tool_use.mjs that let `tests/foo.py` through.
 */
export function isTestPath(relPath, allowlist = DEFAULT_TEST_ALLOWLIST) {
  const p = String(relPath).replace(/\\/g, "/");
  return allowlist.some((g) => globToRegExp(g).test(p));
}

// ── project dir / activation ─────────────────────────────────────────────────

/** The project root. Claude Code injects CLAUDE_PROJECT_DIR into hook/server env. */
export function resolveProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

export function acvDir(projectDir = resolveProjectDir()) {
  return join(projectDir, ".acv");
}

/**
 * The plugin is active for a project iff `acv.config.json` exists and does not
 * set `enabled: false`. A present-but-unparseable config counts as opted-in
 * (the user created the file = intent); we fail open toward "active" only when
 * the file exists.
 */
export function isActivated(projectDir = resolveProjectDir()) {
  const cfgPath = join(projectDir, "acv.config.json");
  if (!existsSync(cfgPath)) return false;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    return cfg.enabled !== false;
  } catch {
    return true;
  }
}

// ── gitignore management ─────────────────────────────────────────────────────

/** Idempotently ensure `.acv/` is in the project's .gitignore. Never throws. */
export function ensureGitignored(projectDir = resolveProjectDir()) {
  const giPath = join(projectDir, ".gitignore");
  try {
    let content = existsSync(giPath) ? readFileSync(giPath, "utf-8") : "";
    const hasEntry = content
      .split(/\r?\n/)
      .some((line) => line.trim() === ".acv/" || line.trim() === ".acv");
    if (hasEntry) return;
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += "# agent_code_validation runtime state (auto-added)\n.acv/\n";
    writeFileSync(giPath, content, "utf-8");
  } catch {
    // Best-effort: never block a session on gitignore housekeeping.
  }
}

// ── settings ─────────────────────────────────────────────────────────────────

/**
 * Merge plugin defaults (CLAUDE_PLUGIN_ROOT/settings.json) with per-project
 * overrides (acv.config.json). Never throws; always returns an object with at
 * least `test_path_allowlist`.
 */
export function readSettings(projectDir = resolveProjectDir()) {
  let settings = {};
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    try {
      settings = JSON.parse(readFileSync(join(pluginRoot, "settings.json"), "utf-8"));
    } catch {
      /* defaults below */
    }
  }
  try {
    const cfg = JSON.parse(readFileSync(join(projectDir, "acv.config.json"), "utf-8"));
    settings = { ...settings, ...cfg };
  } catch {
    /* no project overrides */
  }
  if (!Array.isArray(settings.test_path_allowlist)) {
    settings.test_path_allowlist = DEFAULT_TEST_ALLOWLIST;
  }
  return settings;
}
