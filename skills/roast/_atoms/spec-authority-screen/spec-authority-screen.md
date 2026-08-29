---
name: spec-authority-screen
description: Check a synthesized specification roast against the staged pair, refusing a report that inverts the nano authority, rests on a layer disagreement without naming the authority, cites an undeclared acceptance criterion, or omits a sibling from the evidence manifest.
level: atom
allowed-tools: ["execute"]
includes: ["roast/_atoms/spec-authority-screen/spec-authority-screen.mjs"]
composes: []
used-by: ["roast/_molecules/roast-artifact-branch/roast-artifact-branch.md"]
---

# Spec Authority Screen

`spec-pair` establishes what is true about a specification pair. This atom
checks that the roast written about that pair respects the one rule the pair
rests on: `<spec>.nano.md` is authority and `<spec>.full.md` is context.

It screens a report. It raises no finding, assigns no severity, withdraws
nothing, approves nothing, and returns no verdict about the specification. A
defect is an ordinary schema failure and takes the ordinary
retry-once-then-report route the roast contract already defines.

## Why the Rule Is Checked Rather Than Stated

A rule that lives only in prose is a rule a reviewer inverts under time
pressure, and the inversion reads perfectly well. "Update the nano
specification to match the full specification" is a fluent, helpful-sounding
recommendation. Acted on, it changes an artifact a human approved so that an
artifact nobody approved becomes right, which is the exact failure the two-layer
model exists to prevent.

Items 12, 13, and 14 of the spec envelope checklist point at this checker for
the same reason items 10 and 11 point at theirs.

## Required References

1. [Spec authority screen](./spec-authority-screen.mjs)

## Operation

```text
node <atoms>/spec-authority-screen/spec-authority-screen.mjs \
  --report "$absolute_report_path" --pair "$absolute_pair_record_path" \
  --phase <envelope|roast>
```

`--pair` is the spec pair record `spec-pair.mjs` produced for this run, written
to a file. Check availability with `--probe`.

`--phase` names which document is being screened, and it is required. Only the
envelope carries `## Evidence Manifest`, so only `envelope` checks one. Running
the manifest check against a final roast would fail every clean run, and
defaulting the phase would let the wrong one pass quietly. Both phases check
authority direction and criterion citations, because synthesis rewrites the
findings and can introduce an inversion the envelope did not carry.

Exit `0` is a clean screen, `2` names each entry and the rule it broke, and `1`
is a usage, path, or record failure.

The screen refuses a record that does not name the nano layer as the authority,
that carries no locator for either sibling, or that declares no criteria list.
Each of those would let the check pass by having nothing to check against, so
the screen cannot be satisfied by starving it.

## Defect Categories

This section **owns** the defect vocabulary and the phrase lists below.
`spec-authority-screen.mjs` holds the same tokens so it runs without parsing
Markdown, and the regression suite derives both directions.

| Category | Recorded when |
| --- | --- |
| `Missing pair evidence` | In the `envelope` phase, the evidence manifest has no entry naming a sibling, or names an absent sibling without its status. |
| `Inverted authority` | A recommendation brings the nano specification into agreement with the full specification, or an `Authority` field names anything except the nano locator alone. |
| `Unattributed authority` | An entry rests on a disagreement between the layers and carries no `Authority` field. |
| `Undeclared criterion citation` | An entry cites an acceptance-criterion identifier the staged nano specification does not declare. |

### Authority terms

- `nano`
- `nano specification`
- `nano artifact`

### Context terms

- `full specification`
- `full spec`
- `full artifact`

### Alignment terms

- `agree with`
- `agrees with`
- `match`
- `matches`
- `align`
- `aligns`
- `consistent with`
- `in line with`
- `reconcile`
- `reflect`

### Conflict terms

- `conflict`
- `conflicts`
- `contradict`
- `contradicts`
- `disagree`
- `disagrees`
- `overrides`
- `supersedes`
- `widens`

### Negation terms

- `do not`
- `don't`
- `never`
- `avoid`
- `rather than`
- `instead of`

Each sibling's own locator counts as a term for its layer, so a report that
names files rather than layers is screened identically. A locator matches only
as a whole path token: `checkout.nano.md.bak` never satisfies an entry for
`checkout.nano.md`, and one manifest line satisfies one sibling, never both.

