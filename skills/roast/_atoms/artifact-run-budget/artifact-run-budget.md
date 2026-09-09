---
name: artifact-run-budget
description: Bound artifact-roast coordination and synthesis time, surface failed attempts immediately, and reject results returned after their recorded deadline.
level: atom
allowed-tools: ["task"]
includes: []
composes: []
used-by: ["roast/_molecules/roast-artifact-branch/roast-artifact-branch.md"]
---

# Artifact Run Budget

An artifact roast is finite. Coordination failure must become visible evidence,
not an agent that appears active indefinitely.

## Fixed Deadlines

Capture an absolute start time and deadline before every Agent spawn:

| Phase | Maximum wall-clock time |
| --- | --- |
| First coordinate attempt | 10 minutes |
| Replacement coordinate attempt | 10 minutes |
| Synthesis | 10 minutes |
| Whole artifact coordination path | 30 minutes |

Pass the absolute deadline and remaining whole-run budget in the authoritative
task prompt. Require the spawned agent to stop launching work early enough to
validate and return the complete contracted output before that deadline.

Use a background-capable or timeout-capable launch so the parent orchestrator
retains control. If the runtime cannot preserve parent control while the task is
running, return `Status: Insufficient review` before dispatch and name bounded
execution as unavailable. Never enter an open-ended synchronous wait.

## Deadline Evaluation

At the deadline, stop waiting and classify the attempt as `deadline-exceeded`.
The run continues only through the one replacement coordinate attempt already
allowed by the Roast contract. A response delivered after its recorded deadline
is stale execution evidence: record its identity, ignore its contents, and
never validate, merge, repair, or synthesize it.

Synthesis receives no retry. A synthesis deadline returns
`Status: Unsynthesized` with the valid envelope retained only as evidence of
what completed; it is not a finished roast.

The whole-run deadline wins over every phase deadline. Do not start a phase that
cannot receive its full bounded budget before the whole-run deadline.

## Immediate Failure Disclosure

When a coordinate attempt fails transport, deadline, empty-response, or schema
validation, immediately emit one short progress update containing:

- the failed phase and attempt number;
- the named failure category or exact schema defect;
- whether the single replacement attempt will run;
- the remaining whole-run deadline.

Do this before launching the replacement. The update is diagnostic, not a
question and not an approval request. After the second coordinate failure or
any synthesis failure, return the contracted Artifact Roast failure shape
immediately. Do not start another Roast invocation automatically.

## Boundaries

Deadlines bound acceptance and waiting; they do not claim to terminate a remote
process the runtime cannot cancel. A late process has no authority to change the
returned result. Never weaken the envelope contract, omit a mandatory reviewer,
accept partial findings as synthesized, or substitute a cheaper model to meet a
deadline.

