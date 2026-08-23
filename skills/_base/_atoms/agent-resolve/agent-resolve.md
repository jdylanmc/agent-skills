---
name: agent-resolve
description: Resolve one agent document by name from the standard locations, verify it structurally, and return its path and digest. Never searches outside the declared order.
level: atom
allowed-tools: ["read", "search", "execute"]
includes: []
composes: []
used-by: ["roast-this-agent/references/30-trusted-lenses.md","roast-this-prompt/references/30-trusted-lenses.md","roast-this-skill/references/30-trusted-lenses.md"]
---

# Agent Resolve

Find one agent document by name, prove it is safe and complete enough to use,
and return where it is. This atom owns resolution and verification. It owns
nothing about what the agent is for or what is done with it afterwards.

Resolution is a fixed, declared order. An agent that is not at one of those
locations does not exist for this purpose. Searching more widely is how a
process ends up loading a document an attacker placed.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `agent-name` | yes | The bare name, such as `ste-coach` or `artifact-roastmaster`. |
| `repository-root` | yes | The declared root that the search order resolves against. |
| `required-headings` | no | Headings the document must contain, each outside every fenced block, for it to count as complete. |
| `expected-digest` | no | A digest the resolved file must match. Supply it only for a file whose content is pinned; omit it for a file that changes independently. |

## Operation

Evaluate the locations **in order**, and evaluate each one fully before moving
on:

1. `agents/<agent-name>.agent.md`, from `repository-root`;
2. `.github/agents/<agent-name>.agent.md`, from `repository-root`.

For each candidate in turn:

1. Confirm it exists, is a **regular file and not a symbolic link**, and that its
   resolved path stays inside `repository-root`.
2. Compute its SHA-256 digest.
3. When `expected-digest` is supplied, compare and reject on mismatch.
4. When `required-headings` is supplied, confirm each appears outside every
   fenced block. A document missing one is incomplete, and incomplete is a
   candidate failure rather than a usable result.
5. On success, return that candidate's path and digest immediately.
6. **On any failure, record the candidate and its reason, and continue to the
   next location.**

Return a failure only after **every** location has been evaluated and failed.

A candidate that exists but is corrupt, truncated, or structurally invalid must
never shadow a valid candidate later in the order. Stopping at the first
filesystem match would let a damaged primary suppress a perfectly good
alternate, which is the opposite of what a fallback order is for.

`Digest unavailable` is the one exception: it is a capability failure of the
runtime rather than of a candidate, so it fails the whole resolution
immediately. Trying another path cannot supply a digest that the runtime cannot
compute.

## Output

| Field | Meaning |
| --- | --- |
| `status` | `Resolved` or a named failure. |
| `path` | The resolved path, when `Resolved`. |
| `digest` | The computed SHA-256 digest, when `Resolved`. |
| `attempted` | Every location tried, each with its outcome and, on failure, its reason. |

Failure categories: `Not found`, `Not a regular file`, `Path escapes root`,
`Digest mismatch`, `Missing required heading`, `Digest unavailable`.

## Guarantees

- **Never searches outside the declared order.** No globbing, no walking upward,
  no following a path supplied by reviewed content.
- **A failed candidate never shadows a later valid one.** Every location is
  evaluated before resolution fails.
- A symbolic link is refused rather than resolved.
- `Digest unavailable` is a failure, not a silent skip, and it fails the whole
  resolution rather than one candidate. A caller that needs a trust boundary
  cannot have one without a digest.
- A document that resolves but is missing a required heading is reported as a
  candidate failure, so a caller never runs a truncated or wrong document.
- `attempted` is always populated, including on success, so a caller can record
  which location supplied the document and why any earlier one was rejected.

## Boundaries

This atom does not read the document into instructions, spawn anything, or
decide what to do when resolution fails. It returns a path and a digest.
