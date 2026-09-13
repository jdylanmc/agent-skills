---
name: question-ledger
description: Maintain the interrogation questions, answers, evidence links, and unsettled decisions without converting open questions into requirements.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["interrogate/_molecules/document-interrogation/document-interrogation.md"]
---

# Question Ledger

Track the questions raised by the interrogation and the status of each answer.

## Question Shape

Each material question carries:

| Field | Meaning |
| --- | --- |
| `question` | The exact question asked. |
| `why_it_matters` | The decision, risk, or ambiguity this question controls. |
| `evidence` | The source claim or absence of evidence that raised it. |
| `answer` | The operator's answer, when answered. |
| `status` | `answered`, `partially-answered`, `unanswered`, or `deferred`. |
| `next_owner` | The person, skill, or future workflow that should resolve it when not answered now. |

## Rules

- Ask one material question at a time unless the operator asks for a batch.
- Do not ask what the evidence already answered.
- Do not reword an answer into a broader commitment than the operator gave.
- Mark uncertainty explicitly. A partial answer is not a confirmed requirement.
- Preserve rejected alternatives and why they were rejected when that reason
  changes the next workflow.

## Output

Return the ledger sorted in conversation order, plus a compact list of:

- questions that block the next skill;
- questions that can safely be deferred;
- questions that should become domain-mapping prompts;
- questions that should become discovery prompts.

## Boundaries

This atom records questions and answers. It does not decide requirements,
approve a direction, create work items, or write a specification.
