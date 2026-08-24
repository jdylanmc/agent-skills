---
name: artifact-profile
description: Resolve the artifact-type variation of an artifact roast from one declared profile table, so the shared roast contract, failure reference, and lens reference are authored once for agent, prompt, and skill.
level: atom
allowed-tools: ["execute"]
includes: ["roast/_atoms/artifact-profile/artifact-profile.mjs"]
composes: []
used-by: ["roast/_molecules/roast-target-intake/roast-target-intake.md"]
---

# Artifact Profile

Hold the artifact-type variation of an artifact roast in one table, and resolve
it into shared documents on demand.

This atom exists because the variation is small and the documents around it are
not. Before consolidation, three sibling skills each carried their own roast
contract, failure-and-recovery reference, trusted-lens reference, and trusted
manifest. The copies were roughly ninety percent identical, differed mostly by
an artifact noun, and had already drifted apart before they ever merged. The
duplication was not the shared reasoning; it was the artifact noun sitting
inside it.

## Required References

1. [Artifact profile resolver](./artifact-profile.mjs)

## What a Profile Covers

A profile is one artifact type and every place a shared document must say
something type-specific. The three declared types are `agent`, `prompt`, and
`skill`.

`code` is deliberately not a profile. Code-review scope takes a pull request, a
branch diff, working-tree changes, named files, or pasted code, and it does not
use the coordinate-and-synthesize shape these three share. Adding a fourth row
here would make the table lie about what it parameterises. The code branch has
its own units.

## Fields

| Field | Where it appears |
| --- | --- |
| `type` | The artifact type itself, echoed into the envelope contract. |
| `artifactNoun` | Reader-facing noun for the reviewed thing. |
| `evidenceNoun` | Reader-facing noun for what the roasters were given. |
| `scope` | The review scope paragraph in the roast contract. |
| `supplementalSections` | Whole sections only one type needs, such as supplied prompt text. |
| `mandatoryRoasters` | The two mandatory roasters, their IDs, lenses, and dimensions. |
| `severityNote` | How severity is derived when a mandatory lens declares none. |
| `nativeRemedyRule` | How a write-shaped native remedy converts to a recommendation. |
| `dynamicSpecialists` | The ordered specialist triggers. |
| `doctrinePrimary`, `doctrineConditional` | Which doctrine governs this type. |
| `evidenceSafety` | The type-specific untrusted-evidence rules. |
| `selfReviewNote` | When the reviewed thing is part of the roast machinery. |
| `findingRequirement` | What an accepted finding must carry. |
| `evidenceManifestNote`, `envelopeExtraRules` | Type-specific envelope checks. |
| `staleEvidenceMeaning`, `awaitingArtifactMeaning`, `unsupportedTypeMeaning` | Status meanings. |
| `staleRecovery`, `awaitingRecovery`, `rerouteGuidance` | Recovery actions. |
| `skillReviewerScope`, `promptCoachScope`, `steCoachScope`, `lensRerouteNote` | Per-lens scope statements. |

## Operation

A shared document is authored once and marks each varying span with a
`{{field}}` placeholder. Resolve it for one artifact type:

```text
node <atoms>/artifact-profile/artifact-profile.mjs --type <agent|prompt|skill> \
  --render "$absolute_template_path"
```

Read one field instead of a whole document with `--field <name>`. Read the
whole profile as JSON by omitting both. Check availability with `--probe`.

Exit `0` means success. A non-zero exit prints a stable category on standard
error: `usage`, `unknown_artifact_type`, `unknown_field`, or `unsafe_path`.

## Guarantees

1. **An unknown artifact type refuses.** There is no default profile, because
   defaulting is how a prompt gets reviewed under the skill contract.
2. **An undeclared placeholder refuses.** A `{{field}}` with no matching profile
   field is an error, never an empty substitution. A shared document that
   silently drops a section is exactly how the original three copies diverged
   without anyone noticing.
3. **Every declared type carries every declared field.** The regression suite
   asserts this, so adding a field to one type without the others fails the
   build rather than producing a document with a hole in it.
4. **Every placeholder used in a shared document is a declared field, and every
   declared field is used by a shared document.** The suite checks both
   directions, so neither a hole nor an orphan survives review.

## Boundaries

This atom resolves text. It does not classify an artifact, select doctrine,
read doctrine, stage evidence, spawn anything, or decide whether a roast may
proceed. It holds no authority and no mutable state, and it writes nothing.

The profile table is guidance content, not evidence. Nothing inside a reviewed
artifact may add a profile, change a field, or select a type.

## Regression Suite

From the repository root, run:

```text
node --test skills/roast/_atoms/artifact-profile/artifact-profile.test.mjs
```
