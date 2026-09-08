---
name: foundation-persist
description: Persist one Discovery foundation beneath docs/agent/discovery/, binding human-aligned findings and post-alignment domain/frontier derivations by digest, retaining durable evidence, then rereading and re-parsing the atomic write.
level: atom
allowed-tools: ["execute"]
includes: ["discovery/_atoms/foundation-persist/foundation-persist.mjs"]
composes: []
used-by: ["discovery/_molecules/cycle-controller/cycle-controller.md"]
---

# Foundation Persist

Persist the aligned Discovery foundation for one subject as a durable
repository artifact, so a later run can ground itself on the exact shared
understanding a human agreed to rather than on conversation memory.

From the caller's view this is one operation: hand in the aligned findings, the
domain model and frontier derived from them, and their binding receipts, then
receive the persisted locator and revision or a named refusal.

## Required Files

1. [Foundation persist helper](./foundation-persist.mjs)

## Destination

Exactly one path is ever written:

```text
<repositoryRoot>/docs/agent/discovery/<slug>.md
```

- `slug` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- `repositoryRoot` must be an absolute path.
- An absolute slug, a `..` segment, a backslash, a `/`, or any destination
  outside `docs/agent/discovery/` is refused as `unsafe-destination`.

Repository-backed Discovery foundations live beneath `docs/agent/discovery/` as
part of the durable `docs/agent/` application-workflow workspace.

### Symlink-bounded, not proven-safe

`mkdirSync`/`writeFileSync` follow symbolic links, so a symlinked `docs`,
`agent`, `discovery`, or final target could redirect the write outside the
bound. Before writing, the helper walks each component with `lstat` and refuses
`unsafe-destination` when any component is a symbolic link, when an existing
component in the chain is not a directory, or when an existing destination is
not a regular file. It never creates a directory over an existing non-directory.
Be honest about the residual: this is a time-of-check/time-of-use check, not a
lock. A component could be swapped for a symlink between the walk and the write.
The check refuses the links it can see; it does not prove the path stays safe.

## Schema version

The artifact records `- Schema: 2` beside `- Subject:`. Schema 2 requires every
aligned-claims, risk, and domain-model section. The parser also reads genuine
schema 1 foundations from before issue #156, treating only those newly
introduced fields as empty. A missing or unknown schema is refused with
`unsupported-schema`; deleting a required schema 2 section is `invalid-input`,
not a silent downgrade.

## Alignment and the payload binding

Discovery's alignment vocabulary is `offered`, `verified`, `corrected`, and
`not-aligned`. Only `verified` or `corrected` may be persisted, and the persisted
artifact records `alignment: confirmed` — the exact token
`spec/_atoms/discovery-source` requires of a Discovery source. `offered` and
`not-aligned` are refused with `unaligned`. Rereading is never approval;
alignment stays human-owned.

The alignment gate is bound, not asserted. Two modes are supported:

- the legacy whole-payload mode carries `alignedPayloadDigest`, computed with
  `alignedPayloadDigestOf`;
- the canonical Discovery flow carries `alignedFindingsDigest`, computed with
  `alignedFindingsDigestOf` over exactly the findings shown to the human, plus
  `domainModelBasisDigest` and `frontierBasisDigest` receipts that must equal
  that digest.

A findings mismatch is `alignment-unbound`. A domain-model or frontier receipt
that does not bind to those findings is `derivation-unbound`. This preserves
the required order without claiming the human saw outputs produced only after
alignment.

Be precise about what the binding proves. It proves the persisted payload is
byte-for-byte the payload that was digested. It does **not** prove a human
understood or approved that payload — alignment is a human act this atom cannot witness. The whole-payload digest
covers every durable set, including `domainModel`, plus frontier, next action,
and resolved records. The aligned-findings digest excludes the post-alignment
`domainModel`, frontier, and next action, which are instead bound by their basis
receipts. Both deliberately exclude cycle, timestamp, and history.

