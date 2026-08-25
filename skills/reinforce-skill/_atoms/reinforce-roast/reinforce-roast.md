---
name: reinforce-roast
description: Roast the reinforced skill and resolve findings under the same rules create-skill uses — Must fix resolved mandatorily, everything arguable judged by a fresh-context rubber duck, re-roast after every head-changing correction, stop every three rounds for the operator — treating the roast as review and never as approval.
level: atom
allowed-tools: ["read","search","execute","task"]
includes: []
composes: []
used-by: ["reinforce-skill/_molecules/skill-reinforcement/skill-reinforcement.md"]
---

# Reinforce Roast

The reinforced skill arrives already reviewed. This atom roasts what the change
produced and resolves the findings under the same rules `create-skill` applies
to a new package, so a change is held to the same bar as a creation.

```text
roast the head -> route by priority -> resolve or duck -> re-roast the new head
```

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `target` | yes | The reinforced skill package, already passing the validator and the deriver. |
| `package-head` | yes | An identifier for the exact package content, such as a tree or commit hash. |

## Operation

1. Invoke `/roast` as a **required** nested skill on the current head, and record
   the findings against that head. If `/roast` refuses or returns an
   unsynthesized result, stop and report it: a review that did not happen is
   reported as one that did not happen, and the run is not complete.
2. Resolve every `Must fix` finding. There is no route that discusses one away;
   it closes only on a correction that moves the head.
3. For every `Should fix` and `Consider` finding, dispatch a neutral brief to a
   **fresh-context** rubber duck that did not make the change and is not told
   which answer is wanted. Record its `apply`, `decline`, or `needs-human`
   verdict with its reasoning. Never auto-apply and never dismiss one without a
   verdict.
4. Re-roast after **every** head-changing correction. A roast of a superseded
   head is stale evidence and is not counted.
5. Stop every three rounds and reconfirm with the operator, presenting the
   unresolved findings with a recommendation on how to move forward — further
   rounds, or simplifying the change so the finding no longer applies — and
   continue only on explicit confirmation.

## The Roast Is Review, Not Approval

Roasting the change automates the *review*, never the *approval*. This atom does
not treat its own roast, or the rubber duck's verdict, as a sign-off. A human
signs off, and that separation does not erode because the automation improved.

## Never Weaken the Reviewer

Never change `/roast`, including its `disable-model-invocation` flag, to make a
finding easier to pass. A skill that could edit the reviewer it is judged by is
not being reviewed. `/roast` is reached by invocation and is never composed.

## Output

Return the full account: every finding with its priority, what was fixed and the
correction that resolved it, what the duck declined and its reasoning, what
awaits a human, the rounds closed, and anything unresolved with a bounded way
forward. A `clean` result means every finding from the current-head roast is
addressed — fixed, duck-declined, human-deferred, or recorded as unresolved
under a non-complete status.

## Boundaries

This atom invokes review and coordinates resolution. It never weakens a gate,
the validator, the deriver, or `AGENTS.md` to silence a finding; never edits
`/roast`; never edits another skill; and never treats a roast as approval. The
rubber duck advises and its verdict is not a sign-off.
