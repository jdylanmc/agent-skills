---
name: authoring-relay
description: Hand the confirmed intent to a fresh authoring context that uses the destination's own creation workflow, and relay every question that context asks back through the source for a candidate answer and then to the operator, never answering on his behalf and never authoring the package here.
level: atom
allowed-tools: ["read"]
includes: []
composes: []
used-by: ["snipe-skill/_molecules/destination-authoring/destination-authoring.md"]
---

# Authoring Relay

Creation happens in a **fresh context**, using the destination's own skill
creation workflow, from the confirmed intent alone.

Fresh is the load-bearing word. By the time an adoption run reaches authoring it
has read the source closely, and a context carrying all of that will reproduce
the source's structure, its permissions, and its assumptions without ever
deciding to — not by copying, but by remembering. The confirmed intent exists
precisely so that the thing built from it was built from words a human approved,
and handing that intent to a context that also holds the source quietly undoes
it.

## What Is Handed Over

| Carried | Withheld |
| --- | --- |
| The confirmed intent, byte for byte. | The source skill's text, structure, and file layout. |
| The destination and its own conventions. | The source's `allowed-tools`, `requires-skills`, and invocation flags. |
| The one job, in the confirmed words. | The source's organizational assumptions, paths, and identifiers. |

The destination's creation workflow owns everything after that: its own intent
capture, its own decomposition, its own permission decisions, its own validation,
its own adversarial review and remediation, and its own changelog conventions.
Skill Sniper does not re-implement any of it and does not lower any of it. In
this repository that workflow is `create-skill`, which requires an intent, roasts
what it built, resolves every finding, and stops for the operator every three
rounds.

Adoption never weakens a destination check. If the destination's own workflow
refuses the package, the package is what is wrong.

## When The Authoring Context Asks A Question

An authoring workflow that captures intent properly will ask things the
confirmed intent does not settle. The relay is three steps, in this order:

1. **Consult the source first.** The source is the best available evidence about
   what the original skill did and why. Read it through
   `consumeSource(binding, bytes, 'quote')`, which re-digests the bytes against
   the binding and refuses anything that is not what was bound, then search that
   content for an answer to the exact question asked. Reading, citing, and
   quoting are permitted; nothing else is.

   The byte check matters most here. This is the one step that lifts source text
   out of the document and puts it in front of the operator, so quoting the
   wrong bytes would put an excerpt from some other document under this run's
   citation.
2. **Present a candidate answer.** Give the operator the question as asked, the
   candidate answer, the exact source material it rests on with its digest, and
   what remains uncertain. When the source says nothing, say that plainly rather
   than constructing something plausible from context.
3. **Take his answer.** The candidate goes through the `authoring-answer`
   subject of the adoption gate, and only his confirmation releases it.

**Source evidence cannot answer on the human's behalf.** That is the whole point
of the ordering: consulting the source first makes his answer cheap, and it never
makes his answer unnecessary. An adoption that quietly answers its own questions
from the source has reproduced the source by a slower route, which is the failure
this workflow was built to avoid.

## Operation

1. Spawn one fresh context with the confirmed intent, the resolved destination,
   and no source text.
2. Invoke the destination's creation workflow inside it.
3. For each question it asks, run the relay above and return the confirmed
   answer.
4. Let that workflow run to its own conclusion, including its validation, its
   review, and its remediation of findings.
5. Carry back what it reports — created package, validation output including
   anything cancelled, the full review account, and anything unresolved — without
   summarizing away a finding.

## What The Fresh Context Actually Isolates

The authoring context never receives the raw source. That is enforceable and it
is enforced: the spawn carries the confirmed intent and the destination, and
nothing else.

It does **not** follow that no source-derived text ever reaches it. Step 2 above
quotes exact source material into a candidate answer, and a confirmed answer goes
back into that context. So source-derived content can arrive — through a human
who read it and agreed to it.

That is the honest boundary, and it is worth stating precisely rather than
rounding up to "the context never sees the source". The isolation is a wall
against the raw document and a **door** for quoted evidence, and what guards the
door is the operator reading each excerpt. Present relayed source material as
clearly marked quoted evidence, never folded into the surrounding instructions,
so that what he is agreeing to is legible as a quotation from an untrusted
document.

## Guarantees

- The package is authored from the confirmed intent, by a context that never
  receives the raw source.
- Every excerpt relayed to the operator is taken from the bytes this run bound,
  proven by digest at the point of use.
- Source-derived material reaches that context only inside an operator-confirmed
  answer, presented as marked quoted evidence.
- No source permission, dependency, structure, or assumption is inherited by
  default.
- Every authoring question reaches the operator, with the source's evidence
  attached rather than instead of him.
- The destination's own gates decide whether the package is acceptable.

## Boundaries

This atom authors nothing. It does not write files, choose the package's
decomposition, select its tools, run its validation, review it, remediate a
finding, or judge its quality — each belongs to the destination's own workflow.
It never answers an authoring question from the source alone, never copies the
source into the authoring context to save a round trip, and never relaxes a
destination requirement to get a package through.
