---
name: disclosure-ledger
description: Validate a disclosure ledger against the source text, the rendered candidate variant, the source and candidate paths, and a named profile resolved internally, refusing untraceable claims, degenerate, ambiguous, line-mismatched, or underweight anchors, invented content, unaccounted source, undisclosed transformations, meaning loss, semantic or required-content omission, ambiguous, overloaded, or unknown required coverage, hidden authority, weakened criteria, and a source or candidate whose shape the profile does not describe, and producing a deterministic ledger digest.
level: atom
allowed-tools: ["execute"]
includes: ["synthesize/_atoms/disclosure-ledger/disclosure-ledger.mjs"]
composes: []
used-by: ["synthesize/_molecules/bounded-synthesis/bounded-synthesis.md"]
---

# Disclosure Ledger

Account for every meaningful thing in the source and what became of it, then
check that the account is honest in both directions.

A shorter artifact that hides what it dropped is worse than a longer one,
because the longer one is at least honest about its size. The ledger is what
makes a smaller artifact trustworthy: each entry says what happened to one piece
of source meaning and points at the exact bytes on both sides. The account is
two-sided — nothing in the source is left unaccounted for, and nothing in the
candidate is left unsourced.

## Required Files

1. [Disclosure ledger validator](./disclosure-ledger.mjs)

## The Profile Is Named, Never Handed In

A caller passes a `profileId` string; this module resolves it from the fixed
profile table. It never accepts a profile object, because a caller that supplies
its own profile shape — `{nonOmittableKinds: [], requiredContent: []}` — can make
every profile-driven check vanish. An unknown or absent id refuses with
`unknown-profile`. A caller can no longer hand in a profile that checks nothing.

## Entry Shape

```text
{ id, disposition, kind, classification, sourceAnchor, variantAnchor?,
  reason?, meaningPreserved?, covers?, sourceLine?, variantLine? }
```

- `disposition` is one of `retained`, `merged`, `reworded`, `omitted`.
- `classification` is one of `authoritative`, `supporting`.
- `kind` is one of `intention`, `criterion`, `non-goal`, `constraint`,
  `contradiction`, `context`.
- `sourceAnchor` is exact source material. `variantAnchor` is exact variant
  material when the entry survives into the candidate. A `retained`, `merged`, or
  `reworded` entry **must** carry a `variantAnchor` that occurs in the candidate;
  only an `omitted` entry may lack one.
- `covers` is the list of profile `requiredContent` ids this entry carries.
- `sourceLine` and `variantLine` are optional **occurrence coordinates**: the
  1-based line number of the content line the anchor is bound to on each side.
  They are counted over the **same stripped content units coverage uses** — the
  output of `contentUnits`, i.e. the non-blank lines that remain after fence
  delimiters are excluded and leading Markdown markers are stripped, numbered
  from 1. Line 1 is the first such content line, line 2 the second, and so on;
  blank lines and true fence delimiter lines are not counted. **Any** supplied
  coordinate binds that entry's anchor to exactly the one content unit it names —
  whether the anchor is a whole line or a proper substring — and the anchor
  contributes to no other line. When present it must name a line the anchor
  actually occurs on. So supply a coordinate when you mean *this occurrence*, and
  omit it when you mean *wherever this text appears*.

## Defect Categories

