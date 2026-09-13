---
name: domain-inventory
description: Extract domain terms, actors, systems, states, events, policies, and dependencies from evidence without deciding requirements.
level: atom
allowed-tools: ["read","search"]
includes: []
composes: []
used-by: ["domain-mapping/_molecules/domain-map/domain-map.md"]
---

# Domain Inventory

Collect the domain nouns and classify what each one is.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `subject` | yes | The domain or subdomain being mapped. |
| `source hints` | no | Files, issues, documentation, prior notes, or search terms. |
| `scope boundary` | no | Repositories, products, systems, teams, or workflows included or excluded. |

## Operation

1. Search only the requested repository or explicitly supplied sources unless
   the operator widens scope.
2. Extract named concepts and classify each as one of:
   - `actor`: a person, role, team, service owner, or external participant;
   - `system`: software, service, tool, repository, process, or data store;
   - `concept`: a business object, capability, policy, rule, artifact, or
     abstraction;
   - `state`: a lifecycle state, status, phase, or mode;
   - `event`: a trigger, transition, signal, handoff, or observed occurrence;
   - `dependency`: an upstream or downstream thing the domain relies on.
3. Record aliases, contested names, and terms that look overloaded.
4. Attach evidence references and confidence to each entry.
5. Mark guesses as guesses; do not silently promote them to vocabulary.

## Output

Return an inventory grouped by classification, plus:

- glossary entries and aliases;
- contested or overloaded terms;
- missing definitions;
- evidence confidence and source references;
- map-blocking questions.

## Boundaries

This atom inventories domain material. It does not map relationships, write
requirements, create a tracker, or decide what should be built.
