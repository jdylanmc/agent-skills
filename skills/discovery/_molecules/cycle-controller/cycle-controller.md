---
name: cycle-controller
description: Orchestrate recursive discovery cycles by running discovery, offering interactive human alignment, persisting a handoff, reading it back, compacting continuation state, and choosing the next cycle.
level: molecule
includes: ["discovery/_molecules/discovery-loop/discovery-loop.md","discovery/_atoms/alignment-check/alignment-check.md","discovery/_molecules/research-thread/research-thread.md","_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
composes: ["discovery/_molecules/discovery-loop/discovery-loop.md","discovery/_atoms/alignment-check/alignment-check.md","discovery/_molecules/research-thread/research-thread.md","_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
used-by: ["discovery/SKILL.md"]
allowed-tools: ["execute","read","search","task"]
---

# Cycle Controller

Own the recursive discovery control loop.

## Required References

1. [Discovery loop](../discovery-loop/discovery-loop.md)
2. [Alignment check](../../_atoms/alignment-check/alignment-check.md)
3. [Research thread](../research-thread/research-thread.md)
4. [Persist bounded handoff](../../../_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md)

## Workflow

1. Run [Discovery loop](../discovery-loop/discovery-loop.md) to produce the
   current discovery packet and frontier.
2. If the frontier is `needs-interrogate`, route the blocking questions to
   `interrogate`, then incorporate the answers as source claims, decisions, or
   unanswered questions according to their evidence.
3. If the frontier is `needs-domain-mapping`, route the blocking vocabulary or
   relationship uncertainty to `domain-mapping`, then incorporate the returned
   map as domain evidence.
4. If the frontier is `needs-proof-of-concept`, route the scoped prototype
   question to `proof-of-concept`, then incorporate the findings as prototype
   evidence, including what worked, what failed, edge cases, gaps, cleanup
   status, and human feedback. Discovery owns alignment, handoff, compaction,
   and next-cycle selection after the proof of concept returns.
5. If the frontier is `needs-research`, route the blocking external-knowledge
   question to [Research thread](../research-thread/research-thread.md),
   one question per thread. Incorporate a valid report as **source claims with
   citations**, never as confirmed facts, and carry its conflicts and limits
   into the packet unresolved.

   An `evidence-gap` or `research-unavailable` result is recorded as exactly
   that and leaves the question open. Discovery does not proceed as though an
   external question were answered when nothing answered it.

6. Offer and run [Alignment check](../../_atoms/alignment-check/alignment-check.md).
   The goal is shared understanding with the human. A handoff cannot be written
   until the human verifies or corrects the discovery state.
7. Convert only verified shared understanding into the payload for
   [Persist bounded handoff](../../../_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md).
8. Persist the handoff and read back the exact reported path. Treat a failed
   read-back as `handoff-incomplete` and stop.
9. Compact the reread handoff into the continuation focus: the smallest set of
   aligned facts, decisions, open questions, frontier state, and next action
   needed to begin the next discovery pass without rereading the whole prior
   conversation.
10. Use that compacted handoff-derived focus, not memory, to choose and **begin**
    the next cycle:
    - continue discovery;
    - run another interrogation;
    - run another domain map;
    - run a proof of concept;
    - run another research thread;
    - hand off to specification or ticket breakdown.

## Continuation

**The loop continues by default.** A completed cycle is not a resting state, and
finishing one is not a reason to return to the operator.

Cycle *n* ends by starting cycle *n+1*: classify the frontier, route, align,
persist, read back, compact, and go again. The operator asked for discovery, not
for one cycle of it.

Stop only for one of these, and name which:

| Stop | When |
| --- | --- |
| `alignment` | The alignment check is being offered. This is a pause inside a cycle, not the end of one. |
| `clarifying-question` | A question only the human can answer blocks the next cycle. Ask it and wait. |
| `ready` | The discovery subject is settled enough to hand to the next workflow. |
| `blocked` | Progress needs authority, access, or a decision owner that is unavailable. |
| `stop` | The request is out of scope or unsafe to pursue. |
| `interrupted` | The operator interrupted, or a declared budget or cycle limit was reached. |

Anything not on that list means keep going. In particular, do not stop merely
because a cycle produced a handoff, because a frontier was classified, because
a routed skill returned, or because a natural-sounding summary point was
reached. Reporting "cycle 2 complete" and waiting is the failure this rule
exists to prevent.

Do not ask permission to continue. Continuation is the default; a request to
proceed spends the operator's attention on a decision already made when they
started the loop.

## Handoff Payload

Map aligned discovery state into the bounded handoff payload:

| Handoff field | Discovery source |
| --- | --- |
| `goal` | Discovery subject and intended outcome. |
| `current_progress` | Verified shared understanding, aligned facts, decisions, frontier, and cycle count. |
| `decisions_and_constraints` | Decisions, boundaries, refusals, and alignment corrections. |
| `artifacts_and_references` | Evidence sources, prior handoffs, maps, and interrogation packets. |
| `what_worked` | Evidence routes and questions that advanced understanding. |
| `what_did_not_work` | Missing sources, contradictions, and dead ends. |
| `next_steps` | The next cycle selected from the reread handoff. |
| `suggested_skills` | `interrogate`, `domain-mapping`, `proof-of-concept`, `discovery`, or the next downstream skill when exact and useful. |

Research findings enter `artifacts_and_references` as cited sources and
`current_progress` as source claims, never as settled facts.

## Boundaries

- The controller may repeat discovery cycles, but it may not skip alignment.
- The controller offers the alignment check interactively and never writes a
  handoff from unverified, unaligned, or disputed context.
- The controller reads back every handoff before using it as continuation
  state.
- The controller compacts the reread handoff before starting discovery again.
- The controller routes to `interrogate` and `domain-mapping`; it does not
  absorb their jobs.
- The controller routes one bounded question at a time to a research thread when
  the blocker is external knowledge. It does not absorb research, does not treat
  a cited claim as a confirmed fact, and does not continue past an unanswered
  external question by assuming an answer.
- The controller routes to `proof-of-concept` when prototype evidence is the
  next cheapest answer; it does not absorb that skill's job or treat prototype
  code as product code.
- Tracker mutation remains outside this molecule in the root skill's
  approval-gated tracker update gate.