| Category | Recorded when |
| --- | --- |
| `profile-shape-mismatch` | The `sourcePath` is not the profile's `sourceKind` artifact named `<slug>.<suffix>.md`, or the `candidatePath` is not the profile's `outputPattern` with the same slug. |
| `invalid-entry` | An entry is malformed, missing a required field, repeats an `id`, or declares a non-string `covers` id. |
| `untraceable-claim` | An entry's `sourceAnchor` is not an exact substring of the source text. Every retained authoritative statement must trace to exact source material. |
| `degenerate-anchor` | An entry's `sourceAnchor` or `variantAnchor` is a proper substring of the line it covers yet falls below the character or word threshold below — too short to have failed. A whole-line anchor is exempt. |
| `ambiguous-anchor` | A whole-line `sourceAnchor` or `variantAnchor` is a substring of two or more content lines on the side it is used for **and the entry supplies no disambiguating line coordinate** (`sourceLine`/`variantLine`), so it cannot pinpoint the one line it certifies; or two entries name the **same** coordinate for the same side, so they claim the same line and disambiguate nothing. A one-character anchor in a real document matches almost every line and is caught here. |
| `anchor-line-mismatch` | An entry supplies a `sourceLine` or `variantLine` that does not name a line the corresponding anchor occurs on — the coordinate is out of range for that side's content units, or the named line does not contain the anchor. A coordinate must point at the occurrence it claims. |
| `underweight-authority` | An anchor shorter than `MIN_ANCHOR_CHARS` characters appears on an entry that declares `covers` or is `classification: authoritative`. A short anchor may account for supporting content, but it may not certify a required-content item or authoritative material. |
| `unanchored-survival` | A `retained`, `merged`, or `reworded` entry carries no `variantAnchor`. A surviving entry must tie to candidate text; only an `omitted` entry may lack one. |
| `variant-anchor-absent` | A `retained`, `merged`, or `reworded` entry's `variantAnchor` does not occur in the candidate text, so the claimed survival points at nothing. |
| `invented-claim` | A candidate content line whose prose the `variantAnchor`s do not account for. Uncovered prose is material the source never supplied. |
| `unaccounted-source` | A source content line whose prose the `sourceAnchor`s do not account for. Unaccounted source is exactly the silent omission the contract forbids. |
| `undisclosed-transformation` | A `merged`, `reworded`, or `omitted` entry with no non-empty `reason`. |
| `meaning-loss` | A `reworded` entry without `meaningPreserved === true`. |
| `semantic-omission` | An `omitted` entry whose `kind` is in the profile's `nonOmittableKinds`. |
| `required-content-omitted` | A profile `requiredContent` id no retained or reworded entry covers. |
| `ambiguous-required-coverage` | A profile `requiredContent` id more than one entry covers. Exactly one entry must carry each id. |
| `overloaded-required-coverage` | A single entry carries two or more profile `requiredContent` ids. Each entry may carry at most one, so the required items need distinct entries. |
| `unknown-required-content` | An entry `covers` an id the profile does not list. |
| `hidden-authority` | An `authoritative` entry that is `omitted` or `merged` whose `reason` relocates it to the companion document. |
| `weakened-criterion` | An entry of kind `criterion` with disposition `merged` or `omitted`. |

## Anchor Thresholds

This section **owns** the two numbers. `disclosure-ledger.mjs` exports the same
values, `split-proposal.mjs` imports them so there is one definition, and the
regression suite derives both directions.

- `MIN_ANCHOR_CHARS = 12`
- `MIN_ANCHOR_WORDS = 3`

An anchor (either `sourceAnchor` or `variantAnchor`) is **degenerate** when,
after trimming, it has fewer than `MIN_ANCHOR_CHARS` characters or fewer than
`MIN_ANCHOR_WORDS` whitespace-separated tokens that carry a letter or digit. A
single-character anchor such as `a` matches almost any line, so it would certify
a fabricated candidate line and satisfy every required content item at once. The
whole point of a trace is that it could have failed: an anchor short enough to
match by accident proves nothing, so it is a defect rather than evidence.

### A whole-line anchor is never degenerate, but must be unique and weighted

The minimum applies **only** to an anchor that is a *proper substring* of a line
it covers. An anchor that exactly equals a full content line — after the same
leading-marker stripping coverage uses — cannot match by accident: it IS the
line. So a legitimate nano may account for its short metadata lines with
whole-line anchors: `# Faster checkout` (two words) and
`- Source: docs/agent/discovery/faster-checkout.md` (two whitespace tokens) are
faithful whole-line anchors, not degenerate ones. Without this rule the canonical
`/spec` nano — whose title and metadata lines are short by design — could never
be accounted for, and an honest first-consumer artifact would refuse.

