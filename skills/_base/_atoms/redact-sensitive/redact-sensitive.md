---
name: redact-sensitive
description: Replace secrets, credentials, and personally identifiable information with explicit redaction markers, idempotently, so a reader can see that something was removed.
level: atom
allowed-tools: ["execute"]
includes: ["_base/_atoms/redact-sensitive/redact-sensitive.mjs"]
composes: []
used-by: ["_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
---

# Sensitive Content Redaction

Remove sensitive spans from text and leave a visible marker where each one was.
This atom owns the deterministic floor. It owns nothing about what the text is
for or where it will be stored.

Deleting a secret silently produces a document that reads as if the secret was
never there, which is how an incomplete handoff gets mistaken for a complete
one. Every replacement here is announced.

## Required Files

1. [Redaction entry point](./redact-sensitive.mjs)

## Operation

```text
node <atoms>/redact-sensitive.mjs (--file <path> | --stdin)
```

| Input | Required | Meaning |
| --- | --- | --- |
| `--file` | one of | A file holding the text to redact. |
| `--stdin` | one of | The text on standard input. |
| `--probe` | no | Prints `redact-sensitive: available` and exits `0`. |

Exactly one text source is supplied; both or neither is `usage`. Exit `0`
prints `text` and `redactions` as JSON. `redactions` counts the spans this call
actually changed, grouped by category. Any non-zero exit prints one JSON
failure object on standard error.

## Markers

Every replacement is `[REDACTED:<category>]`:

| Category | What it replaces |
| --- | --- |
| `private-key` | A PEM private-key block, header and body and footer. |
| `credential` | A `Bearer` or `Basic` authorization value, and a cloud access-key identifier. |
| `token` | A recognizable provider token or a JSON Web Token. |
| `secret` | The value of an assignment whose key names a secret. |
| `email` | An electronic mail address. |
| `phone` | A telephone number written with separators or a country code. |

A key names a secret when either tier below recognizes it. The keyword may sit
anywhere in the key, so `secret_key`, `accessToken`, `dbPassword`, `signingKey`,
`PGPASSWORD`, and a bare `key` are all covered.

**Whole words.** The key is split on separators, on a camel-case boundary, and
on a letter-to-digit boundary, so `access_token`, `accessToken`, `AccessToken`,
`ACCESS_TOKEN`, and `oauth2Token` all yield the word `token`. A key naming any
of `password`, `passwords`, `passwd`, `pwd`, `passphrase`, `secret`, `secrets`,
`token`, `tokens`, `key`, `keys`, `apikey`, `apikeys`, `accesskey`,
`accountkey`, `privatekey`, `clientsecret`, `connectionstring`, `credential`,
`credentials`, `sas`, `sig`, `signature`, `authorization`, `auth`, or `pat` is
a secret.

`pass` is recognized the same way, but only when the key holds more than one
word, so `DB_PASS`, `MYSQL_PASS`, and `userPass` are secrets while a sentence
about a second `pass:` is not.

**Compounds.** The key is stripped to letters and digits and searched for
`password`, `passwd`, `passphrase`, `credential`, `apikey`, `apitoken`,
`accesskey`, `accesstoken`, `accountkey`, `authtoken`, `bearertoken`,
`clientsecret`, `connectionstring`, `encryptionkey`, `idtoken`, `masterkey`,
`privatekey`, `refreshtoken`, `secretkey`, `securitytoken`, `sessiontoken`,
`sharedaccesssignature`, `signingkey`, or `sshkey`. This tier exists for the
forms that carry no boundary at all, such as `PGPASSWORD` and `AWSSECRETKEY`,
so every entry is long and specific enough that containing it is evidence.

The two tiers are deliberately different. A short word such as `key`, `sig`, or
`pat` is only ever matched whole, which is what keeps `monkeys`, `design`,
`assign`, `path`, `patch`, `author`, and `keyboard` out of the rule.

## Rules

- A value is replaced; the key that named it stays, so a reader can tell which
  secret was present.
- An unquoted value ends at whitespace or at punctuation that carries
  structure, so a link, a list item, or a sentence around the value survives
  intact.
- A key and its value are on **one line**. The separator carries spaces and
  tabs, never a line break, so `password: hunter2` is recognized and a
  `password:` whose value sits on the next line is not. This is a deliberate
  trade, and it is the safer one: a line after `key:` is nearly always a
  nested bullet or a wrapped sentence, and pairing them replaces the bullet
  marker or the first word - `- Auth:` above `  - uses Entra ID` would become
  `- Auth:` above `  [REDACTED:secret] uses Entra ID` - which destroys the
  list and tells the reader a credential was removed from a line that never
  held one. Put a credential and the key that names it on one line, or
  neither is recognized.
- An electronic mail address is found by anchoring on `@` and walking out from
  it, so two addresses joined by a character such as `_` or `+` are both
  replaced in a single pass, and a span whose domain cannot be an address
  never hides a real address behind it.
- An assignment nested inside another one is still found. `https://host/x?token=...`
  matches first with the key `https`, which names nothing; scanning resumes
  inside it and redacts the `token`.
- The floor is **eager on purpose**. `token: bounded` in ordinary prose is
  redacted. Rewrite the sentence rather than weakening the rule.
- A reference of the form `git@host:owner/repo` is read as an address and
  redacted. Use the HTTPS form of a remote in a reference.
- A commit identifier, a version, a port range, and an issue number are not
  redacted.
- Input is limited to 65536 UTF-8 bytes. Redaction is a bounded scan, not a
  log filter.
- The entry point reads at most 262144 UTF-8 bytes before the bound above is
  applied.

## Guarantees

- **Idempotent.** Redacting already-redacted text returns the same text and
  reports no further replacements. A marker is never relabelled, re-bracketed,
  or nested. This holds by construction: every rule runs only on the spans
  **between** existing markers, never on a marker and never across one, so
  neither a key nor a value can run into `[REDACTED:` and find its colon.
  `secrets[a@b.example]` becomes `secrets[[REDACTED:email]]` and stays there.
- **Complete in one pass.** Every span a second pass would replace is replaced
  by the first, so a caller that redacts once has not left something behind
  for a caller that redacts twice.
- Every replacement is visible as a marker. Nothing is deleted quietly.
- The categories are stable names a caller can report and a test can assert.

## Failure Categories

A failure is one JSON object on standard error, `{"error": {"code", "reason",
"message"}}`, and the exit status is `1`. `reason` is always present and is
`null` for every category this atom reports.

| Category | Meaning |
| --- | --- |
| `usage` | The arguments were not understood, or the text source could not be read. |
| `malformed_payload` | The input was not a string, or exceeded the bound above. |
| `internal_error` | An unclassified defect in this atom. Report it. |

## Boundaries

This atom is a floor, not a guarantee of safety. Pattern matching cannot see a
secret that carries no recognizable shape, a customer name in a sentence, or an
internal host name that matters. **The caller is still responsible for the
content it supplies** and must remove what patterns cannot recognize before
calling.

This atom does not render, write, classify a document, or decide whether a
redacted document is fit to share.
