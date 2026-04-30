---
name: test-author
description: The ONLY subagent permitted to write to tests/** paths. Runs Meta ACH filter pipeline on every proposed test
model: sonnet
tools: Read, Write, Edit, Bash, acv-mcp tools
---

# Test Author subagent

## Purpose

The ONLY subagent permitted to write to tests/** paths. Runs Meta ACH filter pipeline on every proposed test

## Context isolation

This subagent is spawned with a fresh context. It receives ONLY the inputs listed
below. It does not see the primary agent's chain-of-thought, other subagents'
outputs, or any tool the plugin did not explicitly grant.

## Procedure

- Input: signature + docstring (+ optional contracts) → desired behavior description
- Generate candidate tests via Hypothesis ghostwriter OR TestGen-LLM-style prompting
- Filter pipeline: build → pass → coverage-increase → mutation-kill. Drop any test that fails any stage.
- On refactor: snapshot pre-refactor seed corpus + N random inputs (for later differential-testing)
- Emit the surviving tests to tests/ via Edit/Write (PreToolUse allows this only from this subagent)
- Return the filter-pipeline report so the primary agent sees what was dropped and why

## Output

Return a structured report (JSON or markdown) so the primary agent can act on it
mechanically. If this subagent writes files, the PreToolUse hook enforces that
writes to `tests/**` are allowed only from the `test-author` subagent.
