---
name: tdd-squadron
description: "Run the isolated Test-Driven Development (TDD) Squadron delivery experiment: one persistent Red/Green pair alternates vertical slices, freezes a candidate, and sends it through one four-seat Roast before review-ready publication. Use only when a human explicitly invokes TDD Squadron. Do not use for Bench, replacing ship-with-squadron, merge, approval, risk acceptance, scope expansion, promotion, retirement, or continuous monitoring."
allowed-tools: ["execute","read","search","task"]
includes: ["_base/_molecules/chronicler/chronicler.md","tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md"]
disable-model-invocation: true
user-invocable: true
requires-skills: [{"id":"slop-sniper","source":"local","required":true}]
---

# TDD Squadron

Run one isolated Test-Driven Development (TDD) candidate loop over the shared
fleet substrate. This package owns only TDD choreography. It neither replaces
Bench nor `ship-with-squadron`, and it never embeds common fleet lifecycle
policy in its own strategy transitions.

```text
confirm experiment -> reserve Red/Green pair -> alternate vertical slices
  -> freeze one ready candidate and release pair -> atomically reserve Roast
  -> Roastmaster synthesizes three independent roasters -> review ready
  -> agent-authorized publication or recommendations back to the pair
```

## Required References

1. [Chronicler](../_base/_molecules/chronicler/chronicler.md)
2. [TDD candidate loop](./_molecules/tdd-candidate-loop/tdd-candidate-loop.md)

## Shared Transition Boundary

The TDD candidate loop composes the shared
[`atomic-transition`](../_base/_atoms/atomic-transition/atomic-transition.md)
atom. It validates generic proposal bindings, reservations, authority,
currentness, and fleet-state compare-and-swap delegation. TDD alone owns
Red/Green and Roast choreography.

## Workflow

1. Start or reuse the Chronicler context. Confirm the selected strategy is
   `tdd-squadron`, the closed fleet manifest, candidate identity, objective
   gates, delivery-seat budget, and human decisions. Record comparison metrics:
   elapsed time, active seat time, model and tool cost, candidate count, patch
   churn, human interventions, terminal outcome, and review readiness.
2. At every dispatch, construct the role packet with each role's assigned
   doctrine as **full text**, plus the canonical doctrine-manifest revision and
   digest that bind those exact bytes. Doctrine is a reasoning lens, not a
   rule-by-rule compliance gate or a grant of strategic authority.
3. Obtain an all-or-nothing two-seat reservation for two distinct people:
   `red` and `green`. Both leases bind seat, owner, agent, generation, expiry,
   replacement fence, run, and candidate revision. A role may hold no second
   concurrent scheduler lease. Recover an expired or unacknowledged pair only
   as one reservation: fence every seat before whole-pair release or
   replacement.
4. Have the pair alternate complete vertical slices, starting with Red and then
   Green. Each slice is a revision-bound proposal and evidence record. Every
   lease-consuming transition receives trusted current time and rejects an expired
   lease. Do not Roast a slice, dispatch a partial pair, or let a stale, expired,
   or replaced lease submit a transition.
5. When both pair members declare the current candidate ready, freeze exactly
   that candidate revision and release both pair leases in the same transition.
   Submit the typed proposal to the shared fleet-state validator. A rejected or
   unavailable shared transition remains blocked; it is never locally
   persisted as accepted.
6. Only after pair release, atomically reserve four delivery seats for exactly
   one `roastmaster` and three distinct `roaster` agents. The four roles and
   four seats must all be distinct, leaving the fifth delivery seat available.
   The Roastmaster synthesizes the three independent roaster reports once for
   the frozen candidate revision. There is no per-slice Roast.
7. If the synthesis has recommendations, release the full Roast reservation and
   return the recommendations, unchanged and revision-bound, to the Red/Green
   pair for another TDD cycle. Any candidate mutation invalidates every prior
   Roast claim and returns the candidate to TDD; it requires a fresh Roast
   before review readiness.
8. Mark a candidate review-ready only when its current revision has complete,
   fresh objective evidence and an approved four-role Roast. Only the configured
   trusted publication-agent identity may publish a review-ready change request;
   a caller's self-assigned role label is never authorization. No role may
   merge, approve, enable auto-merge, accept risk, expand scope, promote,
   retire, or close tracker work; those decisions remain human-owned and
   revision-bound where applicable.
9. Trigger one asynchronous `/slop-sniper` invocation at each declared material
   checkpoint: pre-dispatch, repeated failure, handoff, post-review mutation,
   shared-root failure, pre-readiness, or terminal state with active work. Seal
   the snapshot first. Its report is advisory, owns no delivery seat, cannot
   block the emitting transition, and may be consumed only at a later safe
   transition if the snapshot is still current.
10. Return the current candidate and reservation state, immutable evidence and
    proposal identities, TDD-specific counters, common comparison metrics, all
    human decisions still required, and one terminal or blocked disposition.

## Boundaries

- Do not modify existing Squadron variants, shared `_base` atoms, documentation,
  agents, or workflow registration.
- Do not route automatically, watch, poll, schedule recurring work, or retain a
  resident auditor. The user explicitly invokes this workflow; each Slop Sniper
  audit is one asynchronous snapshot-bound advisory task.
- Do not replace a failed atomic reservation with partial ownership. Do not
  infer completion, freshness, approval, publication, or a human decision.
- Do not compose Bench choreography or copy shared lifecycle validation into
  this strategy package.

## Permissions

`read` and `search` resolve the closed manifest, fleet observations, and
full-text doctrine lenses. `execute` runs deterministic reservation, lifecycle,
proposal, and snapshot helpers plus best-effort Chronicler recording. `task`
dispatches the pair, the four-role Roast, and isolated Slop Sniper audit. There
is no `edit`, provider-write, merge, approval, or risk-acceptance authority.

---

<!-- 🤖 This skill was created using the create-skill AI skill. https://github.com/gaming-microsoft/ai-skills -->
