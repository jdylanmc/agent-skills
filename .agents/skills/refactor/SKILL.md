---
name: refactor
description: Restructure code while preserving behavior. Use for extraction, consolidation, ownership moves, or cleanup where verification must bracket structural edits.
---

# Refactor

Use [doctrine selection and application](../doctrine/APPLY.md), preserving the task's selections. With none, consider `code`, `solid`, and `laziness` for the actual restructuring; choose relevant IDs from metadata rather than loading the whole bundle. Apply loaded rules without weakening behavior-preservation requirements.

Define behavior-preservation boundary and establish verification before structural edits.

- Keep feature changes outside refactor.
- Move one ownership boundary at a time.
- Preserve public interfaces, failure behavior, ordering, and compatibility unless explicitly scoped.
- Keep intermediate states buildable and testable.
- Avoid dependency or configuration growth without correctness need.

Run same proof after change. Stop when behavior matches and requested structure is achieved.
