---
name: intent-storage-gate
description: Show the synthesized intent to the operator and refuse to store it until he confirms the exact words in front of him, invalidating the confirmation whenever the draft changes.
level: atom
allowed-tools: ["read","execute"]
includes: ["create-skill/_atoms/intent-storage-gate/intent-storage-gate.mjs"]
composes: []
used-by: ["create-skill/_molecules/intent-capture/intent-capture.md"]
---

# Intent Storage Gate

The intent is the operator's, not this skill's reading of it. A synthesis is a
guess until he says otherwise.

A stored guess is worse than no intent at all. It looks authoritative, it is the
input a regeneration trusts above everything else, and nothing downstream can
tell it apart from something he actually said. So confirmation is not a
paragraph asking the caller to remember; it is a state the gate is in, and
storing from any other state is refused.

## Required References

1. [Confirmation state machine](./intent-storage-gate.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `skill` | yes | The skill the intent belongs to. |
| `coverage` | yes | The completed elicitation record, re-checked here rather than trusted. |
| `draft` | yes | The synthesized intent presented to the operator. |
| `state-path` | yes | The absolute path to this intent's gate state file. |
| `intent-path` | yes | The absolute path the confirmed intent is stored at. |

## The Rules It Enforces

1. **Nothing is stored unconfirmed.** Storing requires the gate to be in
   `confirmed`. There is no route from a draft to a file that does not pass
   through the operator.
2. **A confirmation names the words it confirms.** It is bound to the exact
   bytes presented. A confirmation of any other text is stale and is refused.
3. **A correction invalidates the answer.** Every correction clears both the
   presentation and the confirmation, so an edited draft can never ride on a
   yes given to an earlier one.
4. **A question nobody asked has no answer.** The gate re-validates the
   elicitation record and refuses to open while a topic a regeneration needs is
   unanswered.
5. **Structure never reaches the file.** The draft is screened when it is
   presented and again when it is stored, so an intent cannot acquire machinery
   between the operator's yes and the write.
6. **An existing intent is never overwritten.** This skill creates new packages.
   Rewriting the intent of a skill it did not create is a different job.

## Operation

Apply one event per step:

```text
node <atoms>/intent-storage-gate/intent-storage-gate.mjs \
  --state "$absolute_state_path" --event "$absolute_event_path" --report
```

Exit `0` applies the event, `2` refuses it and names the rule, and `1` is a
usage or path failure. An unknown argument, an unknown event type, an unknown
state field, and an unknown event field are each a refusal rather than a silent
fallback.

| Event | Meaning |
| --- | --- |
| `create` | Open the gate for a skill, carrying the completed elicitation record. |
| `draft-presented` | The synthesized draft was shown to the operator. |
| `operator-corrected` | He corrected it; his words are recorded and the draft is re-presented. |
| `operator-confirmed` | He confirmed the draft currently in front of him. |
| `store` | Write the confirmed text, and only the confirmed text. |

Present the draft in full rather than summarising it. A confirmation of a
summary is a confirmation of something that is not what gets stored.

## Output

| Field | Meaning |
| --- | --- |
| `status` | `awaiting-draft`, `presented`, `corrected`, `confirmed`, or `stored`. |
| `confirmed` | Whether a confirmation currently stands. |
| `storedPath` | Where the intent was written, once it was. |
| `events` | Every event applied, in order. |

## Guarantees

- An unconfirmed synthesis is never stored.
- A confirmation cannot outlive the words it was given for.
- A stored intent is byte-for-byte what the operator confirmed.
- A stored intent has passed the plain-requirements screen.
- An existing intent file is never replaced.

## Boundaries

- The gate records and refuses. It does not draft the intent, does not judge
  whether the intent is any good, and does not approve the skill.
- It stores an intent only for the package being created.
- It never writes anywhere but the new package's own intent file.
