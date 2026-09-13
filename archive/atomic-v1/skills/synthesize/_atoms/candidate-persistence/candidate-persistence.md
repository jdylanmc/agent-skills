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
runId, profile?})`:

- requires the candidate path to be the one destination this run's contract
  names. The contract is read from the validated receipt (`outcome.contract`);
  `profile` supplies its terms only when the receipt names a contract that
  cannot be resolved by name, which is every declared reduction. Reading the
  contract off the receipt is better provenance than taking it as a separate
  argument nothing ties back to the run, and it leaves a named-profile call
  exactly as it was;
- requires a **declared** reduction's receipt to name the contract it was
  validated under, refusing with `contract-evidence-missing` when it does not.
  Absent evidence is not permission: two declared contracts can name the same
  destination while differing in budget, required content, or what may never be
  dropped, so a candidate validated under strict terms could otherwise be
  published under weaker ones. A **named** profile keeps its original receipt
  semantics — a path and a digest, contract optional — which is safe for a reason
  rather than by oversight: a declared workspace must sit beneath the one root
  declared reductions have, so no declared destination can collide with a named
  profile's;
- refuses publication under a contract other than the one the receipt was
  validated under, with `contract-mismatch`, whenever the receipt names one;
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

## The Accepted Destination Is Derived

There is no list of publishable paths. The one legal destination is this run's
own contract `outputPattern` with the source's slug, and the slug grammar admits
no separator and no dot, so a match cannot climb out of that destination or fan
out into a sibling directory. Anything else is `invalid-input`.

This used to be a regular expression naming `docs/agent/specs/<slug>.nano.md`
literally. That worked while one profile existed and would have silently refused
every other contract's candidate — and with contracts now declarable at run time
there is no fixed set to keep a list of anyway. What remains checkable, and what
is checked, is that the path being written is the path the contract this run
obeyed says to write, under the contract the receipt says was validated.

Write authority is not granted by the reduction terms. A declared contract may
only name a workspace beneath the single root declared reductions have, so a
semantic request never becomes permission to write wherever the requester
fancies; every other guard — repository containment, symbolic-link refusal on
every parent component, and refusal of any destination that already exists — is
unchanged.

## Result

Success returns:

```text
{ "status": "persisted", "candidatePath": <path>, "revision": <sha-256> }
```

Stable refusal codes are `invalid-input`, `contract-evidence-missing`,
`contract-mismatch`, `outcome-not-persistable`,
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
