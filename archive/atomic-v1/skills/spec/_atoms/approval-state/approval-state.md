---
name: approval-state
description: Resolve whether a specification pair is approved or draft by observing the default branch of the remote, verify the observation against git objects, and refuse when the record disagrees with the repository.
level: atom
allowed-tools: ["execute"]
includes: ["spec/_atoms/approval-state/approval-state.mjs"]
composes: []
used-by: ["spec/_molecules/product-specification/product-specification.md"]
---

# Approval State

Determine whether a specification pair is approved or draft by observing the
default branch of the remote and verifying the observation against the
repository.

## Why Approval Is A Merge, Not A Field

A specification pair on a branch is a draft. A pair that reached the default
branch through a pull request a human merged is approved — approval is a merge
to the default branch. The merge commit pins the exact bytes the human saw.

The rejected alternatives — an `approved:` section inside the nano document, a
sibling `<slug>.approved.json` file, a frontmatter flag — all fail for the same
reason: the same agent that wrote the specification writes the claim. A
permission guarded only by a promise is not guarded. A field the producing
agent can write is not a boundary; a merge the producing agent cannot perform
is.

## The Trust Chain

The boundary this design depends on is stated precisely:

1. **The merge itself is an act the agent cannot perform, and the provider
   enforces that, not this repository.** Branch protection on the default
   branch is the real gate. This atom cannot prevent a misconfigured repository
   from allowing direct pushes; it can only observe whether the merge exists.
2. **The observation of the merge is a faithful reading of what the provider
   accepted, verified against git objects and refused when it disagrees.** The
   verification step recomputes digests from the working tree and the
   remote-tracking ref and refuses any disagreement. A caller that fabricates
   an observation record is caught at verification time.
3. **`observedWith` records the exact commands and is a checked field rather
   than an unchecked audit note.** The recorded commands must name the same
   remote, the same ref, and the same nano path that verification itself
   performed. Comparison is on the meaningful tokens (the remote, the ref, the
   nano path), not on exact string equality. When the recorded commands do not
   describe the observation that was verified, the result is
   `unverified-observation`.
4. **Residual limitation, stated plainly:** a local remote-tracking ref is
   writable by anything with shell access in this clone, so the receipt is
   checkable rather than tamper-proof. What makes it trustworthy is that it
   reproduces against the provider. The ultimate boundary is the provider's
   refusal to let the run push to or merge into the default branch, not
   anything this repository can enforce locally.

## The Observation Boundary

The observation is taken from a **remote-tracking ref** — `<remote>/<default-branch>`,
for example `origin/main` — fetched immediately before the observation. A local
branch of the same name is not the boundary, because the agent can reset a local
branch. A local remote-tracking ref is also writable by anything with shell
access, so the observation is checkable, not tamper-proof. The binding is that
the observation reproduces against the provider, and the provider's branch
protection is the real gate.

Verification proves the ref identity rather than merely asserting it:

1. **The remote is configured:** `git remote get-url <remote>` must succeed. A
   remote name that is not configured in this clone is refused.
2. **The ref is a remote-tracking ref:** `git rev-parse --symbolic-full-name
   <defaultBranchRef>` must resolve to exactly `refs/remotes/<remote>/<defaultBranch>`.
   An arbitrary name that does not resolve to that namespace is refused.
3. **The branch is the remote's default:** `git symbolic-ref refs/remotes/<remote>/HEAD`
   must equal `refs/remotes/<remote>/<defaultBranch>`. When `refs/remotes/<remote>/HEAD`
   is absent, the verification refuses with `unverified-observation` and names the
   exact command a human can run to set it: `git remote set-head <remote> --auto`.
   An unprovable default branch must never verify.

## Exact-Byte Binding

Approval is bound to exact bytes: the SHA-256 of the nano document in the
working tree must equal the SHA-256 of the nano blob on the default branch. A
revised working copy of an approved specification is a draft revision of it,
not an approved specification. This prevents a run from silently modifying
approved content and reporting it as still approved.

## Fail Closed

A refused, absent, malformed, or unreadable observation resolves to `draft`,
never to `approved`, and the caller applies strict freshness. Absence of proof
of approval is not approval.

## In-Flight Delivery Protection

A `ship` run grounds on criteria that came from an approved specification.
Because approved bytes are pinned by a merge commit whose existence is verified
against the provider, unrelated Discovery enrichment cannot invalidate the
specification underneath a delivery run, and the confirmed change ledger keeps
its meaning.

## Alternative Boundaries

A deployment that cannot use git must supply an equivalent boundary the agent
cannot cross, declared through `boundary`. An unrecognized boundary is refused
rather than assumed, because treating an unfamiliar boundary as valid is the
same as having no boundary.

