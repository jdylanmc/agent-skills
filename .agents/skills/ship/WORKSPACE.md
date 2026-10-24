# Delivery workspace

The PR-producing owner executes this procedure within its existing authority after loading `worktrees` through [Doctrine](../doctrine/SKILL.md). It replaces the standalone worktree skill, not the caller's approval, setup, or publication rules.

## Inspect and reuse

Read repository/harness guidance and inspect actual Git state:

```sh
git status --short --branch
git worktree list --porcelain
git rev-parse --path-format=absolute --git-dir --git-common-dir
git rev-parse --show-superproject-working-tree
```

Resolve the target repository, delivery, base, current branch, path, and owner. Different Git/common directories alone do not establish safe isolation; submodules and harness-managed workspaces need interpretation. A directory name is not evidence of isolation.

Reuse an existing worktree only when it belongs to this delivery, has no competing writer, preserves unrelated changes, and is not the default-branch workspace. Do not create nested worktrees merely because another skill was invoked. A detached harness-managed workspace needs an agreed delivery branch before committing/publishing; never repurpose another owner's branch.

## Create only when needed

Use an available harness-native worktree mechanism when it provides the required isolation and ownership. Otherwise use `git worktree add` with an explicit approved path, delivery branch, and base. Follow platform/repository placement rules; ask for unresolved decisions rather than inventing a global layout.

For a repository-local worktree directory, check that exact destination with `git check-ignore` before creating it. Do not test some other candidate directory. If it is not ignored, propose an authorized ignore change or an external destination; do not automatically edit `.gitignore` and commit it.

Inspect and report creation failures. Do not fall back silently to the user's main checkout or share a live worker's directory. Obtain direction when the required workspace cannot be established.

## Establish evidence and custody

Record path, branch, actual base/start commit, owner, and relevant pre-existing changes/failures. Run the smallest repository-required baseline checks for the planned work, not a guessed full suite. Use existing environment setup; install dependencies only when separately warranted and authorized, never merely because a worktree is new.

Preserve baseline failures and missing checks in the report; neither is a clean baseline. The owner resolves their impact before making completion claims.

Independent write deliveries need distinct Git worktrees, not branches/UI entries.
Serialize integration/shared resources; read-only agents may share sources without new
worktrees. Record placement/custody under [lifecycle contract](../squadron/LIFECYCLE.md).

## Paseo placement, when used

Use exactly **one Paseo project per Git repository and one Paseo workspace per
Git worktree**. Same-worktree agents share registration; independent writers
use distinct worktrees/workspaces under that project. New agents alone require
no project/workspace/worktree.

Resolve repository identity/common directory, actual worktree paths, existing
registrations; reuse compatible ones. Distinguish UI project/workspace, Git
repository/common directory, branch, mutable state. Before creation, resolve
ambiguous/duplicate mappings with owner; never force consistency by deleting registrations.

Inspect schemas. Needed worktree/workspace creation always specifies existing
repository `projectId`; establish one only if absent and authorized.
Native creation must honor approved layout/ownership. Otherwise create Git
worktree above, register explicit path:
`create_workspace({isolation: 'local', path, projectId, title})`.
Result may report `isolation: 'worktree'`; before use verify actual path,
project/workspace IDs, Git worktree/branch.

