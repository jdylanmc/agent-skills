---
name: frontmatter-reference-mirror
description: Author frontmatter and Required References sections so includes, composes, generated fields, invocation flags, and tool grants satisfy the graph contract.
level: atom
allowed-tools: ["read","edit"]
includes: []
composes: []
used-by: ["create-skill/_molecules/skill-package-conformance/skill-package-conformance.md"]
---

# Frontmatter and Reference Mirror

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `package-tree` | yes | The files selected for the new skill package. |
| `direct-unit-graph` | yes | The direct units each skill or molecule composes. |
| `tool-needs` | yes | The smallest tool set required by each atom and by the routable skill. |

## Operation

1. For every unit, declare frontmatter fields `name`, `description`, `level`,
   `includes`, and `composes`. The `name` matches the Markdown file stem and
   `level` matches `_atoms` or `_molecules`.
2. For every routable `SKILL.md`, declare `name`, router-quality `description`,
   `allowed-tools`, `includes`, `composes`, `disable-model-invocation`,
   `user-invocable`, and `requires-skills`.
3. Keep `includes` as the exact mirror of inline links in `## Required
   References` and `## Required Files`. Those sections contain only their lists
   and end at the next `##` heading. Do not put prose links inside them.
4. Keep `composes` as the exact direct subset of `includes` that points to atoms
   or molecules. An atom uses `composes: []`. A molecule composes two or more
   units. A routable skill directly composes Chronicler plus its direct local or
   shared units.
5. Never hand-author `used-by`. Never hand-author a molecule's `allowed-tools`.
   Generate both with `node scripts/derive-skill-graph.mjs --write`.
6. A skill's `allowed-tools` is verified, never regenerated. Set the narrowest
   deliberate superset of the composed units' needs. Include `execute` when the
   skill composes Chronicler or runs validation commands.
7. Every routable skill directly composes `_base/_molecules/chronicler/chronicler.md`
   and grants `execute` for bounded invocation recording.
8. Do not add a signature footer.

## Output

| Field | Meaning |
| --- | --- |
| `frontmatter_plan` | Required fields for each file. |
| `required_reference_plan` | Exact links that must appear in each required section. |
| `tool_grant_plan` | Atom-authored tools and the routable skill's deliberate grant. |
| `generated_fields` | Fields intentionally left for the deriver. |

## Guarantees

- `includes` and required-reference links match exactly after canonicalization.
- Derived fields are not hand-authored.
- Skill grants are intentional and narrow.
- Chronicler is always a direct routable-skill dependency.

## Boundaries

This atom does not choose package seams, write validation tests, run graph
commands, or widen another skill's tools.
