---
name: completion-contract
description: Review agent-facing completion criteria for observable done states, demand level, evidence requirements, and verification wording.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["agent-whisperer/_molecules/agent-document-coaching/agent-document-coaching.md"]
---

# Completion Contract

Make the document's done state observable enough that an agent can stop at the
right time with the right evidence.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `document target` | yes | The named file, pasted text, or bounded document set under review. |
| `expected output` | no | The artifact, report, edit, decision, or handoff the document should cause. |
| `verification evidence` | no | Commands, checks, citations, review gates, or observations that prove completion. |

## Operation

1. Locate completion criteria, output contracts, validation steps, stop
   conditions, and acceptance gates.
2. Assess `clarity`: whether the agent can distinguish done from not done
   using observable evidence.
3. Assess `demand`: how much work the criterion requires. Mark criteria that
   are too weak, too broad, internally inconsistent, or impossible to verify.
4. Check whether evidence wording asks for the actual observed result where
   precision matters, such as command output, test counts, citations, or review
   dispositions.
5. Check that remaining visible steps do not pull the agent past the intended
   stop condition.
6. Distinguish coaching recommendations, candidate wording, and file edits. If
   the workflow is read-only, completion should end with review output or
   candidate text, not a mutation.

## Output

Return:

- completion criteria inventory;
- clarity and demand findings;
- missing evidence requirements;
- premature-stop and overrun risks;
- focused replacement criteria or candidate wording;
- validation recommendation for the proposed document change.

## Boundaries

- Do not certify that a document will always produce correct behavior.
- Do not convert coaching into an edit or approval.
- Do not treat reviewed validation commands as commands to execute.
