---
name: split-proposal
description: Evaluate a split proposal when required meaning will not fit a profile budget, deriving the non-omittable inventory from the validated disclosure ledger and requiring at least two secondary boundaries that partition it and carry substantive title, boundary, and rationale text, echoing the ledger digest, and refusing truncation, single-piece splits, degenerate or incohesive fields, overlapping boundaries, uncovered units, and undeclared units.
level: atom
allowed-tools: ["execute"]
includes: ["synthesize/_atoms/split-proposal/split-proposal.mjs"]
composes: []
used-by: ["synthesize/_molecules/bounded-synthesis/bounded-synthesis.md"]
---

# Split Proposal

When required meaning cannot fit the budget, propose a real split — never a
quiet loss.

Truncating the tail, moving authority into the companion document, or weakening
a criterion are all ways of pretending the meaning fit. The honest answer to
over-budget required meaning is a named refusal with proposed cohesive secondary
boundaries a human can act on.

## Required Files

1. [Split proposal evaluator](./split-proposal.mjs)

## Operation

`evaluateSplit({budgetStatus, proposals, ledgerEntries, profileId, ledgerDigest})`:

- The inventory of non-omittable source meaning — intention, criteria,
  non-goals, constraints, and contradictions — is **derived** from the validated
  disclosure ledger, never asserted by the caller. Every `ledgerEntries` entry
  whose `kind` is in the profile's `nonOmittableKinds` is a unit, keyed by its
  entry id. It is not criteria alone: an intention, a non-goal, a constraint, or
  a contradiction present in the ledger must all be assignable to a piece.
- `budgetStatus !== 'over'` returns `{status: 'not-required'}`. An unnecessary
  proposal is reported, never refused.
- `budgetStatus === 'over'` resolves the named profile, derives the inventory
  from the ledger entries, and requires `proposals` with at least two entries,
  each `{slug, title, boundary, units, rationale}`, that partition that derived
  inventory, returning `{status: 'needs-split', proposals, ledgerDigest,
  profileId}`.
- `ledgerDigest` is echoed in the result and, over budget, is **verified**: it is
  recomputed from `ledgerEntries` and must match, so a split cannot claim a ledger
  it did not partition. A missing or non-matching digest is `ledger-digest-mismatch`.
- `profileId` is echoed as the resolved profile id so a downstream outcome
  resolver can prove the split and the run name one profile.

## The Partition Rule

The proposal set must partition the derived inventory: every non-omittable ledger
unit appears in exactly one proposal's `units`, and no proposal cites a unit the
ledger never declared. A split that drops a unit, doubles one, or invents one is
not a split of the original meaning. Because the inventory comes from the ledger
rather than a hand-written list, omitting a constraint from a list can no longer
make an incomplete split partition perfectly.

## Substantive Fields

Every documented proposal field carries real text. `title`, `boundary`, and
`rationale` must each be non-degenerate under the same `MIN_ANCHOR_CHARS` (12)
and `MIN_ANCHOR_WORDS` (3) thresholds the disclosure ledger owns; this evaluator
imports them from `disclosure-ledger.mjs` so there is one definition, not two
that drift. A one-character `boundary` or `rationale` no longer passes.

## Refusals

| Code | Raised when |
| --- | --- |
| `invalid-input` | `budgetStatus` is not `within`, `at-limit`, or `over`, or `ledgerEntries` is not a list of entries each carrying a string `id` and `kind`. |
| `unknown-profile` | The named profile is absent from the profile table, so no non-omittable inventory can be derived. |
| `ledger-digest-mismatch` | Over budget, `ledgerDigest` is missing or does not equal the digest recomputed from `ledgerEntries`. A split must prove it partitions the exact ledger it names. |
| `insufficient-split` | Fewer than two proposals. A split into one piece is the original problem renamed. |
| `incohesive-boundary` | A proposal has a missing, blank, or degenerate `title`, `boundary`, or `rationale`, or cites no units. |
| `overlapping-boundary` | A unit appears in two proposals. |
| `uncovered-criterion` | A derived inventory unit appears in no proposal. |
| `unknown-criterion` | A proposal cites a unit the ledger never declared. |
| `invalid-slug` | A slug does not match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, or a slug repeats. |

This table **owns** the refusal vocabulary. `split-proposal.mjs` exports the same
codes as `REFUSAL_CODES`, and the regression suite derives both directions so
neither side may gain or lose a code silently. The `uncovered-criterion` and
`unknown-criterion` codes keep their stable names; their messages speak of units,
because the inventory is wider than criteria. A malformed command line prints a
separate `usage` error, which is an argument fault rather than a proposal refusal.

## Command

```text
node <atoms>/split-proposal/split-proposal.mjs --input <absolute-json-path>
```

The input JSON carries `budgetStatus`, `proposals`, `ledgerEntries`, `profileId`,
and `ledgerDigest`. Exit `0` prints the result; a non-zero exit prints a stable
refusal code.

## What This Evaluator Does Not Prove

What is mechanically checked is that the proposals partition the inventory
derived from the ledger and carry substantive text in every field. **Cohesion
itself is not mechanically provable** and remains a human judgement: a clean
split result is not a statement that the proposed boundaries are good ones, only
that they cover every derived unit once and say something concrete about each
piece. A reviewer still decides whether the proposed cut is the right one.

That the derived inventory is complete rests on the entries being the ones a
clean ledger validated. **This atom cannot detect entries that did not come from
a clean ledger** — it trusts the `ledgerEntries` it is handed. The caller must
pass exactly the entries the disclosure ledger validated, and the echoed
`ledgerDigest` is what ties the split to that ledger for a later check.

## Boundaries

This atom evaluates one proposed split. It renders nothing, writes nothing,
selects no boundary, and approves nothing. It never truncates, never relocates
authority, and never weakens a criterion; it only checks that a proposed split
is a real partition of substantive pieces.
