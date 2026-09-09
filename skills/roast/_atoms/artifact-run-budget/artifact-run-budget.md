---
name: artifact-run-budget
description: Bound artifact-roast coordination and synthesis time, surface failed attempts immediately, and reject results returned after their recorded deadline.
level: atom
allowed-tools: ["execute","task"]
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
task prompt, but never treat that prompt as enforcement. A spawned agent may
miss or ignore its deadline.

Before every spawn, start one parent-owned, non-detached deadline signal through
`execute`. Launch the agent through `task` in background mode, then wait for the
runtime's completion notification from either operation. Do not poll.

- Agent completes first: stop the specific deadline process, collect the
  response, and evaluate whether it arrived on time.
- Deadline completes first: classify the attempt as `deadline-exceeded`, send a
  bounded stop request when the runtime supports agent messaging, and stop
  waiting for that agent.

If the runtime cannot launch the task in background and independently notify
the parent when a deadline signal completes, return `Status: Insufficient
review` before dispatch and name bounded execution as unavailable. Never enter
an open-ended synchronous wait.

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

The deadline process is attached to the current run and is stopped when its
agent completes. Never detach it, leave it running after the phase, use a broad
process kill, or confuse its completion with the review agent's completion.

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

Deadlines bound acceptance and waiting. They do not claim to terminate a remote
process when the runtime lacks cancellation; a bounded stop request is
best-effort, and a late process has no authority to change the returned result.
A prompt deadline alone never satisfies this contract. Never weaken the
envelope contract, omit a mandatory reviewer, accept partial findings as
synthesized, or substitute a cheaper model to meet a deadline.
