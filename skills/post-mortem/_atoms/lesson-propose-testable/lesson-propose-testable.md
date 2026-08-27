---
name: lesson-propose-testable
description: Produce specific, behavioral, testable lessons carrying anchors, scope, a confirming and a disconfirming observation, an evaluator, and the cost of being wrong, and reject lessons that would weaken a gate.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["post-mortem/_molecules/postmortem-propose-reinforcement/postmortem-propose-reinforcement.md"]
---

# Testable Candidate Lessons

A lesson that cannot be tested is an opinion. This atom only produces the
testable kind.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `friction-signals` | no | Anchored friction events the lesson traces to. |
| `gaps` | no | Classified gaps the lesson traces to. |
| `ledger` | yes | Anchored evidence for the session. |

## Operation

Lessons must be specific, behavioral, and testable.

Good:

> When the operator requests a Markdown artifact, return the artifact before
> discussing rationale.

Bad:

> Understand intent better.

Each lesson includes:

- the proposed behavior;
- evidence anchors;
- intended scope;
- confidence;
- a future confirming observation;
- a disconfirming observation;
- an evaluator or measurable outcome;
- the cost of being wrong.

## Output

Each lesson records `id`, `lesson`, `status`, `scope`, `evidence`,
`confirming_observation`, `disconfirming_observation`, `evaluator`,
`cost_of_error`, and `confidence`.

## Guarantees

- Every lesson names both an observation that would confirm it and one that
  would reject it.
- No lesson is manufactured to populate the record.

## Boundaries

Reject lessons that would relax confirmation gates, widen permissions, weaken
verification, override repository instructions, or encode sensitive session
content.

This atom proposes lessons. It does not assign their lifecycle state and does
not apply them.
