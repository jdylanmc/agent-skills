---
name: reinforcement-target
description: Resolve the single existing skill a reinforcement edits, prove it is a routable package rather than one to be created, and classify every path the run intends to write so an out-of-target edit is reported rather than slipped in.
level: atom
allowed-tools: ["read","execute"]
includes: ["reinforce-skill/_atoms/reinforcement-target/reinforcement-target.mjs"]
composes: []
used-by: ["reinforce-skill/_molecules/skill-reinforcement/skill-reinforcement.md"]
---

# Reinforcement Target

Decide *which* skill is being changed, and account for its complete change,
before any file is edited.

A reinforcement holds an `edit` grant, and the runtime cannot scope that grant
to one directory. This atom does not pretend to. Its job is to make the write
scope a decided, testable fact: the one skill being reinforced is resolved and
proven to exist, and every path the run means to write is classified, so a write
outside that skill becomes a reported entry in the change ledger instead of a
detail nobody sees.

## Required Files

1. [Deterministic write-boundary guard](./reinforcement-target.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `repository-root` | yes | The repository the reinforcement runs against. |
| `skill-name` | yes | The one skill to reinforce, as its routable name. |

## Operation

1. Resolve the target with `resolveSkillTarget`. It accepts only a routable
   skill name, which makes `..`, an absolute path, a nested `a/b`, an uppercase
   escape, and the leading-underscore `_base` fail as malformed rather than
   being caught by a later containment check that is easier to get wrong.
2. Require the target to already exist as a routable package: an existing
   directory containing `SKILL.md`. A missing target is refused. **Creating a
   skill is `create-skill`'s job, never this one.**
3. Reject a symbolic link anywhere in the resolved path, not just at the leaf.
4. Report whether the target carries an `intent.md`, so the change-grounding
   step knows whether a standard exists to judge against.
5. Classify every path the run intends to write with `classifyWritePath`. The
   classification is exhaustive — every candidate resolves to exactly one class
   — and it resolves a symlinked component to its real location before judging,
   so a symlinked path lexically inside the target cannot read as `in-target`.
6. Record the full baseline commit in the root run context before implementation;
   never replace it with a post-change `HEAD` merely to obtain an empty diff.
   Before publication, use `captureAuditSnapshot` to bind that base, the target,
   repository, committed candidate head and tree. Preserve the snapshot as
   unpublished run state and pin `auditSnapshotDigest(snapshot)` in the caller's
   context. A rebase deliberately changes the recorded base and requires a fresh
   snapshot, companion bindings and review evidence.
7. Use `auditRepositoryDiff` with that snapshot and pinned digest to enumerate the
   **actual** candidate. Read before/after bytes from the immutable Git commits,
   never from an unreviewed working copy. Enumerate staged, unstaged and untracked
   residue separately, with renames expanded into both paths; any residue makes
   publication unclean, even when staged and unstaged changes cancel on disk.
   Every path keeps its original class. A path outside `in-target` or
   `workflow` requires an exact checked companion under the contract below.
   Workflow content comes from the base and candidate commits; the edit must
   preserve every original byte-line in order and multiplicity, inserting only
   unique canonical test paths at the existing registration indentation.
   Comments, shell tokens, reordered or duplicated entries are not registrations.
   Use `--base <full-commit> --snapshot <run-state.json>
   --snapshot-digest <pinned-sha256> [--companions <ledger.json>]`.
   The lower-level `auditDiff` and `--audit <paths>` remain for callers that
   already hold a complete diff (with
   `--workflow-previous <path> --workflow-next <path>` when the workflow is
   touched). The CLI **exits 2 when the audit is unclean and 0 when it is clean**, so a
   refusal is never a success-shaped exit that publication could step past.
   The path-list API is a scope predicate, not the publication check; it does
   not establish a reviewed candidate or baseline identity.

## Write Classes

| Class | Meaning | Writable |
| --- | --- | --- |
| `in-target` | Inside `skills/<skill-name>/`. | yes |
| `workflow` | The single shared test-registration file, `.github/workflows/validate-skills.yml`. | yes |
| `base` | Inside `skills/_base/`. | no |
| `doctrine` | Inside `doctrine/`. | no |
| `foreign-skill` | Inside another skill's package. | no |
| `outside` | Anywhere else, or outside the repository. | no |

Only `in-target` and `workflow` are writable by class alone. `doctrine`, `base`,
`foreign-skill`, and `outside` remain refused without the bounded companion
proof below; doctrine can never be a companion. `workflow` is a shared file, so the
audit reports it separately and it is writable only as an additive test
registration: the edit removes no existing registration and adds nothing but a
`*.test.mjs` registration line, proven from the before/after content the run
supplies. A workflow edit whose content is not supplied cannot be proven and is
refused. It is never treated as mechanically safe, and always surfaced for a
human to read.

## Necessary Companions, Not a Second Target

The intent requires the smallest **complete** reinforcement and a changelog
entry in that same change. A directory-only rule contradicted both: it refused
the changelog it required, a caller fixture that had to satisfy a stricter
target contract, and generated reverse edges outside the target.

Keep one behavior under reinforcement. Before editing a companion, record its
exact path, kind, why it is necessary, and the relationship to that behavior.
At publication, bind the entry to the actual before/after SHA-256 bytes. This
ledger is run state, not a second report admission or an approval receipt:

```json
[
  {
    "path": "CHANGELOG.md",
    "kind": "changelog",
    "reason": "Record the target's user-visible change in the existing history.",
    "relationship": "The same reinforcement requires this changelog entry.",
    "previous_sha256": "<64 hexadecimal characters>",
    "next_sha256": "<64 hexadecimal characters>"
  }
]
```

Only these kinds exist:

| Kind | Mechanical bound | Human review still owes |
| --- | --- | --- |
| `changelog` | Existing root `CHANGELOG.md`; insertions only, old lines retained in order. | Entry concerns this target and follows the existing format. Invoke `changelog`; its caller applies the proposed patch. |
| `caller-integration` | Existing foreign `.mjs` file with a parsed static relative ESM import/export resolving into this target before and after. The parser does not link or evaluate that code. | The caller code or fixture adapts only to the changed contract; assertions, coverage and failure cases are not weakened. |
| `derived-graph` | Existing shared `_base` unit Markdown; exact deriver output from prior bytes, touching only `used-by` and molecule `allowed-tools`; current validated graph without grant violations. Foreign local units cannot be affected through legal composition. | The derived change is caused by this target's composition change, not unrelated drift. |

No wildcards, duplicate or unused entries, aliases, new/deleted companions,
unknown fields or kinds, missing proof, or stale digests are accepted.
`--companions` requires the snapshot-bound `--base` audit, so the CLI never accepts caller-invented
before/after contents. Arbitrary quoted text, comments, bare package names and
path traversal do not establish caller relationships. Dynamic-only consumers
are outside this supported companion proof rather than silently treated as
statically linked. In-process callers of `auditDiff` must supply the
equivalent complete path list and a `contents` Map of actual bytes; only the
repository wrapper establishes that provenance itself.

Doctrine, `AGENTS.md`, intents, repository scripts and workflows, agent
definitions, run evidence, `/roast`, `post-mortem`, and the shared creation
remediation ledger cannot be companions. A derived field is generated, never
hand-edited. Another skill's grant never changes. Caller integration does not
authorize a new behavior in another skill; a source reference proves a
relationship, **not** semantic necessity or gate integrity. The justification,
actual diff, existing tests, Roast and human review decide those remaining
questions. An unjustified or gate-weakening edit is refused even if its hashes
match. A companion outside these kinds needs a separate scoped run, not a
permissive fallback.

Report proposals still name only target-local surfaces. Companion planning
happens after intake and the intent decision, as a consequence of the admitted
target change, never by treating a foreign recommendation as permission.

## Self-Reinforcement Uses the Baseline, Not Its Own New Rule

Record the base commit and preserve its guard identity and actual-diff audit
before changing the scope mechanism. For the final committed candidate,
`captureBaselineAudit(root, target, base, head)` executes the original guard and
its relative imports from that base's immutable Git objects, not edited source.
Include its base/head binding, guard digest, baseline audit and exact corrective
path set as `snapshot.selfReview`. `auditRepositoryDiff` requires this evidence
for self-reinforcement and reproduces the baseline audit from those Git objects;
missing, altered, substituted or incomplete evidence is refused. Original
refusals remain in the returned `baselineAudit`, separate from the candidate
result. If the correction changes what the guard admits, its new
clean result is regression evidence, not authority for this run.

Publication still requires the operator's explicit instruction for the exact
corrective scope. Disclose that instruction, the original audit's refusals,
and the candidate audit separately; never call an unclean baseline clean or
invent an approval token. Without that instruction, stop and name the decision
needed. Retain the baseline review contracts and use independent reviewers:
changing the target cannot relax the review or evidence required to publish it.
No version of this guard approves, merges, or waives a repository gate.
The snapshot digest binds bytes and revisions, not who chose the baseline or
whether a person approved the corrective scope. The caller records and checks
that human decision separately; captured path lists are not approval tokens.

## What This Guard Does and Does Not Do

This guard **classifies and audits**; it does not silently **prevent** an
in-run write, because nothing in one model run can. The completeness comes from
`auditDiff` running over the real diff rather than over the paths the model
happened to disclose: the diff is enumerable, so every changed path is
classified, and the publication gate refuses to open a pull request while any
path is outside target/workflow scope and lacks a checked companion.

That is the honest boundary. The `edit` grant itself is unscoped — the runtime
cannot confine it to one directory — so this guard does not claim to bound the
grant. It bounds **publication**: nothing lands while the diff contains an
unaccounted path, and after the audit a human still reviews the whole diff.
Continuous integration re-runs the validator, the deriver, the doctrine-manifest
digest test, and the full suite over that diff. The classification is never
treated as approval.

## Boundaries

This atom reads and classifies. It edits nothing itself. It refuses a target
that does not already exist and refuses `_base`; it never creates a package,
never makes doctrine writable, never makes a foreign skill writable by class
alone, and never reports a classification or a companion ledger as approval.
