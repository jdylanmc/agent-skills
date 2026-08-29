---
name: setup-repository
description: Materialize a repository's agent context so skills that need domain and tracker configuration can resolve it instead of guessing. Detect the repository root, remotes, and provider, classify GitHub, GitLab, Azure DevOps, or a local custom tracker, elicit only the facts detection cannot settle, and write issue-tracker.md, domain.md, and triage-labels.md into the repository's configured agent-context directory behind a preview and an explicit confirmation. Use when a repository needs its reusable tracker and domain context set up for later skills. Do not use to create, edit, close, label, assign, or relate tracker work items, to invent provider or domain values, or to configure a repository this run cannot read.
allowed-tools: ["execute","read","search"]
includes: ["_base/_molecules/chronicler/chronicler.md","setup-repository/_molecules/repository-configuration/repository-configuration.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","setup-repository/_molecules/repository-configuration/repository-configuration.md"]
disable-model-invocation: false
user-invocable: true
requires-skills: []
---

# Setup Repository

Set up the agent context a repository's later skills read, from what the
repository reveals and what only an operator knows.

```text
record -> detect and classify -> elicit the rest -> preview -> confirm -> write -> read back
```

This is repository configuration, not a template. The files it writes describe
this repository's tracker and domain, resolved from detection and operator
confirmation, so a downstream skill reads a settled answer rather than inferring
one. It is a short, explicitly invoked setup job for any repository, named for
the work it does rather than for any single repository or account.

## Required References

1. [Chronicler recording molecule](../_base/_molecules/chronicler/chronicler.md)
2. [Repository configuration](./_molecules/repository-configuration/repository-configuration.md)

## Core Workflow

1. Reuse the caller's Chronicler run context, or create one when this skill is
   the root. Record the detected provider, the resolved context status, the
   target paths and content hashes previewed, the confirmation outcome, the
   final status, and the readback hashes. Continue when recording is
   unavailable; recording is best effort and weakens no boundary below.

2. Run [Repository configuration](./_molecules/repository-configuration/repository-configuration.md).
   It detects the repository root and remotes, classifies the provider, elicits
   only the facts detection cannot settle, normalizes one context model, renders
   the artifacts, and gates the write behind a complete preview and an explicit
   confirmation.

3. **Show the complete preview before requesting confirmation.** Display every
   normalized value the render used and, for each of the three target files,
   either every rendered field or the complete rendered file bytes together
   with its content hash and the exact `previewId`. This is a requirement, not
   a suggestion: a confirmation cannot approve values the operator did not
   see, and a preview that omits any value is not the complete preview this
   skill promises.

4. Accept a confirmation only after step 3. The confirmation is an object
   carrying the exact `previewId` shown and the literal
   `CONFIRMATION_GRANT` token; both must match, and the grant literal alone
   is not sufficient. Anything else is `cancelled` and no file is written.
   The executable enforces that a confirmation is bound to one displayed
   preview; it cannot and does not prove that a human, rather than an
   agent, produced the confirmation, so obtaining that consent is this
   skill's obligation, held here as a boundary rather than delegated to the
   gate.

5. Return the status and its evidence: the resolved context, the previewed
   targets, and, on success, the written files with their readback identities
   and content hashes.

## Generated Files

The skill writes three files into the repository's configured agent-context
directory. They are configuration consumed by later skills, not generic
templates.

| File | Content |
| --- | --- |
| `issue-tracker.md` | provider, organization or project, repository, tracker operations, relationship support, and mutation vocabulary |
| `domain.md` | the repository product and domain identity and pointers to authoritative vocabulary |
| `triage-labels.md` | the available labels and states and what each one means |

`issue-tracker.md` resolves the full tracker-adapter contract, so a downstream
skill such as a backlog publisher selects its tracker adapter from a concrete
value for every field rather than guessing one.

## Provider Boundary

The supported providers are `github`, `gitlab`, and `azure-devops`, plus a
`local` class for a custom tracker described as bounded prose. No single
repository is hardcoded. The provider matrix does not grow without limit: a
provider it does not recognize returns the `unsupported-provider` disposition
together with the custom configuration required to describe it as a `local`
tracker instead.

## Output Statuses

| Status | Meaning |
| --- | --- |
| `configured` | the files were written and read back with matching hashes |
| `cancelled` | confirmation was absent or did not match the preview; nothing was written |
| `needs-input` | a required field is still unsettled; each is named with its question |
| `unsupported-provider` | the provider is not supported; the required custom configuration is returned |
| `unsafe-target` | a target escaped the root, was a symlink, or was not a regular file; nothing was written |
| `stale-preview` | a target changed since the preview; nothing was written |
| `blocked` | a readback or contract check failed after or before writing, naming the file |

## Boundaries

- **No tracker mutation.** This skill does not create, edit, close, label,
  assign, or relate tracker work items. It reads what a tracker offers and
  records it; it changes nothing in the tracker.
- **No invented values.** It does not invent a provider, project, repository,
  area, label, or domain value. Every value comes from detection or the
  operator, and an unsettled field is asked for rather than filled in.
- **No instruction-file edits beyond an approved pointer.** It does not modify
  repository instruction files, except an explicitly approved, bounded pointer
  when the contract requires one.
- **No permission widening.** It does not widen another skill's permissions or
  silently install a consumer of the files it writes.
- **No template contamination.** It does not copy employer, private, or
  repository-specific content into the open-source template. The generated files
  are derived only from this repository's own context.
- **No unsafe or unconfirmed write.** Every write is previewed, confirmed
  against that exact preview, contained in the repository, and read back.

## Permissions

`read` and `search` gather the repository root, its remotes, and the domain
vocabulary detection needs. `execute` covers Chronicler recording and the
three deterministic helpers this package ships: detection and normalization,
artifact rendering and hashing, and the write gate. The write gate itself is
invoked as an executable — its documented `build-preview` and `apply-preview`
subcommands are the only path to a file write — so the executable performs
the mutation, not a direct `edit` tool grant.

The grant is `["execute","read","search"]`. It carries no direct `edit`
grant: every write goes through the gate's executable, which refuses to write
without a confirmed preview matching the exact identity of what the operator
saw. Narrowing this way makes the gate the enforced mutation path rather than
an advisory step alongside a raw `edit` grant. There is no `task` grant and no
wildcard.
