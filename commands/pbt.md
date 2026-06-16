---
name: pbt
description: Run PBT-Bug-Hunter against a target; return validated bugs
---

# /pbt

**Usage:** `/pbt <module or function path>`

Run PBT-Bug-Hunter against a target; return validated bugs.

## What happens

1. Invoke the `pbt-bug-hunter` subagent with target + thoroughness=quick
2. Subagent runs ghostwriter + Hypothesis + reflection loop
3. Output: list of validated bugs with reproducing seeds
4. If zero bugs at quick, prompt user: 'escalate to standard (slower, broader)?'

## Related

- Subagents / skills invoked: see steps above
- Spec: component "Commands" in `spec/acv_spec_v2_1.json`
