---
name: tdd
description: Scaffold red-green-refactor TDD with per-phase subagent context isolation
---

# /tdd

**Usage:** `/tdd <feature description>`

Scaffold red-green-refactor TDD with per-phase subagent context isolation.

## What happens

1. Invoke the `tdd-red-green-refactor` skill
2. Spawn test-author subagent → failing test (red)
3. Wait for SubagentStop → Auditor confirms the test legitimately fails for the right reason
4. Spawn implementer subagent (fresh context) → passing impl (green)
5. Wait for SubagentStop → Auditor confirms test now passes + mutation/property baseline
6. Spawn refactor subagent → differential-testing preserves behavior

## Related

- Subagents / skills invoked: see steps above
- Spec: component "Commands" in `spec/acv_spec_v2_1.json`
