---
name: migration
description: Implement reversible compatibility-safe transitions. Use for schema, data, API, protocol, configuration, or dependency migrations requiring rollback and preservation proof.
---

# Migration

Use [doctrine selection and application](../doctrine/APPLY.md). Preserve the task's selections; with none, consider `sequencing`, `idempotency`, and, for stored-data changes, `data` or `distributed-data`. Select only relevant guidance and load its text before applying it. No doctrine authorizes destructive contraction or expands the agreed stage.

Map current readers, writers, data shape, compatibility window, and ownership before editing.

- Define forward path and rollback path.
- Preserve existing data; make destructive steps explicit and separately authorized.
- Keep mixed-version operation safe where rollout can overlap.
- Sequence expand, migrate, verify, then contract when applicable.
- Make retries idempotent and partial failure observable.
- Verify old and new paths at required transition stages.

Stop after requested stage passes; do not perform later destructive contraction implicitly.