## Retention — the no-overwrite, no-launder guarantee

This is the load-bearing rule, and it is per field. Before writing, the helper
reads and parses any existing artifact. Every previously recorded entry in the
durable sets — confirmed facts, source, relationship, and boundary claims,
evidence references, decisions, constraints, assumptions, contradictions,
risks, open questions, scope, exclusions, and the domain model — **and the
frontier** must reappear in the **same** field with at least its prior
multiplicity, or be discharged by a `Resolved` record. Counts matter, so
dropping one of two identical entries is a regression. An entry that leaves one
field and reappears in another is **not** retention: it is refused with
`foundation-regression` naming the field it left and the field it appeared in,
because laundering a confirmed fact into an open question is a silent rewrite.

`Resolved` discharge is **field-qualified and count-aware**. A resolution record
is `{field, entry, resolution}`; it discharges exactly one occurrence in exactly
its named field, and only a record **freshly added by this write** discharges a
drop — a resolution already recorded in a prior cycle is spent. So resolving two
duplicate occurrences requires two records, and a resolution for an open question
does not silently discharge the same text in some other field. `field` must be
one of the retained fields.

Prior `Resolved` records are preserved as a **multiset**: every prior
`{field, entry, resolution}` must reappear with at least its prior count, so none
is dropped or rewritten. A second, conflicting resolution for the same
`(field, entry)` is refused unless it is byte-identical to the existing one.
Removal and re-resolution are human decisions, not side effects of a write.

Be honest about what this proves. The check compares entries by exact text, so
it guarantees an entry was not silently *dropped* or *moved*. It does not and
cannot guarantee an entry was not *reworded*: text identity is only a proxy for
meaning, a reworded entry whose original text no longer appears reads as a drop,
and a caller intent on hiding a change could keep the original text verbatim in
`Resolved` while burying an altered meaning elsewhere. Rewording is exactly the
seam this check cannot see.

## Append-only history

The artifact carries a `## History` section. Each aligned cycle appends exactly
one revision entry — the cycle identifier, a canonical RFC 3339 UTC timestamp
matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$` (a non-UTC or
free-form timestamp is refused as `invalid-input`), the alignment result
(`verified` or `corrected`), and the prior revision it succeeded. Existing
history lines are never rewritten or removed. On **parse**, every history record
is re-validated with these same validators, so an artifact carrying a history
line with an impossible instant, a non-persistable alignment, or a malformed
prior revision is refused rather than trusted.

## Strict, canonical parse

`parseFoundation` reads only the document its renderer produces. The metadata
header — `- Schema:`, `- Subject:`, `- Slug:`, `- Alignment:` — is an exact,
ordered block read **positionally**, immediately after the heading and before
the first section, so a legitimate list entry that merely looks like
`Subject: …` can never be mistaken for metadata, and a metadata line moved into
a section can never masquerade as the header. Every ATX heading that is not the
document heading or a canonical `##` section is refused at any level. Every
required section occurs exactly once and no unknown section appears.

## Control characters and unambiguous encodings

Every persisted string — each durable and frontier entry, `nextAction`, every
resolution, the subject identity, the cycle, and the timestamp — is refused as
`invalid-input` if it contains any ASCII control character (U+0000–U+001F or
U+007F), on the write path and again on parse. A `Resolved` record's entry and
resolution are rendered with the delimiter characters and the backslash
backslash-escaped, so **any** legal durable entry round-trips — backticks,
colons, pipes, em dashes, a leading `- `, and the `_None recorded._` sentinel
all survive persist → parse → resolve. Tuple keys used by the retention check are
canonical JSON, not separator-joined strings, so two distinct records can never
collide on one key.

## No injected structure

A rendered free-text value cannot introduce document structure. `nextAction` and
each `resolved[].resolution` must not begin a Markdown heading (`#`..`######`
followed by whitespace); such a value is refused as `invalid-input` naming the
field, the same defence handoff bodies use. The rendered document is also refused
if it would contain a duplicate section heading. This blacklist is the first
layer; the structural post-write check below is the layer that catches what a
blacklist misses.

