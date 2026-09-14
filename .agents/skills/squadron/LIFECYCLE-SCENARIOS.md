# Lifecycle acceptance scenarios

Reviewer exercise for changes to [LIFECYCLE](LIFECYCLE.md), its callers,
[placement](../ship/WORKSPACE.md), or [readiness](../ship/DELIVERY.md). These
scenarios are not live-operation instructions, runtime enforcement, or claims
that provider transitions were executed.

For each case, supply the observations below to the applicable route. Ask for
the next action, delivery/custody/runtime state, and decisive evidence required
before its final claim. Compare with the expected outcome; record the actual
response, pass/gap, and source revision in the existing review/task record.
Simulate provider/harness observations for this exercise—do not modify real PRs,
archive agents, or create resources merely to run it. A manual walkthrough is
weaker evidence than a live authorized transition; label it accordingly.

| Case and supplied observations | Expected action and observable postcondition | Reject |
| --- | --- | --- |
| **Ready draft:** acceptance met, whole-candidate independent review current, required checks green at H1 containing latest observed T1, no blockers; Shepherd observes H1/T1 and acknowledges custody | Accepted Shepherd executes supported promotion. Readback reports non-draft, still H1/T1 with covering checks. Only then report ready for human signoff and next observation. | Draft URL, successful promotion request without readback, or sender-authored custody treated as ready; agent casts approval/merges. |
| **Blocked draft:** required check failed/missing, acceptance gap, or unresolved human decision despite mergeability | Record actual draft and blocker, retain/transfer explicit duties, return repair to existing route when authorized. No ready claim. | Promote to make the report consistent or count mergeability/empty checks as success. |
| **Mixed batch:** PR A verified ready, PR B draft building, PR C blocked draft | Report each state and owner separately; B/C remain unfinished with next action. A reconciled cycle may include honest blockers, not “all delivered.” | Final delivered batch with abandoned drafts; treating cycle completion as every PR ready. |
| **Send only:** transfer tool succeeds, recipient is idle, no recipient observation/response | Transfer pending; sender retains responsibility without competing writes. Obtain receiver observation and acknowledgment of actual scope/candidate/duties. | Send success, idle status, or local owner field treated as custody proof. |
| **Accepted transfer:** receiver observes H2/T2, accepts named PR and maintenance duties with next observation; outgoing writer has stopped | Preserve receiver acknowledgment; one accepted scope owner, no competing monitor. Retire outgoing terminal worker only after remaining duties/evidence checks. | Sender discards evidence, or recipient writes before outgoing writer stops. |
| **Base moves:** H1/T1 was reviewed/green; fresh target is T2 before promotion or announcement | Invalidate stale readiness, rebase on T2, refresh affected proof/review and provider checks, re-observe refs. Report actual draft flag if already promoted; no stale ready claim. | Reuse T1 proof because mergeability remains green or blindly claim successful promotion means ready. |
| **Cancelled owner/child:** parent cancelled after a partial diff; child may still write; another monitor may survive | Disclose observation gap; inspect owners/children, Git/provider state, partial work and wakeups. Preserve work; resume/replace only confirmed missing ownership with explicit transfer. | Infer cancellation stopped descendants; launch replacement writer/monitor into uncertain ownership. |
| **Placement:** repository R has project P, worktree W1/workspace S1; independent writer needs W2 and two read-only agents inspect W1 | Reuse P/S1 for W1 readers; establish W2/S2 under P for writer, never a project per worktree or one workspace for both worktrees. Verify returned mapping plus each agent's actual cwd/Git state. | New UI resources solely per agent; shared mutable checkout for independent writers; trust a title/branch or guessed cwd argument. |
| **Mapping mismatch:** create_workspace returns wrong project/path or ownership is ambiguous | Block affected writes and reconcile mapping with owner; preserve existing resources and unrelated work. | Fall back to main, create another project blindly, delete registrations, or widen permissions. |
| **Terminal worker vs idle monitor:** parent accepts/preserves analysis or implementation result with no remaining duties; separate Shepherd is idle waiting on its next heartbeat | Invoke supported archival for the terminal owned worker and verify archived state/removal from active view. Retain the live Shepherd with next observation evidence. Arrange parent archival when self-reporting would be interrupted. | Only report cleanup candidates; archive all idle agents; retain terminal workers for hypothetical fixes forever. |
| **Shared monitor:** one runtime owns PR A and B, A merges while B remains open | End A's scope, preserve terminal evidence; keep B's ownership and cadence. Agent remains retained until all scopes/duties end. | Archive runtime on A's merge or silently reduce B's observation frequency. |
| **No archive capability:** owned worker is terminal/accepted, but archival unsupported or denied | Record retained ID, exact capability limit, responsible owner and next action. No successful retirement claim. | Guess API, enable bypass, silently retain, or substitute workspace archival. |
| **Preserve resources:** terminal owned agent eligible for archive; its branch/worktree/evidence still needed and archive_workspace may delete worktree | Archive only the exact agent using supported operation; verify runtime result and preserve branch, worktree, workspace, project and accessible evidence. Git cleanup is a separate authorized decision. | Delete/archive workspace/project or branch to declutter agents. |

The pack tests exercise real released-CLI discovery, copy install/reinstall, and
reachable support files. They do not score these decisions or enforce agent
behavior. Independent review records scenario outcomes; actual delivery owners
still supply live observations for real readiness, custody, and retirement claims.
