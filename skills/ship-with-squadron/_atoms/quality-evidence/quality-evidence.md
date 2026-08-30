---
name: quality-evidence
description: Enforce the candidate delivery order, exact revision binding, blast-radius contract adaptation, bounded remediation, and evidence invalidation after mutation.
level: atom
allowed-tools: ["execute","read","search","task"]
includes: ["ship-with-squadron/_atoms/quality-evidence/quality-evidence.mjs"]
composes: []
used-by: ["ship-with-squadron/_molecules/candidate-delivery/candidate-delivery.md"]
---

# Quality Evidence

## Required Files

1. [Quality evidence helper](./quality-evidence.mjs)

Run every candidate in this order:

```text
implementation
  -> diff reconciliation
  -> run-ci
  -> Roast
  -> blast-radius proof
  -> bounded remediation
  -> criterion verdict
  -> publication
  -> real nested Shepherd
```

Use the quality evidence helper to enforce order and bind
every receipt to exact base and head revisions. Any head mutation invalidates
diff, Continuous Integration, Roast, blast-radius, criterion, publication, and
Shepherd evidence; restart from reconciliation. Remediation is a fresh bounded
worker dispatch, never an unbounded loop or validation weakening.

The helper reuses `ship`'s validated deterministic hunk reconciler through a
code dependency. This does not compose or route to another skill-local unit;
the composition graph remains squadron-local.

The final quality gate requires `reconciled`, complete `run-ci: passed`
evidence, no unresolved Roast `blocker`, blast-radius readiness `satisfied`,
and every criterion `satisfied` or explicitly `descoped-by-human`. Failed or
incomplete checks enter bounded remediation and never publication readiness.

## Blast-radius adapter

Invoke the independently routable `blast-radius` capability through the
required-skill seam. Do not compose or copy its skill-local units. Preserve its
exact vocabulary:

- classifications: `confirmed-risk`, `cleared-risk`,
  `unproven-assertion`;
- rung progression: `completed`, `unavailable`, `not-applicable`,
  `not-attempted`;
- evidence outcome: `supports-assertion`, `supports-bad-case`,
  `inconclusive`, `conflicting`;
- `regression-proof-status`: `selected` or `unavailable`.

The adapter retains ladders, stopping evidence, classifications, and the one
regression-proof slot. `unavailable`, `unproven-assertion`, invalid revision
binding, or malformed evidence never becomes success. A `confirmed-risk`
requires remediation or a human decision outside this fleet; the fleet cannot
accept risk.

Until Pull Request 157 is merged into the baseline and this branch is rebased,
the skill declares the capability as required external integration. It may not
claim the local baseline is integrated.
