---
name: graph-normalization
description: Normalize bounded mixed work records and explicit prerequisite-to-dependent edges without repairing defective evidence.
level: atom
allowed-tools: ["execute"]
includes: ["chart-a-course/_atoms/graph-normalization/graph-normalization.mjs"]
composes: []
used-by: ["chart-a-course/_molecules/course-chart/course-chart.md"]
---

# Graph Normalization

Normalize one bounded dependency graph into a deterministic evidence record.

## Required Files

1. [Deterministic graph normalizer](./graph-normalization.mjs)

## Input

The input object contains:

- `goal`: one stable work identity;
- `revision`: the caller's graph or source revision;
- `observationTime`: a complete ISO-8601 timestamp in the exact grammar
  `YYYY-MM-DDTHH:mm:ss[.sss](Z|+HH:mm|-HH:mm)`, where the fractional component
  has one to three digits when present;
- optional `freshness.maxStatusAgeSeconds`;
- `records`: mixed work records with `id`, optional `kind`, `title`, `status`,
  `statusObservedAt`, `revision`, and optional estimate;
- `edges`: dependencies shaped as `{ "prerequisite": "A", "dependent": "B" }`.

An estimate is usable only when it has a positive safe-integer `value` in the
smallest unit the caller needs, a non-empty `unit`, and `reliable: true`.
Fractional values are preserved as unusable evidence and force structural
analysis; weighted analysis never compares floating-point sums.

## Operation

1. Require an object input, array-valued `records` and `edges`, and a valid
   `observationTime`. Validate calendar dates, clock fields, and numeric offsets
   explicitly; reject natural-language dates, timezone-less values, rollover
   dates, surrounding whitespace, offsets beyond `23:59`, and incomplete
   timestamps. When supplied, `freshness` must be an object containing a
   non-negative safe-integer `maxStatusAgeSeconds`. Report stable defects rather
   than substituting empty collections or disabling malformed policy.
2. Sort identities and edges lexically after validation.
3. Canonicalize known lifecycle states to `pending`, `active`, `blocked`,
   `completed`, or `unknown` while preserving the supplied status.
4. Validate every supplied status observation timestamp. Reject future or
   invalid observations. When freshness is enabled, require an observation
   timestamp for each status; mark observations beyond the limit stale.
5. Report malformed records, missing identities, and duplicate identities. Do
   not merge duplicate records.
6. Accept only edges with exactly one explicit `prerequisite` and `dependent`.
   Report ambiguous direction, missing endpoints, and duplicate edges.
7. Detect directed cycles and preserve every member in deterministic order.
8. Return normalized records, accepted edges, unresolved edges, cycles,
   defects, and observation metadata.

## Boundaries

- Never infer edge direction from `source`, `target`, `before`, `after`, prose,
  record order, hierarchy, or issue-link type.
- Never invent an endpoint or choose one duplicate record as canonical.
- Never treat stale or unavailable state as completed.
- Never turn malformed input, collections, freshness policy, or timestamps into
  valid-looking defaults.
- Normalization reports evidence; it does not recommend work.
