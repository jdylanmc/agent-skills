---
name: repository-configuration
description: Compose repository-context detection and elicitation, context-artifact rendering, and the write gate into one bounded configuration outcome that reports a status only with the evidence that produced it.
level: molecule
includes: ["setup-repository/_atoms/repository-context/repository-context.md","setup-repository/_atoms/context-artifacts/context-artifacts.md","setup-repository/_atoms/write-gate/write-gate.md"]
composes: ["setup-repository/_atoms/repository-context/repository-context.md","setup-repository/_atoms/context-artifacts/context-artifacts.md","setup-repository/_atoms/write-gate/write-gate.md"]
used-by: ["setup-repository/SKILL.md"]
allowed-tools: ["execute","read","search"]
---

# Repository Configuration

Materialize one repository's agent context: resolve what the repository is,
render its configuration files, and gate the write behind a preview and a
confirmation.

```text
resolve context -> render artifacts -> gate the write
```

The three atoms run in order, and each one's failure maps to exactly one status
the skill reports. No status is ever returned without the evidence that produced
it, so `configured` means files were written and read back, and every refusal
names the target and the rule.

## Required References

1. [Repository context](../../_atoms/repository-context/repository-context.md)
2. [Context artifacts](../../_atoms/context-artifacts/context-artifacts.md)
3. [Write gate](../../_atoms/write-gate/write-gate.md)

## Entry Conditions

The molecule runs when the operator asks to set up a repository's agent context.
It needs a repository root it can read and, where detection cannot settle a
required fact, an operator who can answer for it. It does not begin rendering
until the context resolves `complete`.

## Workflow

1. Run [Repository context](../../_atoms/repository-context/repository-context.md).
   Detect the repository root and remotes, classify the provider, elicit only
   what detection could not settle, and normalize one context model. Stop before
   rendering unless the context is `complete`.

2. Run [Context artifacts](../../_atoms/context-artifacts/context-artifacts.md)
   on the complete context. Render `issue-tracker.md`, `domain.md`, and
   `triage-labels.md`. `renderArtifacts` itself verifies the tracker-adapter
   contract before returning, so a rendered set that leaves a contract
   field unresolved is refused rather than written. The provenance helper is
   exposed for callers who need to check FOREIGN bytes and is not run from
   inside `renderArtifacts` (its byte-equality and identity-projection
   checks cannot fail against the bytes the same call just produced).

3. Run [Write gate](../../_atoms/write-gate/write-gate.md). Build a preview
   that names every target path and content hash.

4. **Before requesting confirmation, display the complete preview.** Show
   every normalized value that entered the render — provider, host,
   organization, project, repository, default branch, target directory, item
   types, tracker operations, relationship kinds, mutation vocabulary, every
   label and its meaning, every state and its meaning, the domain identity
   and its vocabulary sources, and any custom tracker instructions — and,
   for each of the three files, either every rendered field or the complete
   rendered file bytes together with its content hash. Display the exact
   `previewId` alongside the content. This is a requirement of the workflow,
   not a suggestion: a confirmation that approves values the operator did
   not see is not the confirmed preview this molecule promises.

5. Accept a confirmation only after step 4. Invoke the write gate's
   `apply-preview` subcommand with the exact `previewId` and the literal
   confirmation grant token; both must match. The gate refuses unsafe or
   concurrently changed targets, writes the approved files through a safe
   open (atomic `O_NOFOLLOW` on POSIX; a check-open-verify sequence on
   Windows — see the residual note in the write-gate atom), and reads them
   back to report their identities and hashes. The executable enforces
   that a confirmation binds to one displayed preview; it cannot prove a
   human (rather than another agent) supplied the confirmation, so
   displaying the complete preview and obtaining that operator consent is
   this molecule's obligation, not the gate's.

## Status Mapping

Each atom's outcome maps to one of the skill's output statuses. The mapping is
total: every atom result the molecule can observe resolves to exactly one
status.

| Atom result | Status |
| --- | --- |
| Context is `complete`, artifacts verified, write confirmed and read back | `configured` |
| Confirmation absent or non-matching | `cancelled` |
| A required field is still unsettled | `needs-input` |
| The provider is not supported and no custom configuration was supplied | `unsupported-provider` |
| A target escapes the root, is a symlink, or is not a regular file | `unsafe-target` |
| A target changed since the preview, or the preview no longer hashes to its identity | `stale-preview` |
| The adapter contract is unsatisfied or a readback hash mismatches | `blocked` |

## Evidence Discipline

No status is reported without the evidence that produced it. `configured`
carries the readback identities and hashes. `needs-input` carries the named
missing fields. `unsupported-provider` carries the required custom configuration.
Every `unsafe-target`, `stale-preview`, and `blocked` names the target and the
rule it failed. A bare status with no evidence would be indistinguishable from a
guess, which is the failure this package exists to remove.

## Boundaries

- The molecule composes the three atoms and adds no capability of its own. It
  resolves, renders, and gates; it does not detect, render, or write directly.
- It reports a status only with the evidence behind it.
- It writes only through the gate, only what a confirmed preview named, and only
  inside the repository.
- It does not mutate a tracker, invent a provider or domain value, or widen a
  consuming skill's permissions.
