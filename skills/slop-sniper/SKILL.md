---
name: slop-sniper
description: Audit one bounded snapshot of active multi-agent orchestration for evidence-backed coordination defects and return one parent-owned correction. Use when a human asks whether current agent work is drifting, duplicating, stale, retrying without new evidence, laundering state, crossing privacy boundaries, or repairing a shared root locally, or when an explicitly invoked orchestrator dispatches a fresh checkpoint audit. Do not use for code review, artifact review, post-mortems, status-only reporting, fleet ownership, remediation, mutation, or continuous monitoring.
allowed-tools: ["execute","read","task"]
includes: ["_base/_molecules/chronicler/chronicler.md","slop-sniper/_molecules/orchestration-audit/orchestration-audit.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","slop-sniper/_molecules/orchestration-audit/orchestration-audit.md"]
disable-model-invocation: true
user-invocable: true
requires-skills: []
---

# Slop Sniper

Judge whether one observed orchestration snapshot contains evidence-backed
process defects, then route the smallest safe correction to the workflow that
already owns the work.

```text
one checkpoint -> one sealed snapshot -> one fresh audit -> one parent-owned correction
```

## Required References

1. [Chronicler recording molecule](../_base/_molecules/chronicler/chronicler.md)
2. [Orchestration audit](./_molecules/orchestration-audit/orchestration-audit.md)

## Core Workflow

1. Reuse the caller's Chronicler context, or create one when explicitly invoked
   as the root skill. Record snapshot intake, specialist dispatch, report
   validation, and final status. Recording is best effort and grants no
   remediation authority.

2. Accept exactly one bounded orchestration snapshot. It must be bound to the
   confirmed goal, manifest revision, fleet revision, repository revision,
   observation time, and declared completeness. Do not search for additional
   work, infer a newer fleet, or combine snapshots from different revisions.

3. At the wrapper boundary, read the exact UTF-8 bytes of the fixed
   `agents/slop-sniper.agent.md` persona and canonical
   `report-contract.schema.json`. Before dispatch, use Report Contract to bind
   those bytes to their SHA-256 digests and verify the persona digest declared
   by the canonical schema plus exact schema-byte parity with the validator.
   Stop as `invalid-specialist-materials` on any mismatch. Pass the immutable
   bytes and binding to Orchestration Audit; do not grant its molecule an
   undeclared repository read.

4. Run Orchestration Audit. It seals the packet, dispatches one fresh no-tools
   specialist with the wrapper-supplied bytes, and validates the response
   against the exact snapshot, prompt-material binding, and
   correction-authority contract.

5. Return the validated report unchanged. The report may recommend one bounded
   correction, but the parent orchestrator remains the only workflow that can
   execute it.

## What Counts As Slop

Slop is an observable process defect: work no longer contributes to the goal,
exceeds approved scope or authority, duplicates investigation or mutation,
repairs a shared failure locally, continues after terminal state, retries
without changed evidence, launders incomplete evidence into success, introduces
premature structure or optimization, races ownership, escalates routine
engineering decisions, crosses a privacy boundary, churns context without
preserving evidence, hallucinates state, or proceeds without a bound.

Imperfect prose, code style, elapsed time by itself, ordinary iteration,
legitimate parallel work, and necessary architecture or safety controls are not
slop.

## Invocation

- A human may explicitly invoke `/slop-sniper` with:
  - `snapshot`: exactly one JSON object accepted by Snapshot Contract, either
    unsealed input for the workflow to seal once or the unchanged sealed output;
  - `repository-root`: the absolute repository root containing the fixed
    `agents/slop-sniper.agent.md` and canonical report schema.
- An explicitly invoked orchestrator may dispatch a fresh Slop Sniper audit at
  a documented event or checkpoint.
- It is never model-routed automatically, resident, scheduled, or polling.

The [Snapshot Contract](./_atoms/snapshot-contract/snapshot-contract.md)
documents complete and partial observations plus source-free unavailable
coverage, and links a mechanically validated minimal capture recipe. Missing or
inaccessible evidence is declared; it is never fetched, inferred, or replaced
with placeholders during the audit.

## Output

Return:

- `status`: `complete`, `invalid-snapshot`, `invalid-specialist-materials`,
  `spawn-failed`, or `invalid-report`;
- the sealed snapshot identity and completeness;
- the validated Slop Sniper report when complete;
- bounded validation defects plus response byte length and digest when invalid.

Never return or record the raw invalid specialist response.

The report status and all nested report fields use the
[canonical report schema](./_atoms/report-contract/report-contract.schema.json).

## Boundaries

- Read-only. No code, tracker, provider, branch, worktree, process, schedule,
  publication, or control-state mutation.
- No direct remediation and no automatic correction execution.
- No merge, approval, risk acceptance, ownership change, scope change, branch
  deletion, process stop, or schedule cancellation.
- No fleet ownership. Slop Sniper audits one snapshot and returns.
- No status-only reporting, artifact review, code review, or durable learning.
- No sensitive-content reproduction. Privacy findings cite redacted anchors.
- No daemon, watcher, heartbeat, sleep loop, or polling.

## Permissions

`read` belongs only to this wrapper and loads the two fixed prompt materials
before dispatch. `task` launches one fresh no-tools specialist through Agent
Spawn. `execute` binds prompt materials, runs deterministic snapshot and report
validation, and records the bounded invocation through Chronicler. There is no
edit, provider-write, tracker-write, or process-control grant.
