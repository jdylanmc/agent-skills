---
name: postmortem-propose-reinforcement
description: Produce bounded reinforcement proposals by gating reusable candidates on the retention criteria, forming testable lessons, and assigning a lifecycle state no further than OBSERVED. Applies nothing.
level: molecule
includes: ["post-mortem/_atoms/candidate-gate-retention/candidate-gate-retention.md","post-mortem/_atoms/lesson-propose-testable/lesson-propose-testable.md","post-mortem/_atoms/reinforcement-assign-state/reinforcement-assign-state.md"]
composes: ["post-mortem/_atoms/candidate-gate-retention/candidate-gate-retention.md","post-mortem/_atoms/lesson-propose-testable/lesson-propose-testable.md","post-mortem/_atoms/reinforcement-assign-state/reinforcement-assign-state.md"]
used-by: ["post-mortem/SKILL.md"]
allowed-tools: ["read","search"]
---

# Propose Reinforcement

Convert a diagnosis into a small number of gated, testable proposals, and stop
short of adopting any of them.

## Required References

1. [Candidate discovery and retention gate](../../_atoms/candidate-gate-retention/candidate-gate-retention.md)
2. [Testable candidate lessons](../../_atoms/lesson-propose-testable/lesson-propose-testable.md)
3. [Reinforcement lifecycle state](../../_atoms/reinforcement-assign-state/reinforcement-assign-state.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `diagnosis` | yes | Friction signals, gaps, and hypotheses with anchors. |
| `package-root` | no | The repository containing this skill package, for prior-art grounding. |
| `recurrence` | no | Whether independent operator-selected runs showed the same pattern. |
| `evidence-gaps` | no | Recommendations the evidence assembly already produced, such as a missing harness adapter. |

## Operation

1. **Discover and gate** capability candidates with
   [Candidate discovery and retention gate](../../_atoms/candidate-gate-retention/candidate-gate-retention.md).
   Ground prior art in the skill package repository only, and keep at most three
   retained candidates.
2. **Form lessons** with
   [Testable candidate lessons](../../_atoms/lesson-propose-testable/lesson-propose-testable.md),
   each carrying a confirming and a disconfirming observation.
3. **Assign lifecycle state** with
   [Reinforcement lifecycle state](../../_atoms/reinforcement-assign-state/reinforcement-assign-state.md),
   passing `recurrence`. Without independent runs, everything stays `PROPOSED`.
4. **Carry forward an evidence gap** the assembly already identified. An
   unsupported harness arrives as a complete `PROPOSED` candidate with its
   traceability, evaluator, disconfirming observation, and validation
   requirements already stated; record it as a candidate rather than restating
   or re-deriving it, and never raise its lifecycle state. It does not count
   against the retention limit for candidates discovered in this session,
   because it was not discovered by judgement here.

## Output

| Field | Meaning |
| --- | --- |
| `candidate_skills` | Retained and classified candidates with their gate fields. |
| `skill_improvements` | Reviewed skills with evidence-backed strengths and weaknesses. |
| `candidate_lessons` | Testable lessons with evaluators and cost of error. |
| `reinforcement_opportunities` | Behaviors worth repeating, with a measurement and a repetition plan. |
| `validation_requirements` | What independent evidence each candidate needs, and the human approval required. |

## Guarantees

- Nothing is applied, written, validated, or promoted.
- No proposal is manufactured to fill the record. An empty result is valid.
- `ready_for_promotion` remains empty.
- A missing capability the run actually hit, such as an unreadable harness, is
  proposed rather than worked around.

## Boundaries

Package design and edits belong to Skill Coach or create-skill in a separate,
explicitly approved workflow.

This molecule never adds a capability the analysis found missing. A proposed
adapter is disposed by a person and built by a separate `reinforce-skill` run,
which is the only path from a gap here to a capability later.
