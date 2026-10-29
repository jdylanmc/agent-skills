# Human PR review

Applies when a **human** invokes Roast and supplies a pull request (URL, number, or the current branch's PR). Agent, Ship, and other delegated invocations keep the findings contract in [Roast](SKILL.md) and the [reviewer contract](reviewer.md). The review itself is unchanged: same evidence, standards, and full finding fields. Only the presentation and follow-up change.

## 1. The table

Lead with one table, one row per issue, most severe first. Keep every cell to one short line. If there are no supported findings, say so with the scope and limits, and stop: no table, no prompt.

| # | File | Issue | Fix | Severity | Confidence | Doctrine |
|---|---|---|---|---|---|---|
| 1 | [`src/a.ts:42-47`](https://example.com/blob/abc123/src/a.ts#L42-L47) | What is wrong, plainly | The change that resolves it | Critical | High | `solid` |

- **File:** a link to the file and lines at the **reviewed head commit** (a permalink with that SHA), labeled `path:lines`. For an issue spanning files, link the primary location. For a PR-level issue with no file, write `PR` and link the PR.
- **Issue:** what the problem actually is, not a topic label.
- **Fix:** what we would need to do, concretely.
- **Severity:** `Critical`, `Important`, or `Minor`, ranked by consequence.
- **Confidence:** `Low`, `Med`, or `High`, from the strength of the evidence. A concern still needing investigation is `Low`.
- **Doctrine:** the doctrine ID(s) violated, as loaded through [Doctrine](../doctrine/APPLY.md). Write `none` when the finding rests on a requirement, the intent, or demonstrated behavior instead of a doctrine.

Under the table, add at most two lines of coverage: the PR and head SHA reviewed, doctrines applied, anything executed, and what was not covered. Keep every finding's evidence, consequence, and verification for step 2; the table is the summary, not the whole record.

## 2. Ask which issues to dig into

Right after the table, prompt with `ask_user` as a multi-select of the rows, each labeled `#n` with a short issue name. Allow none. Do not explain every issue unprompted, and do not post anything yet.

For each issue the human picks, explain it in detail:

- the evidence: the code or text, with locations;
- why it is a flaw and what it costs;
- the fix, shown concretely (a diff or exact replacement);
- how to verify the fix;
- the doctrine or requirement behind it. This detail is for the human and may name the doctrine.

Then offer to leave a comment (step 3) for that issue.

## 3. The comment

Draft one comment per issue, in this exact shape:

```markdown
**[Severity]**

<Finding text>

<How to fix text>
```

- Severity is the same label as the table: `Critical`, `Important`, or `Minor`.
- Write both texts at the [Synthesize](../synthesize/SKILL.md) **Caveman** altitude: concise, to the point, every substantive fact kept.
- **Finding text** says what is wrong and why it matters, in a sentence or two.
- **How to fix text** always **shows** the fix: the replacement code, a diff, or the exact edit. Use a GitHub ```` ```suggestion ```` block when the fix is a contiguous change on the commented lines. Never write "consider fixing" without showing how.
- **Never** name a doctrine or standard, state a confidence level, or mention this skill, a reviewer, or AI.

Show the exact text and ask with `ask_user`: **post**, **edit**, or **skip**. Post only text the human approved, one comment at a time.

## 4. Post

Posting is authorized by the human's approval of that exact comment. It is a comment only: never a review, an approval, a request for changes, or a merge.

- **GitHub.** Post an inline comment on the file and lines with `gh api repos/<owner>/<repo>/pulls/<n>/comments`, using the reviewed head SHA as `commit_id`, `path`, `line` (and `start_line` for a range), and `side: RIGHT`. Use the account that owns the repository, as in [Pull Request](../pull-request/SKILL.md). Pass the body from a file, never inline shell text.
- **Not in the diff.** If GitHub rejects the inline comment because the lines are not in the PR diff, post a PR-level comment with `gh pr comment` that links the file and lines, and tell the human.
- **Other providers.** Do not improvise. Return the comment text for the human to paste, and say the capability is missing.
- **Moved head.** If the PR head changed since the review, say the findings may be stale and still comment on the reviewed commit.
- **Read back.** Read the posted comment and confirm its body matches the approved text. Report the comment link. If readback differs, report the actual state.

After the picked issues are handled, stop. Do not fix, merge, or approve.
