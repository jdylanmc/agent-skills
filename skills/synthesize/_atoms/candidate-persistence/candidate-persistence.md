---
name: candidate-persistence
description: Stage one validated candidate beside its profile-defined destination and promote it atomically only after a complete outcome, refusing an unapproved replacement and preserving the prior destination on every pre-commit failure.
level: atom
allowed-tools: ["execute"]
includes: ["synthesize/_atoms/candidate-persistence/candidate-persistence.mjs"]
composes: []
used-by: ["synthesize/_molecules/bounded-synthesis/bounded-synthesis.md"]
---

# Candidate Persistence

Persist only a candidate whose run resolved `complete`.

## Required Files

1. [Candidate persistence implementation](./candidate-persistence.mjs)

## Contract

`persistCandidate({repositoryRoot, candidatePath, candidateText, outcome,
runId})`:

- requires a profile-contained, repository-relative candidate path;
- requires `outcome.status === "complete"`;
- stages bytes to a unique sibling file, rereads them, and verifies their
  SHA-256 digest before promotion;
- binds the bytes and path to the candidate receipt returned by outcome
  resolution;
- refuses every existing destination rather than replacing prior authority;
- validates parent components and staging identifiers before writing; and
- uses an atomic same-directory hard-link creation as the commit point, so a
  destination that appears concurrently survives and the run blocks.

A refused, stale, blocked, `needs-split`, or failed run never promotes a
canonical candidate. Any pre-commit failure removes the staged sibling and
leaves the prior destination unchanged. Cleanup failures are retained in error
detail rather than masking the primary refusal.

## Result

Success returns:

```text
{ "status": "persisted", "candidatePath": <path>, "revision": <sha-256> }
```

Stable refusal codes are `invalid-input`, `outcome-not-persistable`,
`candidate-receipt-mismatch`, `replacement-not-authorized`,
`concurrent-modification`, `unsafe-path`, `staging-failed`, and
`verification-failed`. The caller maps any persistence refusal to final
`status: blocked`; `complete` is returned only after persistence succeeds.

If the destination link succeeds but removing the staged sibling fails, the
result remains `persisted` and carries `cleanupWarning: {staged,
filesystemCode}`. The canonical receipt is not discarded after the commit
point, and a retry is unnecessary; the named sibling can be removed later.

## Command

```text
node <atoms>/candidate-persistence/candidate-persistence.mjs \
  --input <absolute-json-path>
```

Exit `0` prints the persistence receipt. A non-zero exit prints a stable error
code, message, and diagnostic detail on standard error.

## Boundaries

This atom writes only the candidate destination selected by the resolved
profile. It does not render, validate, approve, or publish candidate content.
