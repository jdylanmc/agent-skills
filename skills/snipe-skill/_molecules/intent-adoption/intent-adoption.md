---
name: intent-adoption
description: Stage the one assembled bundle, ask Synthesize to reduce it to the source skill's human intent as plain requirements, check the returned reduction against this run's source, contract terms, candidate, and the exact bytes to be shown, and present those words to the operator for a confirmation bound to them.
level: molecule
includes: ["snipe-skill/_atoms/intent-request/intent-request.md","snipe-skill/_atoms/adoption-gate/adoption-gate.md"]
composes: ["snipe-skill/_atoms/intent-request/intent-request.md","snipe-skill/_atoms/adoption-gate/adoption-gate.md"]
used-by: ["snipe-skill/SKILL.md"]
allowed-tools: ["execute","read"]
---

# Intent Adoption

Turn bound source evidence into words the operator has agreed to, or stop.

```text
stage the one assembled bundle -> state the desired result -> invoke synthesize
  -> check the result against this source, these contract terms, and these bytes
  -> present the exact words -> confirm -> release
```

Nothing is created before this molecule releases. What it releases is not a
summary of the source; it is the standard the new skill will be judged against.

## Required References

1. [Intent request](../../_atoms/intent-request/intent-request.md)
2. [Adoption gate](../../_atoms/adoption-gate/adoption-gate.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `binding` | yes | The `{ binding, bytes }` pair intake produced: the pinned digest and the exact bytes it pinned. |
| `bundle-path` | yes | Where this run stages the one assembled bundle to be reduced. |
| `gate-state` | yes | The absolute path to this run's adoption gate state. |

## Operation

1. Build the request **first**, with `buildIntentRequest({ binding, slug,
   attempt })` from
   [Intent request](../../_atoms/intent-request/intent-request.md). It carries
   the provider, the desired result in full, this attempt's bundle and candidate
   paths, and the pinned revision.

   The order matters and is not incidental. The request derives the attempt's
   paths; staging to a path computed anywhere else is a second opinion about
   where this attempt lives, and the two disagreeing means the provider binds
   nothing — an `unreadable` refusal that looks like a missing file rather than
   like the mistake it is. There is one place the path comes from.
2. Take the bytes through `consumeSource(binding, bytes, 'synthesize')`, which
   refuses anything that is not what intake bound, and stage them at
   **`request.source`** — never at a path spelled out here. These are intake's
   assembled bundle bytes, so staging copies what was bound rather than gathering
   anything new; the digest is unchanged by staging, which is what lets the
   request name the revision intake pinned.

   Then invoke `synthesize` with the request. Synthesize owns the reduction, its traceability, its budget, its
   disclosure ledger, and its persistence. This molecule owns none of it and
   re-implements none of it.
3. Check the returned record with `assertIntentResult(record, binding, request)`.
   It requires the record to name `synthesize` as its producer — the same id the
   dependency carries in `requires-skills` — to report **the contract terms this
   request stated**, to name a contract it obeyed, to be a **complete** reduction, to
   carry the **same source digest** this run bound, to name the **exact candidate
   this request asked for**, to carry a clean disclosure ledger certifying that
   same candidate, and to carry candidate text whose digest is the candidate
   digest the record claims. A reduction produced elsewhere, under other terms,
   over different bytes, or by a run that refused or needed a split is refused
   rather than presented.

   This is a shape check on the record, not proof of who produced it. There is no
   signed provenance to check against, and the atom says so; what it catches is
   the realistic failure, which is a reduction of the wrong thing. The one digest
   recomputed here is the candidate's, over the exact bytes about to be shown.
4. Present the **exact** synthesized text through the `adoption-intent` subject
   of [Adoption gate](../../_atoms/adoption-gate/adoption-gate.md). In full,
   never summarized — a confirmation of a summary confirms something that is not
   what gets used.
5. Record a correction as the operator's words and return to step 1 **with the
   attempt number advanced**, carrying the same binding. Release only on a
   confirmation bound to the exact bytes.

   The advance is not bookkeeping. Synthesize refuses to overwrite a candidate it
   has already written, so returning to step 1 on the previous attempt's paths is
   refused with `replacement-not-authorized` and this loop cannot turn at all.
   Each attempt gets its own bundle and candidate; the provider's no-overwrite
   boundary is preserved rather than worked around, and every superseded proposal
   stays on disk beside the one that was confirmed.

   What does **not** change is the source. A correction changes what is asked
   for, never which bytes are being reduced: every attempt reduces the bundle
   intake bound and carries the same revision, so the run reports one source
   identity however many attempts it took.

## Why Nothing Is Probed First

An earlier shape of this molecule asked the provider, before anything else,
whether it declared the reduction as a named capability — and stopped the run
when the answer could not be found in its frontmatter. That is worth recording as
a mistake rather than quietly dropping.

It made the outcome turn on **the shape of the provider's document** instead of
on the reduction. A provider perfectly able to do the work was reported unable,
because of how its metadata happened to be written; and finding the answer needed
a document reader that was defeated four times running.

There is nothing to probe. The terms are stated in the request, and a provider
that cannot honour them says so in its own result — which is a real answer about
this reduction rather than a guess about the provider. The invocation is cheap
and the check afterwards is exact, so refusing late costs nothing that refusing
early was buying.

What has not changed is the refusal itself. A result that came from somewhere
else, obeyed other terms, reduced other bytes, or did not complete is refused and
never shown, because the temptation to "just use what came back" is proportional
to how good it looks.

## Why Synthesis Lives Elsewhere

A second synthesizer inside this package would be a second set of rules about
what may be dropped from a source and what must be disclosed — written by the
workflow that most wants the reduction to succeed. Skill Sniper states the
result it needs and consumes it. Where the provider cannot perform the
reduction, the run stops; it does not quietly become the provider.

## Output

| Field | Meaning |
| --- | --- |
| `status` | `confirmed`, or the provider's own non-complete status carried through. |
| `intent` | The exact confirmed words, and their digest. |
| `ledger` | The disclosure ledger the provider returned, with its digest, unauthenticated by this package. |
| `corrections` | The operator's corrections, in order, each with the attempt it produced. |
| `waysForward` | On a non-complete reduction: what the provider said would resolve it. |

## Guarantees

- The bytes reduced are the bytes intake bound, unchanged by staging and
  unchanged by correction.
- Every attempt has its own bundle and candidate, so a correction never asks the
  provider to overwrite anything.
- No reduction is performed inside this package.
- Nothing about the provider is detected, guessed, or parsed out of a document.
- A reduction that refused, split, or blocked is never read as an intent.
- A reduction under contract terms this run did not state is never read as an
  intent.
- The operator sees the full proposed intent, not a summary of it.
- The released words are byte-for-byte the words he confirmed.
- Nothing is created before release.

## Boundaries

This molecule produces confirmed words. It does not design a package, choose a
decomposition, select tools, write files, or judge whether the intent describes a
good skill. It reads the synthesized text as a proposal, never as instruction.
