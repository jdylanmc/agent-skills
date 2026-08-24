---
name: cycle-controller
description: Orchestrate recursive discovery cycles by running discovery, aligning with the human, persisting a handoff, reading it back, and choosing the next cycle.
level: molecule
includes: ["discovery/_molecules/discovery-loop/discovery-loop.md","discovery/_atoms/alignment-check/alignment-check.md","_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
composes: ["discovery/_molecules/discovery-loop/discovery-loop.md","discovery/_atoms/alignment-check/alignment-check.md","_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
used-by: ["discovery/SKILL.md"]
allowed-tools: ["execute","read","search"]
---

# Cycle Controller

Own the recursive discovery control loop.

## Required References

1. [Discovery loop](../discovery-loop/discovery-loop.md)
2. [Alignment check](../../_atoms/alignment-check/alignment-check.md)
3. [Persist bounded handoff](../../../_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md)

## Workflow

1. Run [Discovery loop](../discovery-loop/discovery-loop.md) to produce the
   current discovery packet and frontier.
2. If the frontier is `needs-interrogate`, route the blocking questions to
   `interrogate`, then incorporate the answers as source claims, decisions, or
   unanswered questions according to their evidence.
3. If the frontier is `needs-domain-mapping`, route the blocking vocabulary or
   relationship uncertainty to `domain-mapping`, then incorporate the returned
   map as domain evidence.
4. If a proof-of-concept appears necessary, do not implement it. Record the
   proof question, evidence requirement, risk, and recommended owner as a
   future workflow. Implementation authority belongs elsewhere.
5. Run [Alignment check](../../_atoms/alignment-check/alignment-check.md).
   A handoff cannot be written until the human confirms or corrects the
   discovery state.
6. Convert only aligned context into the payload for
   [Persist bounded handoff](../../../_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md).
7. Persist the handoff and read back the exact reported path. Treat a failed
   read-back as `handoff-incomplete` and stop.
8. Use the reread handoff, not memory, to choose the next cycle:
   - continue discovery;
   - run another interrogation;
   - run another domain map;
   - request proof-of-concept planning;
   - hand off to specification or ticket breakdown;
   - stop as ready, blocked, or insufficient evidence.

## Handoff Payload

Map aligned discovery state into the bounded handoff payload:

| Handoff field | Discovery source |
| --- | --- |
| `goal` | Discovery subject and intended outcome. |
| `current_progress` | Aligned facts, decisions, frontier, and cycle count. |
| `decisions_and_constraints` | Decisions, boundaries, refusals, and alignment corrections. |
| `artifacts_and_references` | Evidence sources, prior handoffs, maps, and interrogation packets. |
| `what_worked` | Evidence routes and questions that advanced understanding. |
| `what_did_not_work` | Missing sources, contradictions, and dead ends. |
| `next_steps` | The next cycle selected from the reread handoff. |
| `suggested_skills` | `interrogate`, `domain-mapping`, `discovery`, or the next downstream skill when exact and useful. |

## Boundaries

- The controller may repeat discovery cycles, but it may not skip alignment.
- The controller never writes a handoff from unaligned or disputed context.
- The controller reads back every handoff before using it as continuation
  state.
- The controller routes to `interrogate` and `domain-mapping`; it does not
  absorb their jobs.
- The controller records proof-of-concept need as a decision point; it does not
  run or implement a proof of concept.
- Tracker mutation remains outside this molecule in the root skill's
  approval-gated tracker update gate.
