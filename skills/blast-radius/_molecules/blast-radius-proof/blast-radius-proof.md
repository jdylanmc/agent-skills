---
name: blast-radius-proof
description: Trace a proposed change across direct and hidden consumers, prove the smallest safety-critical assertions through five evidence rungs, and return bounded risk states plus one regression-proof recommendation slot.
level: molecule
includes: ["blast-radius/_atoms/impact-trace/impact-trace.md","blast-radius/_atoms/assertion-ladder/assertion-ladder.md","blast-radius/_atoms/risk-proof-report/risk-proof-report.md"]
composes: ["blast-radius/_atoms/impact-trace/impact-trace.md","blast-radius/_atoms/assertion-ladder/assertion-ladder.md","blast-radius/_atoms/risk-proof-report/risk-proof-report.md"]
used-by: ["blast-radius/SKILL.md"]
allowed-tools: ["execute","read","search"]
---

# Blast-Radius Proof

Turn a proposed change into bounded evidence about what it can break.

## Required References

1. [Impact trace](../../_atoms/impact-trace/impact-trace.md)
2. [Assertion ladder](../../_atoms/assertion-ladder/assertion-ladder.md)
3. [Risk proof report](../../_atoms/risk-proof-report/risk-proof-report.md)

## Workflow

1. State the candidate change, baseline, repositories, revisions, environments,
   inclusions, exclusions, and evidence-access limits.
2. Run [Impact trace](../../_atoms/impact-trace/impact-trace.md). Continue past
   direct callers into evidence-backed cross-boundary consumers. Keep unresolved
   leads separate from confirmed impact paths.
3. From the confirmed impact paths, select the smallest set of
   safety-critical, falsifiable assertions. Every assertion names one concrete
   bad case. Do not create an assertion merely because a generic failure is
   imaginable.
4. Run [Assertion ladder](../../_atoms/assertion-ladder/assertion-ladder.md) for
   each assertion:

   ```text
   assertion -> exact source citation -> ruled-out bad case -> executable proof -> live reproduction
   ```

   Record progression separately from evidence outcome. Stop each ladder at the
   first rung that cannot advance, mark later rungs `not-attempted`, and retain
   the exact rung, reason, strongest supported claim, and next evidence needed.
5. Run [Risk proof report](../../_atoms/risk-proof-report/risk-proof-report.md).
   Classify every assertion exactly once as a confirmed risk, cleared risk, or
   unproven assertion. Reachability alone cannot confirm a risk: require
   demonstrated occurrence or evidence that necessarily produces the named bad
   case under the stated inputs and scope. Preserve each classification's
   evidence and scope.
6. Fill exactly one pre-merge regression-proof recommendation slot. Select the
   cheapest responsible proof that crosses the needed boundary, or set
   `regression-proof-status: unavailable` and provide a separate bounded
   next-evidence action and reason. Evidence acquisition is not itself a
   regression proof.
7. Return the report. If no assertion can advance beyond unsupported
   speculation, stop and report insufficient evidence rather than manufacturing
   a blast radius.

## Evidence Discipline

- Exact citations identify file and line or symbol, revision, command and
  working directory, query and scope, report location, or reproducible live
  observation.
- Search absence is bounded evidence only when the search expression and scope
  are recorded.
- Prior reports can point to evidence but do not inherit proof status without
  verifying their cited sources.
- A passing executable proof is bounded by its inputs and environment.
- Live reproduction is the strongest available observation, not universal
  proof and not permission to mutate a live system.

## QA Council Seam

The report is a stable blast-radius lens for a future QA council: it provides
boundaries, ladders, classifications, stopping points, and one proof
recommendation. The molecule neither invokes nor requires a council or judge.
It remains complete when invoked independently.

## Boundaries

- Read-only analysis and bounded non-mutating execution only.
- No candidate edits, test authorship, implementation advice, approval, merge,
  deployment, or risk acceptance.
- No cross-skill local composition and no dependency on future council,
  judging, or tactical-versus-strategic authority capabilities.
- Human operators retain approval and strategic authority.

  ## Provenance

  The evidence-ladder concepts were adapted in independently written language
  from `cursor/plugins` at pinned commit
  `46125561306434d8a1d7745d540d8932ab0cd2a2`.
