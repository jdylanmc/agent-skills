---
name: chronicler
description: Keep one bounded running log of skill operations across a long-running session, and replay it on demand. Composes the chronicle append and chronicle replay atoms.
level: molecule
includes: ["_base/_atoms/chronicle-append/chronicle-append.md","_base/_atoms/chronicle-replay/chronicle-replay.md","_base/_molecules/chronicler/chronicler.mjs"]
composes: ["_base/_atoms/chronicle-append/chronicle-append.md","_base/_atoms/chronicle-replay/chronicle-replay.md"]
used-by: ["cmux-orchestrate/SKILL.md","create-skill/SKILL.md","decision-trail/SKILL.md","discovery/SKILL.md","domain-mapping/SKILL.md","handoff/SKILL.md","interrogate/SKILL.md","next-step-selection/SKILL.md","optimize-prompt/SKILL.md","prompt-coach/SKILL.md","proof-of-concept/SKILL.md","roast/SKILL.md","run-ci/SKILL.md","skill-coach/SKILL.md"]
allowed-tools: ["execute"]
---

# Chronicler

Keep one bounded Skill Run Log for a root skill invocation, and replay a
selected log on demand. Chronicler observes what happened. It never owns claims,
merges, provider state, or delivery authority.

Chronicler is never used on its own. Every routable skill composes it so each
invocation leaves bounded diagnostic evidence.

Recording is best effort. A skill that cannot record reports the failure, marks
its evidence incomplete, and continues delivering.

## Required References

1. [Chronicle append](../../_atoms/chronicle-append/chronicle-append.md)
2. [Chronicle replay](../../_atoms/chronicle-replay/chronicle-replay.md)

## Required Files

1. [Shared recording and replay implementation](./chronicler.mjs)

## Run Context

Chronicler owns the run context; neither atom does. The root skill creates it
once:

- `run_id` - an opaque identifier unique to this invocation;
- `root_skill` - the routable skill that owns the run;
- `log_path` - one absolute path, `<repository>/.skill-log/<root-skill>.<UTC-date>.<run-id>.jsonl`.

Pass all three values unchanged to every nested skill or agent. A nested
participant adds only its own `--skill` name. Never re-derive the path from the
current directory or worktree, and never infer a run from the newest file.

## Invocation Contract

Apply this contract to every routable skill invocation:

1. Before the skill's core workflow, reuse a caller-supplied run context or
   create the root context once. Probe the append entry point and record one
   `run` `before` event.
2. Record one paired `before` and `after` event for each material operation.
   Record delegation and externally observed degradation as `observation`
   events.
3. Pass `run_id`, `root_skill`, and `log_path` unchanged to every nested skill
   or agent. A nested skill records with its own `--skill` value and never
   creates a second run.
4. Before every terminal return, record one `run` `after` event with the final
   outcome, including refusal, cancellation, blockage, degradation, and
   failure outcomes.
5. If recording is unavailable or an append fails, report the stable failure
   category once, mark diagnostics incomplete, and continue the skill. Do not
   retry in a loop or convert a recording failure into a workflow failure.

The invocation contract is infrastructure, not new authority. It does not
weaken any skill's read-only boundary, approval gate, mutation rule, or output
contract.

## What to Record

Chronicler owns this judgement; the append atom records whatever it is given.
Record meaningful lifecycle boundaries only:

- the start and final outcome of the run;
- the intent and outcome of each material operation;
- delegation to a nested skill or agent;
- externally observed degradation.

Do not trace every tool call, file read, or heartbeat. Chronicler is evidence,
not instrumentation.

## Composition

| Concern | Owner |
| --- | --- |
| Appending one bounded event, its fields, bounds, and log-target safety | [chronicle-append](../../_atoms/chronicle-append/chronicle-append.md) |
| Replaying one selected log and reporting defects | [chronicle-replay](../../_atoms/chronicle-replay/chronicle-replay.md) |
| Run context, propagation to nested participants, and what is worth recording | This molecule |
| Shared validation, bounds, and the persisted envelope | `chronicler.mjs` |

`chronicler.mjs` is this molecule's local implementation, named after the
molecule. Both atoms' entry points call into it, so validation on write and
revalidation on read are the same code rather than two drifting copies.

## Regression Suite

From the repository root, run:

```text
node --test skills/_base/_molecules/chronicler/chronicler.test.mjs \
  skills/_base/_molecules/chronicler/chronicler.adversarial.test.mjs \
  skills/_base/_atoms/chronicle-append/chronicle-append.test.mjs \
  skills/_base/_atoms/chronicle-replay/chronicle-replay.test.mjs
```

The adversarial suite covers torn records, unsafe log targets, semantically
corrupt histories, concurrent writers, and malformed bytes. Keep it passing:
every defect it covers once shipped unnoticed.

## Boundary

Chronicler is non-routable. It holds no mutable control state, so a consumer's
own claim, merge, and safety gates remain authoritative and unaffected by a
recording failure.
