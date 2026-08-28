---
name: context-artifacts
description: Render one normalized repository context into the exact bytes of issue-tracker.md, domain.md, and triage-labels.md with their content hashes, prove the machine-resolvable identity round-trips back to the context, guarantee the tracker-adapter resolution contract is satisfied inside the render, and expose a bounded provenance helper callers can run on foreign bytes to check they carry no identity the context did not supply.
level: atom
allowed-tools: ["execute"]
includes: ["setup-repository/_atoms/context-artifacts/context-artifacts.mjs"]
composes: []
used-by: ["setup-repository/_molecules/repository-configuration/repository-configuration.md"]
---

# Context Artifacts

Render one normalized context into the three configuration files a later skill
reads, and nothing else.

```text
context -> render three artifacts -> hash -> verify adapter contract
```

The output is repository configuration, not a template copied from another
repository. It is a pure function of the context: the same context produces
byte-identical files, so a regenerated artifact with no diff is proof nothing
changed rather than a coincidence.

## Required Files

1. [Rendering, parsing, hashing, and provenance helper](./context-artifacts.mjs)

## Artifacts

`renderArtifacts(context)` returns three entries in stable order, each with a
repository-relative `path` under the context's `targetDirectory`, the exact
`content`, and its `sha256`.

| File | Carries |
| --- | --- |
| `issue-tracker.md` | provider, host, organization, project, repository, default branch, item types, tracker operations, relationship kinds, mutation vocabulary, label vocabulary, and state vocabulary |
| `domain.md` | the repository product and domain identity and pointers to authoritative vocabulary |
| `triage-labels.md` | the labels and their meanings, the item types, and the workflow states with their meanings |

Rendering never emits a timestamp, run identifier, random value, absolute path,
or account name. Those are exactly the values that would make two runs over one
context disagree, and a configuration that changes without its inputs changing
cannot be trusted as configuration.

The label vocabulary and state vocabulary are the same shape: each is a named
term paired with what it means. `triage-labels.md` prints both alongside the
item types, so a human reader sees the same vocabulary the machine block in
`issue-tracker.md` resolves.

## Target Directory Safety

`validateTargetDirectory(rawDirectory)` refuses an absolute POSIX or Windows
path, a drive-qualified prefix (`C:\...`), a UNC prefix (`\\server\share`), a
NUL byte, and any path that normalizes above the repository root. A rewrite
would silently place output somewhere the operator did not name; the atom
refuses instead. The write gate observes the same rules a second time as
defense in depth.

## The Machine-Resolvable Grammar

The identity a downstream tracker adapter reads does not live in prose. It
lives in two fenced blocks whose fences carry an exact grammar name.

| File | Fence | Purpose |
| --- | --- | --- |
| `issue-tracker.md` | ` ```tracker-adapter-v1 ` | tracker identity and vocabulary |
| `domain.md` | ` ```domain-identity-v1 ` | product and domain identity |

Every line inside a fenced block has the form `field = <json>`, and every value
is JSON-encoded. A pipe, newline, comma, or backtick inside a value cannot
break the row or merge two entries: a real newline is encoded as `\n`, a real
quote is escaped, and the delimiter characters of Markdown tables are inert
inside JSON. An absent scalar is the JSON literal `null`, which is distinct
from a value literally named `"none"`.

`parseIssueTracker(rendered)` and `parseDomain(rendered)` are the counterparts
to the renderers: they parse the fenced block back into the same typed shape
the projection helpers return. `renderArtifacts` round-trips its own output
through those parsers on every call and throws
`ContextArtifactsError('round-trip-failed', ...)` rather than emitting bytes
it cannot read back. That closes the loop: every artifact this atom writes is
one its own parser can resolve.

## The Tracker-Adapter Contract

`issue-tracker.md` exists so a downstream tracker adapter can resolve its
configuration without guessing. `TRACKER_ADAPTER_CONTRACT` is the frozen list
of fields the adapter must be able to read: provider, host, organization,
project, repository, default branch, item types, tracker operations,
relationship kinds, mutation vocabulary, label vocabulary, and state
vocabulary. The label and state vocabularies are non-empty arrays of
`{ name, meaning }` entries.

