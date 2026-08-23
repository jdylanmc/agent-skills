---
name: intent-capture
description: Elicit what the operator wants the new skill to do before any structure exists, synthesize it into plain-English requirements, confirm the synthesis with him, and store it as the new package's intent.
level: molecule
includes: ["create-skill/_atoms/intent-elicitation/intent-elicitation.md","create-skill/_atoms/intent-synthesis/intent-synthesis.md","create-skill/_atoms/intent-storage-gate/intent-storage-gate.md"]
composes: ["create-skill/_atoms/intent-elicitation/intent-elicitation.md","create-skill/_atoms/intent-synthesis/intent-synthesis.md","create-skill/_atoms/intent-storage-gate/intent-storage-gate.md"]
used-by: ["create-skill/SKILL.md"]
allowed-tools: ["execute","read"]
---

# Intent Capture

What the skill is for is settled before what the skill is made of.

```text
elicit -> synthesize -> confirm -> store
```

The operator says what he wants in whatever shape it comes out. This writes it
back to him as clean prose, he corrects it until it is right, and only then is
it kept. Everything built afterwards follows from it.

## Required References

1. [Intent elicitation](../../_atoms/intent-elicitation/intent-elicitation.md)
2. [Intent synthesis](../../_atoms/intent-synthesis/intent-synthesis.md)
3. [Intent storage gate](../../_atoms/intent-storage-gate/intent-storage-gate.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `request` | yes | The operator's request for a new skill, however it arrived. |
| `skill-name` | yes | The package the intent belongs to. |
| `workspace` | yes | Absolute paths for the elicitation record and the gate state. |

## Operation

1. Ask with
   [Intent elicitation](../../_atoms/intent-elicitation/intent-elicitation.md).
   Show the opening ask verbatim and take the answer as it arrives. If the
   operator has already described the skill, treat what he said as the
   transcript and do not make him say it again.
2. Assess coverage against his own words and ask a targeted follow-up only where
   something a regeneration needs is genuinely missing. Fold each answer into
   the transcript and reassess until the record is complete.
3. Draft with
   [Intent synthesis](../../_atoms/intent-synthesis/intent-synthesis.md), in
   plain requirements, with rationale recorded at the human level.
4. Open the gate with
   [Intent storage gate](../../_atoms/intent-storage-gate/intent-storage-gate.md),
   present the full draft, and record his answer. A correction returns to step
   3 with his words attached; a confirmation is bound to the exact draft shown.
5. Store only on confirmation, at `skills/<new-skill>/intent.md`.
6. Carry the stored intent into the build. The single job, the routing
   description, the refusals, the permission grant and its justification, and
   the confirmation points all follow from it rather than being invented
   alongside it. Where the design and the intent disagree, the intent is what
   the operator asked for, so the design changes or he is asked again.

## Output

| Field | Meaning |
| --- | --- |
| `intent_path` | Where the confirmed intent was stored. |
| `transcript` | The operator's own words, kept for the account. |
| `coverage` | Every topic, its evidence, and any question that was asked. |
| `confirmation` | The exact draft he confirmed, and the corrections before it. |
| `open_questions` | Anything he declined to settle, carried forward as unsettled. |

## Guarantees

- Intent is requested before any package structure is designed.
- Unstructured input is accepted; no template is demanded up front.
- A synthesis is never stored without the operator's confirmation of those exact
  words.
- A stored intent is plain requirements, with no frontmatter, no schema, and no
  structural implementation detail.
- The build that follows is answerable to the stored intent.

## Boundaries

- This molecule captures intent for the package being created. Writing an intent
  for a skill this run did not create is a different job and is out of scope.
- It never infers intent from the request and proceeds. An unanswered question
  is carried forward as unanswered.
- It does not design the package, choose a decomposition, select tools, author
  package files, or run validation.
- It never overwrites an existing intent.
