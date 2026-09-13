---
name: poc-findings
description: Convert prototype observations and human feedback into a durable proof-of-concept findings packet.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["proof-of-concept/_molecules/prototype-learning/prototype-learning.md"]
---

# POC Findings

Turn the experiment into reusable learning.

## Findings Packet

Return:

- question tested;
- prototype scope and isolation location;
- artifacts created and whether each was deleted or preserved;
- commands run and relevant output references;
- observed behavior;
- what worked;
- what did not work;
- edge cases and constraints found;
- gaps or fixes needed;
- human feedback and interpretation;
- cleanup status;
- recommendation.

## Recommendation Values

| Recommendation | Meaning |
| --- | --- |
| `adopt` | The approach appears viable for the scoped goal. |
| `reject` | The approach does not fit the scoped goal. |
| `continue-poc` | Another bounded experiment is the next best way to learn. |
| `return-to-discovery` | Discovery should incorporate the learning and choose the next question. |
| `specify` | The learning is sufficient to write behavior/proof obligations. |
| `implement` | The learning supports implementation, but this skill still does not implement product code. |

## Boundaries

Prototype code is never the durable deliverable. The findings packet is the
deliverable. Preserve shortcuts, assumptions, and cleanup status so later work
does not mistake prototype success for production readiness.
