---
name: intent-request
description: State the output contract Skill Sniper asks Synthesize for - the source skill's human intent as plain requirements - build the one attempt-scoped request that carries those terms and the bound revision, and check the returned result against this run's source, contract terms, and the exact bytes the operator will be shown, without reducing anything here.
level: atom
allowed-tools: ["execute"]
includes: ["snipe-skill/_atoms/intent-request/intent-request.mjs"]
composes: []
used-by: ["snipe-skill/_molecules/intent-adoption/intent-adoption.md"]
---

# Intent Request

Skill Sniper does not reduce source text. Bounded reduction with a disclosure
ledger is `synthesize`'s job, and a second synthesizer living here would come
with its own quiet rules — which is precisely what the ledger exists to prevent.

What this atom owns is the **request**: what the smaller artifact has to be, and
what a usable answer looks like.

The seam is small on purpose, and it earns its place twice. Synthesize requires
the desired result to be stated in full, so something has to state it. And the
words that come back are shown to a human for a byte-exact confirmation, so
something has to prove they are a reduction of the artifact this run bound and
not of anything else. Everything beyond those two jobs belongs to the provider.

## Required Files

1. [The output contract asked for, and the check on what comes back](./intent-request.mjs)

## The Output Contract, Stated In Full

| Term | Value |
| --- | --- |
| `goal` | the source skill's human intent as plain requirements suitable for operator confirmation and later create-skill input |
| `sourceKind` | `skill-bundle` |
| `variantKind` | `intent-prose` |
| `workspaceRoot` | `synthesis/intent/` |
| `outputPattern` | `synthesis/intent/<slug>.intent.md` |
| `wordBudget` | `500` |
| `requiredContent` | `subject`, `purpose`, `requirements`, `refusals` |
| `nonOmittableKinds` | `intention`, `criterion`, `non-goal`, `constraint`, `contradiction` |
| `structuralHeadings` | `What this is for`, `What it must do`, `What it must refuse` |

The goal is worded for the two things the result has to survive. An operator
confirms it byte for byte, so it has to read as requirements rather than as a
description of a package; and the destination's own skill-creation workflow takes
it as input, so it has to be the kind of thing that workflow can build from.

Every term is stated because the provider requires every term to be stated, and
that is deliberate on both sides: a caller that will not say what the smaller
artifact must contain has not chosen a result, and a result nobody chose is one
nobody can be held to afterwards.

`requiredContent` names meaning, not document furniture, and the source path and
revision are deliberately absent from it. Requirements that named their own
source file would be a machine-facing document instead of plain requirements, and
would prove nothing anyway: traceability is proved by the disclosure ledger,
which anchors every retained claim to exact source material.

`structuralHeadings` is an exemption list, not a template. Existing intent files
differ from one another, and a candidate is a proposal a human reshapes —
imposing an outline here would impose it on the wrong artifact at the wrong
moment.

### Five hundred words, and what that limit counts

The budget is a **hard maximum over the complete candidate** — every heading,
marker, and link included. A limit that ignored part of the document could always
be met by moving text into the part it ignored, so the count has no blind spot to
move text into.

Traceability does not compete for that budget. The disclosure ledger, the source
identity, and the revision all live **outside** the candidate, so nothing is
squeezed out of the requirements to make room for evidence about them. That is
why `requiredContent` names meaning and not provenance.

When the essential intent will not fit, the provider **refuses and proposes a
bounded split**. It does not truncate the tail, and it does not blur a refusal or
a constraint into a vaguer sentence — both produce a document that still reads
like requirements and no longer commits anybody to anything, which is worse than
an honest refusal because the operator would confirm it. A source whose intent
genuinely will not fit is usually more than one job, and splitting it is cheap at
this point and expensive later.

## There Is Nothing To Detect

An earlier version of this unit took a phrase from the operator's own intent —
ordinary human language about how far a reduction zooms out — and treated it as a
machine identifier. It probed the provider's frontmatter for a declaration of
that identifier and stopped the run when it could not find one.

That was wrong twice over.

It made the run's outcome depend on **the shape of the provider's document**
rather than on anything about the work. A provider perfectly able to do the job
was reported as unable to, because of how its metadata was written.

And it required reading Markdown and then YAML well enough to be trusted, which
defeated four successive readers: prose that mentioned the identifier, prose
beside a label, a fenced example, an HTML comment, and finally a look-alike field
sitting inside a quoted multi-line description, which the reader took for a
declaration the provider had never made. Each fix was a smaller epicycle on the
same mistake.

The probe and its parser are **deleted**, and the class of bug goes with them.
Nothing is detected, because there is nothing to detect: the contract is stated,
handed over with the bound source, and the result is judged. A provider that
cannot honour the contract says so in its own result, which is a far better
signal than a guess about its frontmatter.

The general lesson is the one worth keeping: a phrase a person uses to describe
what they want is not a name the machinery gets to look up. Promoting it to an
identifier invents a taxonomy nobody agreed to, and then makes runs fail on
whether other people's documents use it.

## Every Attempt Has Its Own Identity

A run does not get one shot at this. The operator reads the proposed
requirements, and when they are wrong he corrects them and the reduction is asked
for again — which is the whole reason the confirmation gate exists.

So each attempt is `<slug>-attempt-<n>`, for both the staged bundle and the
candidate:

```text
attempt 1  synthesis/intent/<slug>-attempt-1.bundle.md -> <slug>-attempt-1.intent.md
attempt 2  synthesis/intent/<slug>-attempt-2.bundle.md -> <slug>-attempt-2.intent.md
```

