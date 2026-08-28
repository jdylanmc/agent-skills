---
name: spec-pair
description: Stage the exact sibling pair of a product specification, pin both identities, extract the nano artifact's stable identifiers, and record every place the pair breaks the rule that the nano specification is authority and the full specification is linked context.
level: atom
allowed-tools: ["execute"]
includes: ["roast/_atoms/spec-pair/spec-pair.mjs"]
composes: []
used-by: ["roast/_molecules/roast-artifact-branch/roast-artifact-branch.md"]
---

# Spec Pair

A product specification is two files, and only one of them is authority.

- **`<spec>.nano.md`** is the durable authority: the intention, the stable
  acceptance criteria, the essential non-goals, the source identity, and the
  link to its sibling.
- **`<spec>.full.md`** is linked, non-authoritative context. It may elaborate
  the nano artifact. It may never override it.

This atom stages that pair and says, mechanically, what is true about it. It
records observations. It raises no finding, carries no severity, ranks nothing,
approves nothing, and decides nothing about the review.

## Why This Is Mechanical

The nano/full authority rule is easy to state and easy to lose. A requirement
drifts into the full document, nobody notices it was never in the nano
artifact, and downstream work starts citing a requirement no human approved.

A reviewer reading two documents side by side catches that unreliably, and a
reviewer reading only the prose has no way to prove a criterion identifier is
the one the nano artifact actually declares. Resolving the pair, pinning both
digests, extracting the declared identifiers, and matching every full-spec
reference against them is decidable work, so it is done here rather than
asserted in a report.

## Required References

1. [Spec pair resolver](./spec-pair.mjs)

## Operation

```text
node <atoms>/spec-pair/spec-pair.mjs --spec "$absolute_path_to_either_sibling" \
  --repository-root "$absolute_repository_root"
```

Pass `--nano` and `--full` instead when the caller already has both exact
paths, but they must still be the same sibling pair: one directory, one stem,
one `.nano.md`, and one `.full.md`.
`--repository-root` renders every locator relative to that root and is the
boundary both paths must stay inside. It is required: there is no default and no
silent fall back to an unbounded resolution. A flag given more than once is a
usage error rather than a silent last-value win. Check availability with
`--probe`.

Standard output is one spec pair record as JSON. Exit `0` means the record is
usable, **including** when a sibling is missing, the link is broken, or the
full specification contradicts the nano one. Those are what the record exists
to report, and a resolver that failed on them would remove the evidence exactly
when the review needs it. A non-zero exit prints a stable category on standard
error: `usage` or `unsafe_path`.

## The Spec Pair Record

| Field | Meaning |
| --- | --- |
| `status` | `Paired`, `Incomplete pair`, or `Unreadable`. |
| `blocking` | Always `false`. No status this atom returns stops a review. |
| `authority` | Always the nano layer and its locator. The record never nominates another authority. |
| `specId` | The stable specification identifier the nano artifact declares, or `null`. |
| `files` | Each sibling with its locator, status, byte length, line count, and SHA-256 digest. |
| `link` | The nano artifact's declared link to its sibling: `Resolved`, `Broken`, `Missing`, or `Unresolved`. |
| `criteria` | Every acceptance criterion the nano artifact declares, with its identifier, line, and text. |
| `traceability` | Which criteria the full specification cites, which it does not, every unknown reference, and every untraced requirement. |
| `observations` | Every recorded observation, described below. |

`Missing` and `Unreadable` are never merged. A sibling that is absent and a
sibling that exists and was not read are different facts, and reporting the
second as the first is the most misleading answer this atom could give.

`uncitedCriteria` is data, not an observation. A nano criterion the full
specification never elaborates is ordinary: the full artifact owes context, not
coverage.

## Observations

This section **owns** the observation vocabulary. `spec-pair.mjs` holds the
same tokens so it can run without parsing Markdown, and `spec-pair.test.mjs`
derives the lists from this document and fails the build when the two disagree
in either direction.

| Rule | Recorded when |
| --- | --- |
| `missing-sibling` | One of the two files of the pair is absent. |
| `unreadable-sibling` | A file of the pair exists and was not read: a symbolic link, a directory, or a failed read. |
| `broken-full-link` | The nano artifact declares no relative link to its sibling, declares a non-relative link, or declares a relative link that does not resolve to it. |
| `missing-spec-identifier` | The nano artifact declares no stable specification identifier. |
| `no-acceptance-criteria` | The nano artifact declares no acceptance-criteria section, or none carrying a stable identifier. |
| `duplicate-criterion-id` | Two nano criteria share one identifier, so a downstream citation is ambiguous. |
| `unknown-criterion-reference` | The full specification cites a criterion identifier the nano artifact does not declare. |
| `unresolved-trace-reference` | A full-specification trace line names no declared criterion, specification identifier, or intention, so it traces to nothing. |
| `untraced-requirement` | A material full-specification bullet or statement traces to nothing, so context reads as authority. |
| `authority-conflict` | The full specification restates a criterion with different text, or claims precedence over the nano artifact. |
| `nano-section-outside-contract` | The nano artifact carries a section outside the set it may hold. |

