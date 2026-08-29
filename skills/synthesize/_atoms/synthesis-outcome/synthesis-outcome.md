---
name: synthesis-outcome
description: Resolve a bounded-synthesis run to complete, needs-split, refused, stale-source, or blocked from explicit structural binding, budget, ledger, and split evidence, worst to best, resolving the named profile and requiring the evidence to be internally consistent and profile-bound — revision equal to digest, budget equal to the profile budget, status recomputed from the words, candidate path matching the profile pattern with the source slug, and source inside the profile workspace — and treating a bare status stub, absent evidence, an unknown profile, or an inconsistency as blocked and never as complete.
level: atom
allowed-tools: ["execute"]
includes: ["synthesize/_atoms/synthesis-outcome/synthesis-outcome.mjs"]
composes: []
used-by: ["synthesize/_molecules/bounded-synthesis/bounded-synthesis.md"]
---

# Synthesis Outcome

Resolve one run to one status from evidence, not from optimistic narration.

This atom narrates nothing and reads no file. It is deliberately separate from
the synthesis it judges, so the thing that decides whether a run passed is not
the thing that produced the candidate.

## Required Files

1. [Synthesis outcome resolver](./synthesis-outcome.mjs)

## Inputs

`resolveOutcome({profileId, candidatePath, binding, budget, ledger, split})`
requires STRUCTURAL evidence, never a bare status stub:

- top-level `profileId` (non-empty string) and `candidatePath` (non-empty
  string);
- `binding`: `{status, sourcePath, revision, digest}` — `status` is `bound` or
  `stale-source`, `sourcePath` and `revision` are non-empty, and `digest`
  matches `^[0-9a-f]{64}$`;
- `budget`: `{words, budget, status, profileId}` — integer `words` and `budget`,
  a recognized `status`, and a `profileId`;
- `ledger`: `{status, digest, profileId, entries}` for a clean result, or a
  defect result carrying a `code`. A clean ledger's `digest` must equal
  `ledgerDigest(entries)` recomputed here;
- `split`: `{status: 'needs-split', ledgerDigest, profileId, proposals}`,
  required only when the budget is `over`. Each proposal must be a COMPLETE
  record — the shape a valid split partition produces — carrying a non-empty
  `slug`, `title`, `boundary`, and `rationale`, and a `units` array of one or
  more non-empty strings **at every index**, and there must be at least two of
  them. A sparse array such as `Array(1)` — length one but no member at index 0 —
  names no cohesive unit; each index is checked as an own property holding a
  non-empty string, so a hole is not vacuously accepted.

The `profileId` must be identical across the top level, the budget, and the
clean ledger. A mismatch is `blocked` with reason `evidence-profile-mismatch`.

## Resolution

Worst to best over an explicit table:

| Status | Meaning |
| --- | --- |
| `blocked` | The binding refused for any non-staleness reason, required evidence is absent or malformed, a bare status stub was supplied, the profile is unknown, a path is absolute or escapes the workspace root, the evidence is internally inconsistent, the ledger digest does not match its entries, one profile is not named throughout, or an over-budget run has no valid split evidence. |
| `stale-source` | The bound source moved since it was identified. |
| `refused` | A ledger defect means the profile cannot be satisfied without losing meaning. The defect code is the named reason. |
| `needs-split` | The variant is over budget with a valid partitioning proposal set bound to the same ledger and profile. |
| `complete` | The source is freshly bound, the budget is satisfied, and the ledger is clean. |

This table **owns** the status vocabulary; `synthesis-outcome.mjs` exports it as
`STATUSES` and the regression suite derives both directions.

## Blocked Reasons

Every `blocked` path emits a stable hyphenated code, never prose. The `reasons`
array carries only the code; any human-readable detail rides in a separate
`detail` field, so a prose reason can never drift in unlisted. This table
**owns** the reason vocabulary; `synthesis-outcome.mjs` exports it as
`BLOCKED_REASONS`, and the regression suite drives the resolver down each blocked
path, collects the emitted reason, and asserts it is a member of `BLOCKED_REASONS`
and appears here — so a prose reason emitted anywhere fails the suite.

