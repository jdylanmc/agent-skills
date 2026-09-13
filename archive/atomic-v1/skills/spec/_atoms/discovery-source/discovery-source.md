---
name: discovery-source
description: Resolve exactly one Markdown or tracker-issue Discovery artifact into a confirmed, revision-bound intake record, refusing raw conversation, stale evidence, and materially incomplete shared understanding.
level: atom
allowed-tools: ["execute"]
includes: ["spec/_atoms/discovery-source/discovery-source.mjs"]
composes: []
used-by: ["spec/_molecules/product-specification/product-specification.md"]
---

# Discovery Source

Normalize the source that product requirements are allowed to rely on.

## Required Files

1. [Discovery source validator](./discovery-source.mjs)

## Accepted Sources

| Kind | Locator |
| --- | --- |
| `markdown` | A repository-relative Markdown path beneath `docs/agent/discovery/`. |
| `tracker-issue` | An HTTPS issue URL for the tracker item Discovery cycled around. |

Both kinds become the same intake record. The source kind changes how the caller
reads it, never what proof of alignment or freshness is required.

## Required Intake Record

- schema version `1`;
- source kind and locator;
- `alignment: confirmed`;
- captured revision and current revision;
- `repositoryRoot`: the absolute path to the repository root, used to verify
  approval evidence against git objects;
- `specNanoPath`: the repository-relative path to the specification being
  resolved (`docs/agent/specs/<slug>.nano.md`), validated with the same slug
  vocabulary as `approval-state`. Required when `approvalEvidence` is present;
  may be `null` when no approval evidence is supplied. Binds the approval to
  this specific specification so an approval for one cannot hold another.
- `approvalEvidence`: an approval observation record from `approval-state`, or
  `null` when no observation was taken. The field carries only observed
  default-branch state. There is deliberately no field in which a caller may
  assert that something is approved.
- non-empty confirmed facts with references;
- decisions, assumptions, contradictions, and unresolved questions, supplied as
  arrays even when empty;
- non-empty scope and exclusions.

For Markdown, revisions are SHA-256 digests of the exact bytes. For a tracker
issue, revisions are stable provider revision identities such as an update
timestamp plus immutable item identity. The caller reads the current source and
supplies both values; equality is freshness.

### State-Dependent Freshness

When revisions differ, the outcome depends on the state of the specification
that depends on the source, resolved from `approval-state`, never from
narration:

| State | Revisions differ | Outcome |
| --- | --- | --- |
| **draft** (or no approval evidence) | yes | `stale` — refuse and re-derive. |
| **approved** | yes | `held` — only after verification and binding pass. |

A moved whole-file digest, on its own, never invalidates an approved
specification. Enrichment that is irrelevant or merely additive produces
silence. An approved specification is revisited only when enriched material
**contradicts** it, and detecting that is companion issue #123 and is not
decided here.

#### Verification is the only route to held

When approval evidence is present and the revisions differ, `discovery-source`
calls `verifyApprovalObservation` with the `repositoryRoot` and the observation
record. Verification recomputes digests from git objects and refuses when the
observation disagrees. Only a verified, approved result may produce `held`:
the awaited verifier result must be an object with `verified === true` **and**
`state === 'approved'`. Anything else — falsy, non-object, `verified` absent
or not exactly `true`, `state` not `'approved'` — refuses with
`invalid-source`. An unverified, unverifiable, or refused observation falls
through to `stale` or `invalid-source` — never to `held`.

The verifier is injected as a second parameter
(`validateDiscoverySource(input, { verify })`) whose default is the real
`verifyApprovalObservation`. The seam exists so tests are deterministic without
a fixture repository. The shipped command-line path uses git.

#### Binding: the approval is bound to the specification, source, and revision

The three-part binding that must all match for an approval to hold:

1. **Specification identity** — `approvalEvidence.nanoPath` must equal
   `specNanoPath`. An approval for one specification cannot hold another, even
   when both were derived from the same source at the same revision. An
   approval cannot be replayed onto a different specification.
2. **Source locator** — the published nano's declared `- Source:` line must
   equal the intake's `locator`.
3. **Source revision** — the published nano's declared `- Source revision:` line
   must equal the intake's `capturedRevision`.

The binding is proved by bytes a human merged, not by a claim the caller made.

When the published nano's declared source locator does not equal the intake's
`locator`, or its declared source revision does not equal the intake's
`capturedRevision`, or the approval evidence names a different specification
than the one being resolved, the hold is refused and the mismatch is named.

Additionally, provenance must be complete: both `publishedSource` and
`publishedSourceRevision` must be present (non-null) in the verifier result.
Absent, unparsable, or duplicated provenance (which the parser reports as null)
is a refusal naming which line was missing or ambiguous. A byte-matched but
malformed published nano therefore cannot hold a moved Discovery source.

Discovery's own `verified` or `corrected` alignment becomes `confirmed` only
when the persisted artifact records that result. Raw conversation, a remembered
summary, or an issue that merely contains the word "confirmed" is not alignment.

## Operation

Validate with:

```text
node <atoms>/discovery-source.mjs --input <absolute-json-path>
```

The JSON file is an intake record, not the Discovery artifact itself. The
caller resolves and reads the artifact, extracts the bounded record including
the `repositoryRoot` (an absolute path used to verify approval evidence against
git), and the validator proves the record has the required shape and freshness.

## Output

Return `ready` with the normalized source record when revisions match, `held`
with the approval record when an approved specification's source moved, or a
named refusal: `invalid-source`, `unconfirmed`, `stale`, or `incomplete`.

| Status | Freshness | Meaning |
| --- | --- | --- |
| `ready` | `fresh` | Revisions match. The source is unchanged since confirmation. |
| `held` | `held` | Revisions differ, but the specification is approved on the default branch. The specification remains valid and nothing is re-derived. |
| `stale` | — | Revisions differ and the specification is a draft or approval evidence is absent. Refuse and re-derive. |

## Boundaries

This atom validates a caller-resolved record. It does not browse a tracker,
read arbitrary paths, conduct Discovery, infer alignment, update the source, or
write a specification.
