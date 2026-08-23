---
name: roast-artifact-branch
description: Run the shared coordinate-and-synthesize roast for one agent, prompt, or skill package, resolving every artifact-type difference from one profile so the three types share a single contract, failure reference, and lens reference.
level: molecule
includes: ["_base/_atoms/agent-resolve/agent-resolve.md","_base/_atoms/doctrine-evaluate/doctrine-evaluate.md","_base/_molecules/roast-coordinate-review/roast-coordinate-review.md","roast/_atoms/roast-contract/roast-contract.md","roast/_atoms/roast-failure-recovery/roast-failure-recovery.md","roast/_atoms/roast-trusted-lenses/roast-trusted-lenses.md"]
composes: ["_base/_atoms/agent-resolve/agent-resolve.md","_base/_atoms/doctrine-evaluate/doctrine-evaluate.md","_base/_molecules/roast-coordinate-review/roast-coordinate-review.md","roast/_atoms/roast-contract/roast-contract.md","roast/_atoms/roast-failure-recovery/roast-failure-recovery.md","roast/_atoms/roast-trusted-lenses/roast-trusted-lenses.md"]
used-by: ["roast/SKILL.md"]
allowed-tools: ["execute","read","search","task"]
---

# Artifact Branch

Roast one agent definition, one prompt, or one skill package.

These three artifact types share one coordination shape: resolve a trusted
coordinator, stage bounded evidence, convene mandatory and triggered roasters
against declared lenses, validate one envelope, and synthesize one
severity-ranked list of recommendations. What differs between them is small:
the artifact noun, the two mandatory roasters, the scope paragraph, the
specialist triggers, and a handful of status sentences.

That difference is data, not structure. It lives in the artifact profile, and
this branch resolves it once per run. Nothing here forks by type.

## Required References

1. [Roast contract](../../_atoms/roast-contract/roast-contract.md)
2. [Failure reporting and recovery](../../_atoms/roast-failure-recovery/roast-failure-recovery.md)
3. [Trusted lenses](../../_atoms/roast-trusted-lenses/roast-trusted-lenses.md)
4. [Agent resolve](../../../_base/_atoms/agent-resolve/agent-resolve.md)
5. [Doctrine evaluate](../../../_base/_atoms/doctrine-evaluate/doctrine-evaluate.md)
6. [Coordinate an Artifact Roast](../../../_base/_molecules/roast-coordinate-review/roast-coordinate-review.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `artifact-type` | yes | `agent`, `prompt`, or `skill`, as classified during intake. |
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
   allowed review root. For a pasted prompt, apply the supplied-text identity
   and retention rules the profile supplies, and retain the normalized text
   across both stateless coordinator invocations.

4. **Evaluate against the selected doctrine.** Supply the staged packet and the
   intake selectors to
   [Doctrine evaluate](../../../_base/_atoms/doctrine-evaluate/doctrine-evaluate.md).
   It verifies the manifest digest before loading anything and refuses on
   drift. Carry its findings, each already carrying a cited rule, a locator, a
   severity, and a confidence, into the coordinator's inputs as verified
   guidance rather than as evidence. When the manifest does not resolve, pass
   `Doctrine unavailable` with the reason and record the degraded state.

5. **Coordinate and synthesize.** Invoke
   [Coordinate an Artifact Roast](../../../_base/_molecules/roast-coordinate-review/roast-coordinate-review.md)
   with the verified coordinator document, the artifact type, the locator, the
   allowed review root, the rendered contract, the resolved lens sources, the
   doctrine input, model routing, repository context, and the complete
   coordinate-mode and synthesize-mode input sets the contract requires. That
   molecule owns coordination, envelope validation, exactly one retry,
   synthesis, and the unchanged return.

6. **Recover by status.** When the returned status is not `Complete`, apply the
   matching recovery action from
   [Failure reporting and recovery](../../_atoms/roast-failure-recovery/roast-failure-recovery.md).
   Every failure returns the Artifact Roast shape with a named status and a
   non-empty `## What Was Not Reviewed`. Never return a raw envelope or a bare
   status token.

## Output

One Artifact Roast, returned unchanged from synthesis, whose findings are a
severity-ranked list of recommendations. `blocker`, `major`, `minor`, and
`advisory` are severity categories only. This branch approves nothing, blocks
nothing, and returns no pass or fail verdict; a human decides what to act on.

## Guarantees

- One authored contract, one authored failure reference, and one authored lens
  reference serve all three artifact types. Adding a type is a profile row.
- No trusted source is loaded without a path check and a digest.
- No doctrine is loaded that intake did not select, and none is loaded at all
  when the manifest digest does not reproduce.
- The reviewed artifact is never invoked, executed, or edited.
- An empty findings section is reported as a real result when the status is
  `Complete`, and as an incomplete review otherwise.

## Boundaries

This branch is read-only. It never edits, creates, commits, publishes, or
comments, and it never applies a recommended fix.

It does not accept code-review scope. A pull request, a branch diff,
working-tree changes, named source files, or pasted code belong to the code
branch, which does not share this coordination shape.

Humor targets the artifact's role, routing, permissions, delegation, contracts,
and failure modes, never its author.
