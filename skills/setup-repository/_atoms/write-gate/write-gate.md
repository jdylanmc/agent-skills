---
name: write-gate
description: Bind a preview of every target path, content hash, and prior on-disk identity to the write that follows, require an explicit confirmation whose grant is bound to the exact preview identity, refuse unsafe or concurrently changed targets, stage every write with no-follow semantics, re-verify the pinned ancestor chain before every mutating open and every readback, roll back any partial commit in reverse order and report exactly what remains on disk if rollback itself cannot succeed.
level: atom
allowed-tools: ["execute"]
includes: ["setup-repository/_atoms/write-gate/write-gate.mjs"]
composes: []
used-by: ["setup-repository/_molecules/repository-configuration/repository-configuration.md"]
---

# Write Gate

Show exactly what will be written, write only that through no-follow opens,
prove afterward that the bytes on disk are the bytes that were approved, and
roll back on any failure so no undisclosed partial state remains.

```text
build preview -> require confirmation -> check safety and staleness -> snapshot all targets -> stage and commit with O_NOFOLLOW -> read back -> reverse rollback on failure
```

Preview and write are one binding, not two steps that can drift apart. The
preview identity is derived canonically from the repository root, every target
path, every new content hash, and each target's prior on-disk identity
(`existingSha256`, or the sentinel `<absent>` when the target did not exist),
so a caller who mutates an entry after approval cannot preserve the id. The
serialized preview does not carry an `absolutePath` field: at apply time the
gate derives the absolute path fresh from the validated repository root and
the entry's relative path, and refuses any payload that carries an
`absolutePath` or any other field not on the allowed list. Trusting a
caller-supplied absolute path is how a serialized preview could redirect the
write to a forged location; the gate does not permit that surface.

## Required Files

1. [Preview, confirmation, safety, staged write, and rollback helper](./write-gate.mjs)

## Preview

`buildPreview({ repositoryRoot, artifacts })` returns a deep-frozen preview
carrying a `previewId`, one `entry` per artifact, and a `safety` verdict per
target. Each entry records the relative path, the content and its `sha256`,
whether the write is a `create` or an `overwrite`, and the `existingSha256`
of whatever the target holds now.

Every mutable field a caller could tamper with after confirmation contributes
to the identity, so a change to a path, to intended content, or to a recorded
prior state changes the id the confirmation must match. Duplicate target paths
are refused before a preview is returned. `absolutePath` is not part of the
serialized payload and is not accepted from a supplied payload; the apply
path derives it fresh at write time.

## Explicit Confirmation

`applyPreview({ repositoryRoot, preview, confirmation })` writes nothing
without an explicit recorded confirmation. The confirmation is an object
carrying the `previewId` it approves and the literal `CONFIRMATION_GRANT`
token. **Both must match** — the grant is not sufficient alone. The grant
alone is a static string that would be the same for every run, so binding to
the previewId (a value that only exists after the preview was built and
displayed) is what ties one confirmation to one displayed preview.

The atom reconstructs the identity from the supplied preview and compares —
a caller-mutated `entries[n].existingSha256`, or any other tampered field,
produces a different id and the write is refused as `stale-preview`.

A truthy value is not a confirmation. `true`, `"yes"`, `1`, and any populated
object that lacks the grant do not confirm, and a confirmation whose
`previewId` does not match the reconstructed identity does not confirm.

**Ceiling — what the executable does and does not enforce.** The executable
enforces that a write is bound to one displayed, confirmed preview: only a
previewId that exists (that is, that a build-preview run produced) can be
named, and one previewId only authorizes its own preview. The executable
does NOT prove that a **human**, rather than another agent, produced the
confirmation. Displaying the complete preview and obtaining the operator's
confirmation is the invoking skill's obligation, stated as a boundary the
skill is held to; the gate cannot verify it.

## Safety Refusals

Every unsafe target returns `unsafe-target` and writes nothing at all.

| Refusal | Reason it is refused |
| --- | --- |
| `path-escape` | The target resolves outside the repository root, through `..` segments or an absolute path. |
| `symlink-component` | The target, or the repository root, or any directory between them, is or became a symbolic link that would redirect the write. |
| `not-regular-file` | The target exists and is a directory, socket, fifo, or device rather than a regular file. |
| `prior-too-large` | The target exists and is larger than `MAX_SNAPSHOT_BYTES`; the gate refuses rather than reading an unbounded prior file into memory for rollback. |

