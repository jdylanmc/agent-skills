---
name: evidence-reconcile
description: Reconcile source claims into confirmed facts, contradictions, assumptions, and missing evidence for a discovery loop.
level: atom
allowed-tools: ["read","search"]
includes: []
composes: []
used-by: ["discovery/_molecules/cycle-controller/cycle-controller.md","discovery/_molecules/discovery-loop/discovery-loop.md"]
---

# Evidence Reconcile

Gather and reconcile evidence for one discovery subject.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `subject` | yes | The question, problem, feature, or workflow being discovered. |
| `source hints` | no | Files, issues, pull requests, docs, notes, or search terms. |
| `scope boundary` | no | What repositories, packages, systems, or documents are in or out of scope. |

## Operation

1. Search and read evidence inside the stated scope.
2. Preserve source claims as claims before turning any of them into facts.
3. Classify material as:
   - `confirmed-fact`;
   - `source-claim`;
   - `decision`;
   - `assumption`;
   - `contradiction`;
   - `ambiguity`;
   - `missing-evidence`.
4. Prefer durable evidence: intent, doctrine, issues, pull requests, tests,
   source files, design notes, and current repository state.
5. Stop gathering when the next useful step is a question, a domain map, a
   specification, or an approved tracker update.

## Output

Return reconciled evidence with source references and confidence. Do not hide
contradictions or reword assumptions as decisions.

## Boundaries

This atom reads and searches only. It does not ask questions, create trackers,
write files, or decide requirements.
