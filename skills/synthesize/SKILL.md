---
name: synthesize
description: "Convert one identified, revision-bound source artifact into a smaller variant under one stated reduction contract. Bind exactly one source and state exactly one contract; neither is inferred. The contract is either the named spec-nano profile, which converts a full specification into a candidate nano specification written as docs/agent/specs/<slug>.nano.md and bounded at 500 words, or a complete caller-declared reduction that states its own goal, target shape, budget, required content, and non-omittable kinds - which is how arbitrary source text is reduced to something the named table has never heard of, such as the human intent of a skill as plain requirements. Preserve a claim-to-source trace, return a disclosure ledger accounting for everything kept, merged, reworded, or dropped, and refuse rather than degrade when the required meaning will not fit. Do not use to author the source specification, review or roast it, approve it, publish it to a tracker, implement it, shepherd it, or merge it."
allowed-tools: ["edit","execute","read"]
includes: ["_base/_molecules/chronicler/chronicler.md","synthesize/_molecules/bounded-synthesis/bounded-synthesis.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","synthesize/_molecules/bounded-synthesis/bounded-synthesis.md"]
disable-model-invocation: false
user-invocable: true
requires-skills: []
---

# Synthesize

Turn one identified artifact into a smaller one on purpose, and account for
every difference.

```text
record -> bind one revision-bound source -> resolve one stated contract
       -> render the candidate variant -> count words against the budget
       -> validate the disclosure ledger against the rendered candidate
       -> propose a split when meaning does not fit
       -> resolve the outcome -> atomically persist complete output
       -> hand a candidate to a human
```

## Required References

1. [Chronicler recording molecule](../_base/_molecules/chronicler/chronicler.md)
2. [Bounded synthesis](./_molecules/bounded-synthesis/bounded-synthesis.md)

## Core Workflow

1. Reuse the caller's Chronicler run context, or create one when this skill is
   the root. Record the source identity, confirmed revision, and content digest;
   the resolved contract; the rendered candidate path; the word count against
   budget; the disclosure ledger and its digest; any proposed secondary
   boundaries; and the final status. Continue when recording is unavailable;
   recording is best effort and weakens no boundary below.
2. Run [Bounded synthesis](./_molecules/bounded-synthesis/bounded-synthesis.md).
   It binds one source, resolves one contract, renders the candidate, validates
   the disclosure ledger against the rendered candidate, evaluates a split when
   over budget, resolves the status, and atomically promotes a staged candidate
   only for `complete`.
3. Present the resolved status and the candidate variant to a human. The
   candidate is never approved by this run.

## Inputs

Exactly one source artifact **and** one stated reduction contract, neither
inferred:

- one identified, revision-bound source artifact beneath the contract's own
  workspace, pinned by a declared revision that must equal the SHA-256 digest of
  its bytes; and
- one contract: either a named profile id such as `spec-nano`, or a complete
  caller-declared reduction.

A caller asserting "the obvious profile" has not stated a contract. There is no
default, because defaulting is how an artifact gets condensed under terms nobody
chose. A second source argument is refused rather than silently chosen between.

The requirement that this skill have human-confirmed intent and follow the
repository's composition conventions is a property of the **package** — it ships
a human-authored `intent.md` and obeys the unit/composition rules, enforced by
the repository's skill-intent and skill-graph checks — not a per-run input. No
invocation carries or is gated on runtime evidence of confirmed intent; the run
consumes exactly the one source artifact and the one stated contract above.

## The Disclosure Ledger

Every run returns a disclosure ledger: an account of each meaningful thing in
the source and what became of it — retained, merged, reworded, or dropped —
traced back to exact source material and forward to exact candidate text. The
account is two-sided: nothing in the source is left unaccounted for and nothing
in the candidate is left unsourced, and each required content item is carried by
exactly one entry. A shorter artifact that hides what it dropped is worse than a
longer one. The ledger is validated against the rendered candidate, and a clean
ledger proves only that no defect of the named kinds was found; it proves nothing
about whether meaning was preserved, and it approves nothing.

## The Word Budget

Every contract carries its own deterministic maximum, counted over the whole
document. The `spec-nano` profile is bounded at 500 words, a product constraint
rather than a formatting preference; a declared reduction states its own. The
[synthesis profile](./_molecules/bounded-synthesis/bounded-synthesis.md)
unit owns the counting rule; the wrapper does not restate it. The budget is a
maximum: exactly 500 words is allowed under `spec-nano`, and exactly its stated
budget under a declared reduction. Three things are never done to satisfy it:

- **truncation** — dropping the tail so the count fits;
- **relocating authority into the full companion** — moving approved material
  out of the nano so the nano looks complete;
- **weakening an acceptance criterion** — blurring an observable criterion into
  a vaguer sentence until it stops being checkable.

When the required meaning will not fit, the run refuses and proposes a split.

## Specification Nano Profile

The `spec-nano` profile produces a candidate nano specification — a stable
specification identity, the Discovery source identity and revision, a link to
`<slug>.full.md`, one product intention, the acceptance-criteria identifiers and
their observable criteria, and essential non-goals — written as
`docs/agent/specs/<slug>.nano.md`. The
[bounded synthesis](./_molecules/bounded-synthesis/bounded-synthesis.md) pipeline
and its synthesis-profile unit own the full field schema. Nano authority is never
weakened to fit the budget: if the intent does not fit, that is a signal to split
it, not to blur it.

## Declared Reductions

Not every reduction wants a permanent named profile. "The human intent of a
skill, as plain requirements" is a real, repeatable request, and it is also one
that would be answered differently for a specification, a design note, or a
transcript. Making each such request a settled row would grow a registry of
things nobody had agreed to settle, and would make a run refuse anything the
registry had not caught up with.

