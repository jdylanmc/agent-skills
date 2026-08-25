---
name: scope-boundary
description: Hold one delivery run to the issue it grounded on, classifying every adjacent finding as reportable rather than actionable.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["ship/_molecules/delivery-grounding/delivery-grounding.md"]
---

# Scope Boundary

Keep the change to the change that was asked for.

The expected failure of a delivery run is not that it breaks something. It is
that it succeeds at more than it was asked to do. Every costly mistake this
repository has seen was adjacent to an assigned task: an unregistered test, an
invocation flag on an unrelated skill, an edit to the validator. None were
malicious and all were defensible in isolation.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `acceptance-criteria` | yes | The numbered definition of done from grounding. |
| `stated-non-goals` | no | What the issue explicitly does not ask for. |
| `candidate-change` | yes | A change under consideration. |

## Classification

Every candidate change is exactly one of:

| Class | Meaning | Action |
| --- | --- | --- |
| `in-scope` | Required by a numbered acceptance criterion. | Do it. |
| `enabling` | Not itself a criterion, but no criterion can be met without it. | Do it only once justified and confirmed below. |
| `adjacent` | A real improvement the issue did not ask for. | Report it. Do not do it. |
| `out-of-scope` | Unrelated to the issue. | Report it. Do not do it. |
| `blocking-defect` | Something that makes a criterion unachievable. | Stop and raise it. |

## The Enabling Class

`enabling` is the class that leaks, because necessity is easy to assert and
tedious to prove. Naming a criterion is not enough. An enabling entry carries:

1. the exact numbered criterion it serves;
2. evidence the criterion is **impossible** without it, not merely harder or
   uglier;
3. the in-scope alternatives considered, and why each fails;
4. the smallest bounded version of the change;
5. explicit operator confirmation.

Without all five it is `adjacent`. "This refactor makes criterion 3 much
cleaner" is adjacent; "criterion 3 requires a second caller and the function is
private" is enabling.

## The Change Ledger

Classification is exhaustive, not sampled. Every planned change gets an entry
with a stable identifier, so a later stage can map each unit of the eventual
diff back to exactly one confirmed `in-scope` or `enabling` entry.

A change appearing in the diff with no matching ledger entry is an undisclosed
change, and it stops the run. Classifying only the changes someone thought to
ask about would make this boundary advisory.

## Reporting an Adjacent Finding

An adjacent finding is not discarded — discarding it wastes what was learned.
Record what was noticed, where, why it looked worth doing, and what it would
take. That belongs in the run's report, and it is the right raw material for a
new issue.

The discipline is only about the diff. A pull request holding one deliberate
change and three helpful ones is harder to review, harder to revert, and harder
to trust, because a reviewer cannot tell which part they are actually approving.

## Fixing Something While Passing Through

The tempting case is a one-line fix in a file already being edited for a real
reason. It is still adjacent. The cost of a separate issue is small; the cost of
a diff whose scope nobody can state is not.

## Output

Return every planned change as a ledger entry with its stable identifier and
classification, the criterion it serves when it has one, the full justification
for each `enabling` entry, the adjacent and out-of-scope findings with enough
detail to become issues, and any blocking defect.

## Boundaries

This atom classifies. It does not implement, revert, file issues, or decide
whether the run continues.
