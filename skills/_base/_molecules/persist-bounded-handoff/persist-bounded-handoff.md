---
name: persist-bounded-handoff
description: Turn confirmed caller context into one bounded, redacted handoff document, write it beneath the operating-system temporary directory, verify it by rereading, and return its exact path. Composes artifact referencing, redaction, rendering, temporary-path resolution, and guarded writing.
level: molecule
includes: ["_base/_atoms/artifact-reference/artifact-reference.md","_base/_atoms/handoff-render/handoff-render.md","_base/_atoms/redact-sensitive/redact-sensitive.md","_base/_atoms/temp-path-resolve/temp-path-resolve.md","_base/_atoms/write-guarded/write-guarded.md","_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs"]
composes: ["_base/_atoms/artifact-reference/artifact-reference.md","_base/_atoms/handoff-render/handoff-render.md","_base/_atoms/redact-sensitive/redact-sensitive.md","_base/_atoms/temp-path-resolve/temp-path-resolve.md","_base/_atoms/write-guarded/write-guarded.md"]
used-by: ["handoff/SKILL.md"]
allowed-tools: ["execute"]
---

# Persist a Bounded Handoff

Take context a caller has already confirmed and turn it into one bounded
handoff document that a fresh agent can act on: redacted, referenced rather
than duplicated, written beneath the operating system's own temporary
directory, reread, and reported by its exact path.

This molecule owns the artifact. It owns nothing about where the context came
from. Every caller keeps its own adapter, because the context a human
conversation can confirm and the context a timed-out worker can confirm are not
the same context.

A handoff is a **bounded continuation artifact**. It is not a transcript, a
memory system, a tracker, or a general persistence framework.

## Required References

1. [Artifact reference](../../_atoms/artifact-reference/artifact-reference.md)
2. [Sensitive content redaction](../../_atoms/redact-sensitive/redact-sensitive.md)
3. [Handoff rendering](../../_atoms/handoff-render/handoff-render.md)
4. [Temporary path resolution](../../_atoms/temp-path-resolve/temp-path-resolve.md)
5. [Guarded verified write](../../_atoms/write-guarded/write-guarded.md)

## Required Files

1. [Shared validation, redaction, rendering, and write implementation](./persist-bounded-handoff.mjs)

## Inputs

The caller supplies one bounded JSON payload of **confirmed** context.

| Field | Required | Meaning |
| --- | --- | --- |
| `slug` | one of | The already-normalized repository or work slug the file name is built from. Validated against `^[a-z0-9]+(?:-[a-z0-9]+)*$` and never rewritten. |
| `slug_source` | one of | The raw repository or work name, normalized here by the exported `slugify`. Supply this **or** `slug`, never both. |
| `goal` | yes | What the work is for. |
| `current_progress` | yes | Where the work actually stands. |
| `decisions_and_constraints` | yes | Decisions already made and constraints the next agent must respect. |
| `artifacts_and_references` | yes | Locators for evidence that already exists elsewhere. |
| `what_worked` | yes | Approaches that produced results. |
| `what_did_not_work` | yes | Approaches that failed, and why. |
| `next_steps` | yes | What the next agent should do. |
| `suggested_skills` | no | Exact skill identifiers and the reason for each. Omitted when no skill usefully follows. |
| `available_skills` | no | The caller's real skill identifiers. When supplied, a suggestion outside the set is refused. |
| `title` | no | The document heading. Defaults to `Handoff`. |
| `schema_version` | no | The payload contract the caller was written against. Must be `1` when present, and is echoed in the normalized payload so a caller can assert what it got. |

A required field with nothing confirmed is supplied empty and renders
`No confirmed information yet.` Never fill a section by inventing a decision, a
test result, a commit, a pull request, an owner, or a next step.

The complete field shapes and constraints are in
[Handoff rendering](../../_atoms/handoff-render/handoff-render.md), which this
molecule validates with the same implementation.

### The Slug

The file name is built from a slug, and there is exactly one normalization for
it. An adapter never writes its own.

- Hold a raw repository or work name - `Acme.Widgets`, `Ship_With_Squadron`,
  `users/dylanmccurry/fix-queue` - and pass it as `slug_source`. It is
  lowercased, every run of other characters becomes one hyphen, leading and
  trailing hyphens are dropped, and the result is cut to 64 characters:
  `acme-widgets`, `ship-with-squadron`, `users-dylanmccurry-fix-queue`. A name
  holding no letters or digits at all is `malformed_payload`.
- Hold an already-normalized slug and pass it as `slug`. It is validated and
  never rewritten, so a caller that computed the name itself is told when the
  name is wrong instead of receiving a different file than it expected.
- A caller inside this runtime may use the exported `slugify` directly; it is
  the same function `slug_source` applies.

Supplying both is `malformed_payload`. The two forms are alternatives, not a
fallback chain, because a silent preference between them is a silent choice of
file name.

### Bounds

Every bound is a refusal, never a truncation, so an adapter can size its input
before it calls rather than discovering a limit afterwards.

