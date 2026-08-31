---
name: remediation-continuation
description: Continue one Ship delivery through a verified orchestration handoff when a worker exhausts its local remediation budget with an in-scope implementation blocker.
level: atom
allowed-tools: ["read","task"]
includes: ["ship/_atoms/remediation-continuation/remediation-continuation.mjs"]
composes: []
used-by: ["ship/_molecules/delivery-cycle/delivery-cycle.md"]
---

# Remediation Continuation

Keep implementation ownership when one worker's five-attempt remediation budget
expires. Exhausting a context is not proof that the issue is no longer
remediable.

## Required Files

1. [Continuation evaluator](./remediation-continuation.mjs)

## Decision

Fingerprint each unresolved `Must fix` finding internally from its stable rule,
repository path or explicit construct identity, ledger entry, kind, and
ownership classification. Ignore caller-made fingerprints, line movement, and
free-form wording. Consume the canonical `run-ci` envelope's
`evidenceComplete`, `status`, and failed `steps`, with each failed step
classified exactly once against the confirmed ledger. Combine those failures
with Roast blockers before deciding. Then:

- continue local remediation while attempts remain;
- invoke Shepherd only when no implementation `Must fix` remains, or every
  remaining condition is explicitly `shepherd-owned`;
- stop for a human on an out-of-scope, requirement, architecture, product,
  accepted-risk, or otherwise decision-dependent finding;
- stop when the same blocker repeats without a mechanically observed head or
  complete-diff change plus an outcome change in validation, criteria, or the
  normalized blocker set;
- stop at the configured global continuation ceiling; and
- after local exhaustion, continue only an in-scope, remediable
  `implementation` finding.

Mixed Shepherd and implementation ownership is not a Shepherd handoff. The
implementation blocker remains unresolved, so Ship stops for a human rather
than hiding it behind custodial work.

An intermittent `run-ci` result is not green and never releases work to
Shepherd. Return it to the human for a fully passed rerun. After the first
continuation, missing prior head, complete-diff digest, validation status,
criterion digest, or normalized blocker fingerprints is stale state and blocks
another continuation.

Every decision, including direct Shepherd handoff, requires a complete
canonical `run-ci` envelope whose full lowercase immutable
`repository.revision` equals the freshly read current head. Only `failed`
validation is eligible for implementation classification. `cancelled`,
`environment-failed`, `unsupported-provider`, and `incomplete` return to the
human under their distinct statuses.

## Required Continuation Handoff

Before dispatching a fresh implementation agent:

1. Stop the prior worker and capture committed and uncommitted state.
2. Invoke the existing `orchestration-handoff` skill. Do not invent another
   schema or write a workspace handoff file.
3. Give it one consolidated brief with `GOAL`, `SCOPE`, `CONTEXT`,
   `ACCEPTANCE`, `VERIFY`, `TIMEBOX`, `FORBIDDEN`, `REPORT`, and `STANDING`.
4. Bind the payload to the issue, confirmed ledger and exclusions, criterion
   verdicts, branch, worktree, pull request when one exists, base and head
   commits, isolation state, exclusions, reconciliation result, `run-ci` evidence, current
   Roast findings, prior remediation attempts, finding fingerprints, local
   five-attempt budget, continuation generation, and configured global ceiling.
5. Consume the actual persistence result. Require its exact path, directory,
   name, byte count, headings, redactions, and suggested-skills flag. Reread the
   real regular file and compare its bytes with the deterministic rendering of
   the current normalized payload.
6. Re-read the branch, worktree, base, and head after persistence. Any stale or
   incomplete receipt blocks continuation.
7. Explicitly release the prior agent and activate exactly one fresh owner for
   the same branch and worktree. Old and new agents never edit concurrently.

Every safety-critical binding is compared with current canonical Ship state;
presence alone is not freshness. The generation, fingerprint set, local budget,
global ceiling, and every executable worker-brief field must also equal the
continuation decision and current task contract.

Authorization loads that confirmed state through the run's trusted persistence
adapter and recomputes its digest. It independently observes Git identity and
the ownership transition; caller-supplied expected values, ownership booleans,
and freshness mirrors are not authority.

The global ceiling comes from the operator-confirmed delivery packet, including
its stable packet identifier, digest, source, and limit. All four are persisted
and verified. A caller's statement that a policy is confirmed is not provenance.
The ceiling is not invented at exhaustion and cannot change between
generations. Canonical `run-ci` evidence must be complete and bind
`repository.revision` to the current head; its status and failed-step identities
must match the continuation decision.

The fresh owner gets a new `0/5` local budget. It resumes at implementation,
then reruns complete-diff reconciliation, the repository's complete `run-ci`,
and a fresh Roast. A fresh budget never clears an unchanged blocker, forgives
failed validation, widens scope, or skips evidence.

## Boundaries

- One issue, one confirmed ledger, one branch, one worktree.
- No merge, approval, auto-merge, risk acceptance, force push, or review-thread
  mutation.
- No continuation from a narrated, missing, stale, or partially validated
  handoff.
- No sixth local attempt and no continuation beyond the configured global
  ceiling.
- Handoff artifacts are persisted only by the existing bounded handoff
  machinery.
