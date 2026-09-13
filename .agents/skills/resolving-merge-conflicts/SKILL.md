---
name: resolving-merge-conflicts
description: "Use when you need to resolve an in-progress git merge/rebase conflict."
---

Preserve the task's [doctrine selection](../doctrine/APPLY.md); `code` and `sequencing` are candidates when none was selected. Preparing changes for an existing PR requires `worktrees` and the owning delivery's workspace. Doctrine does not override the caller's restriction on semantic conflict decisions or authorize rewriting existing messages.

Use the [shared commit-message policy](../../COMMIT-STYLE.md) for newly authored resolution commits. Preserve existing commit messages during rebase unless rewriting them was separately authorized; formatting grants no additional Git authority.

1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where possible. Where incompatible, pick the one matching the merge's stated goal and note the trade-off. Do **not** invent new behaviour. Always resolve; never `--abort`.

4. Discover the project's **automated checks** and run them, typically typecheck, then tests, then format. Fix anything the merge broke.

5. **Finish the merge/rebase.** Stage everything and commit. If rebasing, continue the rebase process until all commits are rebased.
