---
name: domain-map
description: Combine a domain inventory and relationship map into one evidence-grounded domain model handoff.
level: molecule
includes: ["domain-mapping/_atoms/domain-inventory/domain-inventory.md","domain-mapping/_atoms/relationship-map/relationship-map.md"]
composes: ["domain-mapping/_atoms/domain-inventory/domain-inventory.md","domain-mapping/_atoms/relationship-map/relationship-map.md"]
used-by: ["domain-mapping/SKILL.md"]
allowed-tools: ["read","search"]
---

# Domain Map

Produce one bounded domain map from evidence.

## Required References

1. [Domain inventory](../../_atoms/domain-inventory/domain-inventory.md)
2. [Relationship map](../../_atoms/relationship-map/relationship-map.md)

## Workflow

1. State the domain subject and scope. If the subject cannot be stated in one
   sentence, ask for that sentence before mapping.
2. Build the [Domain inventory](../../_atoms/domain-inventory/domain-inventory.md)
   from supplied sources and repository evidence.
3. Build the [Relationship map](../../_atoms/relationship-map/relationship-map.md)
   from the inventory.
4. Check the map for:
   - entities with no definition;
   - relationships with no evidence;
   - overloaded or contested terms;
   - missing actors or owners;
   - unclear boundaries;
   - lifecycle states with no transitions;
   - dependencies with no direction.
5. Ask only the questions needed to keep the map honest. If a question becomes
   a requirements interrogation, recommend `interrogate` instead of absorbing
   that work.
6. Return the map, confidence, open seams, and next recommended workflow.

## Recommended Next Workflow

Choose exactly one primary recommendation:

| Recommendation | Use when |
| --- | --- |
| `interrogate` | A blocking requirement, assumption, or contradiction needs pointed questioning. |
| `discovery` | The domain is mapped enough for a broader evidence-preserving investigation. |
| `specification` | Vocabulary, boundaries, and relationships are stable enough to specify behavior. |
| `ticket-breakdown` | Scope and ownership are stable enough to split work. |
| `implementation` | The map shows no remaining domain uncertainty relevant to the requested work. |
| `insufficient-evidence` | Source material is too thin or contradictory to produce a useful map. |

## Boundaries

- No tracker mutation.
- No discovery loop state.
- No requirements, acceptance criteria, or implementation tasks.
- No invented ownership or relationship confidence.
- No silent collapse of contested terms into one preferred name.
