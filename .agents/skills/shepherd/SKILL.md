---
name: shepherd
description: Keep one published PR moving through checks, branch maintenance, and feedback until it is merged, closed, stopped, or needs a human decision. Use after Ship publishes a PR or to resume monitoring an existing PR.
disable-model-invocation: true
---

# Shepherd

Own one published pull request (PR), not a one-time green snapshot. Observe, maintain the branch when necessary, and send functional repairs through [ship](../ship/SKILL.md). Never merge, approve, enable auto-merge, accept product risk, or delete the delivery branch. See the human-authored [intent](intent.md).

## Take ownership

Read repository guidance and resolve the PR, provider, delivery branch/worktree, requirements, and declared validation. Reuse Ship's handoff and available evidence; a missing old handoff is not a reason to refuse a PR that can be inspected now.

Ensure no other agent is actively implementing or maintaining this same delivery branch. If Ship is still building, wait for its transfer rather than competing with it. If another live Shepherd owns it, confirm and return that owner's status instead of starting a duplicate loop. A stale progress file is not proof of a live owner; uncertain worker status needs resolution before starting competing work.

Use the harness's session storage for a small progress file, or create a uniquely named file in the OS temporary directory when session storage is unavailable. Report its absolute path. Record the PR URL, owner, worktree, creation time, last observation, observed base/head and check/review states, handled findings, active repair, and next observation time. Keep credentials and private log bodies out of it.

Read back updates to this record. If persistence fails, report the error; do not claim resumability. On a resumed run, inspect live state first, record the observation gap, and check whether a previously dispatched repair is still running before redispatching. If the old record is unavailable, reconstruct from the PR and report the reduced history.

## Observe the PR

Use the provider's available read operations to inspect:

- Open, merged, or closed state; draft status; current base/head; mergeability and repository branch policy.
- Required checks, including pending, failed, cancelled, and unavailable results.
- Review decisions, general comments, and inline review feedback.

For GitHub, resolve `REPO` as `owner/repo` and `PR` as its number, then use:

```sh
gh pr view "$PR" --repo "$REPO" --json url,state,isDraft,createdAt,headRefName,baseRefName,headRefOid,baseRefOid,mergeable,mergeStateStatus,reviewDecision
gh pr checks "$PR" --repo "$REPO"
gh pr view "$PR" --repo "$REPO" --comments
gh api --paginate "repos/$REPO/pulls/$PR/comments"
```

Read check details/logs when a result needs diagnosis. A nonzero `gh pr checks` status can mean checks failed or remain pending; inspect its output rather than calling it a provider outage.

For Azure DevOps, use the configured integration and the [provider reference](../setup-matt-pocock-skills/issue-tracker-azure-devops.md). Inspect the code-project PR's `status`, `isDraft`, `mergeStatus`, reviewer votes, threads, PR statuses, and applicable blocking policy evaluations. `active` is open, `completed` is merged, and `abandoned` is closed without merge. A successful merge calculation or an empty check list is not approval. Inspect live refs where the last merge-calculation commits lag, and distinguish missing policy evidence from success. Report pre-existing auto-completion rather than silently relying on human-only merging. For another host, use equivalent configured operations; report missing capabilities instead of guessing endpoints.

Compare with the last observation. An unchanged check failure or previously handled comment is not new repair work. Reopen it only when new evidence warrants it; a failed remedy becomes an explicit blocker, not a fresh identical dispatch.

Do not call unknown mergeability, pending checks, or missing required evidence "ready." No check results is not proof of success: establish what the repository requires. Readiness also requires the repository's required reviews and branch policy; green checks do not override a blocking review or missing approval. Report readiness only for the observed state, and continue watching even when everything is green.

## Act on meaningful changes

| Observation | Action |
| --- | --- |
| PR merged or closed | Record the terminal state and stop. |
| Open with no meaningful changes, or only pending checks | Record the observation and wait for the next interval. |
| Base moved but PR remains mergeable and policy-compliant | Do not rebase; keep watching. |
| Conflicted/unmergeable, or policy requires the current base | Perform bounded branch maintenance below. |
| In-scope review feedback or check failure requiring code/test changes | Invoke Ship's feedback continuation for this same PR. |
| Cancelled check, missing runner/tool, or service outage | Distinguish infrastructure from code failure. Report the blocker; use only authorized provider recovery actions. |
| Changed requirements, architecture, scope, accepted risk, or a semantic conflict | Present the decision to the human and stop. |
| Provider access, branch ownership, or required evidence becomes unavailable | Record what is known, report the blocker, and stop rather than claim readiness. |

### Branch maintenance

Inspect local changes and fetch the current base before working. Preserve unrelated work. Rebase only for the actual mergeability/policy trigger above, not merely because the base advanced.

Regenerate derived output from its source. Mechanical conflict resolution is allowed only when meaning is unambiguous. For independently added validation registrations, preserve both additions and every trusted-base check, then run complete repository validation. Authored or semantic conflicts return to the human with both sides intact; do not blindly invoke a resolver that insists on resolving everything.

Run the repository's declared validation and [verify](../verify/SKILL.md) after maintenance. Push the updated delivery branch through the repository's normal authorized workflow and re-observe the PR. If pushing is rejected, inspect the cause and obtain direction rather than overwrite unrelated work. Functional failures return through Ship; do not turn maintenance into product implementation.

Use the [shared commit-message policy](../../COMMIT-STYLE.md) for newly authored maintenance messages. Preserve existing messages during replay/rebase; this policy does not authorize history rewriting or additional commits.

### Feedback repair

Call [ship](../ship/SKILL.md) with this PR, its requirements, the new findings, and the fact that this Shepherd retains monitoring ownership. Record the repair owner before waiting. Do not concurrently modify the branch or start another repair for the same findings.

Ship coordinates the implementation and independent review, validates, and updates the same PR. On return, inspect the resulting PR/check state and record which findings were addressed. Resume this loop; Ship must not start a nested Shepherd. A missing result, failed repair, or human-owned decision is reported explicitly and ends safe automatic remediation.

If a draft's outstanding delivery work needs completing, route that work through Ship under the same ownership rule. Do not mark it ready yourself while acceptance or review remains incomplete.

## Observation rhythm

Choose the interval from the PR's age since creation, not the number of checks or the time this session started:

| PR age | Interval |
| --- | --- |
| Under 1 hour | 2 minutes |
| 1 to under 2 hours | 5 minutes |
| 2 to under 3 hours | 10 minutes |
| 3 to under 4 hours | 15 minutes |
| 4 to under 5 hours | 30 minutes |
| 5 hours onward | 60 minutes |

Observe once immediately when taking or resuming ownership. Between observations, use an interruptible wait or a supported scheduled wakeup; do not busy-poll. Bound each wait to the next interval and check for stop requests before acting again. An active repair is supervised through its worker lifecycle, not duplicated by the observation clock.

Stay attached to the session unless the human explicitly authorizes a persistent external monitor. Never schedule a wakeup or promise continued monitoring unless the runtime can actually deliver it. If it cannot wait or continue, record the stopped state and report the limitation.

On meaningful changes, report the PR, checks/readiness, action taken, and next observation. On merge, closure, human decision, operator stop, or runtime loss, leave the latest truthful record. A crash ends observation; the last green result does not prove monitoring continued. Stop only run-owned waits/workers when safe, preserve unfinished work, and report any worker whose termination is uncertain.