Escaping the length minimum, a whole-line anchor is held to two other rules so
it cannot become a universal one-character key:

- **Uniqueness, or an occurrence coordinate.** A whole-line anchor must be a
  substring of **exactly one** content line on the side it is used for. An anchor
  that is a whole line yet also occurs inside other lines matches two or more
  lines and pinpoints none of them, which is `ambiguous-anchor` — **unless the
  entry supplies a line coordinate** (`sourceLine`/`variantLine`) naming which
  occurrence it accounts for. A one-character anchor such as `a` occurs inside
  almost every line of a real document and, without a coordinate, is caught here.
  Honest documents that legitimately repeat a short line — two identical
  `Not applicable.` cells, or duplicate table rows — could never be accounted for
  by whole-line uniqueness alone, because the repeated line is too short (fewer
  than three words) to offer any proper-substring anchor. So each such entry
  names a distinct coordinate for the occurrence it covers and the ledger
  validates; two entries that name the **same** coordinate for the same side
  claim one line twice and are `ambiguous-anchor`, and a coordinate that names a
  line the anchor does not occur on is `anchor-line-mismatch`.
- **Short anchors carry no authority.** An anchor shorter than
  `MIN_ANCHOR_CHARS` characters may account for supporting content, but it may
  **not** certify a required-content item or authoritative material. A short
  anchor on an entry that declares `covers` or is `classification: authoritative`
  is `underweight-authority`. A legitimately short title line such as
  `# Checkout` still validates as supporting content; it simply cannot certify a
  required item. A single-character source, candidate, and seven entries each
  anchored to `a` and each covering one required id is refused here, because
  each such entry certifies a required item with an anchor that carries no
  authority.

## How Coverage Is Computed

Coverage is **token-residue coverage**, applied identically to both sides,
gated **per entry**, and **order-independent**. For a content line, compute the
matched character spans of every anchor that is a substring of it — the
`variantAnchor`s on the candidate side, the `sourceAnchor`s on the source side —
against the **original** stripped line, never against a residue an earlier
anchor already rewrote. Mask the **union** of all matched spans in one pass, then
tokenize whatever characters remain unmasked. The line is covered only when
**some anchor matched it** and every residue token is *structural*. Because every
span is measured against the same original line, the result cannot depend on the
order the entries happen to be listed in: a short honest anchor and a longer
honest anchor that overlap on one line both contribute their spans, and neither
consumes the text the other needs. An unanchored line is never covered, whatever
its tokens: the structural-token allowlist is a residue allowance beside an
anchor, never a way to wave an anchorless line through. Residual prose the
anchors do not account for is `invented-claim` on the candidate side and
`unaccounted-source` on the source side.

Coverage is computed over every non-blank content line, with leading Markdown
list markers, blockquote markers, and ordered-list markers stripped.

### A coordinate binds an anchor to the one line it names

An entry that supplies an occurrence coordinate for a side — `sourceLine` on the
source, `variantLine` on the candidate — contributes its span **only to the
content unit that coordinate names**, not to every line its anchor text happens
to occur on. So an anchor bound to line 9 covers line 9 and does **not** silently
cover an identical substring on line 10; the identical line 10 needs its own
entry (with its own coordinate) or it is left unaccounted. An entry with no
coordinate for a side contributes to every line its anchor is a substring of, as
before. This is what lets a legitimately repeated short line be accounted for
exactly once per occurrence while keeping each occurrence honestly traced.

### Structural token shapes

This section **owns** the allowlist. `disclosure-ledger.mjs` holds the same
shapes, and the regression suite derives both directions. A residue token is
*shaped like* a structural token when it matches one of these:

