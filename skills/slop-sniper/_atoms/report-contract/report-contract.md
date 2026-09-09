---
name: report-contract
description: Validate one evidence-only Slop Sniper report and its single parent-owned correction against the sealed snapshot and closed authority vocabularies.
level: atom
allowed-tools: ["execute"]
includes: ["slop-sniper/_atoms/report-contract/report-contract.mjs","slop-sniper/_atoms/report-contract/report-contract.schema.json"]
composes: []
used-by: ["slop-sniper/_molecules/orchestration-audit/orchestration-audit.md"]
---

# Report Contract

Accept only a report that stays bound to the sealed snapshot, proves every
finding from named observations, and routes one correction without acquiring
mutation authority.

## Required Files

1. [Report contract validator](./report-contract.mjs)
2. [Canonical prompt-facing report schema](./report-contract.schema.json)

## Canonical Shape

`report-contract.schema.json` is the one complete prompt-facing authority. Its
standard JSON Schema keywords and conditionals declare every required key,
closed vocabulary, string bound, array bound, nested shape, and
machine-expressible compatibility rule. Its binding `$comment`, description,
and `x-` annotations declare the report byte ceiling, all non-evidence
outcome compatibility, exact one-per-finding audit projection, failure-only
cluster derivation, and the evidence-role proof for all 18 categories. The
validator imports those values directly; it does not keep parallel constants or
hidden category rules. The orchestrator supplies the file verbatim to the
no-tools specialist and explicitly marks every annotation as binding.

The schema also owns the rules JSON Schema cannot evaluate without the sealed
snapshot or cross-array identity comparison: high confidence requires complete
anchored observations; `correction.findingIds` is exactly all findings; and
directive targets are work identities derived from referenced findings or the
current-work inventory.

## Finding Contract

Every finding contains the keys required by the canonical schema, including:

- stable identity;
- one closed category;
- `critical`, `high`, `medium`, or `low` severity;
- evidence-anchor identities;
- affected-work identities;
- consequence;
- `high`, `medium`, or `low` confidence;
- disconfirming-evidence anchors, explicitly empty when none were observed;
- root correction;
- local actions the owning workflow should stop;
- validation that would prove the correction;
- privacy handling: the schema conditional requires `anchors-only-redacted` for
  privacy findings and `not-applicable` for every other category.

The category enum in the canonical schema is exhaustive. The earlier
catch-all category was deliberately removed because it would let unsupported
concerns bypass the reviewed taxonomy. A concern that does not fit a named
category remains a non-finding until a human revises the taxonomy; it must not
be forced into the closest category.

Every finding has exactly one `findingAudits` projection. It assigns all and
only the finding's evidence anchors to the schema-defined roles for that
category. The table declares permitted assertions, observation kinds, source
kinds, completeness, sensitivity, minimum counts, work coverage, and relations
such as matching fingerprints, common bases, distinct heads, matching subjects,
independent sources, strict activity overlap, post-terminal ordering, and
out-of-manifest membership. Missing roles, extra anchors, and role substitution
fail validation.

Duplicate investigation proof requires overlapping assignment and worker
activity plus equal explicit hypothesis, scope, and validation purpose.
Duplicate implementation proof requires the same three dimensions, overlapping
assignments, and exactly one overlapping resource pair: branches, change
requests, or schedules. Distinct dimensions or non-overlapping sequential work
reject the finding.

Stale proof uses exactly one resource-specific terminal/continuation pair for
workers, branches, change requests, or schedules. The activity must start before
the terminal observation, remain active after it, and name the same resource.
A replacement or restarted resource in a valid sequential handoff cannot
satisfy the stale relation. Out-of-manifest issue proof uses an explicit `issue`
observation rather than a generic resource placeholder.

Shared-root proof is deliberately stronger: branch evidence names one matching
`baseRevision`, distinct independent head revisions, and distinct work
identities; changed-path and failure evidence cover every work identity;
component-ownership evidence names the failing component outside local
ownership; every failure has one matching fingerprint; and the finding has one
exact `repeatedFailureCluster`. Cluster anchors may contain only matching
failures, and cluster membership is the exact work union derived from them.

## One Correction

The report contains exactly one correction:

- one strategy from the canonical schema;
- `authority: parent-only`;
- every finding identity;
- zero or more parent directives from the validator's closed, non-destructive
  directive set;
- zero or more named human decisions;
- validation for the owning workflow.

The report has no direct-action field. Unknown fields fail validation. Slop
Sniper never edits code or tracker state, deletes branches or artifacts, stops
processes, cancels schedules, changes ownership, or executes its recommendation.
Every affected-work identity must be named by cited snapshot observations.
Every correction target must be a work identity derived from the directive's
referenced findings or the normalized current-work inventory. The validator
also applies the repository's deterministic redaction floor to every returned
string and rejects sensitive values rather than returning a modified report.
Current-work inventory state must use the shared snapshot work-state vocabulary
and match an explicitly state-bearing observation for that work. The schema's outcome table is authoritative for strategy/status compatibility,
clean outcomes, statuses that require findings, critical findings, named human
decisions, and privacy routing. Every privacy finding independently requires
the declared status and strategy, a parent publication pause covering its
affected work, and the declared human privacy decision.

Privacy findings contain only evidence anchors, require the parent to pause
cross-boundary publication, and require human privacy authority. Sensitive
content must not be copied into the report.

Run:

```text
node skills/slop-sniper/_atoms/report-contract/report-contract.mjs \
  --snapshot <absolute-sealed-snapshot-json> \
  --report <absolute-report-json> \
  --persona-digest <wrapper-bound-sha256> \
  --schema-digest <wrapper-bound-sha256>
```

The wrapper reads the persona and schema bytes, calls
`createSpecialistPromptBinding` before dispatch, and passes the returned binding
unchanged to the specialist prompt and report validator. Substituted or stale
materials fail as `invalid-specialist-materials` before specialist dispatch.

## Output Sections

The exact JSON report carries snapshot identity and completeness, current work
inventory, findings, one category audit per finding, repeated failure clusters,
the one correction, validation plan, and final status.

The canonical schema defines the closed report statuses. `clean` requires a
complete snapshot, no findings, and an empty `continue` correction.

## Boundaries

- Well-formed is not approved. The parent or human decides whether to act.
- The validator never invents a finding or repairs an invalid report.
- Severity controls urgency only. It grants no permission.
- A missing or mismatched snapshot binding invalidates the whole report.
