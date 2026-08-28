---
name: candidate-gate-retention
description: Discover and classify reusable candidates, gate each on six retention criteria and a cap of three, ground prior art in the skill package repository only, and review only the skills a retained candidate touches.
level: atom
allowed-tools: ["read", "search"]
includes: []
composes: []
used-by: ["post-mortem/_molecules/postmortem-propose-reinforcement/postmortem-propose-reinforcement.md"]
---

# Candidate Discovery and Retention Gate

Most of what a session teaches is not reusable. This gate exists to keep the few
things that are.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `friction-signals` | no | Anchored friction events a candidate may trace to. |
| `gaps` | no | Classified gaps a candidate may trace to. |
| `package-root` | no | The repository containing this skill package. |

## Operation

Look for reusable candidates when the session shows:

- repeated steering toward the same behavior or format;
- repeated manual work with a stable transformation;
- an existing skill that was incomplete, misrouted, or not invoked;
- a missing evaluator, template, deterministic check, or context-acquisition
  step;
- a lesson that applies beyond this exact task.

Classify every capability candidate as:

- `existing_but_not_triggered`
- `existing_skill_improvement`
- `new_skill_candidate`
- `evaluator_candidate`
- `automation_candidate`
- `session_specific_no_reuse`
- `duplicate_dropped`

Prefer better routing or improving an existing skill over adding a new one.

Before retaining a reusable candidate, require:

1. **Traceability:** It cites at least one evidence-backed friction event or
   gap.
2. **Generality:** It applies to at least two plausibly different future
   situations.
3. **Prior art:** Repository grounding does not show that an existing capability
   already covers it.
4. **Cost of error:** The consequences of adopting a wrong lesson are stated.
5. **Evaluator:** A concrete pass/fail probe can test the proposed behavior.
6. **Disconfirmation:** Evidence that would reject or retire the candidate is
   named.

### Package grounding

Search only the repository containing this skill package: its root instructions
file and sibling `skills/*/SKILL.md` entry points. Scope every search to that
package repository. Package grounding is not session evidence, and the
operator's working repository, repository history, and unrelated files are never
session evidence.

Determine whether the capability is new, an improvement, a routing failure, or a
duplicate.

### Existing skill review

Review only skills that were invoked, should plausibly have been invoked, or
directly overlap a retained candidate. Do not perform a full package review.

For each relevant skill, record strengths supported by session evidence,
weaknesses supported by session evidence, enhancement ideas, and whether the
problem was implementation, routing, missing examples, missing guards, missing
evaluators, or inappropriate use.

## Output

| Field | Meaning |
| --- | --- |
| `candidates` | Each with `classification`, `reason`, `traces_to`, `generality_examples`, `package_grounding`, `cost_of_error`, `evaluator`, `disconfirming_observation`, and `confidence`. |
| `skill_improvements` | Per reviewed skill: strengths, weaknesses, enhancement ideas, evidence, confidence. |

## Guarantees

- At most three retained, high-priority capability candidates. Entries
  classified as `session_specific_no_reuse` or `duplicate_dropped` do not count
  toward the limit.
- A candidate failing any of the six criteria is not retained.
- A one-off tool failure or task-specific preference normally remains
  session-specific.
- No candidate is manufactured to populate the record.

## Boundaries

Package design and edits belong to Skill Coach or create-skill in a separate,
explicitly approved workflow. This atom proposes and never applies.

**Error recovery.** If the package root cannot be confirmed or searched, set
`package_grounding: pending_prior_art_search_unavailable` in the candidate's
explanatory text, use the schema value `pending`, and keep the candidate
`PROPOSED`. Zero search results without a confirmed package root never prove
that prior art is absent.
