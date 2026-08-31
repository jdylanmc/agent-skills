---
name: product-design-evidence
description: Require validated approved product-design evidence when Discovery routed through product design, otherwise require an explicit non-applicability record.
level: atom
allowed-tools: ["execute"]
includes: ["spec/_atoms/product-design-evidence/product-design-evidence.mjs"]
composes: []
used-by: ["spec/_molecules/product-specification/product-specification.md"]
---

# Product-Design Evidence

## Required Files

1. [Product-design evidence validator](./product-design-evidence.mjs)

Every specification intake passes the primary exact-revision Discovery identity
with its subject, durable locator, and revision. The trusted Discovery adapter
reads the exact bytes; this atom verifies their digest, parses the foundation
schema, and derives the structured frontier route, applicability, and rationale.
Caller-supplied routing and free prose are never interpreted. Then mechanically
choose exactly one:

- `required`: rationale code `discovery-frontier-requires-product-design`,
  authoritative route `needs-product-design`, and the primary product-design
  packet, revalidated with trusted human-event, specialist-event, provider,
  repository-identity, git-ancestry, and merged-byte adapters; or
- `not-applicable`: rationale code `discovery-frontier-ready-for-spec`,
  authoritative route `ready`, and no product-design packet.

Free-prose non-applicability is invalid. A trusted `needs-product-design` route
can never validate as `not-applicable`.

A hand-authored `approved` result object is never evidence. The surrounding
workflow supplies the primary packet and the same trusted adapters used at the
product-design boundary; this atom independently recomputes the result.

Required evidence must name the same Discovery subject and exact revision,
carry the selected concept, concept/walkthrough identities, artifact-set and
interaction-contract digests, merge revision and change-request identity, and
the nonauthority marker. Validated output carries the normalized exact contract
path, digest, exact bytes, parsed validated contract content, concept IDs, and
walkthrough IDs. Spec consumes that returned safe evidence and never rereads a
caller packet. Anything except `approved` is refused.

The normalized result also carries the selected runnable concept root,
entrypoint, untrusted human-run command, owned artifact paths, digest, and exact
merged-byte verification. This proves what evidence was reviewed; it does not
make the runnable prototype or command authoritative or safe to execute.

This atom admits observable product evidence only. It does not make prototype
code, Storybook, dependencies, data shape, components, or architecture
authoritative, and it does not alter Spec's existing approval authority.
