---
name: candidate-delivery
description: Drive each ready issue through revision-bound quality evidence, provider-neutral publication, real Shepherd ownership, and set-wide readiness expiry.
level: molecule
includes: ["_base/_atoms/review-tier-policy/review-tier-policy.md","ship-with-squadron/_atoms/quality-evidence/quality-evidence.md","ship-with-squadron/_atoms/provider-seam/provider-seam.md","ship-with-squadron/_atoms/readiness-set/readiness-set.md","ship-with-squadron/_atoms/fleet-disposition/fleet-disposition.md"]
composes: ["_base/_atoms/review-tier-policy/review-tier-policy.md","ship-with-squadron/_atoms/quality-evidence/quality-evidence.md","ship-with-squadron/_atoms/provider-seam/provider-seam.md","ship-with-squadron/_atoms/readiness-set/readiness-set.md","ship-with-squadron/_atoms/fleet-disposition/fleet-disposition.md"]
used-by: ["ship-with-squadron/SKILL.md"]
allowed-tools: ["execute","read","search","task"]
---

# Candidate Delivery

## Required References

For each ready issue:

1. apply [Review tier policy](../../../_base/_atoms/review-tier-policy/review-tier-policy.md)
   only when the issue's confirmed manifest packet opts in;
2. run [Quality evidence](../../_atoms/quality-evidence/quality-evidence.md);
3. publish through [Provider seam](../../_atoms/provider-seam/provider-seam.md);
4. validate real Shepherd ownership and manage expiry through
   [Readiness set](../../_atoms/readiness-set/readiness-set.md);
5. update [Fleet disposition](../../_atoms/fleet-disposition/fleet-disposition.md).

Persist and reread after every step that changes control state. Publication uses
intent-before-call and reconciliation. Shepherd intent `no` follows the
persisted not-required branch rather than a fabricated invocation. Effective
readiness is recomputed from current evidence after every sibling merge. Never
free a capacity slot by weakening a gate. A worker terminal transition
replenishes from the explicit ready frontier only.
