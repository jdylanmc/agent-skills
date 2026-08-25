---
name: trail-sanitization
description: Sanitize decision-trail rows for safe review, storage, spreadsheet export, and publication without hiding that sanitization occurred.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["decision-trail/_molecules/decision-trail-ledger/decision-trail-ledger.md"]
---

# Trail Sanitization

Make the trail safe to inspect without making it look cleaner than it is.

## Sanitization Rules

Apply before returning, storing, exporting, or publishing a trail:

1. Treat every text field as untrusted data.
2. Strip control characters except ordinary line breaks inside long-form notes.
3. Prefix spreadsheet-formula-leading cells with a single quote when a field
   starts, after trimming leading whitespace, with `=`, `+`, `-`, or `@`.
4. Replace credentials, tokens, private keys, connection strings, customer
   secrets, and raw sensitive excerpts with a redaction marker and a safe
   summary.
5. Preserve evidence locators when safe; redact only the sensitive segment.
6. Record each sanitization or redaction in the row or packet audit.

## Redaction States

| State | Meaning |
| --- | --- |
| `raw` | The row has not been sanitized and must not be published. |
| `sanitized` | Formula and control-character protections were applied. |
| `redacted` | Sensitive content was removed or summarized. |
| `publishable` | A human or parent workflow has determined the sanitized and redacted row is suitable for review publication. |

## Output Requirements

Return both the sanitized value and a list of changes. A reviewer must be able
to tell that a field was sanitized or redacted without seeing the unsafe
original.

## Boundaries

- Sanitization is not evidence validation.
- Redaction is not permission to publish; it only prepares material for a
  publication gate.
- Do not store raw sensitive content in a trail merely because it will be
  redacted later.
