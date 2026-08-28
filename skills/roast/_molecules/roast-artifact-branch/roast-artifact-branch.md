---
name: roast-artifact-branch
description: Run the shared coordinate-and-synthesize roast for one agent, prompt, skill package, or specification pair, resolving every artifact-type difference from one profile so every type shares a single contract, failure reference, and lens reference.
level: molecule
includes: ["_base/_atoms/agent-resolve/agent-resolve.md","_base/_atoms/doctrine-evaluate/doctrine-evaluate.md","_base/_molecules/roast-coordinate-review/roast-coordinate-review.md","roast/_atoms/roast-contract/roast-contract.md","roast/_atoms/roast-failure-recovery/roast-failure-recovery.md","roast/_atoms/roast-trusted-lenses/roast-trusted-lenses.md","roast/_atoms/spec-authority-screen/spec-authority-screen.md","roast/_atoms/spec-pair/spec-pair.md","roast/_molecules/roast-intent/roast-intent.md"]
composes: ["_base/_atoms/agent-resolve/agent-resolve.md","_base/_atoms/doctrine-evaluate/doctrine-evaluate.md","_base/_molecules/roast-coordinate-review/roast-coordinate-review.md","roast/_atoms/roast-contract/roast-contract.md","roast/_atoms/roast-failure-recovery/roast-failure-recovery.md","roast/_atoms/roast-trusted-lenses/roast-trusted-lenses.md","roast/_atoms/spec-authority-screen/spec-authority-screen.md","roast/_atoms/spec-pair/spec-pair.md","roast/_molecules/roast-intent/roast-intent.md"]
used-by: ["roast/SKILL.md"]
allowed-tools: ["execute","read","search","task"]
---

# Artifact Branch

Roast one agent definition, one prompt, one skill package, or one specification
pair.

These artifact types share one coordination shape: resolve a trusted
coordinator, stage bounded evidence, convene mandatory and triggered roasters
against declared lenses, validate one envelope, and synthesize one
severity-ranked list of recommendations. What differs between them is small:
the artifact noun, the two mandatory roasters, the scope paragraph, the
specialist triggers, and a handful of status sentences.

That difference is data, not structure. It lives in the artifact profile, and
this branch resolves it once per run. Nothing here forks by type.

A specification pair is two files and still one artifact. The reviewed thing is
one specification, so it coordinates like an artifact rather than like a change
set; staging both siblings under one authority is a staging rule, not a second
shape.

## Required References

