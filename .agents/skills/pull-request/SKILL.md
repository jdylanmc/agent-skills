---
name: pull-request
description: "Both. Write, create, or update a pull request: terse what/why/how body with a show-me style visual, before/after evidence and blast radius, unslopped, then publish and read it back. The single skill for every PR. Humans review this surface; no prose padding."
disable-model-invocation: false
user-invocable: true
---

# Pull Request

**Entry:** a human request, or an agent inside an already authorized delivery (Ship, Patch, Refactor, Shepherd, Wrap-up), under the [invocation contract](../setup/INVOCATION.md). This skill writes the PR body, unslops it, and creates or updates the one PR. A request to open or update a PR authorizes that one PR; it grants no implementation, tracker change, approval, auto-merge, merge, branch deletion, or release authority. Without publication authority, return the body only.

The body is the surface a human reviews. Give the **what**, the **why**, and the **how**. Show the how; do not narrate it.

## Resolve the route

Inspect repository guidance and available skills before acting:

1. Use an explicitly requested PR workflow.
2. Otherwise use a repository-specific create-PR skill or documented publication procedure. This skill then supplies the body only.
3. Otherwise, inside an active Ship, Patch, Refactor, Shepherd, release, or equivalent delivery, return publication to that owner with the body.
4. Otherwise publish with this skill.

Do not run two publication workflows, take over an owned branch, or bypass a repository's review, template, provider, or approval rules. If ownership is unclear, stop and ask.

## Inspect the candidate

Read repository guidance, the target branch, remote and provider configuration, PR templates, changed commits and files, status, and validation evidence. Resolve the actual source and target refs; do not assume `main`, `origin`, GitHub, or same-repository publication.