Containment and links are resolved with real filesystem calls on the existing
ancestors, not by comparing strings. The final write is performed through a
capability-selected safe open. On POSIX the gate uses a single atomic
`fs.openSync` with `O_NOFOLLOW | O_CREAT | O_EXCL | O_WRONLY` (or
`O_NOFOLLOW | O_TRUNC | O_WRONLY` when overwriting), so a symbolic link at
the final component fails at the open call itself. On Windows `O_NOFOLLOW`
does not exist, so the gate uses **check-open-verify**: `lstatSync` the
target and refuse a symbolic link or reparse point, `openSync` (with the
same `O_CREAT | O_EXCL` or `O_TRUNC` flags, but `O_RDWR` in place of
`O_WRONLY` so the post-open `fstatSync` has the `FILE_READ_ATTRIBUTES`
right it needs on Windows), then `fstatSync` the descriptor and confirm
`(dev, ino)` still identify the entry the pre-open `lstat` saw. The same
capability selection is applied to every snapshot read, every rollback
restoration open, and every readback. If a hypothetical platform exposed
neither the atomic `O_NOFOLLOW` open nor the `lstat`/`open`/`fstat`
sequence, the gate would **fail closed** with `blocked` rather than open a
symbolic link.

The gate captures `(dev, ino)` for the repository root and for every
directory between the root and each target's parent at inspection. That
chain — including directories this run creates, which are pinned
immediately after `mkdir` — is re-verified **immediately before the
truncating/creating open** and **again before readback**. A directory
replaced by another directory with the same name returns `stale-preview`; a
directory replaced by a symbolic link returns `unsafe-target`.

**Residual window — what this does and does not defend against.** Node does
not portably expose `openat` or `O_NOFOLLOW_ANY`, so a fully
descriptor-relative walk from the root descriptor down to the target is not
available on any platform. The gate pins ancestor identities and re-verifies
them at each critical instant.

On POSIX the gate additionally opens the target itself with `O_NOFOLLOW`,
so a last-instant swap of the final component into a symbolic link fails
atomically at the open call. A sufficiently fast attacker who could swap an
already-verified ancestor into a link **between** the last chain
verification and the `openSync` call could still redirect the write, because
the open call re-resolves the path from a string. Every readback then
re-verifies the chain, so a redirected write would be caught by the
readback's chain check even if the open somehow followed the swap between
verifications. Snapshot reads use no-follow descriptors, not paths, so a
swap at the snapshot itself is caught the same way.

On Windows the guarantee is **check-open-verify rather than an atomic
no-follow open**. The pre-open `lstatSync` refuses a symbolic link or
reparse point, but a swap in the small window between the `lstat` and the
`open` is caught only by the post-open `fstatSync` `(dev, ino)` compare —
after the fact rather than atomically prevented. `O_CREAT | O_EXCL` still
prevents a `create` action from writing through an existing entry a swap
introduces. Every snapshot read, every rollback restoration open, and every
readback runs the same check-open-verify sequence, so a redirected write
would be caught by the post-open verify even if the open itself succeeded.
This is a real gap relative to POSIX, and the gate does not claim parity.
It is preferable to failing every write on Windows, which is what the gate
did before this branch was introduced.

## Staleness

Before writing, the gate re-reads every target and compares it against the
`existingSha256` recorded when the preview was built. A target that changed
since the preview returns `stale-preview` and writes nothing. A preview whose
entries no longer hash to the recorded `previewId` is `stale-preview` for the
same reason: the approval was for a state that no longer holds. A target that
existed at preview time but has vanished, or did not exist and has appeared,
is `stale-preview` at commit time as well. The approved prior content hash
is re-verified **once more, immediately before truncation**, so a target that
changed between the earlier disk check and the truncating open is caught
before any bytes are lost.

## Staged Commit, Readback, and Rollback

Writes are two-phase. Every target's prior bytes are **snapshotted UP FRONT
before any target is mutated**, then every target is committed through the
no-follow open described above. Rollback responsibility is registered
**before** the truncating or creating open, so a write or close failure
after the file has already been truncated still has an entry on the
rollback list. Snapshots are bounded per entry by `MAX_SNAPSHOT_BYTES`; a
prior file larger than that is refused with `prior-too-large` rather than
read into memory.