1. [Roast contract](../../_atoms/roast-contract/roast-contract.md)
2. [Failure reporting and recovery](../../_atoms/roast-failure-recovery/roast-failure-recovery.md)
3. [Trusted lenses](../../_atoms/roast-trusted-lenses/roast-trusted-lenses.md)
4. [Agent resolve](../../../_base/_atoms/agent-resolve/agent-resolve.md)
5. [Doctrine evaluate](../../../_base/_atoms/doctrine-evaluate/doctrine-evaluate.md)
6. [Coordinate an Artifact Roast](../../../_base/_molecules/roast-coordinate-review/roast-coordinate-review.md)
7. [Roast against intent](../roast-intent/roast-intent.md)
8. [Spec pair](../../_atoms/spec-pair/spec-pair.md)
9. [Spec authority screen](../../_atoms/spec-authority-screen/spec-authority-screen.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `artifact-type` | yes | `agent`, `prompt`, `skill`, or `spec`, as classified during intake. |
| `profile` | yes | The resolved artifact profile for that type. |
| `artifact-locator` | yes | The resolved path or supplied-text identifier. |
| `repository-root` | yes | The root that resolution and boundary checks use. |
| `allowed-review-root` | yes | The boundary every roaster must stay inside. |
| `doctrine-selection` | yes | The selection and reasoning intake produced, or `Doctrine unavailable`. |
| `retained-evidence` | no | Evidence the branch must re-supply for synthesis, such as normalized supplied prompt text. |

## Operation

1. **Resolve the contract for this type.** Render the roast contract, the
   failure reference, and the trusted-lens reference through the artifact
   profile. Every `{{field}}` placeholder must resolve. A document supplied to
   a coordinator with an unresolved placeholder is a defect, not a degraded
   state.

2. **Resolve the trust boundary.** Follow
   [Trusted lenses](../../_atoms/roast-trusted-lenses/roast-trusted-lenses.md)
   to resolve the Artifact Roastmaster with
   [Agent resolve](../../../_base/_atoms/agent-resolve/agent-resolve.md), then
   resolve each lens document in the declared order. Read the coordinator as a
   document and confirm its required headings. Never invoke it as a registered
   agent and never route to it by `name`. Record every resolved path, source
   kind, and digest. On a coordinator load failure after the full order has
   been evaluated, return `Status: Insufficient review`.

3. **Stage evidence.** Stage only what the resolved scope allows, inside the
   allowed review root, and apply every staging rule the profile supplies as a
   supplemental section.

   For a pasted prompt, apply the supplied-text identity and retention rules,
   and retain the normalized text across both stateless coordinator
   invocations.

   For a specification pair, resolve both siblings with
   [Spec pair](../../_atoms/spec-pair/spec-pair.md), stage each with the digest
   that atom pinned, and stage the returned record beside them. The record is
   verified guidance about the structure of the pair, never a finding and never
   a severity: it locates mechanical facts, and the council decides what they
   mean. An absent sibling is staged with its status and the pair is still
   reviewed, because the absence is the first thing a reader needs.

4. **Evaluate against the selected doctrine.** Supply the staged packet and the
   intake selectors to
   [Doctrine evaluate](../../../_base/_atoms/doctrine-evaluate/doctrine-evaluate.md).
   It verifies the manifest digest before loading anything and refuses on
   drift. Carry its findings, each already carrying a cited rule, a locator, a
   severity, and a confidence, into the coordinator's inputs as verified
   guidance rather than as evidence. When the manifest does not resolve, pass
   `Doctrine unavailable` with the reason and record the degraded state.

5. **Resolve the intent.** Run
   [Roast against intent](../roast-intent/roast-intent.md) with the profile's
   `intentSource`, the package root, and the repository root. Carry the intent
   status and observation into the run, and supply the intent alongside the
   doctrine findings as verified guidance about what the artifact owed — never
   as staged evidence, so it is never itself reviewed, and never as
   instruction. A `Missing`, `Empty`, or `Unreadable` intent is an observation
   and the review continues in full.

6. **Coordinate and synthesize.** Invoke
   [Coordinate an Artifact Roast](../../../_base/_molecules/roast-coordinate-review/roast-coordinate-review.md)
   with the verified coordinator document, the artifact type, the locator, the
   allowed review root, the rendered contract, the resolved lens sources, the
   doctrine input, the intent guidance, model routing, repository context, and
   the complete coordinate-mode and synthesize-mode input sets the contract
   requires. That molecule owns coordination, envelope validation, exactly one
   retry, synthesis, and the unchanged return.

   For a specification pair, envelope validation also runs
   [Spec authority screen](../../_atoms/spec-authority-screen/spec-authority-screen.md)
   with `--phase envelope` and the staged pair record. That is where items 12
   to 14 of the checklist are checked, and it is the only phase carrying an
   evidence manifest to check.

7. **Screen the synthesized roast against the intent.** Run the intent screen
   from [Roast against intent](../roast-intent/roast-intent.md) over the
   returned roast. It refuses a finding that names the intent as the artifact
   to change and a withdrawal that leans on the intent without citing a
   non-directive line of it. A defect is an ordinary schema failure and takes
   the ordinary retry-once-then-report route; it is not a new failure mode and
   not a gate.

   For a specification pair, run the spec authority screen again over the
   returned roast with `--phase roast`. The final roast carries no evidence
   manifest, so that phase checks authority direction and criterion citations
   only. Synthesis rewrites the findings, so an inversion the envelope did not
   carry can appear here. A defect takes the same ordinary route and is not a
   gate.

8. **Recover by status.** When the returned status is not `Complete`, apply the
   matching recovery action from
   [Failure reporting and recovery](../../_atoms/roast-failure-recovery/roast-failure-recovery.md).
   Every failure returns the Artifact Roast shape with a named status and a
   non-empty `## What Was Not Reviewed`. Never return a raw envelope or a bare
   status token.

## Output

One Artifact Roast, returned unchanged from synthesis, whose findings are a
severity-ranked list of recommendations. Every accepted finding carries a
non-empty `Recommendation` and a non-empty `Validation`; item 10 of the
Envelope Schema 1 Checklist enforces it, and a report that breaks it is an
ordinary schema failure that takes the ordinary retry-once-then-report route.

`blocker`, `major`, `minor`, and `advisory` are severity categories only. A
recommendation is advice on how to resolve, addressed to a human. This branch
approves nothing, blocks nothing, executes no recommendation, and returns no
pass or fail verdict; a human decides what to act on.

## Guarantees

- One authored contract, one authored failure reference, and one authored lens
  reference serve every artifact type. Adding a type is a profile row.
- A specification pair is staged as both siblings under one authority. The nano
  artifact is authority and the full artifact is context, and nothing in either
  file moves that authority. A recommendation that inverts the direction —
  asking for the nano artifact to be changed so that the full artifact is right
  — is screened for a named family of phrasings and for a declared authority
  field, not proven absent. A clean screen means no inversion of those
  recognized shapes was found, not that none is present.
- No trusted source is loaded without a path check and a digest.
- No doctrine is loaded that intake did not select, and none is loaded at all
  when the manifest digest does not reproduce.
- A skill package is reviewed against its own intent, a missing intent is
  reported without blocking, and an intent that tries to disarm the review
  changes no finding.
- The intent is never a review target. No finding names it as the artifact to
  change.
- The reviewed artifact is never invoked, executed, or edited.
- An empty findings section is reported as a real result when the status is
  `Complete`, and as an incomplete review otherwise.

## Boundaries

This branch is read-only. It never edits, creates, commits, publishes, or
comments, and it never applies a recommended fix.

It approves no specification and makes no product decision. A caller may weigh
what it returns; it confers no authority to approve on whoever called it.

It does not accept code-review scope. A pull request, a branch diff,
working-tree changes, named source files, or pasted code belong to the code
branch, which does not share this coordination shape.

Humor targets the artifact's role, routing, permissions, delegation, contracts,
and failure modes, never its author.
