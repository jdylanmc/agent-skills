---
name: course-analysis
description: Restrict a normalized work graph to one goal's prerequisites and calculate dependency readiness, operational readiness, and tied weighted or structural gating paths.
level: atom
allowed-tools: ["execute"]
includes: ["chart-a-course/_atoms/course-analysis/course-analysis.mjs"]
composes: []
used-by: ["chart-a-course/_molecules/course-chart/course-chart.md"]
---

# Course Analysis

Calculate the dependency course to one goal from normalized explicit evidence.

## Required Files

1. [Deterministic course analyzer](./course-analysis.mjs)

## Operation

1. Normalize with the sibling graph implementation.
2. Traverse accepted edges backward from the named goal. The goal and only its
   transitive prerequisites form the gating subgraph.
3. Keep every other valid record under `outsideWork`; do not let it affect path,
   readiness, or blocker calculations.
4. Classify fresh, known gating records:
   - `completed`: lifecycle state is completed;
   - `ready`: not completed or active, not explicitly blocked, and every
     explicit prerequisite is completed;
   - `blocked`: explicitly blocked or has one or more incomplete prerequisites,
     with those prerequisite identities listed.
5. Refuse path, ready-frontier, and blocker conclusions when the goal is absent
   or malformed structure, temporal evidence, stale or unavailable gating
   status, duplicate identities, unresolved edges, or cycles can affect the
   goal's closure, order, completion membership, or zero-weight membership.
   Preserve the gating topology and defects. Keep unrelated defects visible and
   lower confidence without globally suppressing a clean goal course.
6. Preserve completed records in every path topology and give them zero
   remaining weight. Calculate weighted longest paths only when every
   non-completed gating record has a reliable same-unit safe-integer estimate.
   Otherwise calculate longest structural chains using zero for completed nodes
   and one for each remaining node, and label them as not a calendar or time
   critical path.
7. Sum structural and weighted values with exact integer arithmetic. Return a
   JSON number with `valueEncoding: number` when the total is safe, otherwise a
   base-10 string with `valueEncoding: decimal-string`.
8. Preserve every tied longest path in lexical order.
9. Derive confidence from uncertainties that can affect membership, mode,
   order, or weight. Cite source-backed statuses, status timestamps, freshness
   policy, estimate values, reliability, units, records, and edges with each
   material conclusion and reordering unknown.
10. Report dependency readiness from explicit edges only. Separately report
    operational readiness from bounded repository or provider observations.
    An unsatisfied prerequisite blocks implementation readiness; an unknown or
    malformed observation makes it uncertain without changing graph
    conclusions.
11. Report operational readiness as ready only when the caller explicitly
    declares the complete required readiness set and every required observation
    is present, current, and satisfied. Supplemental observations stay visible
    but do not gate readiness.
12. Preserve a supported unsatisfied prerequisite as a blocker even when other
    readiness evidence is malformed; expose the defects and lower confidence
    rather than erasing the known blocker.
13. Keep defects belonging only to supplemental observations outside the
    operational gate while retaining them in evidence completeness. Quarantine
    malformed citation fields without discarding a valid required observation.
14. Keep provider-supplied evidence origin-tagged and distinct from
    analyzer-derived edge, coverage, freshness, and citation evidence.
15. Report operational completeness only for an assessment with authoritative
    declared coverage; no assessment is `not-assessed`, not complete.
16. When an operational prerequisite cites a matching foundation record, show
    whether the corresponding edge is already explicit. Otherwise require
    human confirmation before it can enter dependency topology.
17. Return exactly one read-only planning action.

## Boundaries

- Dependency gating is not priority.
- Operational readiness gating is not dependency topology.
- A matching foundation record is a citation, not an inferred edge.
- An absent required repository baseline cannot produce implementation-ready
  output.
- Stale, future, or unpinned readiness evidence cannot support a ready or
  blocked operational conclusion.
- A ready record is not dispatched or selected for execution.
- Tied paths remain tied.
- Completed work stays visible but contributes no remaining path weight.
- This atom does not invoke or duplicate next-step-selection.