A failure — mkdir, open, write, close, or readback — returns an allowed
status (`unsafe-target`, `stale-preview`, or `blocked`) and rolls back in
**reverse order** every commit that succeeded before it: newly created
files are removed and overwritten files are restored to their snapshot.
Every rollback step is verified — a newly created file must be gone, and an
overwritten file must hash back to its prior snapshot AND (on platforms
that expose file modes) be restored to its prior permission bits. The
inspection captures the target's `mode & 0o777` at preview time, and the
overwrite rollback path opens the file, writes the snapshot, `fchmod`s the
descriptor back to the captured mode, and re-verifies both the hash and
the mode by `lstat` before closing. Anything the rollback could not un-do
is named in `rollbackRemaining` in the returned result so the operator
sees exactly what remains on disk. The atom never throws a filesystem
failure to its caller and never reports a bare `written: false` while
undisclosed changes remain on disk.

Every readback is a fresh open — on POSIX using `O_NOFOLLOW | O_RDONLY`,
on Windows using the check-open-verify sequence described above — so the
bytes being verified come from the file the open call just created and not
from a link swapped into position afterward.

## Idempotence

A target that already holds byte-identical content is reported `unchanged`
and is not rewritten, so re-running against unchanged inputs produces no
spurious diff.

## Statuses

| Status | Meaning |
| --- | --- |
| `configured` | every target was written or already matched, and every readback hash matched |
| `cancelled` | confirmation was absent or did not match; nothing was written |
| `unsafe-target` | a target failed a safety rule or a no-follow open; nothing was written or the partial write was rolled back |
| `stale-preview` | a target, ancestor, preview identity, or supplied preview payload shape changed since the preview was built; nothing was written or the partial write was rolled back |
| `blocked` | a filesystem primitive is unavailable, or a filesystem failure occurred; every commit that succeeded before the failure was rolled back and any residue is named |

## Command Interface

The gate is the enforced mutation path. The atom ships a bounded command
interface so the `execute` grant is what actually performs writes; the skill
does not carry a direct `edit` grant. Every subcommand takes its input as JSON
from a file (`--input <path>`) or stdin and emits one JSON document on stdout.
Unknown flags, repeated `--input`, and unknown subcommands are refused as
usage errors with exit code `1`.

| Subcommand | Input | Output | Exit codes |
| --- | --- | --- | --- |
| `build-preview` | `{ repositoryRoot, artifacts }` on stdin or via `--input` | the serialized preview | `0` accepted, `1` usage |
| `apply-preview` | `{ repositoryRoot, preview, confirmation }` on stdin or via `--input` | the write result | `0` accepted, `1` usage, `2` findings |
| `--probe` | none | `write-gate: available` | `0` accepted, `1` usage |

No write can occur without a confirmed preview passing the gate: `apply-preview`
refuses when the confirmation does not carry the exact grant and matching
`previewId`, and every safety and staleness rule above is re-run inside the
executable.

## Boundaries

- The gate writes only files named in a confirmed preview, and only inside the
  repository.
- It never confirms itself. Confirmation is an explicit token supplied from
  outside, matched to the exact reconstructed identity. The executable
  cannot prove a human, rather than an agent, produced the confirmation;
  displaying the complete preview and obtaining operator consent is the
  invoking skill's obligation.
- It refuses an unsafe or concurrently changed target and writes nothing rather
  than writing part of the set.
- It reports what it wrote by reading the bytes back through a no-follow open,
  rather than asserting the write succeeded.
- A filesystem failure never propagates as an exception. Every failure returns
  an allowed status and rolls back the partial commit; anything that could not
  be rolled back is named in `rollbackRemaining`.
- A shape-invalid preview payload is refused as `stale-preview` (unknown
  fields, non-string content, malformed sha256, or duplicate normalized target
  paths); a caller-supplied `absolutePath` is one of the unknown fields the
  gate refuses. **Duplicate target paths** are detected against a
  filesystem-relevant key: paths are Unicode NFC-normalized, and on
  case-insensitive platforms (macOS, Windows) additionally case-folded, so a
  `café.md` in NFC and the same visual name in NFD, or `Foo.md` and
  `foo.md` on macOS, are refused as duplicates. The normalization is
  detection-only: the path the gate actually writes at is the one the caller
  supplied, unchanged.