| Input | Bound |
| --- | --- |
| One prose section | 8000 UTF-8 bytes |
| One fenced block inside a section | 20 lines and 2000 UTF-8 bytes |
| `artifacts_and_references` | 50 entries |
| One `reference` locator, one `note` | 300 UTF-8 bytes each |
| `suggested_skills` | 10 entries |
| One suggestion `reason` | 200 UTF-8 bytes |
| `title` | 80 UTF-8 bytes |
| `slug` | 64 characters |
| `slug_source` | 300 UTF-8 bytes before normalization |
| Text handed to one redaction call | 65536 UTF-8 bytes |
| The rendered document | 65536 UTF-8 bytes |
| The payload an entry point reads | 262144 UTF-8 bytes |

A handoff that no longer fits is a handoff reproducing something it should be
referencing.

## Operation

```text
node <molecules>/persist-bounded-handoff.mjs (--payload <file> | --stdin)
```

| Input | Required | Meaning |
| --- | --- | --- |
| `--payload` | one of | A file holding the JSON payload. |
| `--stdin` | one of | The JSON payload on standard input. |
| `--probe` | no | Prints `persist-bounded-handoff: available` and exits `0`. |

Exactly one payload source is supplied; both or neither is `usage`. Exit `0`
prints the [Output](#output) fields as one JSON object on standard output. Any
non-zero exit prints one JSON failure object on standard error and writes
nothing.

The composed operation runs in this order, and the order matters:

1. **Validate and bound** the payload, including the reference and body rules
   from [Artifact reference](../../_atoms/artifact-reference/artifact-reference.md). An unknown
   field is rejected rather than dropped, and a body that would introduce its
   own document or section heading is rejected before rendering.
2. **Redact** every text field with
   [Sensitive content redaction](../../_atoms/redact-sensitive/redact-sensitive.md), so nothing
   the floor **recognizes** reaches the renderer. The floor is a pattern match,
   not a guarantee: a secret with no recognizable shape, a customer name, or an
   internal host name passes straight through, and removing those stays the
   caller's obligation. The title is redacted with the sections; a suggested
   skill identifier is rendered verbatim, so one that a rule would rewrite is
   rejected at validation instead.
3. **Render** with [Handoff rendering](../../_atoms/handoff-render/handoff-render.md), then
   confirm the rendered document is already clean. Redaction is idempotent, so
   a second finding is a defect here rather than in the caller's content.
4. **Resolve** the destination with
   [Temporary path resolution](../../_atoms/temp-path-resolve/temp-path-resolve.md).
5. **Write and verify** with
   [Guarded verified write](../../_atoms/write-guarded/write-guarded.md), passing the resolved
   directory as the allowed root.
6. **Retry only a taken name.** When the write reports that the target exists,
   with reason `target_exists`, resolve a fresh name and write again, at most
   five times. Every other failure is returned unchanged; nothing is retried
   into success.

## Output

Exit `0` prints these fields as one JSON object on standard output.

| Field | Meaning |
| --- | --- |
| `path` | The exact absolute path that was written and verified. Report this to the caller and record it. |
| `directory` | The single temporary child directory that holds it. |
| `name` | The file name. |
| `bytes` | The verified size in UTF-8 bytes. |
| `headings` | The headings rendered, in order. |
| `redactions` | The redaction categories applied and how many spans each replaced. |
| `suggested_skills_included` | Whether the optional section was rendered. |

## Failure Categories

A failure is one JSON object on standard error and the exit status is `1`:

```json
{
  "error": {
    "code": "unsafe_target",
    "reason": "target_exists",
    "message": "..."
  }
}
```

`code` and `reason` are the contract; `message` is for a human reading a log.
`reason` is always present and is `null` unless the category carries a
discriminator. Nothing is ever written on a failure, and no partial file is
left behind.

| Category | Caller-correctable | Meaning and what to do |
| --- | --- | --- |
| `usage` | yes | The arguments were not understood, or neither or both payload sources were supplied. Fix the invocation. |
| `malformed_payload` | yes | The payload broke a shape, bound, or constraint: an unknown field, a missing or malformed slug, an over-long section, a control character, an unpaired UTF-16 surrogate, an unterminated fence, a locator carrying prose or ending in `:` or `=`, a suggestion with no reason, or a document that outgrew its bound. The message names the field. |
| `inlined_artifact_body` | yes | A section body reproduced an artifact instead of referencing it. Replace the block with a locator in `artifacts_and_references`. |
| `unknown_skill` | yes | A suggestion named a skill outside `available_skills`. Suggest a real skill or omit the section. |
| `redaction_incomplete` | no | The rendered document still matched a redaction rule after redaction. Redaction is idempotent and complete in one pass, and the one seam a caller could reach - a locator ending in a separator - is refused during validation instead, so this is a defect in this core rather than in the caller's content. Report it with the payload; do not retry. |
| `temp_unavailable` | no | The runtime reported a temporary directory that does not resolve or is not a directory. An environment fault. |
| `unsafe_temp_root` | partly | The `handoffs` child exists with a shape this core refuses: a symbolic link, a non-directory, or a directory owned by another user or writable by group or others. See [Recovering from `unsafe_temp_root`](../../_atoms/temp-path-resolve/temp-path-resolve.md#recovering-from-unsafe_temp_root). |
| `name_exhausted` | no | Every candidate name was taken, either 100 within one second or 5 write attempts in a row. Something else is filling the directory. |
| `path_escape` | no | The resolved destination was not directly inside the resolved root. A defect here, never caller input. |
| `unsafe_target` | no | The destination or its parent has a refused shape. Only `"reason": "target_exists"` is retryable, and this molecule already retries it internally. |
| `write_failed` | no | The file could not be created or written. Nothing partial remains. |
| `verification_failed` | no | The reread did not match what was sent. The created file is removed. |
| `internal_error` | no | An unclassified defect. Report it with the message. |

A caller-correctable failure is one the adapter can answer by changing what it
sends. Everything else is an environment fault or a defect, and retrying it
repeats it.

## Destination Contract

`<os-temp>/handoffs/<repository-or-work-slug>-<UTC timestamp>.md`

- The temporary root is whatever the runtime reports, never a hard-coded path.
- Exactly one `handoffs` child directory is used.
- The file name is collision-resistant and UTC, so two handoffs in the same
  second do not overwrite each other.
- **No caller asks where to save.** There is no filename, destination,
  visibility, or placement question anywhere in this contract, and nothing is
  written into the workspace.

## Composition

| Concern | Owner |
| --- | --- |
| Keeping locators and refusing reproduced artifact bodies | [artifact-reference](../../_atoms/artifact-reference/artifact-reference.md) |
| Replacing secrets, credentials, and personal information with visible markers | [redact-sensitive](../../_atoms/redact-sensitive/redact-sensitive.md) |
| The heading schema, its order, and the optional section | [handoff-render](../../_atoms/handoff-render/handoff-render.md) |
| The runtime temporary root, its single child, and a collision-resistant name | [temp-path-resolve](../../_atoms/temp-path-resolve/temp-path-resolve.md) |
| Target safety, exclusive creation, and reread verification | [write-guarded](../../_atoms/write-guarded/write-guarded.md) |
| Step order, retry on a taken name, and the reported result | This molecule |
| Shared validation, bounds, and the persisted document | `persist-bounded-handoff.mjs` |

`persist-bounded-handoff.mjs` is this molecule's local implementation, named
after the molecule. Every atom entry point calls into it, so the rules are
validated by one implementation rather than five drifting copies.

## Guarantees

- The heading order is stable, and `Suggested Skills` is the only section that
  may be absent.
- The reported headings are the headings the written document carries.
- Nothing is written outside the runtime's temporary directory, and no earlier
  handoff is overwritten.
- The temporary child directory is created before it is inspected and belongs
  to the current user alone, so a pre-created directory on a shared temporary
  root cannot capture a handoff.
- Every reported path was reread and compared before it was reported.
- A failure is a named category, never a partial file and never a silent
  success.
- Redaction is idempotent, so a document that is redacted twice is the same
  document, and a marker is never nested inside another marker.

## Boundaries

This molecule does not gather context, decide what is confirmed, judge whether
the work should stop, invoke a next skill, notify anyone, or clean up earlier
handoffs. It holds no control state, so a caller's own state machine, approval
gates, and delivery authority are unaffected by anything here.

**Redaction is a floor, not a guarantee.** The rules match recognizable shapes,
so a secret carrying no shape a pattern can see, a customer name in a sentence,
or an internal host name that matters all reach the document unchanged. The
caller supplying the context is responsible for removing those **before** it
calls, and this molecule cannot check that it did. It is also eager on purpose:
`token: bounded` in prose is redacted, and the answer is to rewrite the
sentence rather than to weaken the rule.

It is non-routable and records nothing. The routable skill that composes it
owns Chronicle recording, and one failed handoff is an outcome that skill
records, not a run this molecule owns.

## Consumers

Two consumers are approved and named in discovery cycle `c-0009`: the
human-facing Handoff skill supplies conversation and next-session focus, and
Ship with Squadron supplies timeout and control-state context through its own
adapter. Both compose this molecule; neither reimplements rendering, redaction,
path selection, or writing.

## Regression Suite

From the repository root, run:

```text
node --test skills/_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.test.mjs \
  skills/_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.adversarial.test.mjs
```

The adversarial suite covers malformed payloads, name collisions, redaction
evasion and idempotence, markers beside brackets and beside each other,
camel-case and unseparated secret keys, unpaired UTF-16 surrogates, prose that
merely ends in a secret word, adversarial redaction input, heading injection,
the omitted optional section, path escape, symbolic links, a shared temporary
child, non-regular targets, and the structured failure a command-line caller
reads. Keep it passing: each case is a way a handoff quietly stops being
trustworthy.

## Attribution

Portions of the temporary-path placement, argument-tailored focus,
reference-not-duplication, redaction, and suggested-skills behavior are adapted
from Matt Pocock's `handoff` skill, <https://github.com/mattpocock/skills>.

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The five-section continuation structure is a generic handoff pattern. This unit
deliberately does not conduct a destination-selection interview.
