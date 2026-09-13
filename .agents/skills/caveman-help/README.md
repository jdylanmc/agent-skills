# caveman-help

Quick-reference card. One shot, no mode change.

## What it does

Prints a cheat sheet of caveman modes, retained sibling skills, and deactivation triggers. Choose modes through the conversation; this library does not install Caveman's product hooks or plugin configuration. One-shot display — does not flip the active mode, write flag files, or persist anything. Use when you forget the slash commands.

## How to invoke

```
/caveman-help
```

Also triggers on "caveman help", "what caveman commands", "how do I use caveman".

## Example output

```
Modes:
  /caveman              full (default)
  /caveman lite         lighter
  /caveman ultra        extreme
  /caveman wenyan       classical Chinese

Skills:
  /caveman-commit       terse Conventional Commits
  /caveman-review       one-line PR comments
  /caveman-compress     compress a selected prose file

Deactivate:
  "stop caveman" or "normal mode"
```

## See also

- [`SKILL.md`](./SKILL.md) — full reference card
- [Library overview](../../../README.md) — retained collections and curation
