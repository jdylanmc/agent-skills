# Changelog

## Unreleased

- Remove 15 skills in the first human curation pass: `wizard`, all six
  `writing-*` skills, `to-questionnaire`, `teach`, `setup-ts-deep-modules`,
  `setup-pre-commit`, `scaffold-exercises`, `migrate-to-shoehorn`,
  `receiving-code-review`, and `claude-handoff`. Keep 57 skills without rewriting
  their upstream contents; archive and doctrine remain unchanged.
- Archive the previous atomic skill framework, agents, coupled tooling, runtime
  hooks, and documentation under `archive/atomic-v1/`.
- Start an editable, repository-local collection from Matt Pocock's skills,
  Caveman's skills, Superpowers, and Anthropic's `skill-creator`.
- Preserve human-owned doctrine and root intent unchanged. Retain the standalone
  doctrine integrity check without imposing the retired framework on imports.

Earlier history is preserved in
[the archived changelog](./archive/atomic-v1/CHANGELOG.md).
