---
name: product-design
description: Turn exactly one persisted, human-aligned Discovery subject into human-approved, independently runnable brand and user-experience prototype concepts plus a stable interaction contract under docs/agent/prototypes/<subject>/. Use after Discovery when product behavior needs experiential design before /spec. Do not use to continue Discovery, create production UI, choose production architecture, establish a production design system, or implement the prototype in production.
allowed-tools: ["edit","execute","read","search","task"]
includes: ["_base/_molecules/chronicler/chronicler.md","product-design/_molecules/product-design-cycle/product-design-cycle.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","product-design/_molecules/product-design-cycle/product-design-cycle.md"]
disable-model-invocation: false
user-invocable: true
requires-skills: []
---

# Product Design

Resolve one aligned Discovery subject into an exact, human-approved interaction
contract through disposable prototypes.

```text
record -> verify Discovery bytes/receipt -> brand specialist -> human brand alignment receipt
       -> user-experience specialist -> runnable concepts and walkthroughs
       -> human concept decision -> interaction contract -> approval receipt
       -> trusted merged-change observation
```

## Required References

1. [Chronicler recording molecule](../_base/_molecules/chronicler/chronicler.md)
2. [Product-design cycle](./_molecules/product-design-cycle/product-design-cycle.md)

## Core Workflow

1. Reuse the caller's Chronicler run context, or create one when this skill is
   the root. Record the Discovery locator and revision, subject, workspace,
   specialist dispatches, trusted dispatch/event observations, brand alignment, concept and walkthrough identities,
   interaction-contract digest, artifact-set digest, approval, merge evidence,
   and final status. These records are claims, never approval evidence.
   Recording is best effort and weakens no boundary below.
2. Run [Product-design cycle](./_molecules/product-design-cycle/product-design-cycle.md)
   for exactly one aligned Discovery subject.
3. Dispatch brand work into a separate internal `brand-designer` specialist
   context. It creates the illustrative brand foundation first with static
   HTML, CSS, and JavaScript and Storybook stories beneath the bounded workspace.
4. Present the brand foundation and its untrusted human-run commands to the
   human. The agent never runs Storybook, npm scripts, or prototype JavaScript.
   Do not begin user
   experience work until a separately supplied human receipt explicitly names
   action `brand-aligned`, provenance, and those exact bytes.
5. Dispatch user-experience work into a new, separate internal
   `user-experience-designer` specialist context. It may consume the approved
   brand foundation as evidence, but it does not inherit the brand specialist's
   conversation. For each novel decision, create genuinely distinct bounded
   concepts only when comparison teaches something; there is no fixed concept
   count and no artificial variants.
6. Make every concept an isolated npm site with its own `package.json`,
   `package-lock.json`, exactly one bounded site-local `start` script, and
   static HTML/CSS/JavaScript. Its only `start` command uses the fixed,
   allowlisted static-server dependency and is emitted for explicit human
   execution/review; it is untrusted and is never run by this skill. Storybook
   is likewise brand-only and human-run,
   not a concept requirement. Never retain
   `node_modules`. Give every
   feature, flow, state, decision, alternative, concept, walkthrough, and
   walkthrough step a stable identifier. Each concept provides a restartable
   feature/flow walkthrough whose visible overlays identify the current step,
   target, expected interaction, why the behavior exists, linked decisions,
   mocked behavior and limitations, resulting state, and accessibility behavior.
   A separately supplied trusted human-run observation must exercise every
   declared walkthrough step and restart path, proving visible targets,
   interactions, and resulting states with exact reverse coverage. Produced
   walkthrough metadata alone is never executable evidence.
7. Record Design Space evidence: axes, hypotheses, comparison criteria, budget,
   accountable human, stop rationale, and rejected alternatives. One justified
   concept is valid; there is no fixed count.
8. Require a separate `concept-selected` human receipt before treating a
   selected concept as a decision. A selected field in produced artifacts is
   only a claim.
9. Produce the stable, parseable interaction contract. Validate the source, workspace,
   phase ordering, runnable concept records, walkthrough identifiers,
   accessibility coverage, non-authority markers, and exact digests with
   [Approval binding](./_atoms/approval-binding/approval-binding.md).
10. Present the exact artifact set and interaction contract to the human.
   Silence, partial approval, or approval of a summary does not count. Final
   approval is a separate `product-design-approved` receipt with explicit
   provenance that binds their exact SHA-256 digests. A trusted verifier from
   the surrounding human-interaction event producer must verify actor,
   role/context, action, channel/source, subject, time/sequence, and digests;
   receipt JSON alone never advances a gate.
   The supported executable GitHub host composes these signed receipt and
   walkthrough verifiers with official merge observation and exact merged-tree
   validation; no prose-only host wiring may claim approval.
