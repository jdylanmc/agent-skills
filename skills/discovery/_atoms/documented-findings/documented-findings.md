---
name: documented-findings
description: Render acquired Discovery evidence into a reviewable findings packet before human alignment.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["discovery/_molecules/discovery-loop/discovery-loop.md"]
---

# Documented Findings

Make the current understanding visible before asking the human to align it.

## Operation

1. Preserve source claims, confirmed facts, assumptions, contradictions,
   decisions, risks, and unanswered questions as separate fields.
   The canonical findings schema is: `confirmedFacts`, `sourceClaims`,
   `relationshipClaims`, `boundaryClaims`, `evidenceReferences`, `decisions`,
   `constraints`, `assumptions`, `contradictions`, `risks`, `openQuestions`,
   `scope`, `exclusions`, and `resolved`. Every field is included in the
   `aligned-findings-digest`.
   `relationshipClaims` and `boundaryClaims` are arrays of structured,
   JSON-compatible object records, not prose strings. Each record preserves
   `source`, `target`, `relationship`, `direction`, `evidence`, `confidence`,
   and `notes`; nested evidence records and lists remain structured. All other
   findings fields remain arrays of scalar text except `resolved`, whose records
   are `{field, entry, resolution}` and whose `entry` has the same scalar-or-
   structured shape as the field it resolves.
2. Record what was found, what was uncovered by comparing sources, what remains
   unknown, and the evidence reference for each material claim.
3. Mark the packet `findings-documented`. This marker is input to the
   post-alignment domain-map gate; conversation memory or an informal summary
   cannot substitute for it.
4. Return the full findings packet without classifying the next frontier.

## Boundaries

- Read-only. This atom writes no files or trackers.
- No alignment. It prepares evidence for the human; it does not decide whether
  the human agrees.
- No domain model and no frontier selection. Both happen later in the
  controller, in that order.
