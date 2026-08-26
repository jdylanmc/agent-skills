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
- non-empty confirmed facts with references;
- decisions, assumptions, contradictions, and unresolved questions, supplied as
  arrays even when empty;
- non-empty scope and exclusions.

For Markdown, revisions are SHA-256 digests of the exact bytes. For a tracker
issue, revisions are stable provider revision identities such as an update
timestamp plus immutable item identity. The caller reads the current source and
supplies both values; equality is freshness. A missing or changed revision is a
refusal.

Discovery's own `verified` or `corrected` alignment becomes `confirmed` only
when the persisted artifact records that result. Raw conversation, a remembered
summary, or an issue that merely contains the word "confirmed" is not alignment.

## Operation

Validate with:

```text
node <atoms>/discovery-source.mjs --input <absolute-json-path>
```

The JSON file is an intake record, not the Discovery artifact itself. The
caller resolves and reads the artifact, extracts the bounded record, and the
validator proves the record has the required shape and freshness.

## Output

Return `ready` with the normalized source record, or a named refusal:
`invalid-source`, `unconfirmed`, `stale`, or `incomplete`.

## Boundaries

This atom validates a caller-resolved record. It does not browse a tracker,
read arbitrary paths, conduct Discovery, infer alignment, update the source, or
write a specification.
