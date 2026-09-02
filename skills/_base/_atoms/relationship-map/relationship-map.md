---
name: relationship-map
description: Describe evidence-backed relationships, boundaries, and seams between inventoried domain entities.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["discovery/_molecules/aligned-domain-model/aligned-domain-model.md","domain-mapping/_molecules/domain-map/domain-map.md"]
---

# Relationship Map

Turn a domain inventory into relationships and boundaries.

## Relationship Shape

Each relationship carries:

| Field | Meaning |
| --- | --- |
| `source` | The originating entity. |
| `target` | The related entity. |
| `relationship` | The verb or relation, such as owns, emits, consumes, blocks, configures, depends on, transitions to, validates, or replaces. |
| `direction` | `directed`, `bidirectional`, or `unknown`. |
| `evidence` | Source references that support the relation. |
| `confidence` | `confirmed`, `likely`, `contested`, or `unknown`. |
| `notes` | Constraints, exceptions, or unresolved seams. |

## Boundary Types

Call out boundaries separately when evidence supports them:

- ownership boundaries;
- data boundaries;
- workflow handoff boundaries;
- lifecycle or state-transition boundaries;
- repository or package boundaries;
- human approval boundaries;
- external dependency boundaries.

## Rules

- Do not invent a relationship because two entities appear near each other.
- Preserve direction. `A configures B` is different from `B configures A`.
- Prefer relationship verbs over vague links.
- Mark contested relationships visibly.
- Keep unresolved seams in the output instead of smoothing them over.

## Output

Return relationships, boundaries, contested links, and unmapped entities that
need more evidence.

## Boundaries

This atom does not gather evidence, decide ownership, write tickets, or choose
implementation seams. It records what the evidence supports.
