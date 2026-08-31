---
name: interaction-contract
description: Preserve the approved experience as a stable contract tracing features, flows, states, decisions, alternatives, accessibility expectations, and open questions without carrying prototype implementation authority.
level: atom
allowed-tools: ["edit"]
includes: []
composes: []
used-by: ["product-design/_molecules/product-design-cycle/product-design-cycle.md"]
---

# Interaction Contract

Write one stable, parseable `product-design-interaction-contract/v1` JSON
record beneath the subject workspace. Validation reads the exact contract
bytes, not a parallel caller summary. It directly carries:

- subject and prototype revision, Discovery revision, brand revision, and
  selected concept;
- features with visible behavior and rules;
- flows with ordered states, visible behavior, and rules;
- observable states, including loading, empty, error, permission, recovery, and
  boundary states where applicable;
- walkthrough-to-feature/flow/step mappings;
- product decisions and rationale;
- alternatives considered, including every rejected nonselected concept and
  equivalent design-space alternative, with concept identity when applicable,
  decision link, disposition, and why it lost;
- structured accessibility expectations for keyboard, focus, semantics,
  contrast, reduced motion, resizing, and applicable error/state
  communication, each with separate typed feature, flow, state, walkthrough,
  and step identifier coverage;
- mocked behavior and limitations;
- assumptions and contradictions;
- unresolved/open questions, including explicit empty lists.

Every reference resolves against its own typed identifier set: features cannot
stand in for flows, states, decisions, alternatives, walkthroughs, or steps.
Contract walkthrough mappings exactly cover and agree with the corresponding
concept walkthrough mappings. The contract names the concept and revisions that
demonstrate each entry. Contract alternatives exactly cover the typed concept
alternative IDs, decision links, dispositions, and rationales. Contract
accessibility records each map exactly one concept accessibility evidence ID
and reproduce its category, typed coverage, and expectation.
It states:

```text
prototype-implementation-excluded-from-production-authority
```

Only observable behavior and the exact approved experience cross into `/spec`.
HTML, CSS, JavaScript, Storybook configuration, components, libraries, data
models, and prototype architecture do not.
