---
name: artifact-classify
description: Classify one roast target as an agent, skill, prompt, specification pair, or code artifact from explicit evidence, and refuse ambiguous targets instead of guessing.
level: atom
allowed-tools: ["read","execute"]
includes: ["_base/_atoms/artifact-classify/artifact-classify.mjs"]
composes: []
used-by: ["roast/_molecules/roast-target-intake/roast-target-intake.md"]
---

# Artifact Classify

Classify one requested roast target before a branch applies an
artifact-specific lens. This atom prevents a Markdown artifact from being reviewed through the
wrong contract by returning only evidence-backed classifications and refusing
ambiguous cases.

## Required References

1. [Artifact classifier](./artifact-classify.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `target` | no | A path-like string, pasted text, or pull-request/diff reference when the caller has not separated the fields. |
| `path` | no | A repository-relative path to a file or directory. |
| `text` or `pastedText` | no | The exact supplied text to classify without writing it to disk. |
| `reference` | no | A pull-request, branch-diff, working-tree, or diff reference. |
| `repositoryRoot` | no | The root used to resolve `path`; defaults to the current working directory. |
| `locator` | no | The caller's stable identifier for supplied text. |

Supply exactly one target form when possible. When a caller passes only
`target`, the atom treats newline-containing input as supplied text, recognized
pull-request or diff wording as a reference, and otherwise as a path.

## Operation

1. Normalize only line endings and path separators needed for classification;
   never rewrite the artifact.
2. For a path, refuse paths outside `repositoryRoot`, symbolic links,
   unreadable paths, and non-regular filesystem entries.
3. Gather positive evidence from conventions and content markers:
   - `agent`: `agents/*.agent.md` or `.github/agents/*.agent.md`, plus agent
     frontmatter such as `target` and `tools`.
   - `skill`: `skills/<skill>/SKILL.md` or a `skills/<skill>` directory with
     `SKILL.md`, plus skill frontmatter such as `allowed-tools`.
   - `prompt`: explicit prompt-file conventions such as `.prompt.md` or a
     `prompts/` path, or supplied instructional text with no stronger marker.
   - `spec`: the specification pair naming convention, `<spec>.nano.md` or
     `<spec>.full.md`, with a second evidence record stating whether the
     sibling resolves beside it.
   - `code`: pull-request, branch-diff, working-tree, or unified-diff
     references; source-code extensions; or code syntax in supplied text.
4. Return `Classified` only when exactly one artifact type has medium or high
   evidence.
5. Return `Refused` when multiple artifact types have material evidence or when
   no artifact type has enough evidence. Name every type the atom could not
   distinguish.
6. Include every evidence item used for the decision. Evidence must name both
   the rule and the observed detail.

## Output

| Field | Meaning |
| --- | --- |
| `status` | `Classified` or `Refused`. |
| `type` | `agent`, `skill`, `prompt`, `spec`, or `code` when classified. |
| `routeToBranch` | The `/roast` branch that owns that artifact type when classified: `artifact` or `code`. |
| `confidence` | `high`, `medium`, or `low` when classified. |
| `locator` | The target path, reference, or supplied-text identifier. |
| `evidence` | Evidence records with `rule` and `detail`. |
| `category` | Refusal reason when refused. |
| `candidates` | Candidate artifact types and their evidence when refused. |
| `couldNotDistinguish` | The ambiguous or insufficiently proven type set when refused. |

Refusal categories: `Ambiguous target`, `Insufficient evidence`, and
`Unreadable target`.

## Guarantees

- A Markdown path is never treated as a skill package merely because it is
  Markdown.
- A conflicting target refuses instead of choosing the strongest-looking type.
- Pasted code and diff references route to the `code` branch; pasted
  instructional text is classified `prompt` only when no stronger marker
  identifies it as an agent, skill, or code artifact.
- A specification pair is classified from its sibling naming convention and
  never from its prose, so it is never routed as code and never reviewed under
  the prompt contract. A nano artifact whose sibling is absent still classifies
  as `spec`: the missing half is what a review most needs to report, and
  refusing to classify would hide it.
- A content-derived code signal never overrules an exact specification suffix.
  A full specification that quotes a diff is documenting a change, not being
  one. A genuine conflict between two path conventions, such as a `.nano.md`
  file inside a `prompts/` directory, still refuses.
- A specification is recognized from a path only. A pair is two files, so
  pasted text cannot be one, and no text signal claims otherwise.
- Every classified result names the correct branch for defensive routing.
- The atom is deterministic and performs no writes.

## Boundaries

This atom does not run a roast, stage evidence, invoke subagents, read linked
files, resolve doctrine, verify hashes, fetch pull-request contents, inspect a
diff, or decide whether a roast should continue after classification. Callers
own policy: if `type` differs from the caller's expected artifact type, they
must stop and report the actual type and `routeToSkill` instead of proceeding.

This shared `_base` atom has four named consumers on arrival:
`roast-this-agent`, `roast-this-code`, `roast-this-prompt`, and
`roast-this-skill`, satisfying ADR 0001's promotion threshold without an
exception.
