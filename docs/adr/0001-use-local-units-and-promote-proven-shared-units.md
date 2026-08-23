# Use Local Units and Promote Proven Shared Units

Skill-specific atoms and molecules live under their owning skill. A unit moves
to `skills/_base/` only when at least two named consumers are current skills or
explicitly approved skill designs. This keeps ownership and names scoped until
reuse is evidenced, while preserving `_base` as the canonical home for
cross-skill composition.

## Status

Accepted

## Considered Options

- Put every atom and molecule under `_base` and require globally unique names.
- Keep units local until two already-implemented skills consume them.
- Keep units local until two current or explicitly approved skill designs
  consume them.

## Consequences

- Local unit names are scoped to their owning skill.
- Shared-unit recommendations must name at least two qualifying consumers.
- Promotion to `_base` is a reviewed architectural change, not the default.
- A shared unit that later loses a consumer creates a review finding; it is not
  silently moved or duplicated.
