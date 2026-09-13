---
name: poc-scope
description: Frame the learning question, success criteria, constraints, and isolation plan for one proof-of-concept run.
level: atom
allowed-tools: ["read","search"]
includes: []
composes: []
used-by: ["proof-of-concept/_molecules/prototype-learning/prototype-learning.md"]
---

# POC Scope

Define the experiment before any code is written.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `idea` | yes | The idea, library, framework, engine, concept, phrase, or directive to test. |
| `learning goal` | yes | The question the prototype must answer. |
| `scope boundary` | yes | What is included, excluded, and deliberately ignored. |
| `success criteria` | no | Observable signals that would make the result useful. |
| `constraints` | no | UI, platform, data, dependency, timebox, or cleanup constraints. |

## Operation

1. Restate the learning question in one sentence.
2. Identify why code is needed instead of more reading or interrogation.
3. Choose the smallest experiment that can answer the question.
4. Name what would count as:
   - works well enough;
   - fails;
   - inconclusive;
   - needs another POC.
5. Decide the isolation strategy before code is written.

## Output

Return the scoped POC plan: question, success criteria, isolation plan,
constraints, expected artifacts, commands likely to run, and approval gates.

## Boundaries

This atom does not write code, install dependencies, or run commands. It frames
the experiment and stops if the learning goal is unclear.