That is not bookkeeping. Synthesize refuses to overwrite a candidate it has
already written, so a corrected attempt reusing the first attempt's path is
refused with `replacement-not-authorized` and **the correction loop cannot
turn**. The fix is to give each attempt a distinct identity, never to relax the
provider's no-overwrite boundary — a boundary worth keeping for its own sake,
since it is also what leaves every superseded proposal on disk beside the one
that was confirmed, so what the operator rejected stays readable afterwards.

Attempt one is numbered like the rest. A special case for the first attempt is
exactly where this collision would grow back.

**The binding does not change between attempts.** A correction changes what is
asked for, never which bytes are being reduced: every attempt in a run reduces
the same bound source and carries the same revision, which is what lets the run
report one source identity for all of them. The result check binds each record to
the attempt that asked for it, so a superseded proposal cannot be presented as
the corrected one.

## Operation

1. Build the request with `buildIntentRequest({ binding, slug, attempt })`. It
   carries the provider, the contract terms in full, the bundle and candidate
   paths **derived from the subject and the attempt number**, and the revision
   intake pinned rather than a label the caller chose. The caller names a subject
   and an attempt; it does not hand in a path, so there is no path to point
   somewhere else. There is no "reduce this however you like" form of this call.
2. Invoke `synthesize` with it. The reduction, its traceability, its budget, its
   ledger, and its persistence are the provider's.
3. Before any result is used, call `assertIntentResult(record, binding, request)`.
   It requires the record to name `synthesize`, to report **the contract terms
   this request stated**, to name a contract it obeyed, to report a `complete`
   reduction, to carry the same source digest this run bound, to name **the exact
   candidate this request asked for**, to carry candidate text whose digest is the
   candidate digest it claims, and to carry a **clean** disclosure ledger that
   certifies that same candidate path and digest with at least one identified
   entry.

   This is a **shape check on the result record**, and saying so matters: there
   is no signed provenance to check against, so it cannot authenticate that
   `synthesize` produced the record. What it catches is the realistic failure — a
   reduction of the wrong bytes, under the wrong terms, of a run that did not
   complete, or accompanied by an account of a different artifact.

   The ledger checks are about agreement, not re-adjudication. A ledger that is
   defective or certifies a different artifact is evidence about something else —
   and evidence about something else is worse than none, because it looks like an
   account and reads like approval.

### What is recomputed here, and what is not

Exactly one digest is recomputed: the candidate's, over the bytes the operator is
about to be shown. Those bytes are this package's own obligation, and a record
whose text and digest disagree would put a confirmation on something nobody
checked.

The provider identifies a declared contract by a digest of its own terms, and
this package **does not recompute that digest**. The canonicalisation is the
provider's, and a second implementation of it here could disagree about what a
contract is. So the substantive question is asked directly instead — were my
terms the terms obeyed? — by comparing the echoed terms with the ones sent.
`profileId` is carried as the provider's own opaque label for them: required to
be present, required to be the label the ledger agrees with, never derived.

The **ledger digest is required but never recomputed** either, for the same
reason. This atom checks that a ledger is present, clean, well formed, carries
identified entries, and agrees with the candidate it accompanies; whether it is
an honest account of the reduction is the provider's guarantee, and the result
says so with `ledgerAuthenticated: false`.

## Provider-Supplied And Caller-Stamped

| Source | Fields |
| --- | --- |
| The provider | `status`, `profileId`, `contractTerms`, `sourceDigest`, `candidatePath`, `candidateDigest`, `ledger` |
| This run | `synthesizedBy`, `intentText` |

The second row matters more than it looks. `synthesizedBy` records which provider
this run invoked, and `intentText` is the candidate bytes this run read back from
the path the provider returned. Checking them proves the record is internally
consistent with what this run did; it corroborates nothing the provider said,
because this run wrote them. A reader who missed that would read the whole check
as verified provenance, which it is not and says it is not.

## Failures

| Code | Meaning |
| --- | --- |
| `usage` | The subject, the attempt number, the binding, or the request was not one this run produced. |
| `local_synthesis_forbidden` | Something other than `synthesize` produced the reduction. |
| `substitution_forbidden` | Different contract terms, no named contract, or a candidate this request did not ask for. |
| `outcome_not_complete` | The reduction refused, split, or blocked, so there is no intent to confirm. |
| `source_mismatch` | The reduction names bytes other than the ones this run bound. |
| `candidate_mismatch` | The text to be shown is not the text the candidate digest names. |
| `unaccounted_reduction` | No clean disclosure ledger for this candidate under this contract. |

## Guarantees

- The output contract is stated in full, and never inferred from what is
  convenient.
- No reduction happens inside this package.
- Nothing about the provider is detected, guessed, or parsed out of a document.
- A request names one bundle, one candidate, one attempt, and the revision this
  run bound; no two attempts in a run name the same paths.
- A result is bound to that source, to the contract terms that were sent, to a
  complete reduction, to the candidate that was asked for, to a clean ledger
  certifying that same candidate, and to the exact bytes the operator will be
  shown.
- What is checked and what is merely required is stated rather than implied, so
  the check is not mistaken for provenance.

## Boundaries

This atom does not synthesize, summarize, condense, or rewrite anything. It does
not edit, extend, or propose a change to `synthesize`. It does not invoke the
provider and does not present anything to the operator: it states what is wanted,
builds the request that asks for it, and checks the shape of what comes back.
