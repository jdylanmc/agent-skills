---
name: deterministic-checks
description: Record the deterministic quality requirements that apply to a feature by finding the policies and thresholds a repository has already adopted, and reporting the rest as unadopted rather than inventing them.
level: atom
allowed-tools: ["read","search"]
includes: []
composes: []
used-by: ["qa-design/_molecules/qa-contract/qa-contract.md"]
---

# Deterministic Checks

State the measurable quality requirements the feature must meet, using only
policy the repository already holds.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `rules` | yes | The behavior rules being given a verification contract. |
| `repository-root` | yes | Where adopted policy is looked for. |
| `stated-policy` | no | Policy the specification or operator supplies explicitly for this feature. |

## Candidate Concerns

Complexity, performance, accessibility, compatibility, security, localization,
resource budgets, and any other measurable policy the repository keeps. The list
is a prompt for looking, not a list of checks to apply.

## Finding Adopted Policy

Look where a repository actually keeps policy: continuous-integration workflow
steps, linter and analyzer configuration, budget and threshold files, contract
documents, and written engineering standards. Cite the exact file and setting
for every check recorded as adopted.

## Disposition

| Disposition | Meaning |
| --- | --- |
| `adopted` | The repository defines this check and its threshold. Cite both. |
| `adopted-without-threshold` | The check is configured, but no numeric bar is set. Record the check and say the bar is undefined. |
| `stated-for-this-feature` | The specification or operator set this requirement explicitly for this feature. Cite where. |
| `not-adopted` | The concern is plausible and the repository has taken no position. Record it as an open question. |

## Never Invent a Threshold

A number that nobody adopted is worse than no number. It reads as policy, gets
enforced by the next workflow that finds it, and turns an opinion picked in the
moment into a gate nobody agreed to.

So a concern with no adopted bar is recorded as `not-adopted` and raised as a
question for the humans who own the standard. "Response time under 200
milliseconds" is a decision. "The repository has not set a response-time
threshold" is a finding. This atom produces the second.

The same applies to a threshold that exists but is not obviously right. Report
the disagreement; do not quietly design against a different number.

## Output

Return each deterministic check with a stable identity, the concern, the
disposition, the cited source of any threshold, the rules it applies to, and
every concern recorded as unadopted with the question it raises.

## Boundaries

This atom records requirements. It does not run a check, install a tool, edit
configuration, set a threshold, or convert an unadopted concern into a gate. It
does not decide whether a delivered system passes; that judgement belongs to the
quality-evidence analysis that runs after implementation.
