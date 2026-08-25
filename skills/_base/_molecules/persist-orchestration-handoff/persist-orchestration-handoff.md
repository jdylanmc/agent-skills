---
name: persist-orchestration-handoff
description: Validate a versioned orchestration handoff document, adapt it into the shared bounded handoff payload, and delegate redaction, temporary-path placement, guarded writing, and exact path reporting to the existing core.
level: molecule
includes: ["_base/_atoms/artifact-reference/artifact-reference.md","_base/_atoms/handoff-render/handoff-render.md","_base/_atoms/redact-sensitive/redact-sensitive.md","_base/_atoms/temp-path-resolve/temp-path-resolve.md","_base/_atoms/write-guarded/write-guarded.md","_base/_molecules/persist-orchestration-handoff/persist-orchestration-handoff.mjs"]
composes: ["_base/_atoms/artifact-reference/artifact-reference.md","_base/_atoms/handoff-render/handoff-render.md","_base/_atoms/redact-sensitive/redact-sensitive.md","_base/_atoms/temp-path-resolve/temp-path-resolve.md","_base/_atoms/write-guarded/write-guarded.md"]
used-by: ["orchestration-handoff/SKILL.md"]
allowed-tools: ["execute"]
---

# Persist an Orchestration Handoff

Validate a confirmed orchestrator-to-worker assignment, adapt it into the
existing bounded handoff payload, and delegate persistence to
`persist-bounded-handoff`. This molecule owns the orchestration schema. The
existing bounded core still owns redaction, rendering, temporary-path
resolution, guarded writes, verification, and exact path reporting.

This is the low-risk sibling of the human persistence path. It reuses the same
atoms and implementation seam, but it does not add fields, versions, or a
discriminator to the already-tested schema-version-1 core.

## Required References

1. [Artifact reference](../../_atoms/artifact-reference/artifact-reference.md)
2. [Sensitive content redaction](../../_atoms/redact-sensitive/redact-sensitive.md)
3. [Handoff rendering](../../_atoms/handoff-render/handoff-render.md)
4. [Temporary path resolution](../../_atoms/temp-path-resolve/temp-path-resolve.md)
5. [Guarded verified write](../../_atoms/write-guarded/write-guarded.md)

## Required Files

1. [Orchestration schema adapter and persistence entry point](./persist-orchestration-handoff.mjs)

## Inputs

The caller supplies one bounded JSON object of confirmed orchestration context.
Unknown fields are rejected instead of dropped.

| Field | Required | Meaning |
| --- | --- | --- |
| `schema_version` | yes | Must be `1`. This is the orchestration document schema, not the core handoff schema. |
| `slug` | one of | Optional already-normalized slug for the file name. Supply this or `slug_source`, never both. If neither is present, the run identifier becomes the slug source. |
| `slug_source` | one of | Optional raw work name to let the shared core normalize. |
| `title` | no | Document title. Defaults to `Orchestration Handoff`. |
| `run_identity` | yes | Object with required `run_id` and optional `root_skill`, `parent_run_id`, and `log_path`. |
| `source_agent` | yes | Object with required `id` and optional `role`. |
| `target_agent` | yes | Object with required `id`, optional `role`, and optional `invocation_reason`. |
| `task_contract` | yes | Object with required `goal`, `scope`, `context`, `verify`, `report`, and `standing`; optional `timebox` and `forbidden`. |
| `inputs` | yes | Strings or `{ name, value, source }` entries. |
| `constraints` | yes | Array of strings. |
| `assumptions` | yes | Array of strings that must stay separate from facts. |
| `artifacts_and_references` | yes | Existing locators using the shared artifact-reference shape. |
| `acceptance_criteria` | yes | Array of strings. |
| `open_questions` | yes | Array of strings. |
| `suggested_skills` | no | Exact skill identifiers and reasons, checked by the shared core. |
| `available_skills` | required with suggestions | Real routable skill identifiers used by the shared core to reject invented suggestions. |

