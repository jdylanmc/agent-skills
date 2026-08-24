---
name: temp-path-resolve
description: Resolve the runtime-reported operating-system temporary directory, create exactly one named child inside it, and propose a collision-resistant UTC file name.
level: atom
allowed-tools: ["execute"]
includes: ["_base/_atoms/temp-path-resolve/temp-path-resolve.mjs"]
composes: []
used-by: ["_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
---

# Temporary Path Resolution

Ask the runtime where its temporary directory is, put exactly one named child
inside it, and propose a file name that will not collide. This atom owns the
destination. It owns nothing about what is written there.

A caller that guesses `/tmp` is wrong on Windows, wrong under a sandbox that
relocates the temporary root, and wrong whenever the operator has moved it.
Asking the runtime is the only answer that stays correct.

## Required Files

1. [Resolution entry point](./temp-path-resolve.mjs)

## Operation

```text
node <atoms>/temp-path-resolve.mjs (--slug <slug> | --slug-source <name>) [--child <name>]
```

Exit `0` prints `directory`, `path`, `name`, and `attempt` as JSON. Any
non-zero exit prints one JSON failure object on standard error.

| Input | Required | Meaning |
| --- | --- | --- |
| `--slug` | one of | An already-normalized slug: lowercase alphanumeric words joined by single hyphens, at most 64 characters. Validated, never rewritten. |
| `--slug-source` | one of | A raw repository or work name, normalized here. `Acme.Widgets` becomes `acme-widgets`; `Ship_With_Squadron` becomes `ship-with-squadron`. At most 300 UTF-8 bytes, and must hold at least one letter or digit. |
| `--child` | no | The single child directory name. Defaults to `handoffs`. One lowercase hyphenated name, never a path. |
| `--probe` | no | Prints `temp-path-resolve: available` and exits `0`. |

Exactly one of `--slug` and `--slug-source` is supplied; both or neither is
`usage`. The two forms exist so a caller never has to reimplement the
normalization: pass the raw name and let this atom apply it, or pass a slug you
already normalized and have it checked. Both end at the same guarantee, so the
proposed name always matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`.

## Resolution

1. Read the temporary directory **from the runtime**, then resolve it to its
   real path. A temporary root that cannot be resolved is `temp_unavailable`.
2. Join exactly one child. A child name containing a path separator, `.`, or
   `..` is rejected before anything touches the file system.
3. Create the child non-recursively with owner-only permissions, ignoring the
   "already exists" result. Creating one level means a missing temporary root
   is reported rather than fabricated.
4. **Then** inspect what is actually there, without following links. Inspecting
   first and creating afterwards leaves a window in which the entry that passed
   the check is not the entry that gets used.
5. The child must be a real directory. A symbolic link or a non-directory entry
   is `unsafe_temp_root`.
6. On a system with user identities, the child must be owned by the current
   user and must not be writable by its group or by others. A shared temporary
   root lets any local account pre-create the child; a handoff written inside a
   directory somebody else controls can be replaced after it was verified.
7. Propose `<slug>-<YYYYMMDDTHHMMSSZ>.md`. When that name is taken, append a
   two-digit ordinal - `-01`, `-02`, and so on - and take the first unused
   name. After 100 attempts the result is `name_exhausted`.

## Output

| Field | Meaning |
| --- | --- |
| `directory` | The real path of the single child directory. Use it as the write's allowed root. |
| `path` | The proposed absolute file path. |
| `name` | The proposed file name. |
| `attempt` | Which candidate was proposed, starting at `1`. Anything above `1` means a name was already taken. |

## Failure Categories

A failure is one JSON object on standard error, `{"error": {"code", "reason",
"message"}}`, and the exit status is `1`. `reason` is always present and is
`null` for every category this atom reports.

| Category | Meaning |
| --- | --- |
| `usage` | The arguments were not understood, or neither or both slug forms were supplied. |
| `malformed_payload` | The slug, slug source, or child name broke a shape or a bound above. |
| `temp_unavailable` | The runtime reported a temporary directory that does not resolve or is not a directory. This is an environment fault, not caller input. |
| `unsafe_temp_root` | The child exists with a shape this atom refuses: a symbolic link, a non-directory, or on a system with user identities a directory owned by another user or writable by group or others. |
| `name_exhausted` | 100 candidate names were all taken. |
| `unsafe_target` | A candidate name exists but cannot be inspected. |
| `internal_error` | An unclassified defect in this atom. Report it. |

### Recovering from `unsafe_temp_root`

This is the one failure a caller can be stuck on, because the offending
directory belongs to somebody else and this atom deletes nothing. In order:

1. **Use a different child.** Pass `--child` with another lowercase hyphenated
   name. This is the only step a caller can take on its own, it needs no
   privilege, and it is the recommended answer for an automated run.
2. **Have the operator inspect and remove the child.** On a shared temporary
   root a pre-created `handoffs` directory owned by another account is worth
   looking at before it is deleted; it may be somebody else's tooling, or it
   may be an attempt to capture handoffs.
3. **Point the runtime somewhere private.** Setting the platform's temporary
   directory to a per-user location resolves the whole class, because the child
   is then created inside a directory only that user can write to.

Never answer this failure by writing into the workspace or by relaxing the
ownership check. The check exists because a handoff written into a directory
somebody else controls can be replaced after it was verified.

## Guarantees

- The destination is always beneath the runtime's own temporary directory, and
  never beneath the workspace.
- Exactly one child directory is created. This atom never builds a tree.
- The directory that is returned is the one that was inspected, and it belongs
  to the current user alone.
- The timestamp is UTC, so two machines in different zones sort identically.
- The proposed name does not exist at the moment it is proposed.

## Boundaries

A proposal is **not a reservation**. Another writer may take the name between
the proposal and the write, so the write must create the file exclusively and
the caller must re-resolve when it reports that the target exists.

This atom does not write, render, redact, choose the slug, or delete anything,
including earlier artifacts in the same directory.