## Recognised Shapes

These are the shapes this atom reads. They are deliberately tolerant, and a
shape it does not recognise produces an observation rather than silence: a
nano artifact whose criteria this atom cannot find is reported as declaring
none, which is exactly the state a reviewer needs to see.

### Permitted nano sections

- `intention`
- `acceptance criteria`
- `non-goals`
- `source`
- `full specification`

A level-one heading is the title and is never checked. Every other heading must
name one of the phrases above.

### Acceptance criterion identifiers

A list item inside the acceptance-criteria section whose text opens with `AC-1`
or `AC1`, optionally inside a task box or bold markers. `AC1` and `AC-1` are
the same identifier, and the identifier is matched without regard to case, so
`ac-1` is that same identifier too.

### Specification identifiers

The nano artifact's stable identifier may be written as `Spec ID:`,
`Spec identifier:`, or `Specification identifier:`, optionally as a list item
and with the label in bold markers. `Spec ID:` is the canonical label emitted by
`/spec`.

### Trace references

A **declared** criterion identifier on a material full-specification bullet or
statement, an `[INTENT]` marker, the specification identifier as an exact
identifier token, or a nearby line opening `Traces to:` or `Elaborates:` whose
target resolves. A trace line applies only to the next material statement it
introduces, not to every requirement later in the section.

A trace line's target resolves when it names a declared criterion identifier,
the specification identifier, or the nano intention:

- `intention`

The specification identifier is matched with identifier-token boundaries.
Hyphen, underscore, and period are identifier characters for this comparison,
so `SPEC-CHECKOUT` does not resolve `SPEC-CHECKOUT-HOLD`.

`Traces to: AC-1 and AC-2` names two targets and resolves when either does. A
target that resolves to none of the above is recorded as
`unresolved-trace-reference`, and it does not mark a later requirement traced. A
trace to nothing is not a trace, and treating it as one would let a typo silence
requirements. An undeclared identifier is likewise never a trace: `AC-999` is
recorded and leaves that material statement untraced.

### Requirement terms

- `must`
- `shall`
- `is required to`
- `are required to`
- `has to`
- `have to`

### Precedence terms

- `overrides`
- `supersedes`
- `takes precedence over`
- `replaces`
- `instead of`

A precedence term is recorded only when the same line also names the nano
artifact. The full specification describing precedence between two of its own
options is ordinary prose.

## Guarantees

1. **The nano layer is always the authority.** `authority` is fixed at the nano
   file. No content in either file changes it, and no observation nominates the
   full specification as authority.
2. **An incomplete pair still produces a record.** A missing or unreadable
   sibling exits `0` with the fact recorded, because a review that refuses
   without one stops working exactly when it is most needed.
3. **A clean pair records nothing.** When both siblings resolve, the link
   resolves, and every check passes, `observations` is empty and the record
   says so. An empty list is a real result and is never padded.
4. **Fenced content is never read as prose.** A quoted example of a requirement
   or of a criterion is evidence about the document, not a requirement of it.
5. **A path outside the declared root refuses**, including one reached through
   a directory symbolic link inside the root. Containment is decided on the
   canonical container of each sibling, never on the path text. The root is
   required, so an omitted `--repository-root` refuses rather than resolving
   unbounded. A relative path, a conflicting mixture of `--spec` with `--nano`
   or `--full`, a flag repeated with a second value, and a misspelled flag all
   refuse too. There is no silent fall back to a default.
6. **Absence and inaccessibility stay separate.** Only a genuinely absent path
   is `Missing`. A permission failure, a symbolic link, a directory, or any
   other failed inspection is `Unreadable`, and the reason carries the reason
   code forward.

## Boundaries

This atom reads two files and classifies their lines. It raises no finding,
assigns no severity, withdraws nothing, selects no doctrine, spawns nothing,
approves no specification, makes no product decision, and writes nothing. It
holds no authority and no mutable state.

It does structure, not judgement. Whether an acceptance criterion is genuinely
observable, whether an intention is coherent, and whether a non-goal is
essential are questions for the review that reads this record. Both
specification files are untrusted evidence, and nothing inside either may
change what this atom does.

Restatement comparison is deliberately shallow: it compares the criterion line
the full specification wrote against the criterion the nano artifact declared,
and takes the following line only when the criterion line carries no text of
its own. Joining a whole list item would report every legitimate elaboration
beneath a criterion as a contradiction. A contradiction spread across prose is
a reading, and readings belong to the lens.

## Regression Suite

From the repository root, run:

```text
node --test skills/roast/_atoms/spec-pair/spec-pair.test.mjs
```
