---
name: bench-control
description: Bind a capped, quorum-controlled Bench Squadron proposal to current Fleet State and full-text role doctrine before review-ready publication.
level: molecule
includes: ["_base/_atoms/atomic-transition/atomic-transition.md","bench-squadron/_atoms/atomic-proposal/atomic-proposal.md","bench-squadron/_atoms/bench-epoch/bench-epoch.md","bench-squadron/_atoms/fleet-state/fleet-state.md","bench-squadron/_atoms/role-doctrine/role-doctrine.md"]
composes: ["_base/_atoms/atomic-transition/atomic-transition.md","bench-squadron/_atoms/atomic-proposal/atomic-proposal.md","bench-squadron/_atoms/bench-epoch/bench-epoch.md","bench-squadron/_atoms/fleet-state/fleet-state.md","bench-squadron/_atoms/role-doctrine/role-doctrine.md"]
used-by: ["bench-squadron/SKILL.md"]
allowed-tools: ["execute","read"]
---

# Bench Control

```text
validate Fleet State -> configure separate roles -> load full-text lenses
  -> accept current-epoch quorum proposal -> invalidate stale assertions
```

## Required References

1. [Atomic transition](../../../_base/_atoms/atomic-transition/atomic-transition.md)
2. [Atomic Proposal](../../_atoms/atomic-proposal/atomic-proposal.md)
3. [Fleet State](../../_atoms/fleet-state/fleet-state.md)
4. [Role Doctrine](../../_atoms/role-doctrine/role-doctrine.md)
5. [Bench Epoch](../../_atoms/bench-epoch/bench-epoch.md)

Validate the existing Fleet State before accepting a proposal, and bind the
proposal to its exact revision through Atomic Transition. Atomic Proposal
adapts that packet to the shared strategy envelope, validates it, projects the
locked current state from its namespaced `strategyState`, and delegates the compatible durable write to
the shared Fleet State compare-and-swap adapter. That same locked write advances
the persisted Bench epoch. Bench Epoch validates the pool cap, role separation,
inclusive quorum, current distinct signatures, and mutator-turn rule. The
current Fleet State owner retains durable-write authority.

Load complete role doctrine text before dispatch. An asynchronous Slop Sniper
result is evidence for the publication gate, never Fleet State ownership or
signature authority. Once the validated proposal mutates the control path,
advance the bench epoch and discard all prior signatures and downstream claims.

Review-ready publication requires the exact current Fleet State binding,
current-epoch quorum, complete role lenses, quality evidence, and a resolved
Slop Sniper checkpoint. Scope, risk, approval, merge, promotion, and retirement
remain human-only decisions.

## Bound Preparation Separately

During the existing human scope confirmation, record a finite preparation
budget, its start time, the execution budget, any absolute cutoff and timezone,
and the disposition at preparation exhaustion. Use a supplied preparation bound;
otherwise propose a short bound for confirmation. Preparation includes capability
discovery, owner resolution, setup, and probes. Retries and changed probe designs
consume that same budget; they never reset its start time.

Before each preparation action, compare the current time with both the
preparation deadline and any overall cutoff. Reaching either deadline ends
preparation. Preparation does not extend the overall cutoff or authorize
execution after it. These are coordination checks, not a claim of runtime hard
cancellation; distinguish an admission deadline from proven termination of work
already executing.

Resolve the execution path before promising overnight delivery. Name the current
Fleet State owner, the available runtime operations, and which actor already
holds any required write or publication authority. Record whether execution and
notification require this session to remain open; do not promise survival after
session exit without evidence. This resolution grants no missing authority.

Exit preparation in one of three ways:

- **Prepared:** the confirmed path can proceed through the existing Fleet State,
  role, scope, and quorum gates. This is not a running claim.
- **Authorized fallback:** identify the operator's prior authorization and the
  exact alternative path. It must fit the remaining time, preserve every
  applicable gate, and use an actor with the required authority. A different
  workflow is an explicit handoff, not Bench continuing under a new name.
- **Blocked:** stop preparation and report the specific missing requirement,
  completed work, remaining gates, and the decision needed. Without an
  authorized fallback, do not silently switch modes, renew the preparation
  budget, or claim that delivery will continue overnight.

Do not begin another setup project at exhaustion. If independent work can still
proceed within the confirmed scope and remaining budgets, apply the operation
checks below; that work does not make the blocked path ready.

## Require Evidence Before Claiming Running

Bind a delivery launch receipt to the exact run, assignment, agent identity,
owned worktree and candidate revision, Fleet State revision, and Bench epoch.
Require an acknowledgement accepting that bounded assignment from its actual
delivery owner, plus a current runtime observation that the same agent is
executing it. A generic task-registry `running` label without accepted
assignment evidence is insufficient. A receipt records evidence, not authority,
and cannot replace a Fleet State reservation or proposal signature.

Report the phase that the evidence supports:

| Phase | Required observation |
| --- | --- |
| `preparing` | Bounded setup is in progress; no delivery launch is claimed. |
| `prepared` | Preparation completed, but no accepted executing owner is proven. |
| `running` | Bound assignment acceptance and current runtime execution agree. |
| `waiting` | The accepted owner is waiting, idle, or awaiting a result. |
| `blocked` | An identified requirement prevents the reported operation. |
| `unconfirmed` | Ownership or current execution evidence is missing, stale, or mismatched. |

A worktree, plan, probe, queued dispatch, or scheduled morning reminder cannot
establish `running`. Name the receipt and observation time when reporting it.
After an epoch, assignment, or candidate change, rebind acceptance and reobserve
execution before renewing the claim. After a session gap, report the gap and
reobserve; do not imply uninterrupted execution. These phase labels never imply
completed delivery, review readiness, or confirmed cancellation.

## Handle Uncertainty Narrowly

Before a probe, name the capability, the operations that require it, the
observable readiness handshake, and the bounded test and cleanup procedure.
Exercise the behavior only after observing that handshake. A startup timeout or
cancellation before the tested boundary is reached is `inconclusive`, not
`unsupported`. A cancellation acknowledgement is not proof of termination.
Report only the boundary actually exercised; a root-session observation does
not prove descendant coverage.

For each proposed next operation, identify its prerequisites and their evidence.
Failed or unproven required prerequisites block that operation and its dependent
operations. A mandatory global gate still blocks every operation it governs.
Continue independent work only when its own prerequisites are satisfied, it
remains inside the confirmed scope and budgets, and its actor has the required
authority. Unknown dependency or authority is not evidence of independence.

Do not turn an inconclusive probe into a whole-runtime verdict. Conversely,
do not treat uncertainty as permission, silently downgrade an operator-required
enforcement guarantee, or bypass Fleet State validation, quorum, role lenses,
quality evidence, or the Slop Sniper publication gate. Preserve the unresolved
condition in every partial result and handoff until evidence or an authorized
human decision resolves it.
