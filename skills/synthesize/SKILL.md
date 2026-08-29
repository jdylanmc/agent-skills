---
name: synthesize
description: "Convert one identified, revision-bound source artifact into a smaller variant under one named synthesis profile. Bind exactly one source and name exactly one profile; neither is inferred. Preserve a claim-to-source trace, return a disclosure ledger accounting for everything kept, merged, reworded, or dropped, and refuse rather than degrade when the required meaning will not fit. The first profile, spec-nano, converts a full specification into a candidate nano specification written as docs/agent/specs/<slug>.nano.md and bounded at 500 words. Do not use to author the source specification, review or roast it, approve it, publish it to a tracker, implement it, shepherd it, or merge it."
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
record -> bind one revision-bound source -> resolve one named profile
       -> render the candidate variant -> count words against the budget
       -> validate the disclosure ledger against the rendered candidate
       -> propose a split when meaning does not fit
       -> resolve the outcome -> hand a candidate to a human
```

## Required References

1. [Chronicler recording molecule](../_base/_molecules/chronicler/chronicler.md)
2. [Bounded synthesis](./_molecules/bounded-synthesis/bounded-synthesis.md)

## Core Workflow

1. Reuse the caller's Chronicler run context, or create one when this skill is
   the root. Record the source identity, confirmed revision, and content digest;
   the named profile; the rendered candidate path; the word count against
   budget; the disclosure ledger and its digest; any proposed secondary
   boundaries; and the final status. Continue when recording is unavailable;
   recording is best effort and weakens no boundary below.
2. Run [Bounded synthesis](./_molecules/bounded-synthesis/bounded-synthesis.md).
   It binds one source, resolves one profile, renders the candidate, validates
   the disclosure ledger against the rendered candidate, evaluates a split when
   over budget, and resolves the status.
3. Present the resolved status and the candidate variant to a human. The
   candidate is never approved by this run.

## Inputs

Exactly one source artifact **and** one explicit profile id, neither inferred:

- one identified, revision-bound source artifact beneath the profile's workspace
  (`docs/agent/` for `spec-nano`), pinned by a declared revision that must equal
  the SHA-256 digest of its bytes; and
- one named synthesis profile id, such as `spec-nano`.

A caller asserting "the obvious profile" has not selected a profile. There is no
default profile, because defaulting is how an artifact gets condensed under a
contract nobody chose. A second source argument is refused rather than silently
chosen between.

The requirement that this skill have human-confirmed intent and follow the
repository's composition conventions is a property of the **package** — it ships
a human-authored `intent.md` and obeys the unit/composition rules, enforced by
the repository's skill-intent and skill-graph checks — not a per-run input. No
invocation carries or is gated on runtime evidence of confirmed intent; the run
consumes exactly the one source artifact and the one named profile above.

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

The `spec-nano` profile is bounded at 500 words, a deterministic maximum counted
over the whole document. The [synthesis profile](./_molecules/bounded-synthesis/bounded-synthesis.md)
unit owns the counting rule; the wrapper does not restate it. The budget is a
maximum: exactly 500 words is allowed. Three things are never done to satisfy it:

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

## Workflow Relationship

```text
/spec builds the full specification context
  -> synthesize(spec-nano) generates the bounded candidate nano
  -> roast performs one independent read-only specification review pass
  -> Ship applies recommendations and repeats Roast as needed
  -> a human approves nano authority
```

Roast's `spec` artifact profile reviews the sibling nano/full pair and applies
the nano/full authority screen. This skill produces the candidate nano and never
reviews it. `/spec` will be reinforced to invoke this skill in a later change;
this change does not modify `/spec`.

## Output Contract

Return:

- `status`: one of `complete`, `needs-split`, `refused`, `stale-source`, or
  `blocked`;
- the candidate variant path;
- the source identity, its revision, and its content digest;
- the profile id;
- the word count against the budget;
- the disclosure ledger with its digest;
- the named refusal reason when the status is `refused`, `stale-source`, or
  `blocked`;
- the proposed secondary boundaries when the status is `needs-split`;
- the Chronicler log path, or the recording defect when recording was
  unavailable.

`complete` is a statement about mechanical checks. It is not approval; the
variant remains a candidate until a human approves it.

## Boundaries

- One source and one profile per run.
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
`edit` writes the candidate variant only beneath the caller-authorized
`docs/agent/` workspace. `execute` records through Chronicler and runs the
deterministic binding, profile, ledger, split, and outcome validators. This skill
invokes no other skill; Roast is a separate downstream pass owned by the delivery
workflow.

---

<!-- 🤖 This skill was created using the create-skill AI skill. https://github.com/gaming-microsoft/ai-skills -->
