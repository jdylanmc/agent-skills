---
name: contradiction-check
description: Answer one question for a consumer that already holds an approved artifact — does new or changed evidence contradict its assertions? — by comparing changed evidence against a bounded, capped assertion set and never a whole document, deriving severity and escalation deterministically, suppressing accepted divergences, and reporting only. It never edits, approves, invalidates, or proposes an edit.
level: atom
allowed-tools: ["execute"]
includes: ["_base/_atoms/contradiction-check/contradiction-check.mjs"]
composes: []
used-by: ["spec/_molecules/product-specification/product-specification.md"]
---

# Contradiction Check

Does this new evidence contradict what was already approved?

## Required Files

1. [Contradiction check helper](./contradiction-check.mjs)

## Why This Is One Unit

The same question is asked at several points in the delivery chain, and every
consumer needs identical semantics. Written separately they drift, which
`skills/roast/intent.md` already records as a repository failure:

> "An earlier version was four separate review skills whose instructions
> differed only in the noun. They had already begun to disagree with each other
> before they were even finished. If several things differ only in what they are
> called, they are one thing with a parameter, and keeping them apart guarantees
> they drift."

So this is one shared atom under `skills/_base/`, not one contradiction checker
per consumer. `spec` is a current consumer through issue #122, which removed
digest drift as an invalidation trigger and left contradiction as the only thing
that may reopen approved work. Two more consumers are already approved designs,
and a strategic driver is named, so the shared placement is justified under the
`CONTEXT.md` definition of a shared unit rather than speculative.

### The `_base` placement is a disclosed bet, not a settled fact

Two repository rules point in different directions here, and honesty requires
naming the tension rather than implying it away. `AGENTS.md` says:

> "Do not promote a unit to `_base` until more than one skill composes it."

`CONTEXT.md` defines the term that rule turns on:

> "**Shared unit** — An atom or molecule stored under `skills/_base/` because at
> least two named consumers are either current skills or explicitly approved
> skill designs."