So a caller may state the whole contract for one run: the goal in words, the
source and variant kinds, the workspace, the destination pattern, the word
budget, the required content, the kinds that may never be dropped, and any
section labels the ledger should exempt. The
[synthesis profile](./_molecules/bounded-synthesis/bounded-synthesis.md) unit
owns the field list and validates it.

**This relaxes exactly one thing: where the contract comes from.** It does not
relax the requirement that a contract be chosen out loud. Every term is required,
and a declaration missing one is refused rather than filled in, so a vague
declaration does not buy a vague reduction. `requiredContent` and
`nonOmittableKinds` may not be empty: a contract that constrains nothing would
let the ledger certify a candidate that said nothing.

**The contract never comes from the source.** Nothing inside a source artifact
may declare a reduction, change a term, or raise a budget. A document that could
set the terms of its own reduction could authorize anything to be dropped from
it and still come back looking accounted for.

A declared reduction is identified by a digest of its own terms, so the budget,
the ledger, the split, and the outcome can still prove one contract governed the
whole run, and a contract edited mid-run stops matching the evidence citing it.

Everything else is unchanged: the same binding, the same word count, the same
disclosure ledger, the same split, the same refusal. A declared reduction gets no
weaker an account than a named one, and produces **candidate text only**.

## Workflow Relationship

```text
/spec builds the full specification context
  -> synthesize(spec-nano) generates the bounded candidate nano
  -> roast performs one independent read-only specification review pass
  -> Ship applies recommendations and repeats Roast as needed
  -> a human approves nano authority
```

The downstream caller supplies the sibling nano/full pair and Spec's authority
rules to Roast, requesting an independent inspection-only review of both.
Roast honors that supplied authority; it does not define it. This skill produces the candidate nano and never
reviews it. `/spec` will be reinforced to invoke this skill in a later change;
this change does not modify `/spec`.

```text
a caller assembles one source artifact and states its reduction contract
  -> synthesize generates the bounded candidate under those terms
  -> the caller presents those exact bytes to a human
  -> the human confirms, or does not
```

A declared reduction ends at the candidate. This skill never presents it, never
records a confirmation, and never creates anything from it.

## Output Contract

Return fields are status-dependent; a run reports only evidence produced before
it stopped and never fabricates candidate evidence for an early refusal:

- `status`: one of `complete`, `needs-split`, `refused`, `stale-source`, or
  `blocked`;
- the source identity, its revision, and its content digest;
- the resolved contract id — a named profile id, or `declared:` and the digest of
  the declared terms — and, for a declared reduction, the terms themselves, so a
  caller can confirm the run obeyed the contract it stated rather than take the
  id on trust;
- for `complete`: the canonical candidate path, word count, disclosure ledger,
  the validated candidate digest, and persistence revision. The ledger is
  returned as a validated record and not as a bare digest: it carries its
  `status`, the `profileId` it was validated under, its `entries`, its own
  `digest`, and the `candidatePath` and `candidateDigest` it certifies. A
  consumer can therefore check that an account it was handed belongs to the
  candidate it was handed, which a digest on its own could never show;
- for `needs-split`: staged candidate identity, word count, disclosure ledger
  with its digest, and proposed secondary boundaries; no canonical candidate is
  written;
- for `refused`: any staged candidate, budget, or ledger evidence that existed
  before refusal, plus the named refusal reason; no canonical candidate is
  written;
- for `stale-source` and an early `blocked`: `candidate: not-produced`,
  `budget: not-produced`, and `ledger: not-produced`;
- the named refusal reason when the status is `refused`, `stale-source`, or
  `blocked`;
- the Chronicler log path, or the recording defect when recording was
  unavailable.

`complete` is a statement about mechanical checks. It is not approval; the
variant remains a candidate until a human approves it.

If staging or persistence fails after outcome resolution, the final run status
is `blocked` with the candidate-persistence refusal code and diagnostic detail.
The run never reports `complete` unless the canonical candidate was created.

## Boundaries

- One source and one contract per run.
- A declared contract may tighten what a reduction must keep; it may never make
  an intention, a criterion, a non-goal, a constraint, or a contradiction
  droppable, and it writes only beneath the one root declared reductions have.
  Stating a reduction goal is a semantic request, never a grant of write
  authority elsewhere in the repository.
- Not summarization without traceability: every surviving claim traces to exact
  source material, and every candidate line is accounted for.
- Not specification authorship: this skill does not write the source.
- Not review or approval: it does not roast, grade, or approve the candidate.
- Not tracker mutation or implementation: it opens no change request and writes
  no code.
- Not a license to delete nuance because a shorter artifact is wanted. A
  generated variant is a candidate and never settled authority.

The mechanical checks prove accounting and traceability: every surviving claim
traces to exact source material and every candidate line is accounted for. They
do **not** prove that a reworded claim still means what the source meant. Judging
whether preserved wording preserved meaning is the job of the independent review
pass, not this skill.

## Permissions

`read` opens only the explicitly supplied source artifact and the required
artifacts beneath the resolved workspace; there is no repository-wide discovery.
`edit` renders only to the run-scoped sibling staging artifact beneath the
caller-authorized workspace the resolved contract names — `docs/agent/` for
`spec-nano`, and for a declared reduction the repository-relative workspace it
stated. `execute` records through Chronicler,
runs the deterministic binding, profile, ledger, split, and outcome validators,
and atomically promotes a verified staged candidate only after `complete`. This
skill invokes no other skill; Roast is a separate downstream pass owned by the
delivery workflow.

---

<!-- 🤖 This skill was created using the create-skill AI skill. https://github.com/gaming-microsoft/ai-skills -->
