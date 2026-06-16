---
name: mutate
description: Run mutation testing on touched files; propose killing tests
---

# /mutate

**Usage:** `/mutate [paths...] [--full]`

Run mutation testing on touched files; propose killing tests.

## What happens

1. Default: incremental mode over `git diff`-touched files + direct importers
2. `--full`: full-baseline mutation run (slower, opt-in)
3. Auto-select backend: Stryker (JS/TS) / mutmut (Python) / cargo-mutants (Rust)
4. For every surviving mutant, invoke `mutation-hunter` subagent to propose killing tests
5. All proposed tests route through `test-author` filter pipeline
6. Return: mutation-score delta + accepted new tests

## Related

- Subagents / skills invoked: see steps above
- Spec: component "Commands" in `spec/acv_spec_v2_1.json`
