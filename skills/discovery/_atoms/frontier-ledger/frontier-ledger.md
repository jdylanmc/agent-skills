---
name: frontier-ledger
description: Maintain the known, unknown, blocked, and ready frontier for a discovery loop without mutating tracker state.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["discovery/_molecules/discovery-loop/discovery-loop.md"]
---

# Frontier Ledger

Track what the discovery loop knows and what can happen next.

## Frontier States

| State | Meaning |
| --- | --- |
| `ready` | Enough evidence exists for specification; persist `frontierRoute` as the exact structured tuple `{route: ready, applicability: not-applicable, rationaleCode: discovery-frontier-ready-for-spec}`. |
| `needs-product-design` | Product behavior and scope are aligned, but experiential uncertainty must be settled before specification; persist `{route: needs-product-design, applicability: required, rationaleCode: discovery-frontier-requires-product-design}`. |
| `needs-interrogate` | A pointed question must be answered; persist `{route: needs-interrogate, applicability: unresolved, rationaleCode: discovery-frontier-needs-interrogate}`. |
| `needs-domain-mapping` | Terms, actors, systems, boundaries, or relationships block progress; persist `{route: needs-domain-mapping, applicability: unresolved, rationaleCode: discovery-frontier-needs-domain-mapping}`. |
| `needs-proof-of-concept` | A small bounded prototype is the cheapest way to answer the discovery question; persist `{route: needs-proof-of-concept, applicability: unresolved, rationaleCode: discovery-frontier-needs-proof-of-concept}`. |
| `needs-research` | The blocker is knowledge that does not exist in reachable evidence and must be sought outside it; persist `{route: needs-research, applicability: unresolved, rationaleCode: discovery-frontier-needs-research}`. |
| `needs-uri-seed` | A human supplied a URI or path to investigate that has not yet been attempted, and its content has not yet been folded into the evidence. Persist `applicability: unresolved` and rationale `discovery-frontier-needs-uri-seed`. |
| `needs-more-evidence` | A named source or source type exists and is reachable, but has not been read. Persist `applicability: unresolved` and rationale `discovery-frontier-needs-more-evidence`. |
| `blocked` | The next step depends on unavailable authority, access, or a decision owner; persist `{route: blocked, applicability: unresolved, rationaleCode: discovery-frontier-blocked}`. |
| `stop` | Discovery should not continue because the request is out of scope or unsafe; persist `{route: stop, applicability: unresolved, rationaleCode: discovery-frontier-stopped}`. |

## Rules

- Keep confirmed facts separate from assumptions.
- Mark each frontier entry's origin so a human can tell a human-supplied seed
  from something the loop discovered and from something carried across runs: an
  entry folded in from a URI seed carries `origin: seed` and cites its source
  URI, an entry the loop found carries `origin: loop`, and an entry rehydrated
  from the persisted foundation at the start of a run carries `origin: foundation`
  and cites the foundation locator and revision it came from.
- Unresolved frontier entries and open questions survive across invocations
  because they are carried in the persisted foundation and rehydrated at the
  start of the next run, not held in conversation memory. A question already
  settled in the foundation is not reopened unless new evidence contradicts it.
- Keep unanswered questions visible.
- Assign every blocker an owner, source, or next workflow when known.
- Route to `proof-of-concept` when code can answer the question cheaply; do not
  pretend the prototype has already been run.
- Choose `needs-product-design` when the remaining uncertainty is what the
  experience should be rather than whether a technical approach works. Name the
  exact experiential uncertainty and route exactly one aligned subject.
- A `ready` route to specification must carry `product-design: not-applicable`
  and rationale code `discovery-frontier-ready-for-spec`. Absence is not non-applicability.
- Choose `needs-research` over `needs-more-evidence` when the answer is not
  reachable from the repository, the tracker, or supplied documents at all. The
  distinction is reachability, not difficulty: a source that exists and has not
  been read is `needs-more-evidence`; a fact nobody here has recorded is
  `needs-research`. Name the external question rather than the topic.
- Classify the frontier as `needs-uri-seed` only for a human-supplied URI or
  path seed that has **not yet been attempted**. A seed is attempted exactly
  once: once retrieved, or once refused with a named disposition, it is terminal
  and never returns to `needs-uri-seed`, so an unreachable, unsupported, or
  out-of-scope seed cannot spin the loop. After an attempt, reclassify from what
  the evidence now shows — continue on the remaining evidence, ask a clarifying
  question when only the human can supply or approve a replacement, or become
  `blocked` when the refused seed was indispensable. Distinguish a seed that
  could not be reached or read from one that was read and said nothing.
- Record why a next action is ready; do not merely name it.
- Do not mutate a tracker. A tracker update is a separate gated operation.

## Output

Return the frontier state, supporting evidence, blockers, ready next action,
deferred questions, and the structured `frontierRoute` route, product-design
applicability (`required` or `not-applicable`), and typed rationale code. These
exact fields are part of the aligned payload digest and persisted foundation
schema; downstream consumers parse them from the exact Discovery bytes and
never infer them from prose or accept a caller-supplied route.

## Boundaries

This atom is an in-memory ledger for the report. It is not a persistent tracker
and does not create or update issues, files, work items, or discovery records.
