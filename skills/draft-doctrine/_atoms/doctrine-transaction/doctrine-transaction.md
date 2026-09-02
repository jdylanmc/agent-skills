---
name: doctrine-transaction
description: Verify the strict doctrine trust root, bind one exact create or update candidate to prior doctrine, manifest, and optional NOTICE bytes, and persist only a fully approved transaction through the shared no-follow write gate.
level: atom
allowed-tools: ["execute","read","search"]
includes: ["draft-doctrine/_atoms/doctrine-transaction/doctrine-transaction.mjs"]
composes: []
used-by: ["draft-doctrine/_molecules/doctrine-authoring/doctrine-authoring.md"]
---

# Doctrine Transaction

Provide the deterministic boundary for one doctrine candidate. This atom reuses
the manifest parser from `doctrine-evaluate`, adds its doctrine-authoring
mapping and portability constraints, and reuses the transactional, no-follow,
rollback-capable write implementation from `setup-repository`'s `write-gate`;
code dependencies do not change the unit composition graph.

## Required Files

1. [Doctrine transaction implementation](./doctrine-transaction.mjs)

## Prepare

`prepareDoctrineChange` requires exactly one `create` or `update`, one canonical
identifier, the unchanged raw human position, Prompt Coach evidence bound to
that raw prompt, provenance, an exact candidate string, relevant doctrine
identifiers, and evidence-only overlap or contradiction findings.

It strictly parses `doctrine/manifest.md`, requires every path to equal
`<id>.doctrine.md`, rejects duplicate IDs/paths and case-fold or Unicode
normalization collisions on every platform, verifies every declared doctrine
path and digest before any is eligible for use, and returns text only for the
selected target and directly relevant identifiers. Descriptor-based no-follow
reads verify device, inode, regular-file type, and `nlink === 1` after open.
Platforms without `O_NOFOLLOW` use failure-honest lstat/open/fstat identity
comparison rather than claiming an atomic no-follow open.
The canonical repository root and doctrine directory are separately pinned as
non-link directories by device and inode, then rechecked before and after every
trust-root open. Symbolic links, hard links, path escapes, ancestor replacement,
and non-files fail closed. Node does not expose a portable descriptor-relative
`openat` walk, so there remains a narrow string-path resolution window between
an ancestor identity check and the open; the implementation documents rather
than conceals that residual.

The candidate is encoded once as UTF-8 without newline, normalization, BOM, or
other transformation. The result displays its exact text, Base64 bytes, byte
length, SHA-256 digest, and complete result. Update also displays an exact
line-preserving diff against the verified prior bytes.

A create candidate counts the complete document using deterministic
whitespace-separated tokens containing a Unicode letter or digit. It must
contain fewer than 500 words. Updates preserve existing doctrine length and do
not apply this creation limit.

Adapted material requires a closed verification record containing source
locator, pinned revision or digest, author, license identifier or text basis,
verifier identity and role, verified-at timestamp no older than 30 days,
explicit human compatibility decision, and attribution requirement. Unknown,
stale, changed, or incomplete verification is refused. The atom never judges
license compatibility. Required NOTICE text must be non-whitespace and contain
the verification record's author, license identifier, and source locator. It is
a separate candidate with a separate digest and approval identity.

## Exact Approval

Doctrine approval must repeat:

- the approval identity and literal `approve-doctrine-write` grant;
- operation, target identifier, and target path;
- candidate digest;
- prior doctrine digest and revision;
- prior manifest digest and revision.

When NOTICE is required, a second approval must repeat its separate approval
identity, literal `approve-notice-write` grant, candidate digest, and prior
NOTICE digest and revision. A correction changes the candidate digest and
approval identity. Rejection, a summary approval, silence, unrelated text, or a
record for another revision returns `cancelled` and writes nothing.

## Persistence

At apply, the complete prepared envelope is recomputed and compared byte for
byte before approval IDs are accepted. Relevant doctrine identities and
digests are approval-bound. Artifact order and preview order are bound by the
same prepared envelope and approval identity. Every relevant non-target
doctrine is also an unchanged entry in the shared write-gate
transaction: it cannot be mutated, drift at the real commit boundary fails the
gate, and final readback covers it. The ordered transaction is optional NOTICE
first, selected doctrine second, unchanged doctrine guards next, and manifest
last. The manifest is the policy commit indicator. The shared gate rechecks
content staleness, ancestor identity, collisions, and descriptor link count;
snapshots all prior bytes; and reverses caught partial commits on failure.
Success is returned only after writer readback plus complete manifest and every
declared doctrine digest verification.

A hard process termination is not rolled back or reported in-process. Before
the final manifest write it can leave an early approved NOTICE attribution
and/or changed doctrine whose digest no longer matches the old manifest; it
cannot leave a manifest-trusted changed doctrine missing its required NOTICE.
The next preparation blocks on doctrine/manifest mismatch when policy bytes
changed. An early NOTICE-only side effect is a residual limitation: it remains
valid attribution but requires ordinary human review and re-approval before
continuing. A stop after manifest may leave the fully ordered bytes on disk,
but no success was reported because full reread verification did not return.
Any rollback residue named by a caught-error result is a repair decision.

## Status and Error Vocabulary

Workflow statuses are `needs-input`, `needs-source`, `needs-decision`,
`needs-approval`, `approved-and-written`, `blocked`, and `cancelled`.
Stable refusal codes include `invalid-manifest`, `digest-drift`,
`unknown-doctrine`, `target-collision`, `unsafe-path`,
`hard-link-collision`, `license-unresolved`, `attribution-required`,
`prompt-coach-required`, `prompt-coach-mismatch`, `stale-state`,
`stale-preview`, `stale-prepared`, `stale-provenance`, `invalid-provenance`,
`invalid-finding`, `candidate-too-long`, and `reread-mismatch`.

## Boundaries

This atom cannot decide doctrine wording, accept coaching, resolve overlap,
approve, publish, merge, widen permissions, or implement policy. It receives
human decisions as data and enforces their byte binding. Invocation authorizes
preparation only; persistence remains unreachable without exact approvals.

## Regression Suite

```text
node --test \
  skills/draft-doctrine/_atoms/doctrine-transaction/doctrine-transaction.test.mjs \
  skills/draft-doctrine/_atoms/doctrine-transaction/doctrine-transaction.adversarial.test.mjs \
  skills/draft-doctrine/draft-doctrine.conformance.test.mjs
```