## Required Files

1. [Approval state resolver](./approval-state.mjs)

## Operation

Resolve only (pure, deterministic — no repository access):

```text
node <atoms>/approval-state.mjs --input <absolute-json-path>
```

Verify then resolve (recomputes digests from git and the working tree, refuses
when the supplied observation disagrees with what the repository says):

```text
node <atoms>/approval-state.mjs --verify --root <absolute-repository-root> --input <absolute-json-path>
```

In `--input` mode, the JSON file is an observation record, not the
specification itself. The caller fetches the remote-tracking ref, computes the
digests, and the resolver proves the record has the required shape and resolves
the state.

In `--verify` mode, the resolver first recomputes `nanoDigest` as the SHA-256
of the working-tree file at `<root>/<nanoPath>`, resolves `publishedCommit`
from `git rev-parse <defaultBranchRef>`, and recomputes `publishedDigest` as
the SHA-256 of the bytes at `git show <defaultBranchRef>:<nanoPath>`. Any
disagreement between the supplied record and the recomputed values is a refusal
with code `unverified-observation`, naming exactly which field disagreed and
both values. A missing working-tree file or an unresolvable ref is also a
refusal, never an approval.

When the published nano blob exists, the verifier parses its provenance lines
(`- Source:` and `- Source revision:`) using the same fenced-block exclusion
rules as `spec-pair.mjs`. The parsed values are returned so the caller can
bind the approval to the exact source and revision the human merged.

### Git failure classification

The injected command runner returns a structured result
(`{ status: 'ok', stdout }` or `{ status: 'error', stderr }`) rather than
signalling by exception. Only a recognizable missing-path failure (git reports
that the path does not exist on the ref) is classified as "absent from the
default branch". Any other git failure — repository corruption, a permissions
error, a killed process, or an unexpected runner condition — is refused with
`unverified-observation` naming the git condition. A git failure is a refusal,
never an approval.

The test-injectable seam exists so tests are deterministic without a fixture
repository. The shipped command-line path uses git.

## Observation Record Fields

| Field | Type | Constraint |
| --- | --- | --- |
| `version` | integer | Must equal `1`. |
| `boundary` | string | Must be `git-default-branch`; any other value is refused as `unsupported-boundary`. |
| `remote` | string | Non-empty, e.g. `origin`. |
| `defaultBranch` | string | Non-empty, e.g. `main`. |
| `defaultBranchRef` | string | Must equal `<remote>/<defaultBranch>` and contain `/`. A bare local branch name is refused because a local ref is writable by this run and therefore is not a boundary. |
| `nanoPath` | string | Repository-relative POSIX path matching `docs/agent/specs/<slug>.nano.md` where `<slug>` is lowercase ASCII alphanumeric words separated by single hyphens. No `..`, no absolute path, no backslashes. |
| `nanoDigest` | string | 64-character hex SHA-256 of the working-tree nano bytes. |
| `publishedDigest` | string or null | Same digest form for the nano blob at `defaultBranchRef`, or `null` when the path does not exist there. |
| `publishedCommit` | string or null | 40-character hex commit SHA on the default branch that provides those bytes, or `null`. `publishedDigest` and `publishedCommit` must both be `null` or both be present; one without the other is refused. |
| `observedAt` | string | ISO-8601 timestamp that `Date.parse` accepts. |
| `observedWith` | array | Non-empty array of non-empty strings: the exact commands whose output produced the observation. Verified to reference the same remote, ref, and nano path that verification performed — comparison is on meaningful tokens, not exact string equality. When the recorded commands do not describe the verified observation, the result is `unverified-observation`. |

Unknown fields are refused. Missing fields are refused. This strictness is
load-bearing: it is what makes a forged `"approved": true` field a refusal
rather than an input.

## Output

| Field | Value |
| --- | --- |
| `state` | `approved` or `draft`. |
| `slug` | Derived from `nanoPath`. |
| `nanoPath` | As provided. |
| `boundary` | As provided. |
| `defaultBranchRef` | As provided. |
| `commit` | `publishedCommit` lowercased, or `null`. |
| `digest` | `nanoDigest` lowercased. |
| `publishedDigest` | Lowercased, or `null`. |
| `observedAt` | As provided. |
| `reasons` | Empty array for `approved`; one named reason for `draft`. |

Draft reasons: `not-on-default-branch` when `publishedDigest` is `null`;
`differs-from-default-branch` when the digests differ.

## Boundaries

This atom observes and resolves. It does not merge, approve, publish, fetch on
its own behalf, edit a specification, or decide freshness — freshness belongs
to `discovery-source`.
