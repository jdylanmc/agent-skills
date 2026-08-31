---
name: approval-binding
description: Validate product-design phase ordering, bounded runnable artifacts, interaction coverage, and exact-byte human approval and merge evidence.
level: atom
allowed-tools: ["execute"]
includes: ["product-design/_atoms/approval-binding/approval-binding.mjs","product-design/_atoms/approval-binding/approval-binding.github.mjs","product-design/_atoms/approval-binding/approval-binding.receipts.mjs"]
composes: []
used-by: ["product-design/_molecules/product-design-cycle/product-design-cycle.md"]
---

# Approval Binding

## Required Files

1. [Approval binding validator](./approval-binding.mjs)
2. [GitHub merge observation adapter](./approval-binding.github.mjs)
3. [Append-only receipt verifier adapters](./approval-binding.receipts.mjs)

Use the deterministic helper to validate the product-design packet:

```text
node <atoms>/approval-binding.mjs --root <absolute-repository-root> \
  --input <absolute-packet-json-path> --evidence <absolute-external-evidence-json-path>
```

The helper resolves a real nonsymlink repository/workspace, safely enumerates
every file beneath `docs/agent/prototypes/<subject>/`, rejects symbolic links
and `node_modules`, and requires the declared manifest to equal that complete
enumeration. Canonical ordering compares Unicode code units directly and never
uses locale-dependent sorting. It parses and validates the exact interaction
contract bytes.

Human receipts, trusted specialist dispatch events, and the merge observation
are separate evidence input, never fields the producing packet may author.
Receipt strings are claims until a trusted human-event adapter re-observes or
cryptographically verifies them. The real producer boundary is the surrounding
workflow's authenticated human-interaction/event system, not this repository or
the packet author. Its injected verifier binds actor, role/context, action,
channel, source event, subject, exact action-specific digests, observed time,
and monotonic sequence. The trusted dispatch runtime similarly verifies role,
distinct context identity, exact artifact revision, channel/source, time, and
phase order. The full trusted causal order is strict: brand completion, brand
alignment, user-experience start, user-experience completion, concept
selection, final approval, provider `mergedAt`. Trusted timestamps increase at
every pair; producer sequences also increase whenever their producer channel
makes them comparable. GitHub uses the provider's actual `mergedAt`, never
local observation time.

The surrounding publication/provider workflow owns merge observation. For
GitHub, `approval-binding.github.mjs` resolves repository identity from the
canonical `origin` remote and no-argument `gh repo view`, then uses official
read-only `gh pr view`. It exports a verifier and a trusted repository resolver.
The validator compares the observation with that independently resolved
identity, so a fork carrying the same commit cannot approve. Composed callers
inject those adapters plus git ancestry and merged-blob reads into
`validateApprovalBinding`. The standalone approval command has no
trusted human or dispatch adapter and therefore fails closed; mere JSON cannot
advance a gate.

The required host interface injects all of
`verifyHumanReceipt`, `verifySpecialistObservation`,
`verifyMergeObservation`, `resolveExpectedRepository`, `verifyGitAncestry`,
and `readMergedArtifact`. Missing functions fail closed. A host with an
externally produced signed, digest-chained local receipt stream may wire
`createHumanReceiptVerifier` and `createSpecialistEventVerifier` from
`approval-binding.receipts.mjs`. Those deterministic adapters verify the
configured trusted public key, stream identity, monotonic sequence, previous
envelope digest, payload digest, envelope digest, and exact event bytes. They
authenticate only the surrounding runtime's append-only envelope provenance;
they do not claim the skill can authenticate a human. Merge wiring uses
`createGitHubMergeVerifier` and `createGitHubRepositoryResolver`, plus the
host's ancestry and merged-blob readers.

It refuses:

- a missing, symlinked, escaping, or stale Discovery source;
- a workspace outside the subject destination;
- reused brand and user-experience specialist contexts;
- user-experience work that began before exact-digest brand alignment;
- incomplete isolated npm/Storybook/static brand sites or isolated npm static
  concept sites, unexpected or lifecycle scripts, Node/preload/eval/custom
  server commands, dependencies, devDependencies, optionalDependencies, or
  peerDependencies absent from the complete lockfile closure, non-exact
  declarations, non-`registry.npmjs.org` resolution, missing integrity,
  unreachable/extra lock records, shared or nested roots/files, weak brand
  Storybook records, external/absolute/traversing/dynamic Storybook imports or
  globs, or concept-local Storybook configuration/stories,
  or retained `node_modules`;
- a concept without mocked data, its own human-run command and entrypoint, stable
  identifiers, structured per-category accessibility evidence linked to
  concept-owned artifact paths and observable targets, typed alternatives, or
  a restartable overlay walkthrough;
- any nonselected concept without an explicit rejected disposition, rationale,
  decision link, and exact interaction-contract alternative record;
- duplicate concept, walkthrough, or step identifiers;
- a user-experience completion event that does not bind the canonical revision
  recomputed from all concept-owned artifact bytes and concept metadata;
- paths outside the workspace, missing/omitted/unexpected files, symlinks, or
  declared file digests that disagree with bytes;
- a contract missing direct revision, behavior/rule, mapping, accessibility,
  decision, alternative/rejection, mocked limitation, assumption,
  contradiction, unresolved-question, or nonauthority fields;
- any authority marker other than
  `prototype-implementation-excluded-from-production-authority`;
- self-authored approval/sequence claims, unverified human receipts, fabricated
  specialist contexts, out-of-order events, or evidence with mismatched actor,
  role/context, action, channel/source, subject, revision, concept, exact
  digests, observed time, or sequence;
- merge observations that are untrusted, unmerged, name another change request
  or destination, do not target the observed default branch, fail ancestry
  verification, or whose revision lacks the exact approved bytes.

There is no required concept count beyond one valid result and no maximum. The
helper enforces structural distinction through unique stable identities and
decision/rationale records; whether concepts are genuinely distinct remains a
human product-design judgement.

Return only the canonical statuses `needs-discovery`,
`needs-brand-alignment`, `needs-concept-evidence`, `needs-human-decision`,
`needs-approval`, `approved`, `blocked`, or `cancelled`. Precedence is
`cancelled`, validation failure (`blocked`), then the first unmet gate in the
listed lifecycle order. Return the normalized workspace, artifact-set digest,
interaction-contract digest, concept and walkthrough identities, and exact
approval and merge binding.

The helper observes and validates. It does not approve, commit, push, merge,
publish, or grant prototype implementation authority.