The adapted document contains a standalone worker brief with `GOAL`, `SCOPE`,
`CONTEXT`, `ACCEPTANCE`, `VERIFY`, `TIMEBOX`, `FORBIDDEN`, `REPORT`, and
`STANDING` labels. Missing material fields are refused, while empty lists render
as no confirmed information.

## Operation

```text
node <molecules>/persist-orchestration-handoff.mjs (--payload <file> | --stdin) [--config <path>]
```

| Input | Required | Meaning |
| --- | --- | --- |
| `--payload` | one of | A file holding the JSON orchestration payload. |
| `--stdin` | one of | The JSON orchestration payload on standard input. |
| `--config` | no | A version 1 repository identifier configuration for shared redaction. |
| `--probe` | no | Prints `persist-orchestration-handoff: available` and exits `0`. |

The operation runs in this order:

1. Validate the orchestration envelope, version, material fields, nested object
   fields, and bounds.
2. Adapt the orchestration document into the strict schema-version-1 payload
   accepted by `persist-bounded-handoff`.
3. Call `persist-bounded-handoff` with that adapted payload and the same
   configured redaction identifiers.
4. Return the exact JSON result from the shared core, including `path`,
   `directory`, `name`, `bytes`, `headings`, `redactions`, and
   `suggested_skills_included`.

All artifact, redaction, path, and write guarantees come from the existing core:
artifacts are linked rather than copied, writes go only beneath the operating
system temporary directory, and the reported path is reread before success.

## Failure Categories

The sibling reports the same JSON failure envelope as `persist-bounded-handoff`.
It can raise the following caller-correctable categories before delegation:

| Category | Meaning |
| --- | --- |
| `usage` | The command-line flags were invalid, or neither/both payload sources were supplied. |
| `malformed_payload` | The orchestration payload was not JSON, had an unsupported `schema_version`, carried unknown fields, missed material fields, exceeded a bound, or broke the declared nested schema. |

After adaptation, every shared-core failure category remains possible and keeps
its shared meaning: `inlined_artifact_body`, `unknown_skill`,
`malformed_config`, `redaction_incomplete`, `temp_unavailable`,
`unsafe_temp_root`, `name_exhausted`, `path_escape`, `unsafe_target`,
`write_failed`, `verification_failed`, and `internal_error`.

## Design Decision

This molecule chooses the sibling-persistence option rather than extending the
existing core with another version or discriminator. The current core accepts
only `schema_version: 1` and rejects unknown fields for the human continuation
caller. Adding orchestration fields to that validator would put the existing
human route at risk, while a sibling can refuse orchestration-specific schema
problems first and then reuse the same redaction, rendering, temporary path, and
guarded-write implementation unchanged.

## Composition

| Concern | Owner |
| --- | --- |
| Keeping locators and refusing reproduced artifact bodies | [Artifact reference](../../_atoms/artifact-reference/artifact-reference.md) |
| Replacing recognizable sensitive spans | [Sensitive content redaction](../../_atoms/redact-sensitive/redact-sensitive.md) |
| Rendering the bounded handoff sections | [Handoff rendering](../../_atoms/handoff-render/handoff-render.md) |
| Resolving the runtime temporary handoffs path | [Temporary path resolution](../../_atoms/temp-path-resolve/temp-path-resolve.md) |
| Exclusive create and reread verification | [Guarded verified write](../../_atoms/write-guarded/write-guarded.md) |
| Orchestration schema validation and adaptation | This molecule |
| Shared bounded persistence implementation | `persist-bounded-handoff.mjs` |

## Guarantees

- The orchestration schema is explicit and versioned.
- The human handoff core schema is not widened.
- The MIT attribution in `persist-bounded-handoff` remains the attribution for
  the reused core behavior.
- No filename, destination, visibility, or placement interview is introduced.
- No workspace handoff file is created.

## Regression Suite

From the repository root, run:

```text
node --test skills/_base/_molecules/persist-orchestration-handoff/persist-orchestration-handoff.test.mjs
```