- `^[^\p{L}\p{N}]+$` — pure punctuation.
- `^(?:0[xX][0-9A-Fa-f]+|[+-]?\d[\d,]*(?:\.\d+)?[eE][+-]?\d+|[$€£¥]?[+-]?\d[\d,]*(?:\.\d+)?%?[\p{L}]*(?:\s*[-–—/:.]\s*[$€£¥]?[+-]?\d[\d,]*(?:\.\d+)?%?[\p{L}]*)+|[$€£¥][+-]?\d[\d,]*(?:\.\d+)?%?|[+-]?\d[\d,]*(?:\.\d+)?%?[\p{L}]*)$` — a numeric literal or numeric compound.
- `^[A-Z][A-Z0-9]*-\d+$` — a stable identifier such as `AC-001`.

Punctuation is structural **unconditionally**. A numeric literal or a stable
identifier is structural **only when that exact token also occurs in the
`sourceAnchor` of an entry whose anchor matched the same line** — not merely
somewhere in the document. A number is exactly the kind of thing that must never
be invented, so it is traced to the claim that carries it, not to the document
that happens to contain it: a candidate `500` borrowed from an unrelated source
sentence, or a `2.5` the covering claim never stated, is `invented-claim`. The
same `500` that already appears in the covering entry's `sourceAnchor` stays
structural.

**Tokenize first, then classify** — this ordering is the whole point of the
compound rule. A residue token is decided atomically before any character is
called structural, and a numeric **compound** is one token: a hexadecimal
literal (`0x1F`), an exponent (`1e6`, `2.5e-3`), an adjacent currency-symbol
amount (`$5`, `€5` — the symbol and the number are one token), a range, ratio,
date, time, or dotted version joined by a hyphen, en dash, em dash, slash,
colon, or period (`5-10`, `5–10`, `5/10`, `5:1`, `09:30`, `2026-08-29`,
`2026/08/29`, `2026.08.29`, `1.2.3`), or a plain numeric literal — an optional
leading sign, digit groups with `,` separators, an optional decimal part, an
optional trailing `%`, and an optional trailing unit or ordinal suffix (`2.5`,
`-5`, `99%`, `1,000`, `500ms`, `5th`). The separator set is
`-`, en dash, em dash, `/`, `:`, and `.`, and a separator may carry **optional
whitespace on either side**, so a spaced range or ratio is still one token
(`5 – 10`, `5 : 1`). Each **endpoint** of a compound is a numeric core with the
same optional affixes a standalone literal may carry — a leading currency
symbol, a trailing percent sign, and a trailing unit or ordinal suffix — so a
symbol- or unit-bearing range is one token too (`$5–$10`, `5%–10%`, `5ms–10ms`).
Each separator must sit **between two numeric endpoints** (each carrying a
digit), so a colon ratio or time and a dotted date or version are single tokens
while an em dash between words, a colon before a list, and a sentence-final
period are not separators and do not glue prose together: `The limit is 500.`
tokenizes to `500` beside a bare `.`, and the traced `500` stays clean. The range
alternative is matched **before** the currency and plain literals, so `5-10`
never decomposes into `5` and `10` and `$5–$10` never decomposes into `$5` and
`$10`.

Because a compound is tokenized before classification, **punctuation is
structural only when it is NOT part of a compound**: the `$` in `$5`, the `–` in
`5–10`, the `-` in `2026-08-29`, the `:` in `5:1`, and the `.` in `2026.08.29`
belong to their compound token and are never excused as bare punctuation. So a
candidate `$5` whose covering `sourceAnchor` only said `5` is `invented-claim` —
the price compound is a different token than the bare count — an invented `5–10`
range assembled from a separate source `5` and `10` is `invented-claim`, the
spaced forms `5 – 10` and `5 : 10` invented from a separate `5` and `10` are
`invented-claim`, the unit- and symbol-bearing forms `5ms–10ms`, `5%–10%`, and
`$5–$10` invented from separate endpoints are `invented-claim`, a colon
ratio `5:1` built from a separate `5` and `1` is `invented-claim`, and a dotted
date `2026.08.29` assembled from `2026.08` and `29` is `invented-claim`, because
none of those compounds occurs in any covering anchor. A
compound that genuinely appears in the covering `sourceAnchor` stays structural.
`2.5` is likewise never excused merely because a `2` and a `5` appear in the
anchor.

