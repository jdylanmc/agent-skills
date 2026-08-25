---
name: model-role-resolver
description: Resolve model-role defaults, overrides, aliases, availability checks, panel fanout, and diversity status into agent-spawn-ready routing records.
level: molecule
includes: ["model-role-resolution/_atoms/model-role-defaults/model-role-defaults.md","model-role-resolution/_atoms/model-role-override-contract/model-role-override-contract.md","model-role-resolution/_molecules/model-role-resolver/model-role-resolver.mjs"]
composes: ["model-role-resolution/_atoms/model-role-defaults/model-role-defaults.md","model-role-resolution/_atoms/model-role-override-contract/model-role-override-contract.md"]
used-by: ["model-role-resolution/SKILL.md"]
allowed-tools: []
---

# Model Role Resolver

Resolve one model-role configuration into deterministic routing records that can
be passed to `agent-spawn` without changing that atom's spawn contract.

## Required References

1. [Model role defaults](../../_atoms/model-role-defaults/model-role-defaults.md)
2. [Model role override contract](../../_atoms/model-role-override-contract/model-role-override-contract.md)

## Required Files

1. [Deterministic resolver implementation](./model-role-resolver.mjs)

## Operation

1. Start from the inline defaults.
2. Overlay `repositoryOverrides`, then `userOverrides`, then explicit
   `overrides` or `config`, using only the accepted fields.
3. Expand panel roles from the configured array length. The resulting array
   length is the fanout.
4. Resolve `auto` and `inherit-parent` aliases.
5. If `availableModels` is present, validate requested and fallback slugs and
   select only the requested model or one of its listed fallbacks.
6. Produce one `agent-spawn` routing record per resolved single role or panel
   entry: `model`, `fallback-models`, `reasoning-effort`, and `context-tier`.
7. Report model status, validation status, unavailable slugs, fallback use,
   fanout, and JSON-stable diversity keyed by panel name.

## Output

The resolver returns:

- `status`: `Resolved`, `ResolvedWithDegradation`, or `InvalidConfig`;
- `roles`: flattened role records, each with `role`, optional `index`, routing
  fields for `agent-spawn`, `model-status`, `validation-status`, and reasons;
- `fanout`: panel lengths for `architecture.candidates` and `qa.reviewers`;
- `diversity`: an object keyed by panel name with family counts,
  `Same-family degraded`, `Insufficient fanout`, `Unverified runtime-default
  diversity`, and fallback degradation notes;
- `configurationSources`: the override layers that were applied, in precedence
  order;
- `warnings`: every unavailable slug, inherited-parent failure, fallback, and
  unvalidated runtime assumption;
- `errors`: schema problems that made the configuration unusable.

## Boundary

The resolver does not spawn agents, infer runtime model availability when it is
not supplied, mutate configuration files, or alter any skill's permissions. It
is deterministic infrastructure that prepares inputs for `agent-spawn`; the
caller still owns dispatch and records `agent-spawn`'s observed `model-status`.
