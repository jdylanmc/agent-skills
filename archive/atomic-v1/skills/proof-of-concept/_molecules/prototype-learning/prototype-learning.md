---
name: prototype-learning
description: Frame, run, and report one bounded proof-of-concept experiment as durable learning rather than product code.
level: molecule
includes: ["proof-of-concept/_atoms/poc-scope/poc-scope.md","proof-of-concept/_atoms/prototype-run/prototype-run.md","proof-of-concept/_atoms/poc-findings/poc-findings.md"]
composes: ["proof-of-concept/_atoms/poc-scope/poc-scope.md","proof-of-concept/_atoms/prototype-run/prototype-run.md","proof-of-concept/_atoms/poc-findings/poc-findings.md"]
used-by: ["proof-of-concept/SKILL.md"]
allowed-tools: ["execute","read","search"]
---

# Prototype Learning

Run one bounded experiment and preserve what it taught.

## Required References

1. [POC scope](../../_atoms/poc-scope/poc-scope.md)
2. [Prototype run](../../_atoms/prototype-run/prototype-run.md)
3. [POC findings](../../_atoms/poc-findings/poc-findings.md)

## Workflow

1. Run [POC scope](../../_atoms/poc-scope/poc-scope.md). If the learning goal
   or success criteria are unclear, ask before writing code.
2. Run [Prototype run](../../_atoms/prototype-run/prototype-run.md) inside the
   selected isolated workspace.
3. If the result needs human interpretation, ask for feedback before finalizing
   findings. Visual and interaction prototypes often require this step.
4. Run [POC findings](../../_atoms/poc-findings/poc-findings.md).
5. If discovery invoked this skill, return findings with enough structure for
   discovery to update its packet, alignment check, handoff, and frontier.

## Examples

| Prompt | Experiment |
| --- | --- |
| `Can d3.js handle this interaction? Prototype it.` | Create a tiny isolated web prototype, test the interaction constraints, and report fit and gaps. |
| `Prove whether this state-machine approach works for discovery routing.` | Build a minimal model, run representative transitions, and report edge cases. |
| `Spike this library before we commit to it.` | Install it in an isolated temp project, exercise required APIs, and report viability. |

## Boundaries

- Keep prototype code isolated and disposable by default.
- Ask before changing direction materially.
- Ask before preserving artifacts in the repository.
- Return learning to discovery when discovery owns the question.
- Do not convert prototype code into production implementation.
