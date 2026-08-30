---
name: course-analysis
description: Restrict a normalized work graph to one goal's prerequisites and calculate readiness and tied weighted or structural gating paths.
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
10. Return exactly one read-only planning action.

## Boundaries

- Dependency gating is not priority.
- A ready record is not dispatched or selected for execution.
- Tied paths remain tied.
- Completed work stays visible but contributes no remaining path weight.
- This atom does not invoke or duplicate next-step-selection.
