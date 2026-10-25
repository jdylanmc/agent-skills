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

1. **Own and record.** An agent that creates a worktree, branch, temp directory, scratch file, or build output owns removing it. Record the path, branch, and PR in the report or handoff when you create it. Remove only what that record names.
2. **Clean up at the end.** When the PR merges or closes, or the experiment ends, stop or retire any writer in it, then remove what you created: `git worktree remove <exact path>`, the branch, and your temp and scratch files. This authorizes removing run-owned worktrees without another prompt. Do not run `git worktree prune`; it touches every worktree record, including ones you do not own. A delivery worktree stays only while its PR needs maintenance. Shepherd and other non-owners report finished workspaces; they never remove them.
3. **Never remove** a worktree with uncommitted or untracked changes, a branch with commits that are neither merged nor on a live remote ref, a locked or active worktree, the main checkout, the directory you are running from, or anything you did not create. Ignored files are not backed up either: keep a worktree that holds ignored local data (`.env*`, databases, keys) unless you have preserved it. Keep it and report what and why.
4. **Build output.** When a task finishes or a worktree goes idle, delete large rebuildable output in worktrees you own: Cargo `target/` (`cargo clean`), `node_modules`, and similar. Only untracked, ignored output is disposable; tracked files and symlinks are not. The main checkout keeps its dependencies unless the human asks.
5. **Reuse, do not multiply.** Reuse the worktree for the same PR instead of creating another. Size the active set to the work: Joe-mode's pool allows six developers, each isolated. Clean up finished workspaces before adding more, and never remove active work to meet a number. Where safe, share one Cargo target directory (`CARGO_TARGET_DIR`) across worktrees.
6. **Coordinators sweep.** A coordinator or parent agent sweeps for finished, owned worktrees at each milestone: PR merged, release cut, end of session. Every delegated worker's prompt tells it to clean up its own artifacts before it finishes.
7. **Prove it, then use exact paths.** Remove a worktree only with proof it is finished: its PR is merged and the local head equals the PR head, or the PR is closed and a live remote ref (not a cached one) contains the exact commit. Re-read that state immediately before removing, because a plan goes stale. Delete the branch only if it still points at the proven commit. Never `rm -rf` a glob or a path you did not create. Ask before deleting anything you did not create.
8. **Report.** The final report lists what you removed, what you kept and why, and the disk freed.

### Sweep helper

[`scripts/worktree-hygiene.mjs`](scripts/worktree-hygiene.mjs) lists each linked worktree and whether it is removable under rules 3 and 7. It needs `git`, `gh` for PR state, `lsof`, and `find`. It is a dry run, and it removes only what you name.

```sh
node scripts/worktree-hygiene.mjs --repo <repo>                                  # list: size, PR state, REMOVABLE or KEEP with a reason
node scripts/worktree-hygiene.mjs --repo <repo> --apply --writers-stopped --remove <worktree>       # remove one worktree you own
node scripts/worktree-hygiene.mjs --repo <repo> --apply --writers-stopped --clean-build <worktree>  # delete target/ and node_modules in one clean worktree
```

`--writers-stopped` is your statement that no agent or process is still writing in the named worktree. The helper cannot prove it. It only adds best-effort checks: any process with that working directory, and any file changed in the last five minutes. Stop or retire the writers first (rule 2). Applying inspects only the named worktrees, reads the PR first and the local state last, and re-checks right before each removal. Repeat `--remove` or `--clean-build` for more than one.

Anything uncertain is kept: unknown PR state, no PR, an open PR, a running process, recent changes, an incomplete `lsof` or `find`, an unreadable status, a failed remote check, or ignored files other than build output. The helper never removes the main checkout or the directory it runs from, and it never runs `git worktree prune`. A worktree whose directory is gone is listed as `STALE`; run `git worktree prune` yourself once you know it is not on an offline volume. It deletes a branch only if it still points at the proven commit. Other flags: `--no-size`, `--json`.

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
