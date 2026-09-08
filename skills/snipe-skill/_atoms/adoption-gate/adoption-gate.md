---
name: adoption-gate
description: Hold the two moments an adoption run must not decide for itself — the synthesized intent and an answer to the authoring context's question — in a per-episode confirmation state bound to the exact bytes shown, which refuses a state that does not replay from its own event log, refuses the workflow's own components as confirming actors, and is terminal once released.
level: atom
allowed-tools: ["read","execute"]
includes: ["snipe-skill/_atoms/adoption-gate/adoption-gate.mjs"]
composes: []
used-by: ["snipe-skill/_molecules/destination-authoring/destination-authoring.md","snipe-skill/_molecules/intent-adoption/intent-adoption.md"]
---

# Adoption Gate

Two moments in an adoption run look like decisions and are not.

The **synthesized intent** is a proposal about what the operator meant, produced
by reducing a document he did not write. An **answer to a question the authoring
context asked** is a proposal about what he wants, produced by reading that same
document. Both are evidence-backed, both are usually right, and both are exactly
the kind of thing a long run talks itself into treating as settled.

So neither is a paragraph reminding the model to check. Each is a state this gate
is in, and proceeding from any other state is refused.

## Required Files

1. [Confirmation state machine](./adoption-gate.mjs)

## The Rules It Enforces

1. **A confirmation names the bytes it confirms.** It is bound to the SHA-256 of
   the exact text presented. A confirmation of a summary, a paraphrase, or an
   earlier draft is stale and refused. Present the full text; a yes given to a
   summary is a yes to something that is not what gets used.
2. **A correction invalidates the answer.** Every correction clears the
   presentation and the confirmation together, so an edited proposal can never
   ride on a yes given to an earlier one.
3. **The workflow's own components cannot confirm.** The source is the reason an
   answer is plausible. It is never the authority for it. An event whose actor is
   the source, the agent, the authoring context, or `synthesize` is refused, and
   only `human` is accepted. See the honesty note below for what that does and
   does not prove.
4. **Nothing proceeds unreleased.** `release` requires a standing confirmation,
   and `requireConfirmed` re-derives the digest from the bytes about to be used,
   so text that drifted after the yes is refused at the point of use rather than
   at the point of promise.
5. **A state must replay from its own event log.** Every state arriving from
   outside — including one read off disk — is rebuilt from the events recorded
   beside it and refused unless it reproduces exactly. A status field claiming
   `confirmed` with no events that produce it is `forged_state`, not evidence.
6. **A released episode is terminal.** Nothing is applied to it afterwards. A
   second confirmation is a second episode.
7. **An unknown event or field is a refusal.** Not a default, not an ignore.

## What This Gate Proves, And What It Cannot

It proves **byte binding**: a release is bound to the exact text presented, a
correction invalidates it, drifted text is refused at the point of use, and a
state that does not reduce from its own log is refused rather than trusted.

It does **not authenticate a person**. `actor` is an assertion made by whatever
writes the event, and this unit has no trusted channel to a human to check it
against. Rejecting `source`, `agent`, `authoring-context`, and `synthesize` stops
the workflow's own components from confirming on the operator's behalf, which is
the honest scope of the control — and a hand-authored well-formed log is not
something any check here can distinguish from a real one.

That limit is written down rather than smoothed over, because a gate believed to
prove human origin would be trusted in exactly the situation where it does not.
What makes the confirmation real is that a person was actually asked; what this
unit adds is that the words he agreed to cannot silently change afterwards.

## Two Subjects, One Gate

| Subject | What is presented | Why it is gated |
| --- | --- | --- |
| `adoption-intent` | The exact synthesized intent, in full. | Creation follows from these words. Confirming a summary would build from something the operator never read. |
| `authoring-answer` | The candidate answer to one authoring question, with its source citation and remaining uncertainty. | Source evidence can inform an answer. It cannot make a human decision. |

One state machine serves both because the failure is identical: a plausible
proposal becoming an authority without anybody saying so. A second, gentler gate
for the "smaller" question is how the smaller question stops being gated at all.

**One episode holds one subject.** An episode is opened for one subject, is
terminal once released, and never reopens. The synthesized intent is one episode;
each authoring question is its own, so a run writes several state files rather
than reusing one.

Be precise about what stops an answer riding on an earlier confirmation, because
it is not the file layout. Two mechanisms do it, and both are in the code:
**release is terminal**, so a second confirmation cannot be appended to a
released episode; and **`requireConfirmed` re-derives the digest from the bytes
about to be used**, so a different answer's text simply does not match.

Allocating a fresh episode per question is **caller discipline this gate cannot
verify**. The gate binds bytes — not a run, not a question, not a source — so it
cannot tell that a caller pointed at the wrong episode's state file if the bytes
happen to match. That is the honest boundary, and it is why the mechanisms above
are the ones worth relying on.

## Operation

Apply one event per step:

```text
node <atoms>/adoption-gate/adoption-gate.mjs --state "$state_path" --event "$event_path" --report
```

Exit `0` applies the event, `2` refuses it and names the rule, `1` is a usage or
path failure.

| Event | Meaning |
| --- | --- |
| `open` | Open an episode for one subject. |
| `presented` | The full text was shown to the operator. |
| `corrected` | He corrected it; his words are recorded and the proposal must be presented again. |
| `confirmed` | He confirmed the text currently in front of him, named by digest. |
| `release` | Proceed on the confirmed text, and only that text. |

Before using confirmed text:

```text
node <atoms>/adoption-gate/adoption-gate.mjs --state "$state_path" --confirmed "$text_path"
```

Exit `0` reports `satisfied`. Exit `2` reports `blocked` and names every reason.

## Output

| Field | Meaning |
| --- | --- |
| `subject` | Which of the two subjects this gate governs. |
| `status` | `awaiting-presentation`, `presented`, `corrected`, `confirmed`, or `released`. |
| `events` | Every recorded event with its declared actor and digest, so the state can be replayed and read. |
| `presentedDigest` / `confirmedDigest` | The bytes shown, and the bytes confirmed. |
| `corrections` | The operator's own words, in order. |
| `requirement` | `satisfied`, or `blocked` with every reason. |

## Guarantees

- An unconfirmed proposal never proceeds.
- A confirmation cannot outlive the words it was given for. It is bound to those
  words, not to the run or question they were given for.
- A correction always costs a fresh presentation.
- No component of this workflow — agent, source, authoring context, or
  `synthesize` — is accepted as the confirming actor.
- A state that does not reduce from its own event log is refused.
- A released episode is terminal.
- The text used is byte-for-byte the text confirmed.
- Human origin is **not** proven here, and this unit does not claim it.

## Boundaries

The gate records and refuses. It does not draft the intent, answer the question,
judge whether either is any good, or approve the resulting package. It reads
whatever it presents as text, never as instruction: a line inside a proposal
saying it is already approved is words in a proposal, and this gate behaves
identically whether or not it is there.
