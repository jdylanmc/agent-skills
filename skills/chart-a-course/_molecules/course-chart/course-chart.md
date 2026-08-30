---
name: course-chart
description: Combine deterministic graph normalization and course analysis into one bounded read-only dependency chart.
level: molecule
includes: ["chart-a-course/_atoms/graph-normalization/graph-normalization.md","chart-a-course/_atoms/course-analysis/course-analysis.md"]
composes: ["chart-a-course/_atoms/graph-normalization/graph-normalization.md","chart-a-course/_atoms/course-analysis/course-analysis.md"]
used-by: ["chart-a-course/SKILL.md"]
allowed-tools: ["execute"]
---

# Course Chart

Produce one evidence-grounded course to a named goal.

## Required References

1. [Graph normalization](../../_atoms/graph-normalization/graph-normalization.md)
2. [Course analysis](../../_atoms/course-analysis/course-analysis.md)

## Workflow

1. Bound the input to the supplied records, edges, revision, and observation
   time. If the goal or bound is unstated, stop for that evidence rather than
   searching an open-ended backlog.
2. Run graph normalization and preserve its defects, unresolved edges, and
   cycles.
3. Run course analysis against the normalized explicit graph.
4. Check that irrelevant work and its defects are visible but absent from every
   gating calculation. Refuse only defects that can change the goal's closure,
   order, lifecycle interpretation, or remaining weight.
5. Check that weighted mode is supported by reliable same-unit estimates on
   every remaining gating record. Otherwise use structural mode.
6. Return all ties, readiness evidence, blockers, confidence, unknowns, and one
   planning action.

## Defect Response

| Defect | Response |
| --- | --- |
| Goal outside graph | Refuse gating, path, readiness, and blocker conclusions. |
| Malformed input, collections, freshness, or temporal evidence | Report stable defects and refuse conclusions they affect. |
| Missing or duplicate identity | Report it; refuse when the identity can belong to the goal closure, otherwise qualify confidence. |
| Ambiguous direction | Preserve the unresolved edge; refuse when its referenced identities can affect the goal, otherwise qualify confidence. |
| Absent endpoint | Preserve the unresolved edge; refuse when its explicit dependent is in the goal closure, otherwise qualify confidence. |
| Cycle | Report every cycle; refuse path and frontier conclusions when it intersects the gating subgraph. |
| Stale or unavailable status | Preserve topology and the defect, but refuse path, ready-frontier, and blocker conclusions when the record gates the goal because completion and zero-weight membership are unknown. |
| Missing, fractional, mixed-unit, or unreliable estimate | Use structural mode and say it is not a time path. |

## Boundaries

This molecule observes and calculates. It does not prioritize, dispatch,
create, close, assign, reorder, or mutate work, and it does not invoke another
skill.
