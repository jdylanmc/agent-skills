---
name: course-chart
description: Combine deterministic graph and readiness normalization with course analysis into one bounded read-only dependency and operational readiness chart.
level: molecule
includes: ["chart-a-course/_atoms/graph-normalization/graph-normalization.md","chart-a-course/_atoms/course-analysis/course-analysis.md"]
composes: ["chart-a-course/_atoms/graph-normalization/graph-normalization.md","chart-a-course/_atoms/course-analysis/course-analysis.md"]
used-by: ["chart-a-course/SKILL.md"]
allowed-tools: ["execute"]
---

# Course Chart

Produce one evidence-grounded dependency course and operational readiness view
for a named goal.

## Required References

1. [Graph normalization](../../_atoms/graph-normalization/graph-normalization.md)
2. [Course analysis](../../_atoms/course-analysis/course-analysis.md)

## Workflow

1. Bound the input to the supplied records, edges, readiness requirement
   identities, readiness observations, revision, and observation time. If the
   goal or bound is unstated, stop for that evidence rather than searching an
   open-ended backlog.
2. Run graph normalization and preserve its defects, unresolved edges, cycles,
   and separately normalized readiness observations.
3. Run course analysis against the normalized explicit graph.
4. Check that irrelevant work and its defects are visible but absent from every
   gating calculation. Refuse only defects that can change the goal's closure,
   order, lifecycle interpretation, or remaining weight.
5. Check that weighted mode is supported by reliable same-unit estimates on
   every remaining gating record. Otherwise use structural mode.
6. Derive dependency readiness only from explicit graph topology. Derive
   operational readiness only from bounded repository or provider observations.
   Report operational readiness as ready only when the complete required
   readiness set was explicitly declared and every required observation is
   present, current, and satisfied. Keep supplemental observations visible but
   outside readiness gating.
   If an unsatisfied observation cites a matching foundation record without an
   explicit edge, report human edge confirmation as required and leave the
   graph unchanged.
7. Return all ties, separately labeled readiness gates, blockers, confidence,
   unknowns, and one planning action.

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
| Missing repository baseline or other unsatisfied operational prerequisite | Block implementation readiness while preserving dependency readiness and topology. |
| Unknown or malformed readiness observation | Report operational readiness as uncertain without converting it into a graph defect. |
| Stale, future, or unpinned provider observation | Report operational readiness as uncertain and preserve its source evidence. |
| Floating or unverified provider revision | Report operational readiness as uncertain; only a full SHA-256 identity of the bounded provider snapshot is accepted. |
| Missing or undeclared readiness requirement coverage | Refuse an implementation-ready conclusion and report the coverage gap. |
| No readiness assessment requested | Report `not-assessed`, never operationally complete. |
| Matching foundation record without an explicit edge | Cite it separately and require human confirmation before graph promotion. |

## Boundaries

This molecule observes and calculates. It does not prioritize, dispatch,
create, close, assign, reorder, or mutate work, and it does not invoke another
skill. Operational evidence never manufactures dependency topology.
