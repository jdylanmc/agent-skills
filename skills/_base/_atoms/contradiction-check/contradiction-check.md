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

`assertions[].id`, `evidence[].ref`, and both members of every `accepted` pair
are **identifiers**: stable labels, not payloads. An identifier carrying an
ASCII control character (U+0000–U+001F, U+007F) is refused, and identifiers are
serialized into suppression and finding-identity keys with an unambiguous
encoding, so a collision between two distinct pairs is impossible even if the
identifier vocabulary later widens. The refusal states the contract; the
encoding is the belt-and-braces guarantee.

Duplicate `assertions[].id` and duplicate `evidence[].ref` are refused as
`invalid-input`, naming the duplicated identifier. Uniqueness is what makes
"every finding names the contradicted assertion" and "severity reflects what
was contradicted" **mechanical** rather than a promise: with a duplicate id the
last assertion would silently win the severity lookup, and with a duplicate ref
a finding could not say which evidence text grounded it.

One validator decides whether any string is usable, everywhere: a string counts
as empty when nothing meaningful remains after trimming ASCII whitespace and
stripping zero-width and other Unicode format characters, so a lone zero-width
space is not a non-empty identifier.

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

Two bounds cap the comparison surface, each applied to the total of the
assertion set and, separately, to the total of the evidence set. Exceeding
either is refused with code `surface-unbounded`, naming which side, which bound,
and both numbers.

- `MAX_SURFACE_WORDS` is `500`. A word count bounds how many distinct claims a
  surface can carry.
- `MAX_SURFACE_CHARACTERS` is `MAX_SURFACE_WORDS * 10` — written as that
  multiple in code so the derivation is visible rather than a second magic
  number. It exists because the word count is **not** a size bound: one
  whitespace-delimited token can be arbitrarily long, and a script written
  without whitespace (many CJK texts) counts an entire paragraph as a single
  word. The character bound is what actually refuses a surface too large to
  compare.

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
| `usage` | The command line was invoked wrongly (wrong flags, or a non-absolute `--input` path). |
| `unreadable-input` | The `--input` path cannot be read, or its contents are not valid JSON. The underlying condition is carried in the message, not the code, so the cause is not swallowed. |
| `invalid-input` | The record is malformed: an unknown or inherited field, a missing required field, a bad type, a control character or duplicate identifier, a duplicate finding pair, or a finding that grounds in no supplied assertion or evidence. |
| `surface-unbounded` | The assertion set or the evidence set exceeds the word or character bound. |

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

## Boundaries

- **Reports only.** It never edits, approves, re-approves, invalidates, revises,
  or proposes an edit. There is no field in the input or the output through which
  an edit, patch, or suggestion may travel; any such field is refused as unknown.
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
