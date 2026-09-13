---
name: document-interrogation
description: Combine an evidence packet and a question ledger into one document-grounded interrogation workflow.
level: molecule
includes: ["interrogate/_atoms/evidence-packet/evidence-packet.md","interrogate/_atoms/question-ledger/question-ledger.md"]
composes: ["interrogate/_atoms/evidence-packet/evidence-packet.md","interrogate/_atoms/question-ledger/question-ledger.md"]
used-by: ["interrogate/SKILL.md"]
allowed-tools: ["read","search"]
---

# Document Interrogation

Turn a rough idea and the available documents into a bounded interrogation
packet.

## Required References

1. [Evidence packet](../../_atoms/evidence-packet/evidence-packet.md)
2. [Question ledger](../../_atoms/question-ledger/question-ledger.md)

## Workflow

1. Establish the subject in one sentence. If the subject cannot be stated, ask
   the operator for that sentence before reading further.
2. Build the [Evidence packet](../../_atoms/evidence-packet/evidence-packet.md)
   from supplied sources and repository evidence.
3. Identify the tensions the evidence creates:
   - unstated assumptions;
   - contradicted claims;
   - terms used without definitions;
   - missing users, actors, systems, or boundaries;
   - unchosen tradeoffs;
   - verification gaps;
   - dependency order questions.
4. Use the [Question ledger](../../_atoms/question-ledger/question-ledger.md)
   to ask pointed questions. Prefer the question that blocks the most next work
   first.
5. Stop when either:
   - the next skill has enough settled material to proceed; or
   - the remaining questions require sources or people not available in the
     current conversation.
6. Produce the interrogation packet with evidence, answers, unresolved
   questions, and the recommended next workflow.

## Recommended Next Workflow

Choose exactly one primary recommendation:

| Recommendation | Use when |
| --- | --- |
| `continue-interrogation` | The next material question is still answerable here. |
| `domain-mapping` | Terms, actors, systems, boundaries, or relationships are the blocker. |
| `discovery` | The subject is clear enough to run a broader evidence-preserving investigation. |
| `specification` | Requirements and proof obligations are settled enough to specify. |
| `ticket-breakdown` | Scope and acceptance are settled enough to split work. |
| `implementation` | The work is already specified and no discovery decision remains. |
| `insufficient-evidence` | Required sources are missing or contradictory beyond what this skill can resolve. |

## Boundaries

- No tracker mutation, even when the next step is ticket breakdown.
- No domain model. A recommendation to run `domain-mapping` is not the map.
- No specification. A settled answer is still an answer, not acceptance
  criteria.
- No implementation instructions beyond naming what remains unsettled before
  implementation can begin.
