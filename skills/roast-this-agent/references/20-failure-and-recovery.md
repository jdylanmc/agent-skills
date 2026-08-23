---
includes: []
requires-skills: []
---

# Failure Reporting and Recovery

Every run returns the Artifact Roast shape defined in
`artifact-roastmaster.agent.md`, including every failure. Never return a raw
Artifact Roast Envelope, a bare status token, or an unlabeled partial review.

## Status Meanings

| Status | Reader-facing meaning |
| --- | --- |
| `Complete` | Every mandatory lens reviewed the staged agent evidence and the report is final. |
| `Insufficient review` | A mandatory lens did not produce a valid report. Some dimensions were never examined. |
| `Unsynthesized` | The envelope failed schema validation twice, so no findings were verified. |
| `Stale evidence` | The agent file or a linked prompt changed between staging and synthesis, so the findings no longer describe the live files. |
| `Awaiting artifact` | No readable agent definition or no valid input was supplied. |
| `Unsupported artifact type` | The target is not an agent definition. |

An empty `## Must Fix` section means the council accepted no findings **only**
when `Status` is `Complete` and `## What Was Not Reviewed` is `none`. For every
other status, state plainly that the review is incomplete and that an empty
findings section is not evidence of quality.

## Recovery Actions

- **`Insufficient review`** — name the failed roaster, its lens, and the
  uncovered dimensions in `## What Was Not Reviewed`. Report the accepted
  findings from the roasters that did complete. Recovery: rerun this skill; if
  the same lens fails again, review those dimensions manually before shipping.
- **`Insufficient review` from a coordinator load failure** — the resolved
  coordinator could not be read, or the loaded document lacked
  `# Artifact Roastmaster`, `## Inputs`, `## Coordinate Mode`,
  `## Synthesize Mode`, or `## Final Output` outside every fenced block. Step 2
  already fell back through the resolution order. Name every attempted path and
  list every dimension as uncovered. Recovery: restore `agents/artifact-roastmaster.agent.md`.
- **`Unsynthesized`** — name the schema defect. The workflow already retried
  `coordinate` once. Recovery: rerun this skill; if it fails again, the
  coordinator resolution is the suspect, so verify which source
  [Trusted lenses](./30-trusted-lenses.md) resolved.
- **`Stale evidence`** — name the changed entries. Recovery: stop editing the
  agent and rerun this skill against the settled files.
- **`Awaiting artifact`** — name the locator and the failed access or the
  rejected input. Recovery: supply one readable agent file inside the allowed
  review root.
- **`Unsupported artifact type`** — name the supplied target and route it:
  a skill package to `roast-this-skill`, a standalone prompt to
  `roast-this-prompt`, and source code or a diff to `roast-this-code`.

## Schema Validation Failure

The **Validate** operation in
`skills/_base/_molecules/roast-coordinate-review/roast-coordinate-review.md` validates the envelope
against the Envelope schema 1 checklist in
[Agent roast contract](./10-agent-roast-contract.md).

1. On the first failure, repeat the `coordinate` step once with a new Artifact
   Roastmaster instance and no prior roast context.
2. On the second failure, stop. Do not run `synthesize` on an invalid envelope.
3. Return `Status: Unsynthesized` and name the missing, duplicated, or
   misordered heading or field in `## What Was Not Reviewed`.

## Degraded but Valid States

These states reduce coverage without failing the run. Record each one in
`## Open Risks and Evidence Gaps` and in `## Council Summary`, and keep the run
status unchanged.

- **Doctrine unavailable** — the doctrine manifest did not resolve or did not
  verify. Record `Doctrine status: unavailable` with the reason. A standalone
  install outside the canonical repository layout is expected to reach this
  state.
- **Lens source fallback** — a lens document failed its integrity check or did
  not resolve, so the next declared source was used. Record the source that was
  used and the reason. If no source verifies for a **mandatory** lens, the run
  is `Insufficient review`.
- **Model fallback** — a roaster ran on a fallback model, or on the runtime
  default. `Runtime default` is also an evidence gap.
- **Triggered but dropped specialist** — more than three specialists triggered.
  Record each dropped specialist, its trigger, and the dimensions left
  uncovered.
- **`Not reached` dimension** — a mandatory roaster did not reach a named
  dimension. Record the dimension. A report whose every dimension is
  `Not reached` is a failed roaster instead.
- **Lens drift** — a resolved repository coach agent no longer covers a
  dimension the roast contract names, or names dimensions the bundled
  configuration omits. Record the lens, its actual digest, and the differing
  dimensions. This is the maintenance trigger to refresh the bundled
  configuration and its digest; see [Trusted lenses](./30-trusted-lenses.md).
- **Digest verification unavailable** — the runtime could not grant `execute`
  to the caller or coordinator. Return `Insufficient review` before staging
  evidence; no trusted source or evidence identity was verified.
- **Restricted or unreadable evidence** — never bypass the restriction. Record
  the path and the consequence for the affected dimensions.

## Reporting Rules

- `## What Was Not Reviewed` is always present. It is `none` only when `Status`
  is `Complete` and no degraded state was recorded.
- Every non-`Complete` status carries a non-empty `## What Was Not Reviewed`
  and a verdict that states the review is incomplete.
- Every empty section contains the single word `none`.
- A clean review is a valid result and is never padded with manufactured
  findings.
