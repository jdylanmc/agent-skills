---
name: ux-concepts
description: Explore genuinely distinct bounded user-experience concepts in a separate specialist context, with independently runnable mocked prototypes and restartable overlay walkthroughs.
level: atom
allowed-tools: ["edit","task"]
includes: []
composes: []
used-by: ["product-design/_molecules/product-design-cycle/product-design-cycle.md"]
---

# User-Experience Concepts

Only after exact-digest brand alignment, dispatch a new internal
`user-experience-designer` specialist context. It must not be the brand
specialist context.

For each unresolved novel product decision, decide whether comparison would
teach something. When it would, create genuinely distinct bounded concepts
whose differences express real alternatives. Do not target a fixed count,
duplicate a concept cosmetically, or create artificial variants. When one
concept is sufficient, explain why alternatives would not add information.

Every concept:

- has a stable concept identity and names the decision it explores;
- records `selected` or `rejected` disposition, a rationale, and the stable
  decision ID that explains why it won or lost; every nonselected concept is
  explicitly rejected rather than disappearing from the record;
- states what distinguishes it from the alternatives;
- is an isolated npm site with its own package manifest and lockfile,
  static HTML/CSS/JavaScript, and exactly one bounded site-local `start`
  command using the fixed allowlisted static-server dependency; concepts do not
  require or carry Storybook. The command is emitted as untrusted for explicit
  human execution/review and is never run by the agent;
- uses mocked data and no production service or personal data;
- remains inside the subject workspace;
- carries structured, typed concept evidence for keyboard, focus, semantics,
  contrast, reduced-motion, text resizing, error/state communication, and
  other applicable accessibility expectations. Every record has a stable ID, typed feature,
  flow, state, walkthrough, and step coverage, a concept-owned artifact path,
  and an observable target. A required category must bind at least one
  selected-concept feature, flow, state, walkthrough, or step. A category may
  be `not-applicable` only with its defined bounded rationale code and no
  behavior references;
- includes a restartable walkthrough for every feature and flow.

Each concept records Design Space axes, hypotheses, comparison criteria,
exploration budget, accountable human, stop rationale, and typed alternatives
with stable IDs, linked decision IDs, a defined `selected`, `rejected`, or
`retained` disposition, and rejection/selection rationale. One justified
concept with an empty alternatives list is valid; no fixed count is required.
The final interaction contract preserves every rejected nonselected concept as
a typed alternative, plus every equivalent non-concept design-space
alternative, with the same decision link and why it lost.

Every walkthrough and step has a stable identifier. Each step names the next
stable step (or explicitly ends), so the walkthrough actually navigates its
ordered path. Restart uses a named, accessible control with stated focus
behavior and returns to the declared initial state. A visible overlay
identifies the step, target, interaction, why the behavior exists, linked
decisions, mocked behavior and limitations, expected resulting state, and
accessibility behavior. The
walkthrough is an explanatory layer over the concept, not hidden narration.

Prototype implementation is disposable and untrusted. Component boundaries,
libraries, state management, data structures, and architecture are not
recommendations for production.
