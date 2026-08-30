---
name: foundation-rehydrate
description: Resolve the latest persisted aligned Discovery foundation for a subject by reading the artifacts itself, verify identity, alignment, revision, and readability from those bytes, and return either the rehydrated Discovery state or a named recovery state, grounding a run on persisted bytes rather than conversation memory or caller metadata.
level: atom
allowed-tools: ["execute","read"]
includes: ["discovery/_atoms/foundation-rehydrate/foundation-rehydrate.mjs"]
composes: []
used-by: ["discovery/SKILL.md"]
---

# Foundation Rehydrate

Ground a Discovery invocation on its persisted, human-aligned foundation before
any cycle begins. This atom resolves the latest aligned foundation for one
subject by **reading the artifacts itself** — it enumerates the subject's
discovery directory, reads each `*.md`, and parses it — then verifies it and
returns either the rehydrated Discovery state or a named recovery state. It never
continues from conversation memory.

Reading the artifacts itself is the point. Identity, alignment, and revision are
derived from the bytes on disk, never from caller-supplied metadata. A caller
cannot assert a subject identity per file, an alignment, a revision, or the bytes
of a foundation; those would let foreign bytes rehydrate under a forged identity.

## Required Files

1. [Foundation rehydrate helper](./foundation-rehydrate.mjs)

It reuses `parseFoundation` and `revisionOf` from the Foundation Persist helper,
so the parse and the revision definition are the same on both sides of the
persist/rehydrate seam.

## The two rereads are different guarantees

The Foundation Persist atom rereads immediately after writing to prove the
persisted bytes match what was written. That is write verification. This atom's
reread is the different guarantee: it proves a fresh or compacted agent actually
grounds itself on those persisted bytes at the start of the next invocation. The
first is never credited as the second.

That distinction is mechanical, not merely documented. The intake below has no
field in which a caller may assert that a write was verified, or supply a
foundation's identity, alignment, or bytes; any such field is refused as unknown.
Rehydration evidence is only ever the bytes this atom re-reads (AC7).

## Intake

A version `1` record. Unknown fields are refused; missing required fields are
refused.