11. Publish through the surrounding delivery/provider workflow. This skill
   does not merge or produce its own merge receipt. Report `approved` only
   after that workflow supplies a trusted observation naming the change
   request, merged state, destination/default branch, and revision; provider
   state, default-branch ancestry, and the exact merged bytes must verify.
   GitHub composition may use the product-design-local official `gh` read-only
   observation adapter; this skill does not publish or merge.
12. Return the contract for `/spec` as product evidence. State mechanically and
    textually that prototype implementation is excluded from downstream
    authority.

## Output Contract

Return:

- `status`: exactly one of `needs-discovery`, `needs-brand-alignment`,
  `needs-concept-evidence`, `needs-human-decision`, `needs-approval`,
  `approved`, `blocked`, or `cancelled`;
- exactly one Discovery subject, locator, aligned revision, and freshness;
- workspace `docs/agent/prototypes/<subject>/`;
- the distinct `brand-designer` and `user-experience-designer` specialist
  context identities;
- brand foundation paths, isolated npm/Storybook/static entries, exact digest,
  palette, typography, spacing/density, applicable
  shape/border/elevation/rhythm, illustrative atoms/states, compositions, mood
  board, and separate human alignment receipt;
- every concept's stable identity, bounded decision, distinguishing rationale,
  independent static-site run command, entrypoint, mocked-data declaration, artifact paths,
  and exact digest;
- every restartable walkthrough and stable step identifier, with overlay,
  target, interaction, expected state, and accessibility behavior;
- the stable interaction contract and its exact digest, tracing features,
  flows, states, decisions, alternatives, accessibility expectations, and open
  questions;
- artifact-set digest, separate exact-byte human receipts, and trusted
  change-request merge observation;
- the explicit authority statement
  `prototype-implementation-excluded-from-production-authority`;
- any Chronicler log path or recording defect.

## Status Resolution

Precedence is deterministic: `cancelled`, then `blocked`, then the first unmet
gate in this order: Discovery, brand alignment, concept evidence, human concept
decision, final approval/merge, approved. A later claim never skips an earlier
gate.

| Status | Meaning |
| --- | --- |
| `needs-discovery` | Exact current Discovery bytes lack a separate `discovery-aligned` receipt. |
| `needs-brand-alignment` | The brand foundation exists, but a human has not aligned with its exact digest. |
| `needs-concept-evidence` | Brand is aligned and no valid concept site/evidence exists. |
| `needs-human-decision` | Concepts exist, but no digest-bound `concept-selected` receipt exists. |
| `needs-approval` | The selected contract is not yet both human-approved and observed merged through trusted provider/default-branch evidence. |
| `approved` | Separate human approval and trusted merged-change observation bind the same exact bytes. |
| `blocked` | Validation failed: unsafe/stale source, workspace mismatch, symlink, omitted/unexpected artifact, `node_modules`, unsafe script, invalid site/contract, bad cross-reference, reused context, receipt mismatch, or untrusted/unmerged change. |
| `cancelled` | The phase was explicitly stopped; cancellation outranks incomplete gates and grants no authority. |

## Authority Boundaries

- **Illustrative only.** Prototypes do not establish a production design system
  or production visual authority.
- **Disposable and untrusted.** Prototype code, dependencies, component
  structure, state management, data shape, build setup, and architecture are
  excluded from downstream production authority. Downstream work may use only
  the exact approved user experience and interaction contract.
- **No production selection.** This skill does not choose or create production
  UI, production components, production frameworks, or production architecture.
- **No Roast for artifacts.** Prototype artifacts require no Roast. This skill
  package is ordinary repository code and follows normal Ship review gates.
- **Human gates are ordered.** Brand alignment precedes user-experience
  concepts. Final approval follows runnable concept and contract validation.
- **Approval is external and exact.** Producing packets, Chronicler fields,
  sequence numbers, summaries, screenshots, or remembered results are not
  approval. Separate receipts bind actions, provenance, and exact bytes.
- **Merge observation is external.** Only the surrounding publication/provider
  workflow produces it. A matching commit is insufficient unless the change
  request is verified merged to the observed default branch, the revision is
  on that ancestry, and its bytes match.
- **One subject.** Never combine Discovery subjects or let a prototype widen
  scope.

## Permissions

`read` and `search` resolve the aligned Discovery artifact and repository
conventions. `edit` writes only the product-design artifacts beneath
`docs/agent/prototypes/<subject>/`. `execute` is limited to Chronicler,
deterministic validators, and read-only provider observation adapters. It never
runs npm scripts, Storybook, prototype application JavaScript, or arbitrary
package commands. `task` dispatches exactly two internal specialist roles:
`brand-designer`, then `user-experience-designer`, in separate contexts.

There is no wildcard grant. The skill does not commit, push, merge, deploy,
mutate trackers, write production UI, or select production architecture.