Place agents with verified `workspaceId` in `create_agent`. No invented cwd argument
or assumed controller-path inheritance: each inspects actual cwd/Git paths/branch/
starting state. Mismatch/missing mapping capability blocks writes, never permits
main, project-per-worker, or permission widening. Deliberate inheritance of
human-selected Allow All is not a placement workaround; follow the actual
[permission contract](../joe-mode-paseo/RUNTIME.md#permission-preserving-dispatch).

## Orca placement, when used

Use the [Orca runtime contract](../joe-mode-orca/RUNTIME.md) and version-matched
`orca-cli`/`orchestration` guides. Record the actual execution host, repository,
full worktree selector, Git path/branch/base and Task/Dispatch identity.
Orca lineage and a terminal title do not establish Git isolation. Use a
separate worktree for each independent writer; read-only workers may share an
owned checkout. Reuse the exact existing workspace for recurring work, never
create another worktree on each tick. Unsupported placement blocks writes;
it does not authorize a local substitute for a remote worker.

## Workspace hygiene

Whoever creates a workspace owns its cleanup. This section is the rule; other skills link here instead of restating it.

1. **Own and record.** An agent that creates a worktree, branch, temp directory, scratch file, or build output owns removing it. Record the path, branch, and PR in the report or handoff when you create it.
2. **Clean up at the end.** When the PR merges or closes, or the experiment ends, remove what you created: `git worktree remove <exact path>`, `git worktree prune`, `git branch -d <branch>` once merged, and your temp and scratch files. This authorizes removing run-owned worktrees without another prompt. A delivery worktree stays only while its PR needs maintenance.
3. **Never remove** a worktree with uncommitted or untracked changes, a branch with commits that are neither merged nor on a remote, a locked worktree, the main checkout, the current worktree, or anything you did not create. Keep it and report what and why.
4. **Build output.** When a task finishes or a worktree goes idle, delete large rebuildable output in worktrees you own: Cargo `target/` (`cargo clean`), `node_modules`, and similar. The main checkout keeps its dependencies unless the human asks. A single worktree's output can reach tens of GB.
5. **Reuse, do not multiply.** Reuse the worktree for the same PR instead of creating another. Keep at most 5 active worktrees per repository, and clean up before adding a sixth. Where safe, share one Cargo target directory (`CARGO_TARGET_DIR`) across worktrees.
6. **Coordinators sweep.** A coordinator or parent agent sweeps for merged and closed-PR worktrees at each milestone: PR merged, release cut, end of session. Every delegated worker's prompt tells it to clean up its own artifacts before it finishes.
7. **Check first, use exact paths.** Before removing, confirm `git status --porcelain` is empty and either the branch is merged (`git merge-base --is-ancestor <head> origin/main`) or the PR is merged or closed with its commits on a remote. Never `rm -rf` a glob or a path you did not create. Ask before deleting anything you did not create.
8. **Report.** The final report lists what you removed, what you kept and why, and the disk freed.

### Sweep helper

[`scripts/worktree-hygiene.mjs`](scripts/worktree-hygiene.mjs) applies rules 2, 3, and 7 to every linked worktree of a repository. It needs only `git`; `gh` adds PR state. It is a dry run unless `--apply` is given.

```sh
node scripts/worktree-hygiene.mjs --repo <repo>                # list: size, PR state, dirty, REMOVE or KEEP with a reason
node scripts/worktree-hygiene.mjs --repo <repo> --apply        # remove merged or closed clean worktrees and their merged branches
node scripts/worktree-hygiene.mjs --repo <repo> --apply --clean-build --path <worktree>   # also delete target/ and node_modules in a named, clean worktree
```

Other flags: `--base <ref>` (default `origin/main`), `--fetch` (run `git fetch --prune` first), `--no-pr`, `--no-size`, `--json`. It never removes the main or current checkout, a dirty or locked worktree, or one whose commits are not merged or on a remote. Read the dry run before `--apply`; a squash-merged PR is recognized only when `gh` reports it.

## Preserve resources at retirement

Agent archival follows LIFECYCLE, not Git/UI cleanup. Before removing a worktree (authorized for run-owned worktrees by Workspace hygiene above), verify run ownership, integration, no live writer, no uncommitted/
unpreserved work. Remove only specific completed run-owned worker worktrees.
Keep delivery workspace while PR/Shepherd needs it; never archive projects/workspaces
or delete branches/worktrees merely to clear finished agents.

For Joe's explicitly authorized blocked-work cleanup, verified recoverable
remote branches replace the integration prerequisite, not the preservation
checks. Follow [TEAM](../joe-mode-paseo/TEAM.md): stop writers, inspect tracked,
untracked and ignored files, preserve safe work/evidence, verify exact remote
commits, then remove only the owned worktree. Push failure or unpreserved data
means keep the local copy. Never delete the only copy or a live PR repair workspace.
