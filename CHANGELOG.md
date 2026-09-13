# Changelog

## Unreleased

- Remove all `openai.yaml` agent metadata files from the active collection.
- Remove 16 skills in the initial human curation passes: `wizard`, all six
  `writing-*` skills, `to-questionnaire`, `teach`, `setup-ts-deep-modules`,
  `setup-pre-commit`, `scaffold-exercises`, `migrate-to-shoehorn`,
  `receiving-code-review`, `claude-handoff`, and `finishing-a-development-branch`.
  Keep 56 skills without rewriting their workflow text; archive and doctrine
  remain unchanged.
- Archive the previous atomic skill framework, agents, coupled tooling, runtime
  hooks, and documentation under `archive/atomic-v1/`.
- Start an editable, repository-local collection from Matt Pocock's skills,
  Caveman's skills, Superpowers, and Anthropic's `skill-creator`.
- Preserve human-owned doctrine and root intent unchanged. Retain the standalone
  doctrine integrity check without imposing the retired framework on imports.

Earlier history is preserved in
[the archived changelog](./archive/atomic-v1/CHANGELOG.md).
