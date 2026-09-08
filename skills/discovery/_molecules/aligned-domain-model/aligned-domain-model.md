---
name: aligned-domain-model
description: Convert exact human-aligned Discovery findings into a bounded domain model without acquiring new evidence or taking Discovery authority.
level: molecule
includes: ["discovery/_atoms/aligned-domain-inventory/aligned-domain-inventory.md","_base/_atoms/relationship-map/relationship-map.md"]
composes: ["discovery/_atoms/aligned-domain-inventory/aligned-domain-inventory.md","_base/_atoms/relationship-map/relationship-map.md"]
used-by: ["discovery/_molecules/cycle-controller/cycle-controller.md"]
allowed-tools: []
---

# Aligned Domain Model

Model only what the human-aligned findings support.

## Required References

1. [Aligned domain inventory](../../_atoms/aligned-domain-inventory/aligned-domain-inventory.md)
2. [Relationship map](../../../_base/_atoms/relationship-map/relationship-map.md)

## Workflow

1. Require the exact aligned findings packet and its
   `aligned-findings-digest`. Refuse offered, rejected, absent, or otherwise
   unverified alignment.
2. Build the
   [Aligned domain inventory](../../_atoms/aligned-domain-inventory/aligned-domain-inventory.md).
3. Build the
   [Relationship map](../../../_base/_atoms/relationship-map/relationship-map.md)
   from the inventory's preserved relationship and boundary claims, including
   their existing directions, confidence, and evidence references. Entity
   co-occurrence alone never produces a relationship.
4. Return actors, concepts, systems, terms, states, events, relationships,
   boundaries, confidence, unsettled seams, and the unchanged
   `aligned-findings-digest` as the model's basis receipt.

## Boundaries

- No evidence acquisition. A missing fact becomes an unsettled seam for a later
  Discovery cycle.
- Read-only transformation with no tool grant.
- No alignment, frontier, persistence, tracker, handoff, compaction,
  specification, or implementation authority.