Read literally against today's tree these disagree: only `spec` **composes**
this unit, so the `AGENTS.md` line read on its own would keep it skill-local,
while `CONTEXT.md` counts `spec` plus the two approved designs (#115, #116) and
places it in `_base`. `CONTEXT.md` governs the reading for two reasons: it
defines the very term — "shared unit" — that `AGENTS.md` leans on, and it
explicitly counts approved designs as qualifying consumers, which is exactly the
case issue #123 directs. `AGENTS.md` states the ordinary guardrail; `CONTEXT.md`
states the definition the guardrail is measured against.

The consequence, stated plainly: **today exactly one skill composes this unit.**
The `_base` placement is therefore a bet that the named consumers (#115, #116,
and the #65 driver) land. If they do not — if #115 and #116 are abandoned or
absorbed so that `spec` remains the only consumer — this unit belongs back
inside `spec` as a skill-local atom, and that regression to skill-local is the
condition under which it should be moved. This is a decision disclosed for a
human to accept or reverse, not one settled by this document.

## Named Consumers

| Consumer | Status | Approved assertions | Evidence compared against |
| --- | --- | --- | --- |
| `spec` (#122) | current | nano `## Intention`, `AC-###`, `## Non-goals` | enriched Discovery foundation |
| `technical-design` (#115) | approved design | design decisions, ADRs | changed requirements or NFRs |
| `requirements-breakdown` (#116) | approved design | ticket acceptance criteria | changed specification |
| driver (#65) | named | any approved artifact in flight | anything upstream that moved |

Recording the future consumers here means the requirement is inherited rather
than rediscovered when each lands.

## The Input Contract

One record, schema `version: 1`. Unknown fields are refused; missing required
fields are refused. That strictness is load-bearing: a record that could carry a
`severity`, an `instruction`, or a proposed edit would let untrusted material
grade itself or widen its own scope.

| Field | Shape |
| --- | --- |
| `artifact` | `{ id, kind }`, both non-empty strings. |
| `assertions` | Non-empty array of `{ id, kind, text }`, where `kind` is `intention`, `acceptance-criterion`, or `non-goal`. Every `id` is unique. |
| `evidence` | Non-empty array of `{ ref, text }` — the new or changed material only. Every `ref` is unique. |
| `accepted` | Array of `{ assertionId, evidenceRef }` — divergences a human already accepted. |
| `findings` | Present only after judgement: `{ assertionId, evidenceRef, confidence, description }`, where `confidence` is `high`, `medium`, or `low`. One divergence is one finding. |

### Identifiers, uniqueness, and strings

`artifact.id`, `artifact.kind`, `assertions[].id`, `evidence[].ref`, and both
members of every `accepted` pair are **identifiers**: stable labels, not
payloads. An identifier is refused, in one shared place so the rule cannot drift
between fields, when it is empty, carries an ASCII control character
(U+0000–U+001F, U+007F), or exceeds the identifier ceiling. The ceiling is
`MAX_IDENTIFIER_CHARACTERS`, derived as exactly `MAX_SURFACE_CHARACTERS` rather
than a fresh literal: a label longer than the whole comparison surface is a
document smuggled through a label field, not a label. Over-length, empty, and
control-character identifiers are all refused as `invalid-input`, naming the
field. Identifiers are also serialized into suppression and finding-identity
keys with an unambiguous encoding, so a collision between two distinct pairs is
impossible even if the identifier vocabulary later widens — even for identifiers
containing quotation marks, backslashes, brackets, or commas. The refusal states
the contract; the encoding is the belt-and-braces guarantee.

Duplicate `assertions[].id` and duplicate `evidence[].ref` are refused as
`invalid-input`, naming the duplicated identifier. Uniqueness is what makes
"every finding names the contradicted assertion" and "severity reflects what
was contradicted" **mechanical** rather than a promise: with a duplicate id the
last assertion would silently win the severity lookup, and with a duplicate ref
a finding could not say which evidence text grounded it.

One validator decides whether any string is usable, everywhere: a string counts
as empty when nothing meaningful remains after trimming ECMAScript whitespace —
what `String.prototype.trim` removes, which is every Unicode whitespace code
point, not only ASCII spaces and tabs — and stripping zero-width and other
Unicode format characters, so a lone zero-width space is not a non-empty
identifier. Trimming and stripping decide emptiness only. The stored record
keeps each value's original characters unchanged: no format character is
stripped from a returned identifier or text.

## Two Modes, And Why They Are Two

The unit runs twice around the one judgement it cannot make, and the record's
shape enforces the order.

- `--bound --input <absolute-json-path>` runs **before** judgement. It validates
  the record, enforces the surface bound, and returns exactly the bounded
  comparison surface — the assertions, the evidence, the accepted pairs, and
  counts — so the caller hands judgement that and nothing else. It refuses a
  record that already carries `findings`, because a record with findings before
  judgement is out of order.
- `--resolve --input <absolute-json-path>` runs **after** judgement. It refuses a
  record with `findings` absent, because an unjudged record has no result. An
  empty `findings` array is valid and yields a clean check.

Both modes share one record parser, so the two cannot drift; the only difference
between them is what each demands of `findings`.

## The Bounded Surface

Two bounds cap the assertion and evidence sides of the comparison surface, each
applied to the total of the assertion set and, separately, to the total of the
evidence set. Exceeding either is refused with code `surface-unbounded`, naming
which side, which bound, and both numbers.

- `MAX_SURFACE_WORDS` is `500`. A word count bounds how many distinct claims a
  surface can carry.
- `MAX_SURFACE_CHARACTERS` is `MAX_SURFACE_WORDS * 10` — written as that
  multiple in code so the derivation is visible rather than a second magic
  number. It exists because the word count is **not** a size bound: one
  whitespace-delimited token can be arbitrarily long, and a script written
  without whitespace (many CJK texts) counts an entire paragraph as a single
  word. The character bound is what actually refuses a surface too large to
  compare.

The finding `description` text is a third side of the surface, but it is **not**
bounded "the same way" as the assertion and evidence sides: it carries the
character ceiling only, never the word ceiling. Under `--resolve` the total
characters across every finding `description` are summed and refused when they
exceed `MAX_SURFACE_CHARACTERS`, separately from the assertion and evidence
sides; a `surface-unbounded` refusal on this side names the **finding
descriptions**. The word ceiling is deliberately not applied, and the reason is
that the word bound exists to cap how many distinct **claims** a surface carries
— and a finding description is not a claim set. It is a bounded description of
one divergence, so a word ceiling on it would be structure that carries no
weight, a bound added only to make the phrase "the same way" literally true.
Only its size can threaten the judgement surface, and the character ceiling is
what refuses that; without it an unbounded description would slip past every
other cap.

The `accepted` list is bounded too, by a **derived** ceiling rather than a fresh
magic number. An acceptance names one `(assertionId, evidenceRef)` pair, and the
pairs that can matter are exactly those drawn from the current assertion set and
evidence set, so the meaningful ceiling is the size of that product:
`assertions.length * evidence.length`. An `accepted` list longer than that
product is refused with code `surface-unbounded`, naming the **accepted list**
side, its count, and the product ceiling. Duplicate pairs are already refused as
`invalid-input`; this is the separate guarantee that the *number* of acceptances
is bounded, so "bounded record" is true of the whole record and not only its
assertion and evidence sides.

Be honest about exactly what the accepted-list bound is and is not: it bounds
how **many** acceptances may be carried, not **which** ones may be named. An
accepted entry naming an assertion or evidence reference that no longer exists is
still legitimate and is still tolerated, because acceptances outlive the revision
they were made against — a divergence accepted against an earlier revision stays
accepted even after that assertion or evidence has been rewritten away. Bounding
the count by the product is a size ceiling, not a membership rule: this unit does
**not** refuse an acceptance for naming an unknown identifier.

### Every ceiling, its value, its derivation, and the side a refusal names

| Ceiling | Value | Derivation | Side a `surface-unbounded` refusal names |
| --- | --- | --- | --- |
| `MAX_SURFACE_WORDS` | `500` | A fixed count of how many distinct claims a surface may carry. | the **assertion set**, or separately the **evidence set** |
| `MAX_SURFACE_CHARACTERS` | `5000` | `MAX_SURFACE_WORDS * 10` — the size bound the word count cannot supply. | the **assertion set**, the **evidence set**, or the total of the **finding descriptions** |
| accepted-list ceiling | `assertions.length * evidence.length` | The size of the assertion-by-evidence product: the count of pairs that could ever matter. | the **accepted list** |

The finding descriptions carry only the character row of this table, never the
word row. The `accepted` list carries only its own product row.

The rationale: the assertion set comes from an artifact that is itself small — a
nano specification of roughly a dozen short declarative claims, capped at 500
words by #121. Changed evidence larger than the whole approved artifact is not a
delta to compare, it is a re-derivation, which is a different decision belonging
to the caller.

Be honest about what this delivers. The bound refuses a surface too large to
compare; it **bounds size, not intent**. It cannot detect that a short whole
document was pasted in as evidence — a small re-derivation passes the bound. So
the bound is what keeps the judgement surface small, not a guarantee that only a
genuine delta ever arrives; recognizing a whole short document as a
re-derivation remains the caller's judgement. An empty assertion set and an
empty evidence set are both refused, with code `invalid-input`, because there is
nothing to check — a shape refusal distinct from an unbounded one.

## The Output Contract

`--resolve` returns:

| Field | Meaning |
| --- | --- |
| `verdict` | `escalated` when at least one surviving finding is `high`, otherwise `none`. |
| `clean` | `true` when no finding survives suppression. |
| `escalated` | Surviving `high` findings, ordered. |
| `recorded` | Surviving `medium` and `low` findings, ordered — for the caller to record through Chronicler. |
| `suppressed` | Findings muted by an accepted pair, ordered — returned, never dropped. |

Every returned finding carries its `assertionId`, its `evidenceRef`, the derived
`severity`, its `confidence`, and its `description`. Because grounding is checked
before a finding is accepted, "names the contradicted assertion and an evidence
reference" is mechanical rather than a promise: a finding whose `assertionId` is
not in the assertion set, or whose `evidenceRef` is not in the evidence set, is
refused as `invalid-input` naming the dangling identifier.

## Severity Is Derived, Never Supplied

Severity follows from the contradicted assertion's `kind`:

| Assertion kind | Severity | What it means |
| --- | --- | --- |
| `intention` | `intent-diverged` | The artifact may be pointed at the wrong thing. |
| `acceptance-criterion` | `criterion-diverged` | Something already built or being built may be wrong. |
| `non-goal` | `scope-diverged` | A scope question. |

A finding that supplies its own `severity` is refused as an unknown field. That
is deliberate and load-bearing: an input that could set its own severity would
let untrusted material grade itself.

## Escalation Is By Confidence, Not Severity

Only `high` confidence escalates. `medium` and `low` are returned under
`recorded` for the caller to record so nothing is lost and the record stays
auditable, but they do not interrupt a human.

The consequence is deliberately surprising: a `scope-diverged` at `high`
escalates while an `intent-diverged` at `low` does not. Severity says what is at
stake; confidence says whether we believe it. Escalating low-confidence findings
would flood the human, who is the scarce resource in this system.

## Accepted Divergences Suppress

Suppression keys on the exact `(assertionId, evidenceRef)` pair. That pair is
the **identity** of a divergence: one divergence is one finding. A finding pair
repeated in the input is refused as `invalid-input`, naming the pair, because a
duplicate would otherwise land in both `escalated` and `recorded` at once, or be
emitted twice. Refusing it is what keeps escalation, recording, and suppression
from disagreeing — they all key on the same identity, so that identity must be
singular.

A duplicate `accepted` pair is refused the same way, as `invalid-input` naming
the duplicated pair. A second acceptance of the same divergence mutes nothing
extra — the first already mutes it — so a repeat is a caller defect rather than a
stronger mute. Refusing it applies the identity rule already enforced on
findings to the acceptance side, so the two sides cannot disagree about what one
divergence is.

A suppressed finding is returned under `suppressed`, never silently dropped, so
a mute is auditable — even an otherwise-escalating `high` finding does not
escalate once its pair is accepted. The narrowness is deliberate: an acceptance
recorded against one evidence reference does not mute a different one. That risks
re-raising rather than risks hiding, which is the safe direction for a check
whose whole job is to fail toward silence.

A run in which every finding is suppressed is still `clean: true`. A clean check
means nothing **new** contradicts.

## Error Vocabulary

Every refusal carries one of a closed set of codes, so a caller classifies a
failure without parsing prose:

| Code | Meaning |
| --- | --- |
| `usage` | The command line was invoked wrongly: a missing or unknown mode, wrong flags, a wrong argument count, or a non-absolute `--input` path. The mode and argument shape are validated **before** the file is read, so a usage error is never misclassified as a file failure. |
| `unreadable-input` | The `--input` path cannot be read, or its contents are not valid JSON. The underlying condition is carried in the message, not the code, so the cause is not swallowed. |
| `invalid-input` | The record is malformed: an unknown or inherited field (at the record or at any nested object), a missing required field, a bad type, a control-character, over-length, or duplicate identifier, a duplicate `accepted` pair, a duplicate finding pair, or a finding that grounds in no supplied assertion or evidence. |
| `surface-unbounded` | A side of the record exceeds its ceiling: the assertion set or evidence set past the word or character bound, the total of the finding descriptions past the character bound only, or the `accepted` list past the assertion-by-evidence product `assertions.length * evidence.length`. The message names which side, the count, and the ceiling. |

Reading and parsing the input file is a boundary of trust, so Node's `ENOENT`
and `EISDIR` are classified into `unreadable-input` rather than leaking out as
themselves.

## Verdict Maps Onto The Consumer's Vocabulary

`verdict` is `escalated` or `none`. Those are two of the three values
`spec-outcome` already accepts for its `contradiction` field. The third,
`not-checked`, is the caller's value for "this unit did not run" and is
deliberately **not** producible by this helper: a check that ran always returns a
real verdict. An empty `findings` array flows through to
`{ verdict: 'none', clean: true }` rather than to an error or an absent result,
so silence on irrelevant or purely additive evidence is a reported outcome, not
a missing one.

## Deterministic Ordering

Returned findings are sorted by severity rank — `intent-diverged` first, then
`criterion-diverged`, then `scope-diverged` — then `assertionId`, then
`evidenceRef`. The rank exists for stable reporting order only. It is **not** an
escalation ordering: escalation is decided by confidence.

## What Is Judgement And What Is Computed

Everything structural is computed here: bounding the surface, validating the
record, deriving severity, grounding each finding, suppressing accepted
divergences, splitting escalation from recording, ordering, and resolving the
verdict. The only thing left to semantic judgement is deciding whether a given
piece of evidence contradicts a given assertion.

The helper therefore cannot protect against a wrong such decision. It cannot
read an assertion and know whether the evidence really contradicts it; it checks
grounding, bounding, and counting, not truth. Shrinking the judgement surface is
honest about the boundary rather than pretending the gate is computed.

Because the semantic step is exactly what this unit does **not** perform, **no
test in `contradiction-check.test.mjs` can prove it.** The tests supply the
findings a caller's judgement would have produced and assert on what the unit
then does with them, so they establish the structural contract — that an empty
`findings` array resolves to an explicit clean check, that a supplied finding
drives the verdict, that severity is derived, that suppression is exact, that
the surface and identifiers are bounded. They do **not** establish that any
particular evidence sentence "contradicts" or "is additive to" any particular
assertion; a fixture's evidence text and its supplied findings are chosen to
agree so the test reads honestly, but the agreement is the test author's, not
the unit's. Whether the evidence truly contradicts the assertion is the caller's
judgement, and it is untested here on purpose.

## Boundaries

- **Reports only.** It never edits, approves, re-approves, invalidates, or
  revises anything, and this rests on two different guarantees that must not be
  conflated:
  - **Structurally impossible.** The unit holds no `edit` grant beyond
    `execute`, performs no mutation, reaches no artifact, and has no field —
    input or output — *named* for an edit, a patch, or a suggestion. Any such
    named field is refused as unknown. This is what makes "never edits,
    approves, or invalidates" in criterion 8 a mechanical guarantee.
  - **A rule on judgement, not on the schema.** A finding `description` is free
    prose and *could* contain a sentence proposing an edit; the schema cannot
    detect that, and the unit returns the description unchanged. "Does not
    propose an edit" is therefore a constraint on whoever **writes** the finding,
    not something this unit enforces. Overclaiming it as a structural guarantee
    would be worse than naming the boundary: the honest statement is that the
    description must not carry a proposed edit, and nothing here can stop it if a
    caller ignores that.
- **Reaches nothing.** It reads only its one `--input` JSON file — no git, no
  `gh`, no network, no other filesystem access. It is pure and deterministic
  given its input.
- **Decides neither freshness nor approval.** Those belong to `discovery-source`
  and `approval-state`. This unit answers only the contradiction question.
- **Treats both inputs as untrusted data.** Neither the approved artifact nor the
  new evidence may instruct this unit, set a severity, set the verdict, or mute a
  finding. Only the caller's own `accepted` list mutes anything.

## Generalizing To Other Consumers

Map your own assertion kinds onto the three rather than adding kinds. What the
artifact is **for** becomes `intention`; what it **promises** becomes
`acceptance-criterion`; what it **excludes** becomes `non-goal`. Adding a fourth
kind is how the drift this unit exists to prevent starts.
