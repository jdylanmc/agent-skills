---
name: source-binding
description: Bind exactly one identified, revision-bound source artifact beneath the profile-derived workspace, refusing an unbound, absolute, out-of-workspace, symlinked, unreadable, unknown-profile, or stale source and returning a content-digest binding whose revision is computed from the bytes rather than asserted.
level: atom
allowed-tools: ["execute"]
includes: ["synthesize/_atoms/source-binding/source-binding.mjs"]
composes: []
used-by: ["synthesize/_molecules/bounded-synthesis/bounded-synthesis.md"]
---

# Source Binding

Prove which artifact a synthesis run converts, and prove it has not moved.

Synthesis reduces one source into a smaller variant. Everything downstream —
the word budget, the disclosure ledger, the outcome — is only meaningful once
the source is pinned. This atom pins it.

## Required Files

1. [Source binding resolver](./source-binding.mjs)

## What a Binding Is

A binding names one source artifact, its slug, its confirmed revision, and the
SHA-256 digest of the exact bytes read. The revision **is** that digest: the
module computes it from the bytes and confirms the declared revision equals it,
so a later run recomputes it and proves it is looking at the same artifact rather
than a newer draft that changed underneath the synthesis.

## Inputs

`bindSource({repositoryRoot, sourcePath, declaredRevision, profileId})` binds the
source, and `bindFile(...)` is the filesystem-facing entry that shares the same
implementation. The source path, the declared revision, and the profile id are
all required and are never inferred or defaulted, because a defaulted input is
how a run quietly synthesizes the wrong document under a workspace nobody chose.

## The Workspace Is Profile-Derived

The containment root comes from `resolveProfile(profileId).workspaceRoot`, a row
in the fixed profile table. It is not a caller parameter: there is no
`workspaceRoot` argument and no `--workspace` flag, because a caller-supplied
root of `.` would make every repository file eligible. Nothing a caller supplies
can widen containment. An unknown profile refuses with `unknown-profile`.

## The Revision Is Computed, Never Asserted

There is no `observedRevision` parameter and no `--observed` flag. A caller that
could assert the observed revision could assert freshness, so freshness is
derived from the artifact: the module hashes the bytes it read and compares the
declared revision to that digest. The two never come from the same hand.

## Refusals

| Code | Raised when |
| --- | --- |
| `unbound-source` | The source path or the declared revision is missing, the source path is absolute, or the file name yields no stable slug. None is ever inferred. |
| `unknown-profile` | The named profile is absent from the profile table, so no workspace can be derived. |
| `outside-workspace` | The resolved path is not beneath the profile's workspace root. |
| `unsafe-path` | Any component of the resolved path is a symbolic link. |
| `unreadable` | The source is absent, cannot be inspected or read, or is not a regular file. Native filesystem detail is retained separately and never escapes as the public refusal code. |
| `stale-source` | The declared revision does not equal the SHA-256 digest of the bytes on disk. Both revisions are reported. |
| `usage` | The command line is malformed, or a second `--source` is supplied. |

Exactly one `--source` is accepted. A second source argument is a `usage`
refusal, never a silent choice between two artifacts. The source path is named
relative to the repository root; an absolute path is `unbound-source`.

## Success

On success the binding is:

```text
{ "status": "bound", "sourcePath": <workspace-relative>, "slug": <slug>,
  "revision": <sha-256-hex>, "digest": <sha-256-hex> }
```

The `revision` and `digest` are the same computed value.

## Operation

```text
node <atoms>/source-binding/source-binding.mjs \
  --root <absolute-repository-root> \
  --source <workspace-relative-source-path> \
  --revision <declared-source-revision> \
  --profile <profile-id>
```

Exit `0` prints the binding. A non-zero exit prints a stable refusal code on
standard error.

## Boundaries

This atom binds one source and reads its bytes. It renders nothing, writes
nothing, and approves nothing beyond resolving the profile row it needs for the
workspace root. It holds no authority and no mutable state.
