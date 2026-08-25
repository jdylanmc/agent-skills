---
name: handoff-render
description: Render one bounded handoff document in the approved heading order, keeping every required section present and Suggested Skills as the only optional one.
level: atom
allowed-tools: ["execute"]
includes: ["_base/_atoms/handoff-render/handoff-render.mjs"]
composes: []
used-by: ["_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
---

# Handoff Rendering

Turn bounded, confirmed context into one Markdown document with a stable shape.
This atom owns the schema and the order. It owns nothing about whether the
content is true.

A handoff is read by an agent that has none of the conversation that produced
it. That reader can only rely on the shape, so the shape does not vary: same
headings, same order, every required heading present even when its section has
nothing confirmed in it.

## Required Files

1. [Rendering entry point](./handoff-render.mjs)

## Operation

```text
node <atoms>/handoff-render.mjs (--payload <file> | --stdin)
```

| Input | Required | Meaning |
| --- | --- | --- |
| `--payload` | one of | A file holding the JSON payload. |
| `--stdin` | one of | The JSON payload on standard input. |
| `--probe` | no | Prints `handoff-render: available` and exits `0`. |

Exactly one payload source is supplied; both or neither is `usage`. Nothing is
written to disk. Any non-zero exit prints one JSON failure object on standard
error.

**Standard output is the rendered Markdown and nothing else**, so a caller can
pipe it straight into a write. The function this entry point wraps returns the
richer result in [Output](#output); the command line deliberately does not,
because a document wrapped in JSON is a document a shell has to unwrap.

## Payload

The payload is the same one the `persist-bounded-handoff` molecule accepts,
validated by the same implementation. Every field below is checked here, not
only the ones that become headings.

| Field | Required | Meaning |
| --- | --- | --- |
| `slug` | one of | The already-normalized repository or work slug. Lowercase alphanumeric words joined by single hyphens, at most 64 characters. Not rendered; it names the file the molecule writes. |
| `slug_source` | one of | The raw repository or work name, normalized here. Supply this **or** `slug`, never both. |
| `goal` | yes | What the work is for. |
| `current_progress` | yes | Where the work actually stands. |
| `decisions_and_constraints` | yes | Decisions already made and constraints to respect. |
| `artifacts_and_references` | yes | An array of locators, each a string or `{"reference": "...", "note": "..."}`. |
| `what_worked` | yes | Approaches that produced results. |
| `what_did_not_work` | yes | Approaches that failed, and why. |
| `next_steps` | yes | What the next agent should do. |
| `suggested_skills` | no | An array of `{"skill": "...", "reason": "..."}`. Omitted when no skill usefully follows. |
| `available_skills` | no | The caller's real skill identifiers. When supplied, a suggestion outside the set is `unknown_skill`. |
| `title` | no | The document heading. Defaults to `Handoff`. |
| `schema_version` | no | The payload contract this caller was written against. Must be `1` when present, and is echoed in the normalized payload. |

A required field with nothing confirmed is supplied as `""`, `null`, an empty
array, or omitted; every one of those renders the placeholder under a heading
that is still present. `yes` above means the heading is always rendered, not
that the payload must carry the field. Any field name not in the table is
rejected rather than dropped.

Field constraints, all of which are `malformed_payload` when broken:

| Field | Constraint |
| --- | --- |
| `title` | One line, at most 80 UTF-8 bytes and 80 characters, opening with a letter or digit, and otherwise letters, digits, spaces, and `' . , ( ) -`. |
| `slug` | Matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters. |
| `slug_source` | One line, at most 300 UTF-8 bytes, with at least one letter or digit. |
| Prose sections | Line endings normalized, trailing spaces stripped, no control character, no unpaired UTF-16 surrogate, at most 8000 UTF-8 bytes, no `#` or `##` heading outside a fence, no unterminated fence. |
| `artifacts_and_references[].reference` | One whitespace-free locator, at most 300 UTF-8 bytes, not ending in `:` or `=`. |
| `artifacts_and_references[].note` | One line, at most 300 UTF-8 bytes. |
| `suggested_skills[].skill` | Matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` and must not itself look like a credential. |
| `suggested_skills[].reason` | One line, at most 200 UTF-8 bytes, and required. |

## Schema

The document opens with `# <title>`, which is `# Handoff` unless the caller
supplied a title. Then these `##` headings, in exactly this order:

| Order | Heading | Payload field | Presence |
| --- | --- | --- | --- |
| 1 | `Goal` | `goal` | always |
| 2 | `Current Progress` | `current_progress` | always |
| 3 | `Decisions and Constraints` | `decisions_and_constraints` | always |
| 4 | `Artifacts and References` | `artifacts_and_references` | always |
| 5 | `What Worked` | `what_worked` | always |
| 6 | `What Didn't Work` | `what_did_not_work` | always |
| 7 | `Suggested Skills` | `suggested_skills` | only when supplied |
| 8 | `Next Steps` | `next_steps` | always |

`Goal`, `Current Progress`, `What Worked`, `What Didn't Work`, and `Next Steps`
keep their relative order, so a reader that knows only the five-section form
still finds what it expects.

## Content Rules

- A required section with nothing confirmed renders
  `No confirmed information yet.` Inventing content to fill a heading is worse
  than an honest gap.
- `Artifacts and References` renders one list item per reference,
  `- <locator> - <note>`, and the note is omitted when there is none.
- `Suggested Skills` renders `- <skill> - <reason>`. A suggestion without a
  reason is malformed input. When the caller supplies its available skills, a
  suggestion outside that set is `unknown_skill`, which is what stops an
  invented skill from reaching the next agent.
- `Suggested Skills` is **omitted entirely**, heading included, when no skill
  is supplied. An empty optional section is noise.
- A section body may not introduce a `#` or `##` heading of its own outside a
  fenced block. A body that emitted `## Next Steps` would leave the document
  disagreeing with the order promised above, and a reader scanning for the
  first `## Next Steps` would act on the wrong block. A `###` or deeper heading
  is fine.
- After rendering, the document's own `##` headings are compared with the
  headings this atom reports. A disagreement is a defect, not an output.

## Bounds

| Bound | Limit |
| --- | --- |
| One prose section | 8000 UTF-8 bytes |
| Artifact references | 50 entries, each locator and note at most 300 UTF-8 bytes |
| Suggested skills | 10 entries, each reason at most 200 UTF-8 bytes |
| One fenced block in a body | 20 lines and 2000 UTF-8 bytes |
| Whole document | 65536 UTF-8 bytes |
| Payload read by the entry point | 262144 UTF-8 bytes |

Exceeding a bound is malformed input, not a truncation. A handoff that no
longer fits is a handoff that is reproducing something it should reference.

## Output

The function returns both fields. The command line prints `document` alone.

| Field | Meaning |
| --- | --- |
| `document` | The rendered Markdown, ending in exactly one newline. |
| `headings` | The headings that were rendered, in order. |

## Failure Categories

A failure is one JSON object on standard error, `{"error": {"code", "reason",
"message"}}`, and the exit status is `1`. `reason` is always present and is
`null` for every category this atom reports.

| Category | Meaning |
| --- | --- |
| `usage` | The arguments or the payload source could not be understood. |
| `malformed_payload` | The payload broke a shape, bound, or constraint above. |
| `inlined_artifact_body` | A section body reproduced an artifact instead of referencing it. |
| `unknown_skill` | A suggestion named a skill outside `available_skills`. |
| `internal_error` | An unclassified defect in this atom. Report it. |

## Guarantees

- The heading order is fixed and does not depend on which fields were supplied.
- The reported headings are the headings the document actually carries.
- Line endings are normalized and trailing whitespace is removed, so the same
  input renders byte for byte the same document on every platform.
- An unknown payload field is rejected rather than silently dropped.
- A suggested skill identifier that a redaction rule would rewrite is rejected
  at validation, so the rendered identifier is always the exact one supplied.

## Boundaries

This atom does not gather context, redact, choose a destination, write, or
judge whether the handoff is good enough to hand off.

In particular, **this atom does not redact.** A caller that renders directly,
rather than through the `persist-bounded-handoff` molecule, renders exactly the
text it supplied.

Portions of this schema are adapted from Matt Pocock's `handoff` skill under
the MIT license. The complete notice is preserved in the Attribution section of
the `persist-bounded-handoff` molecule.
