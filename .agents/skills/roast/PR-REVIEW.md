# Human review of a pull request

Applies when a **human** invokes Roast and supplies a pull request (URL, number, or the current branch's PR). Agent, Ship, and other delegated invocations keep the findings contract in [Roast](SKILL.md) and the [reviewer contract](reviewer.md). The review keeps its evidence, standards, and full finding fields while the presentation and follow-up change.

## Review in sub-agents

Run the review in sub-agents to keep diffs and file contents out of the primary context. The primary context resolves the PR and runs the scout. It dispatches the reviewers the scout picks, then builds the table and handles the follow-up. It does not read the diff, the changed files, or logs to review them.

- **Resolve first.** Get the repository, PR number, base, and head SHA. That is all the primary context needs before the scout runs.
- **Scout first.** Run the PR scout from [PR-SCOUT](PR-SCOUT.md), passing the repository, PR number, base, head SHA, and any reviewers the human added or removed. It returns the reviewers to start, their doctrine packets, and each reviewer's files. Its routing table, not the primary context, selects the reviewers. The count follows the PR. If it returns `unmatched` paths, ask the human about them before dispatch.
- **Dispatch** each planned reviewer in parallel. Give it the [reviewer contract](reviewer.md), the PR and head SHA, and its files. Also give it the purpose (the PR description and linked issue, which it fetches), its doctrine packet from the scout, and read-only evidence access. None loads another reviewer's doctrines or any others, and more doctrines load only on the human's request.
- **Frontier models only.** Set the model for the scout, every reviewer, and every verifier, because this flow requires it. Use the newest frontier-tier models from the `Claude 5.x` and `GPT 6.x` series that the harness offers, and mix the two series across the reviewers. Never use a lightweight tier such as Haiku, Flash, Mini, or similar. If no frontier model is available for a reviewer, say so and ask. Do not fall back to a lighter one.
- **Rubber duck before reporting.** Each reviewer checks its draft findings with a rubber-duck pass before it reports back, to catch hallucinated or unsupported claims against the real code. Run the duck on a frontier model from the other series than the reviewer's. The reviewer drops or corrects any finding the duck cannot support, then reports only what survives, with the count it removed. The duck only reads and starts nothing further. A reviewer that cannot start a duck says so, and the coordinator runs the duck on that reviewer's records before the merge.
- **Merge without losing anything.** Several reviewers often find the same problem. Combine them into one row, and keep what each one learned:
  - list every doctrine involved;
  - take the highest severity any reviewer supported, and note the disagreement in the detail;
  - take the clearest fix, and keep a different reviewer's fix as an alternative;
  - keep every reviewer's evidence note, consequence, and verification in the stored record behind the row. Step 2 uses that full record;
  - independent agreement can raise confidence. A disagreement about the same lines gets settled by viewing only those cited lines, and stays `Low` if it is still open;
  - findings on the same lines about different problems become separate rows.
  
  Rank across reviewers yourself.
- **Compact return.** Ask for one record per finding and nothing else. Each record has the file and lines, a one-line issue and fix, severity, confidence, and doctrine IDs. It also has a short evidence note, the consequence, how to verify, and a replacement or diff for the fix. Ask for no raw diffs, file dumps, or narrative. Add at most two lines of coverage.
- **Verify before you rely on it.** For each issue the human picks, view only the cited lines yourself before you draft a comment. A finding that fails that check gets corrected or dropped, and you tell the human.
- **Dig deeper through the reviewer.** When a picked issue needs more detail than its record holds, ask the reviewer that found it. Do not re-review the PR in the primary context.
- **No sub-agent available.** Say so and ask whether to review directly. Do not present a direct review as isolated.

## 1. The table

Lead with one table, one row per issue, most severe first. Write every cell as one short line. With no supported findings, state the scope and limits and stop without a table or prompt.

| # | File | Issue | Fix | Severity | Confidence | Doctrine |
|---|---|---|---|---|---|---|
| 1 | [`src/a.ts:42-47`](https://example.com/blob/abc123/src/a.ts#L42-L47) | What is wrong, plainly | The change that resolves it | Critical | High | `solid` |

- **File:** a link to the file and lines at the **reviewed head commit** (a permalink with that SHA), labeled `path:lines`. For an issue spanning files, link the primary location. For a PR-level issue with no file, write `PR` and link the PR.
- **Issue:** what the problem is, not a topic label.
- **Fix:** what we would need to do, concretely.
- **Severity:** `Critical`, `Important`, or `Minor`, ranked by consequence.
- **Confidence:** `Low`, `Med`, or `High`, from the strength of the evidence. A concern still needing investigation is `Low`.
- **Doctrine:** the doctrine ID(s) violated, as loaded through [Doctrine](../doctrine/APPLY.md). Write `none` when the finding rests on the intent, a stated need, or demonstrated behavior instead of a doctrine.

Under the table, add at most two lines of coverage covering the PR and head SHA, the doctrines applied, anything run, and what was not reviewed. Step 2 uses each finding's full record, which the table only summarizes.

## 2. Ask what to dig into

Right after the table, prompt with `ask_user` as a multi-select of the rows, each labeled `#n` with a short issue name. Allow none. Do not explain every issue unprompted, and do not post anything yet.

For each issue the human picks, explain it in detail:

- the evidence: the code or text, with locations;
- why it is a flaw and what it costs;
- the fix, shown concretely (a diff or exact replacement);
- how to verify the fix;
- the doctrine or stated need behind it. This detail is for the human, so it can cite the doctrine.

Then offer to leave a comment (step 3) for that issue.

## 3. The comment

Draft one comment per issue, in this format:

```markdown
**[Severity]**

<Finding text>

<How to fix text>
```

- Severity is the same label as the table: `Critical`, `Important`, or `Minor`.
- Write both texts at the [Synthesize](../synthesize/SKILL.md) **Caveman** altitude: concise, to the point, every substantive fact kept.
- **Finding text** says what is wrong and why it matters, in a sentence or two.
- **How to fix text** always **shows** the fix, as replacement code or an exact diff. Use a GitHub ```` ```suggestion ```` block when the fix is a contiguous change on the commented lines. Never write "consider fixing" without showing how.
- **Never** name a doctrine or standard, state a confidence level, or mention this skill, a reviewer, or AI.

Show the exact text and ask with `ask_user`: **post**, **edit**, or **skip**. Post only text the human approved, one comment at a time.

## 4. Post

The human's approval of that exact comment authorizes posting it, as a comment only: never a review, an approval, a request for changes, or a merge.

- **GitHub.** Post an inline comment on the file and lines with `gh api repos/<owner>/<repo>/pulls/<n>/comments`, using the reviewed head SHA as `commit_id`, `path`, `line` (and `start_line` for a range), and `side: RIGHT`. Use the repository owner's account, as in [Pull Request](../pull-request/SKILL.md). Pass the body from a file instead of inline in the command.
- **Not in the diff.** If GitHub rejects the inline comment because the lines are not in the PR diff, post a PR-level comment with `gh pr comment` that links the file and lines, and tell the human.
- **Other providers.** Do not improvise. Return the comment text for the human to paste, and say the capability is missing.
- **Moved head.** If the PR head changed since the review, say the findings might be stale and still comment on the reviewed commit.
- **Read back.** Read the posted comment back and confirm its body matches the approved text. Report the comment link. If it differs, report the actual state.

After you handle the picked issues, stop. Do not fix, merge, or approve.