`verifyAdapterContract(renderedIssueTrackerContent)` returns
`{ satisfied, missing }`, with `missing` ordered by
`TRACKER_ADAPTER_CONTRACT`. Every required scalar must be a non-null string
and every required list must be non-empty. The project field obeys a provider
rule: only `azure-devops` carries a project layer and requires a concrete
project string. Every other supported provider resolves `project` to the JSON
literal `null`. Unparseable content reports every field missing rather than
letting a broken artifact pass partially. `renderArtifacts` runs this check
before returning and refuses to emit bytes that leave any contract field
unresolved, so the guarantee is that the adapter never falls back to
inference — inference is the guessing this whole package removes.

**Residual limitation — the contract is producer-owned until #117 exists.**
The `backlog-publish` skill referenced by acceptance criterion 9 is issue
#117 and does not exist in this repository yet, so no real downstream
consumer can be tested against. The atom therefore evidences criterion 9 by
demonstrating that the rendered bytes are sufficient for a consumer: the
regression suite includes a consumer-perspective test that reads the
rendered `issue-tracker.md` text and parses it with an INDEPENDENT reader
written in the test — importing nothing from this atom except the published
`TRACKER_ADAPTER_CONTRACT` constant — and confirms every contract field is
resolvable for all four provider classes without inference. Once #117 lands,
its real adapter resolver should replace or complement the consumer test.

## Identity Provenance

`verifyProvenance(artifacts, context)` is a PUBLIC HELPER for validating
FOREIGN bytes — bytes a caller obtained from somewhere other than a fresh
`renderArtifacts` call, such as a persisted file, a transported blob, or a
payload from another process. It returns `{ ok, violations }`. It:

1. confirms each artifact's bytes are the pure render of the context, so an
   appended comment or a tampered field is a violation;
2. parses each identity position back out of the fenced identity blocks and
   confirms it equals the corresponding context value, so a value changed
   inside a block is a violation;
3. renders each artifact TWICE from sentinel contexts using two different
   sentinel prefixes, strips the sentinels from both renders, and asserts the
   remaining bytes are byte-identical between the two. That proves the only
   byte positions that depend on identity values are the sentinelled
   positions, so the identity flow is positional;
4. scans the sentinel-neutralized skeleton for the finite
   `FORBIDDEN_LITERALS` set as a backstop against a small number of
   known-dangerous host names bleeding between provider configurations.

`renderArtifacts` deliberately does NOT invoke `verifyProvenance` from
its own body. Every artifact it just produced is byte-identical to
`RENDERERS[name](context)` by construction, so its byte-equality and
identity-projection checks cannot fail from that call site — re-running
them there would prove nothing. Rendering is bounded by the round-trip
check and by `verifyAdapterContract`; `verifyProvenance` is opt-in for
callers that need to check bytes whose origin is not a fresh render.

**Residual limitation — bounded, not exhaustive.** The check does not prove
the fixed template skeleton is free of *arbitrary* hardcoded identities.
Step 4 is a finite denylist, not an allowlist, and an identity such as
`acme-private` hardcoded in the template would survive the sentinel
substitution and not appear in `FORBIDDEN_LITERALS`. Step 3 proves only that
any hardcoded identity would appear at the SAME byte positions in both
sentinel renders — it does not identify those positions as illegitimate. A
positive template allowlist would be sound but is out of scope for this
atom, and the documentation therefore claims only the four finite checks
above.

`findForeignIdentities(rendered, context)` remains as defense in depth. It
flags any forbidden identity literal present in the bytes that the context
does not itself carry.

## Boundaries

- Rendering is pure. It reads a context and returns bytes; it writes no file
  and touches no tracker.
- Output is derived only from the supplied context. `verifyProvenance` is
  exposed as an opt-in helper for callers checking FOREIGN bytes and proves
  the identity flow is positional and that the finite `FORBIDDEN_LITERALS`
  set is absent from the neutralized skeleton, within the bounds stated in
  Identity Provenance above; it does not prove the template skeleton is
  free of an arbitrary hardcoded identity outside that set.
- Every rendered artifact round-trips through its own parser before it is
  emitted. Bytes the parser cannot resolve are refused, not written.
- The adapter contract is verified inside `renderArtifacts`, not assumed. A
  rendered `issue-tracker.md` that leaves a contract field unresolved is
  refused rather than emitted.
- `renderArtifacts` refuses a context whose `labels` or `states` carry an
  entry with a null `name` or `meaning`. An unresolved context is not
  renderable; the caller must settle it before rendering.
- Placement is repository-relative under the context's `targetDirectory`.
  Deciding the write is safe, and performing it, belong to the write gate.
