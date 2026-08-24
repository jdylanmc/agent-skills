---
name: artifact-reference
description: Keep an artifact reachable by locator and refuse a reproduced artifact body, so a bounded document points at evidence instead of duplicating it.
level: atom
allowed-tools: ["execute"]
includes: ["_base/_atoms/artifact-reference/artifact-reference.mjs"]
composes: []
used-by: ["_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
---

# Artifact Reference

Keep the pointer to an artifact and refuse the artifact's body. This atom owns
the difference between the two. It owns nothing about which artifacts matter.

A specification, a plan, an Architecture Decision Record, an issue, a commit,
and a diff already exist and are already authoritative. Copying one into a
second document creates a second version that starts drifting immediately, and
the copy is the one the next reader trusts.

## Required Files

1. [Reference check entry point](./artifact-reference.mjs)

## Operation

```text
node <atoms>/artifact-reference.mjs (--payload <file> | --stdin)
```

| Input | Required | Meaning |
| --- | --- | --- |
| `--payload` | one of | A file holding the JSON payload. |
| `--stdin` | one of | The JSON payload on standard input. |
| `--probe` | no | Prints `artifact-reference: available` and exits `0`. |

The payload is `{"references": [...], "bodies": {"<field>": "<text>"}}`. Both
fields are optional; any other field name is rejected. Exactly one payload
source is supplied; both or neither is `usage`. Exit `0` prints the normalized
`references` and the `bodies_checked`. Any non-zero exit prints one JSON
failure object on standard error.

## Reference Shape

A reference is either a locator string or `{"reference": "...", "note": "..."}`.

| Field | Required | Meaning |
| --- | --- | --- |
| `reference` | yes | One whitespace-free locator: a URL, a repository-relative path, `#123`, or a commit. At most 300 UTF-8 bytes. |
| `note` | no | One short line saying why the artifact matters. At most 300 UTF-8 bytes. |

Prose belongs in `note`, never in `reference`. A locator with whitespace is
rejected, which is what keeps a reference machine-checkable rather than a
sentence that happens to contain a link.

A locator must also not end in `:` or `=`. A reference is rendered next to its
note as `- <reference> - <note>`, so one ending in a separator reads as an
assignment formed with the join, which no consumer intended and which a caller
cannot recover from once the document exists. A locator ends at the resource.

At most 50 references are accepted.

A payload is read at up to 262144 UTF-8 bytes, and each checked body is held to
8000 UTF-8 bytes.

## Body Exclusion

A checked body may hold a short command or snippet. It may not hold a fenced
block longer than 20 lines or 2000 bytes; that is `inlined_artifact_body`, and
the fix is a reference. An unterminated fenced block is malformed input, not a
body to measure.

## Output

| Field | Meaning |
| --- | --- |
| `references` | The normalized references, in the order supplied. |
| `bodies_checked` | The names of the bodies that passed, sorted. |

## Failure Categories

A failure is one JSON object on standard error, `{"error": {"code", "reason",
"message"}}`, and the exit status is `1`. `reason` is always present and is
`null` for every category this atom reports.

| Category | Meaning |
| --- | --- |
| `usage` | The arguments or the payload source could not be understood. |
| `malformed_payload` | The payload, a reference, or a body broke a shape or a bound above. This includes an unterminated fence and an unpaired UTF-16 surrogate. |
| `inlined_artifact_body` | A body reproduced an artifact. The category names the field, so the caller knows what to replace with a link. |
| `internal_error` | An unclassified defect in this atom. Report it. |

## Guarantees

- Every supplied reference survives. Exclusion applies to bodies, never to
  pointers.
- A reproduced artifact is refused with a category that names the field, so the
  caller knows exactly what to replace with a link.
- The check is pure: nothing is fetched, resolved, or written.

## Boundaries

This atom does not verify that a locator resolves, does not decide which
artifacts are worth referencing, and does not summarize an artifact it refused.
A locator is the caller's claim; this atom only keeps it in a shape that a
reader and a test can both follow.