## The Authority Field

An entry that rests on a disagreement between the two layers carries:

```text
- Authority: <nano locator>
```

The field is the checkable part of this screen, and it exists for the same
reason the intent screen requires a citation: a claim inferred from prose can
be phrased around, and a claim stated in a field cannot. After stripping only
incidental whole-field code-span quoting or a whole-field Markdown link, the
field must equal the nano locator, and only it. An entry naming any other
locator, any second locator, or any other trailing text as authority is an
`Inverted authority` defect regardless of how the surrounding sentences read,
because a field that resolves to more or less than the nano locator attributes
nothing.

An entry is treated as resting on a disagreement when it names a conflict term
and the context (full) layer. Naming the nano layer as well is not required: an
entry that asserts the full specification conflicts and carries no `Authority`
field is `Unattributed authority` even when it never uses the word `nano`. An
entry whose conflict is genuinely internal to the full specification is asked
for the same field; supplying it — naming the nano locator as the authority —
clears the screen, and the screen blocks nothing regardless.

## How Direction Is Decided

`Inverted authority` is recorded from the field whenever one is present. The
prose check below is a second, weaker route for an entry that carries no field.

It needs three things in one clause, **in this order**: the authoritative
layer, then an alignment term, then the context layer. Order is what carries
direction in the sentence. "Align the full specification with the nano
specification" is the correct direction and is clean; "align the nano
specification with the full specification" is the inversion and is a defect. A
clause is skipped only for the span a negation term governs, so "Do not update
the nano specification to match the full specification" is not read as the
instruction it warns against. A contrast opener does not suppress the directive
after its comma — "Instead of leaving the drift, update the nano specification
to match the full specification" is still caught — and a negation that merely
trails an inversion, "update the nano specification to match the full
specification, rather than leaving the drift", reverses nothing and is still
caught.

Sentence splitting preserves path locators before applying this direction
check, so "Update specs/checkout.nano.md to match specs/checkout.full.md" is
screened the same way as the layer-name form.

Recommending a change to the nano specification is otherwise entirely
legitimate — an ambiguous criterion should be rewritten — so the screen does not
object to one. It objects only when the full specification is named as the
standard the nano artifact must meet.

## What This Screen Does Not Prove

The prose check recognizes the phrase family listed above. It is not a proof
that no inversion is present, and it never was: "copy the wording from the full
specification into AC-1" inverts the authority without using an alignment term,
and no phrase list closes that off.

The `Unattributed authority` trigger has the same shape of limit. It fires on
the conflict terms listed above; a disagreement phrased without one — "the full
specification says fifteen minutes; the nano specification says ten" — names
both layers but no conflict term, and is not required to attribute an
authority. The `Authority` field remains the mechanically checked route, and
the prose trigger is a best-effort prompt for one, never a guarantee that every
disagreement carries it.

That is why the `Authority` field exists and why the envelope rule requires it.
A clean screen means no defect of the four named kinds was found. It is not a
statement that the roast is correct, and it approves nothing.

## Guarantees

1. **A clean report is valid.** A report that cites no criterion and rests on
   no disagreement passes. The rules are per entry, never a demand that entries
   discuss the authority.
2. **Fenced content is inert.** A quoted example of an inverted recommendation
   is evidence about a report, not a defect in one.
3. **A starved record refuses.** A record that nominates another authority,
   omits a locator, or declares no criteria list exits `1` rather than passing
   with nothing to compare. So does a missing or unknown `--phase`.
4. **The screen never resolves the pair itself.** It compares a report with a
   record it was given, so it can never disagree with the evidence the roast
   was actually built on.

## Boundaries

This atom reads one report and one record. It stages nothing, resolves no path
inside the pair, raises no finding, assigns no severity, selects no doctrine,
spawns nothing, approves nothing, and writes nothing. It holds no authority and
no mutable state.

A defect is a schema failure, not a review outcome. It never blocks, and it
never converts into a finding about the specification.

## Regression Suite

From the repository root, run:

```text
node --test skills/roast/_atoms/spec-authority-screen/spec-authority-screen.test.mjs
```
