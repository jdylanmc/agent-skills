---
name: reinforcement-assign-state
description: Apply the four-state reinforcement lifecycle, assigning PROPOSED, assigning OBSERVED only across independent operator-selected runs, and never assigning VALIDATED or PROMOTED.
level: atom
allowed-tools: ["execute"]
includes: ["post-mortem/_atoms/reinforcement-assign-state/reinforcement-assign-state.mjs"]
composes: []
used-by: ["post-mortem/_molecules/postmortem-propose-reinforcement/postmortem-propose-reinforcement.md"]
---

# Reinforcement Lifecycle State

Decide how far a candidate is allowed to travel, and stop it there.

## Required Files

1. [Lifecycle decision](./reinforcement-assign-state.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `candidate` | yes | One retained capability candidate or lesson. |
| `recurrence` | no | Whether the same pattern appeared in two or more independent operator-selected runs. |

## Operation

```text
node <atoms>/reinforcement-assign-state.mjs --runs '<selected runs as JSON>'
```

Each selected run supplies its run identifier, its session identifier, and its
correlation with the evidence being analyzed. The decision is arithmetic rather
than judgement, because advancing a candidate always looks defensible in the
moment it is being argued for:

- no selected run, or one, is `PROPOSED`;
- two logs recording one run is `PROPOSED`, since that is one attempt seen twice;
- two runs inside one session is `PROPOSED`, since that is two attempts at the
  same work;
- a run that records no session, or belongs to a different session, cannot
  establish independence and is `PROPOSED`;
- two identified runs in two sessions may be `OBSERVED`.

`ready_for_promotion` is `false` in every result, and `human_approval_required`
is `true` in every result.

## States

Use exactly these states:

- **PROPOSED:** A current-session candidate with a validation plan.
- **OBSERVED:** The same pattern is independently observed in a later session.
- **VALIDATED:** Applying the candidate in future interactions produces the
  expected measurable improvement without failing its disconfirmation test.
- **PROMOTED:** A human explicitly approves a separate durable change.

This skill may assign `PROPOSED`. It cannot claim recurrence from repeated
mentions within one session.

It may assign `OBSERVED` only when the operator explicitly selected two or more
independent Skill Run Logs and the same pattern appears in each, under the
recurrence rule that governs those logs. It can never mark a candidate
`VALIDATED` or `PROMOTED`, and it can never write a durable artifact.

Every proposed promotion recommendation must specify:

- the independent future evidence required;
- the evaluator and success measure;
- the minimum scope of the trial;
- the human approval required;
- the rollback or retirement condition.

## Output

| Field | Meaning |
| --- | --- |
| `status` | `PROPOSED` or `OBSERVED`. |
| `validation_requirements` | Independent evidence required, minimum trial scope, success measure, failure or retirement condition, and `human_approval_required: true`. |

## Guarantees

- `VALIDATED` and `PROMOTED` are never assigned here.
- Because validation requires independent later-session evidence,
  `promotion_recommendations.ready_for_promotion` is **always** empty in this
  skill's output.
- Nothing durable is written, applied, or promoted.

## Boundaries

**Error recovery.** If the operator asks for automatic application or
promotion, do not apply it. Record the requested next step as a separate
human-approved workflow.
