---
name: write-guarded
description: Create exactly one new file inside a declared root, refusing path escape, symbolic links, and non-regular targets, then reread the result and verify it byte for byte.
level: atom
allowed-tools: ["execute"]
includes: ["_base/_atoms/write-guarded/write-guarded.mjs"]
composes: []
used-by: ["_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
---

# Guarded Verified Write

Create one new file inside a root the caller declared, and prove afterwards
that the file holds exactly what was written. This atom owns the target's
safety and the proof. It owns nothing about where the root came from or what
the content means.

Three things go wrong when an agent writes to a computed path: the path leaves
the root it was supposed to stay in, something already at the path redirects
the write, and the bytes that land are not the bytes that were sent. This atom
refuses the first two and detects the third.

## Required Files

1. [Guarded write entry point](./write-guarded.mjs)

## Operation

```text
node <atoms>/write-guarded.mjs --destination <path> --allowed-root <path> --stdin
```

Exit `0` prints `path` and `bytes` as JSON, after the file has been reread and
compared. Any non-zero exit prints one JSON failure object on standard error.

| Input | Required | Meaning |
| --- | --- | --- |
| `--destination` | yes | One absolute path for the new file. |
| `--allowed-root` | yes | The absolute directory the destination must sit directly inside. |
| `--content-file` | one of | A file holding the content to write. |
| `--stdin` | one of | The content on standard input. |
| `--probe` | no | Prints `write-guarded: available` and exits `0`. |

Exactly one content source is supplied; both or neither is `usage`. Content is
read at up to 262144 UTF-8 bytes.

## Guards

1. **Containment.** The destination's parent, resolved to its real path, must
   equal the allowed root, resolved to its real path. Anything else is
   `path_escape`, including a `..` segment and a parent that a symbolic link
   redirects out of the root.
2. **Parent shape.** The parent must be a real directory and must not itself be
   a symbolic link. A symbolic-link parent is `unsafe_target` even when it
   resolves inside the root, because the link can be repointed after the check.
3. **Target shape.** An existing destination is refused. A symbolic link, a
   directory, a device, and a socket are each named as `unsafe_target`, and an
   existing regular file is refused too: this atom creates, and never replaces.
4. **Exclusive create.** The file is opened with exclusive creation, so an
   entry that appears between the checks and the open fails the write instead
   of being followed or overwritten.
5. **Encodable content.** Content carrying an unpaired UTF-16 surrogate is
   refused before anything is created. Such a code unit has no UTF-8 encoding,
   so the bytes that land could never equal the string that was sent, and the
   reread below would report corruption for an input this atom already knew was
   unwritable.

## Verification

After writing and flushing, reread the destination without following links.
The result must be a regular file whose content equals the content that was
sent. On any mismatch, remove the file this atom created and report
`verification_failed`.

## Output

| Field | Meaning |
| --- | --- |
| `path` | The absolute path that was created and verified. |
| `bytes` | The verified size in UTF-8 bytes. |

## Failure Categories

A failure is one JSON object on standard error and the exit status is `1`:

```json
{
  "error": {
    "code": "unsafe_target",
    "reason": "target_exists",
    "message": "..."
  }
}
```

`code` and `reason` are the contract; `message` is for a human reading a log.
`reason` is always present and is `null` for every category and every cause
except the one named below.

| Category | Meaning |
| --- | --- |
| `usage` | The arguments were not understood, or the content source could not be read. |
| `malformed_payload` | The destination or root was not an absolute path, or the content was not an encodable string. |
| `path_escape` | The destination is not directly inside the allowed root. |
| `unsafe_target` | The destination or its parent has a shape this atom refuses, or the destination already exists. |
| `write_failed` | The file could not be created or written. Nothing partial is left behind. |
| `verification_failed` | The reread did not match. The created file is removed. |
| `internal_error` | An unclassified defect in this atom. Report it. |

An `unsafe_target` caused by a name that is already taken carries
`"reason": "target_exists"`. That is the only refusal a caller may answer by
resolving a fresh destination and calling again; every other one is a real
refusal and retrying it just repeats the same failure. A caller on the command
line reads the field rather than matching the message, so the discriminator
cannot drift with the wording. `unsafe_target` from a directory, a device, or a
symbolic link reports `"reason": null` and must not be retried.

## Guarantees

- Nothing outside the declared root is ever written.
- No existing file is replaced, so an earlier artifact cannot be destroyed by a
  later write that reused its name.
- A write that cannot be verified leaves no file behind.
- A failure never reports success, and a success was reread before it was
  reported.

## Boundaries

This atom does not choose the destination, obtain approval, generate content,
or retry. A caller whose write was refused because the target exists resolves a
fresh destination and calls again.

It is not [Verified write](../write-verified/write-verified.md), which replaces
an approved destination and restores the previous state when verification
fails. This atom has no previous state to restore, because it only ever creates.
