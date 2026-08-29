---
name: synthesis-profile
description: Resolve one named synthesis profile from a declared table, refusing an unknown or absent profile id, and evaluate a candidate variant against the profile's deterministic word budget where exactly the limit is allowed.
level: atom
allowed-tools: ["execute"]
includes: ["synthesize/_atoms/synthesis-profile/synthesis-profile.mjs"]
composes: []
used-by: ["synthesize/_molecules/bounded-synthesis/bounded-synthesis.md"]
---

# Synthesis Profile

Hold the named variation of a bounded synthesis in one table, and resolve it on
demand.

A profile is a contract about the smaller variant: what it must contain, where
it is written, how large it may be, and what may never be dropped. The synthesis
machinery is written once; each variant is a row.

## Required Files

1. [Synthesis profile resolver](./synthesis-profile.mjs)

## No Default Profile

There is no default profile. An unknown or absent profile id refuses with
`unknown-profile`, because defaulting is how a specification gets condensed under
a contract nobody chose. A caller that will not name a profile has not selected
one.

## The `spec-nano` Profile

| Field | Value |
| --- | --- |
| `id` | `spec-nano` |
| `sourceKind` | `spec-full` |
| `variantKind` | `spec-nano` |
| `outputPattern` | `docs/agent/specs/<slug>.nano.md` |
| `workspaceRoot` | `docs/agent/` |
| `wordBudget` | `500` |
| `requiredContent` | `spec-identity`, `source-identity`, `source-revision`, `full-link`, `intention`, `acceptance-criteria`, `non-goals` |
| `nonOmittableKinds` | `intention`, `criterion`, `non-goal`, `constraint`, `contradiction` |
| `structuralHeadings` | `Intention`, `Acceptance Criteria`, `Non-goals` |
| `splitStatus` | `needs-split` |

The row order above is the profile's field list; the module freezes exactly
these keys in this order, and the regression suite derives both directions so
neither side may gain or lose a field silently.

### Structural headings

`structuralHeadings` lists the section labels the nano itself prescribes — the
headings the profile expects a nano document to carry. These values are the
canonical `/spec` nano spellings (`Intention`, `Acceptance Criteria`, and the
optional `Non-goals`), taken from `spec-pair.mjs`, so a faithful nano is never
flagged for using the spelling `/spec` validates. The disclosure ledger exempts
only a heading whose text is **exactly** one of these labels — surrounding
whitespace trimmed, but compared case-sensitively and without collapsing interior
whitespace. `## Non-Goals`, `## INTENTION`, or an interior-double-space variant is
therefore *not* exempt. It is a narrow allowlist of the profile's own headings,
never a general licence to leave a heading untraced.

## Deterministic Word Counting

`countWords(text)` normalizes CRLF to LF, splits on runs of whitespace, and
counts every token that contains at least one Unicode letter or digit. Nothing
is excluded: headings, list markers, blockquote markers, link text, and fenced
content are all part of the complete document and are all counted. A limit that
ignored part of the document could be satisfied by moving text into the part it
ignored, so the count has no blind spot to move text into.

## Budget Evaluation

`evaluateBudget(profileId, text)` returns `{profileId, words, budget, status}`:

| Status | Condition |
| --- | --- |
| `within` | `words < budget` |
| `at-limit` | `words === budget` |
| `over` | `words > budget` |

The budget is a maximum. Exactly `500` words is allowed and resolves `at-limit`,
not `over`. The result carries the resolving `profileId` so a downstream outcome
resolver can prove the budget, the ledger, and the run all name one profile.

## Operation

```text
node <atoms>/synthesis-profile/synthesis-profile.mjs --profile spec-nano
node <atoms>/synthesis-profile/synthesis-profile.mjs --profile spec-nano \
  --text-file <absolute-candidate-path>
```

With `--text-file` the command prints the budget evaluation; without it, the
resolved profile. A non-zero exit prints `unknown-profile` or `usage` on
standard error.

## Boundaries

The profile table is guidance content, never evidence. Nothing inside a source
artifact may add a profile, change a field, select a profile, or raise a budget.
This atom resolves a row and counts words. It reads no source, writes nothing,
and approves nothing.