| Reason | Blocked when |
| --- | --- |
| `binding-missing` | No `binding` object was supplied. Missing evidence is unmet evidence. |
| `binding-refused` | The binding refused for a non-staleness reason (a `status` other than `bound` or `stale-source`). The refusing status or reason rides in `detail`. |
| `profile-id-missing` | No non-empty top-level `profileId` accompanies the evidence. |
| `unknown-profile` | The top-level `profileId` names no profile in the table. |
| `candidate-path-missing` | No non-empty `candidatePath` accompanies the evidence. |
| `binding-evidence-incomplete` | `binding.sourcePath` or `binding.revision` is empty, or `binding.digest` is not a 64-hex digest. |
| `budget-evidence-incomplete` | `budget` is not `{words: integer, budget: integer, status, profileId}` with a recognized status. |
| `evidence-profile-mismatch` | The `profileId` is not identical across the top level, the budget, and the clean ledger. |
| `ledger-evidence-missing` | No `ledger` object carrying a `status` was produced. |
| `revision-digest-mismatch` | `binding.revision` is not equal to `binding.digest`; the revision IS the content digest. |
| `budget-not-profile-bound` | `budget.budget` is not the resolved profile's `wordBudget`. |
| `budget-status-inconsistent` | `budget.words` is not a non-negative integer, or `budget.status` is not what the profile's rule derives from `words` versus `budget`. The supplied status is recomputed, never trusted. |
| `source-path-absolute` | `binding.sourcePath` is an absolute path — a leading `/`, a Windows drive like `C:`, or a UNC `//server` form — rather than a workspace-relative path. It is refused outright, not stripped to a relative-looking remainder. |
| `source-path-escapes-root` | `binding.sourcePath` begins with a `..` that pops above the relative root. That is an escape, refused rather than silently dropped. |
| `candidate-path-absolute` | `candidatePath` is an absolute path rather than a workspace-relative path. |
| `candidate-path-escapes-root` | `candidatePath` begins with a `..` that pops above the relative root. |
| `candidate-path-mismatch` | The normalized `candidatePath` is not the profile's `outputPattern` with the same slug as the normalized `binding.sourcePath`. |
| `source-outside-workspace` | The normalized `binding.sourcePath` is not beneath the profile's `workspaceRoot`. Interior `.`/`..` segments that stay within the root are collapsed first; an absolute path or a root-escaping `..` was already refused above, so only a contained path that simply sits elsewhere reaches here. |
| `ledger-evidence-incomplete` | A clean ledger's `digest` is not a 64-hex digest, its `profileId` is empty, or its `entries` are absent. |
| `ledger-digest-mismatch` | The clean ledger's `digest` is not `ledgerDigest(entries)` recomputed here. An unverified digest could name a ledger the run never validated. |
| `split-not-proposed` | The budget is `over` but `split` is absent or its `status` is not `needs-split`. |
| `split-ledger-mismatch` | The over-budget `split.ledgerDigest` is not the clean ledger's digest, so the split partitions a different ledger. |
| `split-profile-mismatch` | The over-budget `split.profileId` is not the run's `profileId`. |
| `split-proposals-incomplete` | The over-budget `split.proposals` has fewer than two entries, or any entry lacks a non-empty `slug`, `title`, `boundary`, `rationale`, or `units`, or any member of an entry's `units` array is not a non-empty string. A structurally empty `{}` proposal proposes no boundary, and a `units: [null]` or sparse `Array(1)` array — which a valid split partition never produces — names no cohesive unit. |

## A Status Stub Is Not Evidence

`{status: 'bound'}`, `{status: 'within'}`, and `{status: 'clean'}` name an
outcome without carrying the identity, path, counts, and digests the checks
produce. Each resolves `blocked`, never `complete`. An absent binding, budget,
or ledger resolves `blocked` for the same reason: a run that cannot show its
checks is not a run that passed them. A `stale-source` binding resolves
`stale-source` before the candidate, budget, and ledger are demanded, because a
stale run legitimately renders no candidate to measure.

Beyond structure, the resolver checks that the evidence is internally consistent
and profile-bound: the revision is the digest, the budget is the profile's
budget, the status is what the profile's rule recomputes, both paths are
relative and contained — an absolute path or a `..` that escapes the relative
root is refused outright rather than normalized into a workspace-looking
remainder — the candidate path is the profile's pattern with the source's slug,
the source is inside the profile's workspace, the clean ledger's digest is the
digest of its own entries, and an over-budget run's split evidence names the same
ledger and profile with at least two complete proposals. It is a **pure
resolver** over the evidence the other atoms produced in the same run: it
deliberately does not re-read the source or candidate and does not recompute any
stage, because that
would collapse five atoms into one. Its guarantee is therefore narrow — the
evidence is internally consistent and profile-bound — **not** that the artifacts
exist as described. It proves consistency, not truth. A run whose pieces
contradict each other or the profile is `blocked`.

## Command

```text
node <atoms>/synthesis-outcome/synthesis-outcome.mjs --input <absolute-json-path>
```

## What `complete` Means

`complete` is a statement about mechanical checks: the source was bound, the
words fit, and no ledger defect was found. It is **not** approval. The variant
remains a candidate until a human approves it. This atom approves nothing.

## Boundaries

This atom classifies one run from evidence it is handed. It renders nothing,
reads no file to gather that evidence, writes nothing, and approves nothing.
