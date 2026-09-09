---
name: bench-squadron
description: "Run one explicitly invoked, bounded delivery experiment with a separate orchestrator, no more than five delivery-pool agents, current-epoch quorum proposals bound to Fleet State, and an asynchronous Slop Sniper audit. Use when a human asks to bench a small squadron workflow or test delivery-pool coordination. Do not use for autonomous delivery, model routing, scope selection, risk acceptance, approval, merge, promotion, retirement, or continuous monitoring."
allowed-tools: ["execute","read","task"]
includes: ["_base/_molecules/chronicler/chronicler.md","bench-squadron/_molecules/bench-control/bench-control.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","bench-squadron/_molecules/bench-control/bench-control.md"]
disable-model-invocation: true
user-invocable: true
requires-skills: [{"id":"slop-sniper","source":"local","required":true}]
---

# Bench Squadron

Run one review-ready delivery experiment with bounded delegation and an exact,
replayable proposal epoch.

```text
human boundary -> validate current Fleet State -> configure pool and quorum
  -> dispatch delivery pool + async Slop Sniper -> validate current proposal
  -> mutate epoch and invalidate claims -> complete publication gates
  -> publish review-ready candidate -> human-only downstream decisions
```

## Required References

1. [Chronicler](../_base/_molecules/chronicler/chronicler.md)
2. [Bench control](./_molecules/bench-control/bench-control.md)

## Shared Transition Boundary

Bench control composes the shared
[`atomic-transition`](../_base/_atoms/atomic-transition/atomic-transition.md)
atom. It validates generic proposal bindings, reservation completeness,
authority, currentness, and fleet-state compare-and-swap delegation. Bench
alone owns quorum, epoch, and same-turn mutator rules.

## Workflow

1. Create or reuse the caller's Chronicler run context. Recording is best
   effort and never changes an epoch, a proposal, a gate, or human authority.

2. A human defines and confirms the fixed experiment goal, accepted scope,
   exclusions, delivery-pool membership, quorum, risk boundaries, and
   publication target. Refuse an unconfirmed scope, an unbounded pool, or any
   request to let the workflow decide scope or risk.

3. Validate the current, persisted Fleet State before accepting any proposal.
   Configure one separate orchestrator, one separate asynchronous Slop Sniper,
   and one delivery pool containing one through five distinct agents. The
   quorum satisfies 1 <= quorum <= delivery-pool size inclusive.
   Neither the orchestrator nor Slop Sniper belongs to the delivery pool.

4. Give every role its complete doctrine lens text, not a summary, excerpt,
   identifier, or link. Dispatch delivery-pool agents only inside the confirmed
   scope. Dispatch Slop Sniper separately and asynchronously over one sealed
   checkpoint snapshot; it audits and returns evidence, but never owns the
   fleet, signs a proposal, changes state, or publishes.

5. Route each mutation proposal through Bench Epoch with the exact current
   epoch, Fleet State revision, mutator, turn, bounded mutation, and distinct
   delivery-pool signatures. A valid proposal has at least the configured
   quorum of signatures for the exact current epoch. A mutator may not sign a
   proposal in its own turn. Reject stale epochs, stale Fleet State revisions,
   duplicate agents or signature values, foreign signers, and malformed
   proposals.

6. Apply only a validated proposal to the current Fleet State transition path.
   Each accepted mutation advances the epoch exactly once and invalidates all
   collected signatures and downstream claims. Revalidate from the new epoch;
   never carry a prior claim, signature, or readiness assertion across a
   mutation.

7. Publish a candidate as review-ready only after the confirmed human scope and
   risk boundaries, valid current Fleet State binding, current-epoch quorum,
   complete full-text role-lens evidence, required quality evidence, and the
   asynchronous Slop Sniper checkpoint disposition all pass. A finding remains
   a gate until the human directs a bounded resolution or stops the experiment.

8. Return the review-ready candidate and its exact evidence binding. A human
   alone decides approval, merge, promotion, retirement, scope changes, and
   risk acceptance. The workflow neither performs nor implies any of those
   decisions.

## Boundaries

- This is a finite, explicitly invoked experiment; never model-route it,
  schedule it, poll it, or make it a daemon.
- The orchestrator coordinates but does not sign delivery proposals. Slop
  Sniper remains separate, asynchronous, read-only, and recommendation-only.
- Delivery-pool membership is capped at five. Do not create shadow agents,
  substitute a worker, or expand the pool without a new human-confirmed
  configuration.
- Fleet State remains the control record and Chronicler remains diagnostic
  evidence. Neither is replaced by worker reports or a Slop Sniper result.
- Never auto-approve, merge, enable auto-merge, accept risk, promote, retire,
  close tracker work, or expand scope.

## Permissions

`read` loads the current Fleet State and complete role doctrine lenses.
`execute` runs deterministic state and epoch validation plus bounded
Chronicler recording. `task` dispatches only the capped delivery pool and one
separate asynchronous Slop Sniper invocation. There is no edit, provider-write,
merge, approval, promotion, or retirement authority.

---

<!-- 🤖 This skill was created using the create-skill AI skill. https://github.com/gaming-microsoft/ai-skills -->