Require `worktrees` under [Doctrine](../doctrine/APPLY.md), keeping any caller selection, and use the existing owned isolated workspace. Do not relocate, discard, stash, reset, or overwrite unrelated work. Record the workspace you create; it is cleaned up under [Workspace hygiene](../ship/WORKSPACE.md#workspace-hygiene) when the PR merges or closes.

Check for an open PR from the source branch or for the same delivery, and reuse it. Ask when several plausible matches exist. After an uncertain create or update result, query provider state before retrying. With no meaningful committed change, report that no PR can be created; do not manufacture an empty commit. Report missing commits, push access, required validation, or provider destination as the exact blocker.

## Voice

Write each prose line at the [Synthesize](../synthesize/SKILL.md) **Caveman** altitude: cut filler, keep every substantive fact, constraint, and uncertainty. Readable fragments are fine. This is a per-artifact style, not the session [Caveman](../caveman/SKILL.md) mode, which excludes PR text; the operator explicitly requested this exception. Do not invent abbreviations. Keep `not`, `never`, `only`, `except`. Keep code, paths, identifiers, and numbers exact.

Use the vocabulary in `CONTEXT.md` (via `CONTEXT-MAP.md` if present) when it exists. Skip preambles, recaps, and restating the diff in prose.

## Template

```markdown
## What

<1-2 lines. The change, as observed behavior.>

## Why

<1-2 lines. Goal, bug, or ticket. Closing keyword only if the work fully satisfies it.>

## How

<smallest visual that makes the point; see Visuals>

## Evidence

- **Before:** <screenshot / output / failing test>
  **After:** <screenshot / output / passing test>

## Blast Radius

**Scope:** <one word>

<optional: ramifications of merging>

**Door:** <one-way | two-way>

<optional: why>
```

Omit optional lines when empty. Do not add other sections unless the repository's own PR template requires them; if one exists, keep its required headings and place this content inside them.

## Visuals (How)

Pick the smallest view that makes the key point. Use one or several; rarely all. Show only the calls, files, props, states, and boundaries a reviewer needs. Put each visual next to the single line it supports.

| Shape | Use for | Format |
| --- | --- | --- |
| Pseudocode | Logic or algorithm | `text` fence |
| Call tree | Runtime control flow | `text` fence |
| Component tree | UI structure, state and module boundaries, with file paths where they matter | `text` fence |
| Shallow file tree | File responsibility or broad refactor, one `#` comment per node | `text` fence |
| Mermaid | Component interaction, control flow, data flow | `mermaid` fence |
| Diff sketch | What changes when surrounding shape already exists | `diff` fence |
| Whole block | Mostly new code, or a copyable target shape | language fence |

Match the diff sketch to the topic. Prefix unchanged lines with a space, added with `+`, removed with `-`:

```diff
 submitForm
   createSession
     persistPrompt
+    expandSkillMention
     launchAgent
-  navigateToSession
+  navigateToSession
+    subscribeToEvents
```

Rules:

- Sketch the shape; do not paste the real diff. The host already shows it.
- Verify every name, path, and ordering against the actual change. Never draw structure that does not exist.
- Check that the target host renders Mermaid in PR descriptions. If unsure or unsupported, use a call tree or sequence as text instead.
- The body is Markdown only. Do not embed or link generated HTML artifacts as the explanation.

## Evidence

Concrete proof the change works, as before and after. Never fabricate or imply a run that did not happen.

1. **Screenshots** (best) when the change is visual and an environment can capture them. Attach only by a supported host mechanism; do not commit images to the repository for this.
2. **Execution** (next best): exact test or command output. Name the test that failed before and passes now, and show it as pseudocode:

   ```text
   test "cached save returns same result"
     before: FAIL  expected cached, got fresh write
     after:  PASS
   ```

3. **Neither available:** write `Evidence: none` and say why. Do not substitute reasoning for proof. Name unrun checks.

For a new behavior with no meaningful before, show the failing test on the base and the passing test on the head. Report only runs on the current head; label any older run.

## Blast Radius

- **Scope.** One word for the scope of impact, then optional lines for ramifications. Consider all possibilities: consumers breaking, layout shift, mobile responsiveness, performance, permissions, rollout order, other repositories or services.
- **Door.** *Two-way*: cheap to roll back (revert restores state). *One-way*: destructive or hard to reverse, such as data migration or deletion, published API or contract change, external side effects, secrets rotation. Say which, and why in one line when not obvious.
- Say `none known` only after checking consumers and call sites. Mark inference as inference.

## Unslop

Every PR title and body passes through [Unslop](../unslop/SKILL.md) before it is created or updated, on any route and for every revision. This is standing human policy for all pull requests, not an option per request.

- Unslop the prose lines only. Protect headings (the template's or the repository's), fences, diagrams, paths, identifiers, numbers, links, closing keywords, and quoted output.
- Keep the Voice above. Unslop removes formulaic framing and stock phrasing; it never lengthens a line or adds filler to satisfy a readability score.
- Run Unslop's Vale check on the final text and read the alerts in context, per its own rules. Do not disable rules or edit the configuration for a clean result.
- If Vale, its configuration, or its styles are unavailable, say so in your report and publish the editorially unslopped text. Do not install tools as a side effect.

## Publish or update

Follow [DELIVERY](../ship/DELIVERY.md) for provider mechanics. Use the repository's PR template headings when one exists.

- **State.** Honor an explicit draft or ready request from the human or the owning workflow. Otherwise follow repository convention, and with none, create a draft. Never mark an existing PR ready, approve, enable auto-merge, or merge on your own.
- **Provider.** GitHub and Azure DevOps (ADO) rules follow below. For any other provider, use its supported equivalent or report the missing capability.
- **Push.** Only the owned source branch, to its resolved remote. Never force-push unless the caller owns a separately authorized history rewrite with an exact expected-head lease.
- **Create or update** with the unslopped title and body and the correct base and head. Then read the stored PR back. The body must match the intended text.

Report:

- URL and provider;
- draft or ready state;
- source and target refs;
- observed head commit;
- validation evidence included;
- Unslop and Vale coverage for the title and body;
- unresolved blockers or human decisions.

Request success is not verification. If readback differs from what you asked for, report the actual state. Stop after publication; a separately authorized Shepherd or repository workflow owns continued maintenance.

When updating after new commits, revise What, How, Evidence, and Blast Radius to the current head; do not append history.

## GitHub

Resolve the provider from the remote URL, not from memory.

- Adapt to the repository's own PR standards before writing: its PR template (including a `pull_request_template/` folder), `CONTRIBUTING.md`, title and branch conventions, and recent merged PRs. Keep this skill's voice, visuals, and unslopping, and fit the structure to what the repository states.
- Use `gh` or the available GitHub integration with an explicit `--repo owner/name`, `--base`, and `--head`. For a fork, name the head as `owner:branch`.
- Authenticate as the identity that owns the repository: the personal account for open-source checkouts, the work account for enterprise. Do not switch accounts or write credentials to files.
- Pass the unslopped body from a file (`--body-file`), never inline shell text. Update an existing PR with `gh pr edit`.
- Draft or ready follows the State rule above: `--draft` on create, and `gh pr ready` only on an explicit request.
- Read back with `gh pr view --json` for state, base, head, and body, and compare against the intended text.

## Azure DevOps

Delegate publishing to the work `ado-pull-request` skill, which knows Azure DevOps and the repository's PR standards. This skill owns the generic style. Do not call ADO APIs, `az repos`, or the ADO integration directly.

- **You write, it publishes.** Write and unslop the title and body, then hand it the text, the source and target refs, the draft or ready request, and linked work items.
- **If it asks you for text,** return the unslopped title and body only. Do not publish or delegate back.
- **Adapt to the repository.** Fit the structure to the template and guidance it passes: a template's headings win and required items are filled, not dropped. Keep this skill's voice and unslopping.
- If that skill is not installed, report the missing capability and return the unslopped body. Do not improvise an ADO publication path.

## Check before finishing

- The route was resolved, and no second publication workflow ran.
- What and Why each fit in two lines; nothing restates the diff.
- How shows structure, with names verified against the change.
- Evidence is real, current, and labeled before/after, or explicitly `none`.
- Scope and Door are both stated.
- No required meaning was lost to compression.
- Title and body were unslopped, and the stored body matches that text.
- The readback report covers state, refs, head, and blockers.

## Attribution

Adapted from Matt Pocock's MIT-licensed [`pr`](https://github.com/mattpocock/skills/blob/main/skills/engineering/pr/SKILL.md) skill, which credits Dex Horthy and HumanLayer's MIT-licensed [`show-me`](https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md) skill for the concise visual-summary approach. See the bundled [third-party notice](../setup/NOTICE.md), [Matt Pocock license](../setup/licenses/mattpocock-skills.LICENSE), and [HumanLayer license](../setup/licenses/humanlayer-skills.LICENSE).