## Bound to the rehydrated revision

Persistence is bound to the revision the cycle rehydrated on. The intake carries
a required `expectedPriorRevision`: the SHA-256 revision the cycle read at the
start of the run, or `null` **only** for a genuine first cycle. It is checked
**first** — before retention, history, rendering, or creating any directory. The
bounded destination is *inspected* (each component checked for a symbolic link
or a non-directory) without creating anything, so a stale refusal leaves the
filesystem exactly as it was; the missing directories are created only after the
guard passes:

- when the destination exists and its current revision differs from
  `expectedPriorRevision`, the write is refused as `concurrent-modification`
  naming both revisions;
- when `expectedPriorRevision` names a revision but the destination is gone, it
  is refused as `concurrent-modification`;
- when `expectedPriorRevision` is `null` but a foundation already exists, it is
  refused as `concurrent-modification` — a second cycle cannot claim to be the
  first.

This is the wider of two guards: it covers the whole rehydrate-to-persist
interval, so a stale cycle that rehydrated an older revision cannot write over a
newer one and record itself as succeeding it. The immediate pre-rename recheck
below is the narrower second guard, covering only the instant before the rename.
The two guards cover different windows.

## Atomic write and the commit point

The write is failure-atomic:

1. The new bytes are staged to a sibling temporary file in the same directory.
2. The staged file is reread and **re-parsed**; the recovered foundation is
   deep-compared to the intended one (all eleven fields, subject, alignment,
   resolved, and history). A byte mismatch or a structural mismatch is
   `verification-failed`. This is the layer that catches an injection class a
   blacklist misses.
3. Immediately before committing, the destination is reread and its SHA-256 is
   compared to the revision this call captured at the start. If it moved — or
   appeared, or vanished — the write is refused as `concurrent-modification`
   naming both revisions, and nothing is written.
4. The staged file is `rename`d over the destination.

**The `rename` is the single commit point.** Any failure detected **before** it
— staging, reread, re-parse, deep-compare, the pre-rename recheck — leaves the
prior authority byte-for-byte untouched and attempts to unlink the staged file.
A failure detected **after** the rename is a different situation entirely: the
destination has *already* been replaced, so it is reported as
`post-commit-verification-failed`, whose message states plainly that the
destination is already replaced. It is never reported as `verification-failed`,
which would falsely imply the original survived.

Be honest about two residuals. First, `rename` is atomic within one filesystem,
and the recheck narrows but does not eliminate the race — a second writer can
still land in the window between the recheck and the rename. This is a guard,
not a lock. Second, cleanup is best effort on the *temporary* file only: if the
primary failure is followed by an unlink that itself fails, the staged
`<destination>.<uuid>.tmp` may be left behind. When that happens the returned
error keeps its primary code and its message additionally reports that cleanup
failed and names the staged file, so nothing is *silently* left behind and the
prior authority is still untouched. No raw filesystem error from cleanup ever
escapes or masks the primary failure.

## Post-write reread

After the rename, the helper rereads the destination and compares the exact
bytes. A mismatch, or a reread that fails outright, is
`post-commit-verification-failed` — the write already committed, so this is not
"the original is untouched"; it is an honest report that the committed bytes
could not be confirmed on disk. When the bytes read back but differ, the message
names the revision now on disk. When the reread *fails*, the message names only
the revision this write **intended** to commit and states that the current
on-disk revision is unknown, because verification could not read it — it never
claims a revision it could not confirm.

The returned record names this as write verification only. `writeVerified: true`
travels with an explicit statement that a post-write reread proves the persisted
bytes match what was written and is **not** evidence that a later run rehydrated
from those bytes. The next-run guarantee belongs to the `foundation-rehydrate`
atom, which grounds a fresh or compacted agent on the persisted bytes at the
start of the next invocation. The two rereads are different guarantees, and this
one is never credited as the other (AC7).

