---
name: objective-report
description: Collect a bounded snapshot of the current objective and render its progress and observable activity as one concise report.
level: molecule
includes: ["status-report/_atoms/snapshot-evidence/snapshot-evidence.md","status-report/_atoms/concise-report/concise-report.md"]
composes: ["status-report/_atoms/snapshot-evidence/snapshot-evidence.md","status-report/_atoms/concise-report/concise-report.md"]
used-by: ["status-report/SKILL.md"]
allowed-tools: ["execute","read"]
---

# Objective Report

## Required References

1. [Snapshot evidence](../../_atoms/snapshot-evidence/snapshot-evidence.md)
2. [Concise report](../../_atoms/concise-report/concise-report.md)

## Operation

1. Collect the snapshot with Snapshot evidence. Preserve the objective and
   reporting cutoff selected at invocation, source identifiers, and each
   unavailable or partial field.
2. Render it with Concise report. Do not promote weak evidence into exact
   figures to satisfy the formatter. If the representation is invalid, correct
   it from the same evidence or explicitly report the malformed-input failure.
3. Return the rendered report inline. A blocked task can still have a useful
   status report: include its known blocker under remaining work without
   choosing a new plan.

## Boundary

Collection and presentation are separate so a compact display cannot erase a
coverage limitation. This molecule observes one objective; it neither controls
the workers nor changes the underlying work.
