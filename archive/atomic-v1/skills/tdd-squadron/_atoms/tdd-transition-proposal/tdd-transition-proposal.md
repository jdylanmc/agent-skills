---
name: tdd-transition-proposal
description: Emit only typed TDD strategy proposals whose current revision, run, candidate, lease, agent, and fencing bindings can be validated by shared fleet state.
level: atom
allowed-tools: ["execute"]
includes: []
composes: []
used-by: ["tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md"]
---

# TDD Transition Proposal

Produce a typed `tdd-squadron` proposal for vertical slices, ready-candidate
freeze, report-backed Roast completion, recommendations returning to the pair,
pair/Roast reservation, and expired or quiescent-pair recovery. Emit the
exact version-`1` `atomic-transition` envelope: generic bindings identify the
control revision, run, candidate, actor-held primary lease, agent, and fence;
the generic reservation contains that primary lease; and the transition and
payload use the `tdd-squadron` namespace. Put the TDD type, revision-bound
evidence, all participating TDD leases, and strategy payload inside the opaque
payload value.

`reserve-pair`, `reserve-roast`, `recover-pair`, and `reclaim-expired` are explicitly authorized
coordinator operations. Their shared primary binding is a control-revision
fence derived from the persisted coordinator, not a delivery lease. Their
TDD `leases` map is empty; the atomic adapter verifies runtime coordinator
authority and dispatches them under the same locked CAS.

The shared
[`atomic-transition`](../../../_base/_atoms/atomic-transition/atomic-transition.md)
atom validates that envelope before this package validates its complete
multi-role TDD lease set at a trusted `now` time. This package emits no
parallel proposal contract and never copies or bypasses shared validation.

Reject a stale control revision, candidate revision, lease, agent, generation,
fence, expiry, missing evidence, or non-TDD type. No proposal can express
publication, approval, merge, scope expansion, accepted risk, promotion, or
retirement.