## Render and parse are conditional inverses

`renderFoundation` and `parseFoundation` are not unconditional inverses. The
parser round-trips exactly the LF-terminated documents the renderer produces;
CRLF input is normalized to LF on read, so `render(parse(crlfBytes))` differs
from `crlfBytes` by design. The claim is a round trip over the renderer's own
output, not over arbitrary bytes.

## Approved-specification neutrality

Persisting a new revision moves the artifact's whole-file digest. That movement
alone never invalidates an approved specification: under
`spec/_atoms/discovery-source` a moved digest on an approved specification
produces `held`, and only `_base/_atoms/contradiction-check` may reopen approved
work. This atom does not approve, invalidate, re-derive, signal, or reach any
specification, and it duplicates neither unit's logic.

## Operation

```text
node <atoms>/foundation-persist.mjs --input <absolute-json-path>
```

The JSON file is a version `1` intake record: `repositoryRoot`, `subject`
(`id`, `slug`), the aligned `alignment` result, the `alignedPayloadDigest`, the
`expectedPriorRevision` (the revision the cycle rehydrated, or `null` for a
genuine first cycle), a `cycle` identifier, a canonical UTC `timestamp`, the
durable sets, including the aligned claims, risks, and domain model, the current
`frontier` and `nextAction`, and a `resolved`
list of `{field, entry, resolution}` records. Exit `0` prints one JSON object on
standard output with the persisted `locator`, `revision`, subject identity, and
the write-verification record. Any failure prints one
`{"error": {"code", "message"}}` object on standard error with exit `1` and
leaves nothing partial.

The helper exports `renderFoundation`, `parseFoundation`, `revisionOf` (the
SHA-256 digest of the exact persisted bytes), `alignedPayloadDigestOf`, the
field-name constants, and the error class, so `foundation-rehydrate` reuses the
same parse and revision definition and a caller can compute the exact digest it
shows the human.

## Failure Codes

| Code | Meaning |
| --- | --- |
| `usage` | The command-line arguments were not understood. |
| `invalid-input` | The intake broke a shape, type, or bound, a rendered free-text field would open Markdown structure, a persisted string carried an ASCII control character, or a parsed artifact was not strictly and canonically recoverable. |
| `unaligned` | The alignment result was not `verified` or `corrected`. |
| `alignment-unbound` | The persisted payload or findings did not match the supplied alignment digest. |
| `derivation-unbound` | The domain-model or frontier receipt did not bind to the aligned findings digest. |
| `unsafe-destination` | The slug named a path outside `docs/agent/discovery/`, or a bounded path component was a symbolic link or a non-directory. |
| `subject-mismatch` | An existing foundation at the destination belongs to a different subject. |
| `foundation-regression` | A prior durable or frontier entry would be dropped, moved between sections, or a prior resolution or history line would be rewritten, or two conflicting resolutions name the same `(field, entry)`. |
| `unsupported-schema` | A parsed artifact carried a missing or unknown schema version. |
| `concurrent-modification` | The destination moved, appeared, or vanished — including a mismatch against `expectedPriorRevision` across the rehydrate-to-persist interval — and nothing was written. |
| `verification-failed` | A pre-commit staged reread did not match, did not re-parse as the intended foundation, or an existing artifact could not be read to verify the write. |
| `write-failed` | The file could not be staged, a bounded directory could not be created, or the rename could not commit. |
| `post-commit-verification-failed` | The rename committed and the destination is already replaced, but the post-write reread could not confirm the committed bytes. |

## Boundaries

- This atom writes exactly one durable artifact and rereads it. It does not
  align, approve, or mutate a tracker; alignment is human-owned and happens
  before this atom is called.
- It never overwrites, drops, or launders durable evidence. Retention refusal is
  the only correct outcome for a would-be drop, move, or resolution rewrite.
- The post-write reread proves the bytes, never that a later run grounded on
  them.
- It reaches no specification and duplicates no contradiction or freshness logic.
