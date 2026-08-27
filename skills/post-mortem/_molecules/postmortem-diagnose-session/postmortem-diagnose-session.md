---
name: postmortem-diagnose-session
description: Produce one anchored diagnosis of a session by detecting friction, classifying gaps, and forming deduplicated mechanism-focused root-cause hypotheses, without blame or manufactured findings.
level: molecule
includes: ["post-mortem/_atoms/friction-detect-signals/friction-detect-signals.md","post-mortem/_atoms/gap-classify-taxonomy/gap-classify-taxonomy.md","post-mortem/_atoms/hypothesis-form-root-cause/hypothesis-form-root-cause.md"]
composes: ["post-mortem/_atoms/friction-detect-signals/friction-detect-signals.md","post-mortem/_atoms/gap-classify-taxonomy/gap-classify-taxonomy.md","post-mortem/_atoms/hypothesis-form-root-cause/hypothesis-form-root-cause.md"]
used-by: ["post-mortem/SKILL.md"]
allowed-tools: []
---

# Diagnose the Session

A neutral diagnosis of the current interaction. Its objective is to improve
future performance by finding reusable knowledge, skills, evaluators,
reinforcement opportunities, and missing abstractions.

It does not exist to:

- defend or praise the agent;
- apologize or perform self-criticism;
- blame the operator, agent, model, tool, or third party;
- explain away a failure;
- assume, assert, or imply that dissatisfaction occurred;
- create a minimum number of findings;
- apply learning or changes.

Name agent error plainly when direct evidence supports it. No blame does not
mean no accountability.

## Required References

1. [Friction signal detection](../../_atoms/friction-detect-signals/friction-detect-signals.md)
2. [Gap taxonomy](../../_atoms/gap-classify-taxonomy/gap-classify-taxonomy.md)
3. [Root-cause hypotheses](../../_atoms/hypothesis-form-root-cause/hypothesis-form-root-cause.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `ledger` | yes | Redacted, anchored evidence. |
| `confidence-cap` | no | The compounded cap from session and log completeness. |
| `session-summary` | no | Goal, work product, result, and alignment. |

## Operation

1. **Detect friction** with
   [Friction signal detection](../../_atoms/friction-detect-signals/friction-detect-signals.md).
2. **Classify each shortfall** with
   [Gap taxonomy](../../_atoms/gap-classify-taxonomy/gap-classify-taxonomy.md).
   Where no specific alternative can be named, carry the uncertainty to step 3
   instead of asserting a gap.
3. **Explain the mechanism** with
   [Root-cause hypotheses](../../_atoms/hypothesis-form-root-cause/hypothesis-form-root-cause.md),
   deduplicating by mechanism and referencing every affected `F` and `G`
   identifier.

Separate observations, derived findings, hypotheses, and proposals. Give every
material claim evidence anchors and calibrated confidence.

## Output

| Field | Meaning |
| --- | --- |
| `friction_signals` | `F`-series events with severity, anchors, consequence, and confidence. |
| `identified_gaps` | `G`-series gaps with category, moment, impact, alternative, and feasibility evidence. |
| `root_cause_hypotheses` | `H`-series hypotheses with supporting and counter-evidence, affected findings, and a validation test. |

## Guarantees

- Every finding cites at least one anchor.
- One mechanism produces one hypothesis, referencing all of its symptoms.
- A clean session produces an empty diagnosis rather than an invented one.

## Boundaries

Do not infer operator emotion, intent, or satisfaction from silence, politeness,
brevity, or task completion. Do not psychoanalyze the operator or the model.

This molecule diagnoses. It proposes no capability, assigns no lifecycle state,
and applies nothing.
