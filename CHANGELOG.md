# Changelog

## Unreleased

- Collapse `grilling`, `grill-me`, and `grill-with-docs` into `interrogate`,
  retaining optional domain-model recording and updating callers and ticket types.
- Merge `diagnosing-bugs`, `systematic-debugging`, and `investigate-first` into
  `debug`: distinguish diagnosis from authorized repairs, retain relevant
  techniques and helper scripts, and update callers and evaluation prompts.
- Remove `codebase-design` and its active dependencies. Use repository-local
  architecture and terminology in surviving callers.
- Remove Caveman product integrations: `caveman-setup`, `caveman-discover`,
  `caveman-evidence-review`, `caveman-manage`, `caveman-optimize`, `caveman-learn`,
  and `caveman-stats`. Update help for the standalone collection.
- Keep 43 active skills after these consolidations and removals; preserve
  source attribution, doctrine, and the historical archive.
- Rename `wayfinder` to `discovery`, including invocation names, tracker labels,
  and cross-skill references. Preserve the original upstream provenance.
- Remove all `openai.yaml` agent metadata files from the active collection.
- Remove 17 skills in the initial human curation passes: `wizard`, all six
  `writing-*` skills, `to-questionnaire`, `teach`, `setup-ts-deep-modules`,
  `setup-pre-commit`, `scaffold-exercises`, `migrate-to-shoehorn`,
  `receiving-code-review`, `claude-handoff`, `finishing-a-development-branch`,
  and `git-guardrails-claude-code`. Keep 55 skills without rewriting their workflow
  text; archive and doctrine remain unchanged.
- Archive the previous atomic skill framework, agents, coupled tooling, runtime
  hooks, and documentation under `archive/atomic-v1/`.
- Start an editable, repository-local collection from Matt Pocock's skills,
  Caveman's skills, Superpowers, and Anthropic's `skill-creator`.
- Preserve human-owned doctrine and root intent unchanged. Retain the standalone
  doctrine integrity check without imposing the retired framework on imports.

Earlier history is preserved in
[the archived changelog](./archive/atomic-v1/CHANGELOG.md).
