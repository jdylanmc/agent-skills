---
name: intent-synthesis
description: Turn what the operator said into clean plain-English requirements in the shape the existing intent files take, keeping rationale at the human level and refusing any structural or machine-facing detail.
level: atom
allowed-tools: ["read","execute"]
includes: ["create-skill/_atoms/intent-synthesis/intent-synthesis.mjs"]
composes: []
used-by: ["create-skill/_molecules/intent-capture/intent-capture.md"]
---

# Intent Synthesis

The operator supplies the meaning. This turns it into prose he would recognise
as his own, only tidier.

## Required References

1. [Structural screen](./intent-synthesis.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `transcript` | yes | The operator's own words, verbatim. |
| `skill-name` | yes | The skill the intent belongs to. |
| `coverage` | yes | The completed coverage assessment and its quoted evidence. |

## Write It as Plain Requirements

An intent is plain English requirements from a human, and nothing else. It opens
`# Intent: <skill>` and continues in sections of ordinary prose: what the skill
is for, why it exists, what it must do, what it must refuse, and the judgement
worth preserving. Existing intent files differ from one another in their
headings, and that is allowed; the shape is a family resemblance rather than a
template.

Write what the operator meant, more clearly than he said it, and put nothing
there that he did not mean. Keep his distinctions, keep his examples, and keep
the thing he was annoyed about, because that is usually the requirement. Cut the
repetition, the false starts, and the tangent that went nowhere.

## Record Rationale at the Human Level

The most valuable content is why a non-obvious decision was made, and it is the
first thing lost. Rationale written about today's arrangement of the code does
not survive into a library arranged differently.

| Not intent | Intent |
| --- | --- |
| The code branch does not share the review coordinator. | Reviewing a set of code changes is not the same job as reviewing one artifact. |
| Selection refuses when the artifact type is ambiguous. | A review against the wrong standard is worse than one that declines to start. |

Both rows describe the same decision. Only the right column regenerates.

The same rule governs what is left out. Testing strategy does not belong here:
doctrine says how software is built, including how it is tested, and intent says
what the skill must do. A regenerating model reads both and decides.

## The Screen Refuses Structure

The screen is mechanical, and it refuses rather than warns:

```text
node <atoms>/intent-synthesis/intent-synthesis.mjs --screen "$absolute_draft_path" --skill "$skill"
```

Exit `0` accepts the draft, `2` names every offending line with its kind, and
`1` is a usage or path failure. Both arguments are required: an omitted skill
name would leave the title check doing nothing while still reporting success.
It refuses a leading frontmatter block, a
field-and-meaning table, a machine-facing section heading, the names of this
repository's frontmatter fields, the vocabulary of how packages are cut into
parts, repository paths and script names, and tooling detail such as exit codes
or serialization formats.

Its vocabulary is deliberately narrow: every term in it is one that plain
English about a problem has no reason to use, which is why hand-written intent
prose passes untouched. Resolve a refusal by saying the same thing about the
problem instead of about the machinery. Never by disabling the screen.

## Output

| Field | Meaning |
| --- | --- |
| `draft` | The synthesized intent, ready to be shown to the operator. |
| `screen_status` | `plain`, or the structural lines that stopped it. |
| `shape` | `well-formed`, or what the draft is missing. |

## Guarantees

- The synthesis says what the operator meant, in plain words.
- Rationale is recorded at a level that survives regeneration.
- No stored intent carries frontmatter, a schema, or structural implementation
  vocabulary.
- No template is imposed beyond a title and sections.

## Boundaries

- This atom drafts. It does not confirm the draft with the operator and does not
  store it; a synthesis is a guess until he says otherwise.
- It does not invent an answer to a question the operator did not answer. An
  unanswered topic stays a gap.
- It does not describe the package it is about to build.
