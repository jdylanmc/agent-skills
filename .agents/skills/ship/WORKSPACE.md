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

Independent write deliveries get independent Git worktrees, not merely branches
or UI entries; serialize integration and shared resources. Read-only agents may
share sources without a new worktree. Record placement and custody using the
[lifecycle contract](../squadron/LIFECYCLE.md).

## Paseo placement, when used

Use exactly **one Paseo project per Git repository and one Paseo workspace per
Git worktree**. Multiple agents on a worktree share that registered workspace;
independent write deliveries still use distinct worktrees/workspaces grouped
under the same repository project. A new agent alone never requires another
project, workspace, or worktree.

Resolve the repository identity and Git common directory alongside actual
worktree paths and existing Paseo registrations. Reuse compatible registrations;
do not equate a UI project/workspace, Git repository/common directory, branch,
and mutable working state. Resolve ambiguous/duplicate mappings with the owner
before creating resources; do not delete registrations to force consistency.

Inspect current harness schemas. When creating a needed worktree/workspace,
always specify the existing repository `projectId` (establish one only if none
exists within the caller's authority). Native worktree creation is suitable only
when it respects approved layout and ownership. Otherwise create the Git worktree
above, then register its explicit path with
`create_workspace({isolation: 'local', path, projectId, title})`.
The returned workspace may report `isolation: 'worktree'`; verify its actual
path, project ID, workspace ID, and Git worktree/branch before use.

Place each agent with the verified `workspaceId` in `create_agent`. Do not invent
an independent cwd argument or assume an agent inherits the controller's path:
have it inspect actual cwd, Git paths, branch, and starting state. A mismatch or
missing mapping capability blocks affected writes, not permission to use main,
create a project per worker, or enable bypass/allow-all permissions.

## Preserve resources at retirement

Agent archival follows LIFECYCLE, separately from Git/UI resource cleanup.
Before any separately authorized worktree removal, confirm run ownership,
integration, no live writer, and no uncommitted/unpreserved work. Remove only the
specific completed worker worktrees this run owns. Keep the delivery workspace
while its PR/Shepherd still needs it. Do not archive projects/workspaces or delete
branches/worktrees merely to remove finished agents from the UI.
