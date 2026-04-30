---
name: verify
description: Request an Auditor run on current session state (without waiting for Stop)
---

# /verify

**Usage:** `/verify`

Request an Auditor run on current session state (without waiting for Stop).

## What happens

1. Invoke the `auditor` subagent
2. Auditor checks out clean repo → pins tests/ + production → re-runs suite in isolated sandbox
3. Output: Verification-Quality Score + mutation-score-delta + property-count-delta
4. If verdict is SUSPICIOUS or FAIL, explain the specific dimension that failed

## Related

- Subagents / skills invoked: see steps above
- Spec: component "Commands" in `pipeline_mcp_data/specs/acv_spec_28e6911d_v2_1.json`
