---
name: spec-pair
description: Persist and validate one authoritative nano Product Requirements Document and its supporting full sibling beneath docs/agent/specs, enforcing shared identity, provenance, links, and nano-to-full traceability.
level: atom
includes: ["spec/_atoms/spec-pair/spec-pair.mjs"]
composes: []
used-by: ["spec/_molecules/product-specification/product-specification.md"]
---

# Specification Pair

Write one product specification as two sibling documents with different
authority.

## Required Files

1. [Specification pair validator](./spec-pair.mjs)

## Destination

```text
docs/agent/specs/<slug>.nano.md
docs/agent/specs/<slug>.full.md
```

The slug is lowercase ASCII words separated by hyphens. Refuse traversal,
absolute paths, symbolic links, an existing directory in either location, and
any destination outside `docs/agent/specs/`.

## Nano Shape

Use this fixed order:

1. title;
2. `Spec ID`;
3. `Source`;
4. `Source revision`;
5. `Full specification` relative link;
6. `## Intention`;
7. `## Acceptance Criteria`;
8. optional `## Non-goals`.

Acceptance criteria are bullets beginning `- AC-###:`. IDs are unique. Nano
contains no background, alternatives, architecture, implementation plan,
tickets, Gherkin, or long rationale.

## Full Shape

Use this fixed order:

1. title;
2. the same `Spec ID`, `Source`, and `Source revision`;
3. `Nano authority` relative link;
4. `## Authority`;
5. product context sections;
6. `## Product Requirements`;
7. `## Product Decisions`;
8. `## Traceability`;
9. `## Open Questions`.

Every bullet under Product Requirements and Product Decisions contains one
authority marker: `[INTENT]` or `[AC-###]`. The marker must resolve to the nano
document. Detail without a marker remains context and is not written in either
authoritative section.

Keep confirmed facts, assumptions, contradictions, product decisions, and open
questions in separate sections. Every nano acceptance-criteria identifier
appears in Traceability, even when its evidence is currently incomplete.

## Write and Verify

Create the destination directory when absent. Write both candidates, reread
both paths, compare exact bytes, then validate:

```text
node <atoms>/spec-pair.mjs \
  --nano <absolute-nano-path> \
  --full <absolute-full-path>
```

Do not report either path until both writes, both rereads, and the pair
validation succeed. A partial pair is `blocked`; remove the new partial file
when the sibling write fails, but never overwrite or delete a pre-existing
artifact during recovery.

When the pair already exists, read and retain both prior digests before editing.
Refuse an update when either file moves underneath the run. Preserve the
existing specification identity and source identity; changing either starts a
different specification rather than silently replacing this one.

## Boundaries

This atom persists and validates the pair. It does not invent its content,
approve it, invoke Roast, edit Discovery, or write outside
`docs/agent/specs/`.
