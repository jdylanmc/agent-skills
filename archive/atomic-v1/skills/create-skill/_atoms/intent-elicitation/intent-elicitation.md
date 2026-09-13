---
name: intent-elicitation
description: Ask the operator what the new skill is for before any structure exists, accept the answer in whatever shape it arrives, and ask a targeted follow-up only where something a regeneration needs is genuinely missing.
level: atom
allowed-tools: ["read","execute"]
includes: ["create-skill/_atoms/intent-elicitation/intent-elicitation.mjs"]
composes: []
used-by: ["create-skill/_molecules/intent-capture/intent-capture.md"]
---

# Intent Elicitation

Ask first. A skill built before its purpose is settled is a skill that gets
rebuilt, and the purpose is the one thing that cannot be recovered afterwards by
reading the result. Implementation can be re-derived from intent; intent
reverse-engineered from implementation is a guess wearing a confident face.

So this runs **before** the scope contract, before the decomposition, and before
a single file exists. If the operator has not said what the skill is for, ask.
Never infer it from the request and proceed.

## Required References

1. [Prompt and coverage check](./intent-elicitation.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `request` | yes | Whatever the operator has already said about the skill he wants. |
| `transcript` | yes | Everything the operator has said in his own words, verbatim. |

## Take the Word Vomit

The operator rambles on purpose, and the rambling is the valuable part. A
twelve-question intake form gets terse answers that describe the form, and the
single most useful thing an intent can carry — why a decision was made the way
it was, and what was tried before it — is exactly what a form never asks for.

So the opening is one open ask and nothing else. Do not present a template, do
not present a questionnaire, and do not refuse an answer for being disorganised,
contradictory, or out of order. Sorting it out is this skill's job, not his.

The exact opening ask is authored once, in
[the prompt](./intent-elicitation.mjs), and is shown verbatim:

```text
node <atoms>/intent-elicitation/intent-elicitation.mjs --prompt
```

## What Regeneration Needs

The opening is unstructured. The closing is not. The test an intent has to pass
is whether a competent fresh model could rebuild the skill from it, and these
are the things it cannot rebuild without:

| Topic | What it captures |
| --- | --- |
| `one-job` | The single reusable job, in plain words. |
| `triggers` | When the skill should be reached for, and when it must not be. |
| `refusals` | What it refuses to do, and why refusing is the right answer. |
| `permissions` | What it is allowed to touch, and the reason to trust it with that. Privilege is a human decision and is not derivable from behaviour. |
| `gates` | Where it stops and asks, and what it does that cannot be undone. |
| `rationale` | The reasoning behind any non-obvious decision, and what was tried and rejected. |

`rationale` is the one most easily lost and least recoverable. A regeneration
that does not know a shape was already tried and rejected will re-derive it.

## Ask Few, and Only for What Is Missing

Follow-ups are for genuine gaps. Asking about something the operator already
said spends his patience proving nobody listened, and the next answer is
shorter for it.

1. Assess each topic against what he actually said, quoting the words that cover
   it. A judgement that a topic is covered is not evidence of coverage.
2. Ask exactly one question per remaining gap, in his terms rather than in this
   repository's.
3. Fold each answer into the transcript and reassess.

The check refuses anything that would turn this back into a form:

```text
node <atoms>/intent-elicitation/intent-elicitation.mjs --review "$absolute_record_path"
```

Exit `0` returns the record with `complete` or `questions-pending`, `2` refuses
it, and `1` is a usage or path failure. It refuses a topic that is absent rather
than assuming it covered, a claim of coverage whose quoted evidence does not
appear in what the operator said, a quote too short to be about anything, a
question about a topic already answered, a second question about the same topic,
and a gap that no question was asked about. An unassessed topic is never a
covered one.

The length floor is not fussiness. A one-character quote appears in every
transcript, so without a floor the evidence check would pass on anything and
coverage would quietly mean whatever the caller asserted.

## Output

| Field | Meaning |
| --- | --- |
| `transcript` | The operator's own words, kept verbatim for the synthesis. |
| `coverage_status` | `complete`, or `questions-pending` with the gaps named. |
| `questions` | At most one targeted question per genuine gap. |
| `evidence` | The quoted words that cover each topic. |

## Guarantees

- The operator is asked before any package structure is designed.
- Unstructured input is accepted as given; no template is demanded up front.
- A topic is covered only when the operator's own words cover it.
- No question is asked about something already answered.
- No gap is passed over in silence.

## Boundaries

- This atom asks and records. It does not write the intent, does not confirm it,
  and does not store anything.
- It does not design the package, choose a decomposition, or select tools.
- It never fills a gap by inference. An unanswered question is carried forward
  as unanswered.
