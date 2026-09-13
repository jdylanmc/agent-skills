---
name: tracker-update-gate
description: Apply one explicitly approved discovery tracker update while keeping tracker mutation out of the discovery cycle body.
level: atom
allowed-tools: ["execute"]
includes: []
composes: []
used-by: ["discovery/SKILL.md"]
---

# Tracker Update Gate

Own the only tracker mutation path for discovery.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `target` | yes | The exact tracker, issue, work item, or discovery record to update. |
| `update` | yes | The exact text or field change proposed. |
| `approval` | yes | The operator's explicit approval for this exact target and update. |
| `evidence` | yes | The discovery packet entries that justify the update. |

## Operation

1. Present the exact target and update before mutation.
2. Proceed only after explicit operator approval for that exact update.
3. Apply only the approved update.
4. Return the provider result and a stable reference to the changed tracker.
5. If the provider fails, report the failure and leave the discovery packet as
   the durable evidence.

## Refusals

- No approval for the exact update.
- Ambiguous target.
- Update text contains unconfirmed facts.
- Update would create implementation tasks, acceptance criteria, or a domain
  map instead of recording discovery state.

## Boundaries

This gate mutates trackers only after approval. It does not gather evidence,
decide the update, run the discovery cycle, or broaden its own authority.
