---
name: aligned-domain-inventory
description: Extract domain entities only from the exact human-aligned Discovery findings packet.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["discovery/_molecules/aligned-domain-model/aligned-domain-model.md"]
---

# Aligned Domain Inventory

Extract the domain nouns from the exact documented findings the human aligned.

## Inputs

- the aligned findings packet;
- its `aligned-findings-digest`.

## Operation

1. Read only the supplied aligned findings packet. Do not search repositories,
   retrieve sources, follow links, or add evidence after alignment.
2. Extract actors, systems, concepts, terms, states, events, policies, and
   external dependencies.
3. Preserve aliases, contested names, confidence, and source references already
   present in the packet.
4. Preserve the aligned relationship claims and boundary claims as distinct
   records carrying their source, target, verb, direction, evidence citation,
   confidence, and notes. Do not reduce them to an entity list before the
   relationship stage.
5. If modeling exposes a need for evidence absent from the packet, return that
   seam as unsettled. Discovery must acquire and document the evidence, then
   align again before it can enter a later model.

## Boundaries

- No read, search, execute, edit, or task capability.
- No new evidence after alignment.
- It preserves relationship and boundary evidence but does not adjudicate or
  map it. No frontier, persistence, or next-action authority.
