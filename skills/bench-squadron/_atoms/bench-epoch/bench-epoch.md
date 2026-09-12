---
name: bench-epoch
description: Bind distinct-slot fresh-context signoffs to one issue's requirements, candidate commit and successful validation evidence.
level: atom
allowed-tools: ["execute"]
includes: ["bench-squadron/_atoms/bench-epoch/bench-epoch.mjs"]
composes: []
used-by: ["bench-squadron/_molecules/bench-control/bench-control.md"]
---

# Bench Epoch

## Required Files

[Issue and review rules](./bench-epoch.mjs) normalize authorized work, gate
dependencies and count current-candidate votes. The reviewed basis contains the
complete work packet, issue epoch, commit and validation evidence. It is not a
global fleet signature or mutation quota.

Candidate changes discard only that issue's votes. Distinct slot IDs count once
per basis. Fresh incarnation reuse cannot multiply votes, and the actual author
context cannot review its own output. A fresh context in the authoring slot is
eligible. A review must return the exact basis, explicit verdict, substantive
evidence, controller-observed file-read receipts and consistent findings. A
message claiming to have read files does not manufacture tool receipts.
Arbitrary text, partial JSON and failed results
are not signoff. Corrections return to the single-writer path and then fresh review.

Requirements cannot change under an existing ID. Duplicate identical admissions
are idempotent; differing packets or dependency cycles are refused. Unknown
dependencies wait; only observed human merge satisfies them.

Path admission and file tools share one path policy. Explicit legitimate
dotfiles/directories are supported; authorizing a child does not authorize its
parent or siblings. Protected components include Git metadata, Bench/Harness
control state, vendored dependencies and known credential stores. Environment
files (`.env` family), credential configuration such as `.npmrc`/`.netrc`,
private-key names and dot-prefixed secret/credential stores remain reserved even
under an authorized parent. Ordinary source such as `credentials.ts` or a
workflow named `secrets.yml` is not classified as a credential store by a word
in its name.

Paths use portable repository-relative `/` spelling: no `.`/`..` components,
absolute/drive/alternate-stream paths, Windows device names, empty components
or trailing-dot/space aliases. This is path protection, not a general secret
content detector; operators must never authorize actual secret-bearing content
under an otherwise ordinary filename.