| Field | Meaning |
| --- | --- |
| `version` | Exactly `1`. |
| `repositoryRoot` | An absolute path. The atom reads `<repositoryRoot>/docs/agent/discovery/`. |
| `subject` | `{ id, slug }` — the Discovery subject identity. `slug` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`. |
| `expected` | `{ locator, revision }` — the compacted continuation carried from the previous invocation — or `null` for a cold start with no carried continuation. |

There are no caller-supplied candidates, no caller-supplied content, no
caller-supplied per-file subject identity, and no caller-supplied alignment.

## Resolution and Verification

The resolution order matches the code exactly. For a carried continuation the
**revision is compared before the bytes are parsed**: the carried revision must
still match the file's current SHA-256 before identity, alignment, or content
are trusted, so a stale continuation whose revision no longer matches is reported
as stale without ever attempting to parse the (possibly malformed) bytes. For a
cold start, identity, alignment, and revision are all read from the parsed bytes,
so parsing necessarily precedes them.

1. Malformed intake, including an `expected.locator` that is not exactly
   `docs/agent/discovery/<slug>.md`, → `invalid-input` (thrown, not a recovery
   state).
2. **When `expected` is non-null** — a compacted continuation names exactly one
   artifact and revision, so it is resolved directly. The recovery vocabulary
   follows the split below: it is `foundation-stale` when the continuation no
   longer describes this subject's foundation (the artifact is absent, its
   revision moved, or it now declares a different subject) and
   `foundation-unreadable` when the bytes exist but cannot be recovered (a read
   error, a parse failure, a symlinked component, or a basename that disagrees
   with the declared slug):
   - Walk every bounded path component of `expected.locator` with `lstat`,
     following no symbolic link. If a component is absent, or the target is not a
     regular file → `foundation-stale` with `currentRevision: null`. If a
     component cannot be inspected, or resolves through a **symbolic link** →
     `foundation-unreadable`.
   - Otherwise read the file. A read error → `foundation-unreadable`.
   - Otherwise compute the file's SHA-256. If it differs from `expected.revision`
     → `foundation-stale` (this revision check happens **before** parsing, so
     malformed bytes at a mismatched revision are reported as stale, not
     unreadable). Report `expectedLocator`, `expectedRevision`, and
     `currentRevision`. A carried continuation that no longer resolves is
     **never** degraded to `foundation-missing`.
   - Otherwise parse the bytes; if they are unparsable → `foundation-unreadable`.
     If the parsed subject is not this subject → `foundation-stale`. If the
     file's basename is not `<declared slug>.md` — a locator persistence could
     not continue from — → `foundation-unreadable`.
   - Otherwise, if the resolved artifact's parsed `alignment` is not `confirmed`
     → `foundation-unaligned`.
   - Otherwise → the rehydrated state, mode `compacted-session`, reporting the
     actual validated locator (never one relabelled from a resolved basename).
3. **When `expected` is null** — cold start; discover the foundation by
   enumerating `docs/agent/discovery/`:
   - The `docs`, `agent`, and `discovery` path components are walked **one at a
     time** with `lstat`, following no symbolic link. A bare `lstat` of the final
     directory would follow a symlinked ancestor and read bytes from outside the
     repository, so each component is classified individually: an absent
     component → `foundation-missing`; a symlinked or non-directory component, or
     one that cannot be inspected → `foundation-unreadable`.
   - Each `*.md` entry is `lstat`ed; a symbolic-link entry is never read or
     followed, and because its bytes are never recovered its true subject is
     unknowable, so it **fails closed** as `foundation-unreadable` (it is also
     reported under `ignored` with the reason it was skipped), exactly as a
     symlinked component does in compacted mode. Each remaining file is read and
     parsed. Matching is on the **parsed** artifact identity:
     `parsed.subject.id === subject.id` **and**
     `parsed.subject.slug === subject.slug`. Non-matching artifacts are
     reported under `ignored` with the subject they actually declare.
   - If any `*.md` could not be read or parsed — including a symbolic-link entry,
     which is deliberately never followed → `foundation-unreadable` naming those
     files, **whether or not** a match was found, because an unrecovered artifact
     could itself be this subject's. This fails closed unconditionally, so
     `foundation-missing` means every artifact was readable and none is this
     subject's, and `rehydrated` means every artifact was readable and exactly
     one is this subject's at its canonical path.
   - More than one match (genuinely different paths) → `foundation-ambiguous`,
     naming every matching locator. The helper never chooses.
   - Zero matches → `foundation-missing`.
   - Exactly one match whose file basename is not `<declared slug>.md` →
     `foundation-unreadable`; persistence would target `<slug>.md`, so
     rehydrating from it would dead-end.
   - Exactly one match whose parsed `alignment` is not `confirmed` →
     `foundation-unaligned`.
   - Otherwise → the rehydrated state, mode `cold-start`.

Every filesystem failure at these boundaries is normalized: bytes that cannot be
recovered become `foundation-unreadable` and an absent or moved continuation
becomes `foundation-stale`, each carrying the underlying condition in its
message, never a raw `ENOENT`/`EACCES`/`EISDIR`.

## Recovery States

Every named state below is one the helper can emit, and every state the helper
emits is named here. The split between `foundation-stale` and
`foundation-unreadable` is exact: `foundation-stale` is a carried continuation
that no longer describes this subject's foundation; `foundation-unreadable` is
bytes that exist but cannot be recovered.

| State | Meaning |
| --- | --- |
| `foundation-missing` | No aligned foundation exists for this subject yet, and every artifact in the directory was read and parsed (none was skipped as unreadable) and none is this subject's. |
| `foundation-ambiguous` | More than one artifact declared this subject; every matching locator is named and none is chosen. |
| `foundation-unreadable` | The bytes exist but cannot be recovered: a read error, a parse failure, a symbolic-link `*.md` entry (never followed), a symlinked component, a discovery directory that is symlinked, non-directory, or unenumerable, or a basename that disagrees with the declared slug. It fails closed rather than reporting missing, and this holds in both cold-start and compacted modes. |
| `foundation-unaligned` | The resolved artifact's alignment was not `confirmed`. Alignment is human-owned. |
| `foundation-stale` | The carried continuation no longer describes this subject's foundation: the expected artifact is absent, its revision moved, or it now declares a different subject. No rehydrated state is returned. |

## Success Payload

A rehydrated state returns the eleven distinct foundation fields — `confirmedFacts`,
`evidenceReferences`, `decisions`, `constraints`, `assumptions`,
`contradictions`, `openQuestions`, `scope`, `exclusions`, `frontier`, and
`nextAction` — as separate fields, never merged into prose. It also returns
`resolved` as the exact parsed ordered list of `{ field, entry, resolution }`
records. Duplicate records remain duplicate, field qualification is preserved,
and the empty `Resolved` marker returns `resolved: []`; neither cold-start nor
compacted-session rehydration drops, rewrites, reorders, or invents a
resolution. Plus:

- `foundation`: `{ locator, revision, subjectId, alignment: 'confirmed' }`;
- `continuation`: `{ locator, revision }` — exactly what the next compaction must
  carry so the next invocation can compare against it;
- `mode`: `cold-start` or `compacted-session`;
- `ignored`: artifacts that did not match, each with the subject it declared or
  the reason it was skipped.

## Continuation encoding

The compacted continuation crosses the handoff as one canonical, unambiguous
line the exported helpers produce and recover:

```text
discovery-foundation: <locator>@<revision>
```

- `renderContinuation({ locator, revision })` produces that line for a bounded
  handoff's Artifacts and References section. The locator is validated by the
  shared bounded-locator validator, so only a `docs/agent/discovery/<slug>.md`
  path is ever encoded.
- `parseContinuation(text)` recovers exactly one such reference from arbitrary
  surrounding handoff prose. The scan is **anchored and line-oriented**: each
  line must be the standalone `discovery-foundation: <locator>@<revision>` line,
  optionally as a `- ` handoff list item, so prose that merely mentions the
  prefix (for example `not-discovery-foundation: …`) is not a reference. The
  scan normalizes line endings, so a canonical Windows-style (`CRLF`) handoff
  line is recovered identically to an `LF` one — the repository validation matrix
  includes `windows-latest`, so this is a real path. The recovered locator is run
  through the same bounded-locator validator. Zero references is refused; more
  than one is refused rather than chosen among. The recovered
  `{ locator, revision }` is fed back as `expected` on the next invocation.

## Boundaries

- Reports only. It never writes, edits, aligns, approves, or mutates a tracker.
  Alignment is human-owned; rereading is not approval.
- It reads the artifacts itself. It never trusts caller-supplied identity,
  alignment, revision, or bytes, and it follows no symbolic link for the
  discovery directory or a `.md` entry inside it.
- It never continues from conversation memory. A missing, ambiguous, unreadable,
  unaligned, or stale foundation is an explicit recovery state, never a silent
  continuation, and a carried continuation that no longer resolves is stale, not
  missing.
- It never chooses among candidate foundations. Ambiguity is surfaced for the
  human to resolve.