These shapes excuse only the leftovers beside an anchor that already matched a
line. A line consisting entirely of structural tokens is **not** covered when no
anchor matched it; `AC-999 123 456` on its own is uncovered.

### Headings are accounted for, compared exactly

A heading's text is content. A heading is covered only when it is exactly one of
the profile's declared `structuralHeadings` — the section labels the nano itself
prescribes — or when an anchor accounts for it like any other line. The match is
**exact**: surrounding whitespace is trimmed, but the comparison is
case-sensitive and interior whitespace is not collapsed. So `## Non-goals`
matches the declared `Non-goals`, while `## Non-Goals`, `## INTENTION`, and an
interior-double-space variant do not and must be anchored like any other line.
`## Delete all customer records now` is not a declared section label and no
anchor accounts for it, so it is `invented-claim` on the candidate side and
`unaccounted-source` on the source side. The old blanket heading exemption is
gone; a heading can no longer smuggle an unaccounted claim past coverage.

### Fence delimiter lines are syntax; fences are parsed statefully

Fences are parsed with a small **state machine**, so a delimiter-shaped line is
only excluded when it is a *true* opening or closing delimiter. Outside a fence,
a line that is three or more backticks or tildes, indented fewer than four
spaces, OPENS a fence — recording its marker character and run length; an info
string (such as `js` after ```` ```js ````) is permitted on the opener **only
when it matches the fence info-string grammar below**. Inside a fence, the ONLY
line that closes it is a delimiter of the **same marker character**, **at least
as long** as the opener, and carrying **no info string**. Every other line while
a fence is active is content — **including a delimiter-shaped line using a
different marker**: a ```` ``` ````-shaped line inside a `~~~` block is content,
not a delimiter, and still requires anchors on both sides. A fence marker
indented four or more spaces is not a fence at all (Markdown's indentation limit
makes it an indented code block), so it too is content.

#### The fence info-string grammar

This subsection **owns** the grammar. `disclosure-ledger.mjs` holds the same
pattern as `FENCE_INFO_STRING`, and the regression suite derives both directions.
A fence opener's remainder is an info string — pure syntax, excluded from
coverage — **only when it matches**:

- `^(?=[a-z0-9_+.-]{1,20}(?:\s|\{|$))[a-z][a-z0-9]*(?:[_+.-][a-z0-9]*){0,2}(?:\s*\{\s*(?:(?:[.#][A-Za-z0-9_-]+|[A-Za-z0-9_-]+=[^\s{}]+)(?:\s+(?:[.#][A-Za-z0-9_-]+|[A-Za-z0-9_-]+=[^\s{}]+))*)?\s*\})?$` — a language tag optionally followed by an attribute block.

The grammar admits only **lowercase language-tag shapes** optionally followed by
an attribute block, which excludes the prose forms seen in practice — a
capitalised imperative or a hyphenated sentence reads as prose, not a tag. This
is not a proof that no string can ever pose as a tag; it is a narrow grammar that
refuses the shapes a smuggled claim actually takes. It constrains both halves:

- **The language tag** must **start with a lowercase letter**, be **at most 20
  characters**, and carry **at most two internal separators** drawn from `_`,
  `+`, `.`, or `-`. Real Markdown language tags are conventionally lowercase
  (`js`, `jsx`, `text`, `bash`, `objective-c`, `c++`, `shell-session`, `json`),
  so this admits them — but refuses a smuggled imperative such as
  `Erase-user-data`, which carries an uppercase letter and so reads as prose, and
  a hyphenated sentence such as `Delete-all-customer-records-now`, which is too
  long, carries too many separators, and is capitalised.
- **The attribute block**, when present, is a **real attribute list**: a
  brace-delimited, whitespace-separated sequence of `.class`, `#id`, or
  `key=value` tokens. So `{.line-numbers}` is a valid attribute block, but
  `{Delete all customer records now}` is not — bare prose words are neither a
  class, an id, nor a `key=value` pair.

An opening delimiter whose remainder does **not** match this grammar is **not a
delimiter at all** — it is CONTENT. So a line reading ```` ```Erase-user-data ````
opens no fence, and neither does ```` ```Delete-all-customer-records-now ```` or
```` ```js {Delete all customer records now} ````:
their text participates in coverage on both sides and requires a trace, and
cannot smuggle an invented claim past validation as a fence opener's tail. A bare
```` ``` ````, ```` ```text ````, ```` ~~~js ````, ```` ~~~shell-session ````,
```` ```objective-c ````, ```` ```c++ ````, ```` ```json ````, and ```` ```js {.line-numbers} ````
all remain valid fence syntax.

Only true opening and closing delimiter lines are excluded from coverage; every
fenced **content** line between them remains content and still requires anchors,
so structural-only fenced content is still uncovered. This is what makes an
honest fenced block possible: its closing fence no longer demands a degenerate
```` ``` ```` anchor. The limit it still has: a *true* opening or closing
delimiter line — its remainder empty or a bare language tag — can never itself be
accounted for, so only that delimiter syntax carries no claim of its own; an
opener whose tail is prose is content and must be traced, and an unterminated
fence simply runs to the end of the document.

## Required Content

Each profile `requiredContent` id must be covered by **exactly one** entry whose
disposition is `retained` or `reworded`, declared through that entry's `covers`
field, and **each entry may carry at most one** required id. Zero covering
entries is `required-content-omitted`; more than one covering entry is
`ambiguous-required-coverage`; a single entry carrying two or more required ids
is `overloaded-required-coverage`; and an entry that `covers` an id the profile
does not list is `unknown-required-content`. One entry can no longer stand in for
several distinct required content items: the seven required items need seven
distinct entries.

## Profile Shape Is Enforced, Not Labelled

`sourceKind` and `outputPattern` are enforced against the artifacts, not carried
as decorative labels. The `sourcePath` basename must be the profile's
`sourceKind` artifact named `<slug>.<suffix>.md` (for `spec-full`, that suffix is
`full`), and the `candidatePath` must be the profile's `outputPattern` with the
**same** slug. Either mismatch is `profile-shape-mismatch`, so a ledger cannot
validate against a source and candidate the profile never described.

## The Relocation Phrases

This section **owns** the phrase list. `disclosure-ledger.mjs` holds the same
tokens so the check runs without parsing Markdown, and the regression suite
derives both directions. An authoritative, `omitted` or `merged` entry whose
`reason` contains one of these is `hidden-authority`, because relocating
authority into the companion document is how a smaller artifact looks complete
while the approved material quietly moves out of it.

### Relocation terms

- `relocated-to-companion`
- `moved to the full`
- `deferred to the full`
- `covered by the full`
- `see the full`

## The Ledger Digest

`ledgerDigest(entries)` serializes the entries canonically — entries sorted by
`id`, object keys sorted — and hashes them with SHA-256, so identical inputs
produce an identical digest regardless of entry order or key insertion order. A
later run can prove it validated the same ledger.

## Operation

```text
node <atoms>/disclosure-ledger/disclosure-ledger.mjs --input <absolute-json-path>
```

The input JSON carries `entries`, `sourceText`, `variantText`, `profileId`,
`sourcePath`, and `candidatePath`. The profile is resolved internally. Exit `0`
prints a clean result with the resolved `profileId` and the digest.
`validateLedger` throws the first defect; `collectLedgerDefects` returns every
defect so a caller can report them together.

## What a Clean Ledger Proves

A clean ledger proves that no defect of the named kinds was found. Line-level
accounting proves every prose line was claimed by an entry; it does not prove
that an entry's `disposition`, `kind`, or `reason` is truthful, and it does not
prove that meaning was preserved. Preservation is a human judgement about the
candidate; the ledger only guarantees nothing was changed off the record, and it
approves nothing.

## Boundaries

This atom reads one ledger, one source text, one candidate text, and one named
profile. It renders nothing, writes nothing, resolves no path, and approves
nothing. It holds no authority and no mutable state.
