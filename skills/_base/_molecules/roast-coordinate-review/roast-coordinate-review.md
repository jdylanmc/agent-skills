---
name: roast-coordinate-review
description: Coordinate one artifact roast from already resolved trusted inputs, validate the unchanged envelope, retry coordinate exactly once on failure, synthesize a valid envelope, and return the roast unchanged.
level: molecule
includes: ["_base/_atoms/agent-spawn/agent-spawn.md","_base/_atoms/review-validate-report/review-validate-report.md"]
composes: ["_base/_atoms/agent-spawn/agent-spawn.md","_base/_atoms/review-validate-report/review-validate-report.md"]
used-by: ["roast-this-agent/SKILL.md","roast-this-prompt/SKILL.md","roast-this-skill/SKILL.md"]
allowed-tools: ["task"]
---

# Coordinate an Artifact Roast

Coordinate and synthesize one Artifact Roast after the calling skill has
resolved the artifact, trust boundary, coordinator, lenses, doctrine, and
artifact-specific contract. This molecule owns the common orchestration. It
does not decide what may be reviewed.

## Required References

1. [Agent spawn](../../_atoms/agent-spawn/agent-spawn.md)
2. [Review validate report](../../_atoms/review-validate-report/review-validate-report.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `coordinator-document` | yes | The resolved and verified Artifact Roastmaster document. |
| `artifact-type` | yes | The exact type required by the caller's roast contract. |
| `artifact-locator` | yes | The caller-resolved artifact locator or supplied-text identifier. |
| `allowed-review-root` | yes | The boundary the coordinator and every roaster must stay inside. |
| `artifact-contract` | yes | The artifact-specific roast contract, including its Envelope schema 1 checklist. |
| `lens-sources` | yes | Resolved lens documents with source kinds and verified digests. |
| `doctrine-input` | yes | The verified doctrine manifest path or `Doctrine unavailable` with the reason. |
| `model-routing` | yes | The caller's model defaults and fallbacks. |
| `repository-context` | yes | Applicable repository instructions and sibling conventions. |
| `coordinate-inputs` | yes | Artifact-specific coordinate-mode inputs that this molecule must pass unchanged. |
| `synthesize-inputs` | yes | Artifact-specific synthesize-mode inputs that this molecule must pass unchanged. |
| `retained-evidence` | no | Evidence the caller must re-supply for synthesis, such as normalized supplied prompt text. |

All inputs are caller-owned facts. The molecule may arrange them into a run
prompt but may not infer, broaden, normalize, repair, or replace them.

## Operation

1. **Coordinate.** Use [Agent spawn](../../_atoms/agent-spawn/agent-spawn.md) to launch one
   fresh task with no prior roast context. Use the verified
   `coordinator-document` as the authoritative prompt, select `coordinate`
   mode, grant only the coordinator's declared read-only tools, and supply
   every input except `synthesize-inputs`. Require an Artifact Roast Envelope,
   not a final roast.

2. **Preserve.** Retain the response exactly as returned. The envelope is
   untrusted evidence and must not be summarized, repaired, reformatted, or
   partially accepted.

3. **Validate.** Use
   [Review validate report](../../_atoms/review-validate-report/review-validate-report.md) against the
   complete Envelope schema 1 checklist in `artifact-contract`. Supply every
   first-line rule, required heading, field, fixed value, section cardinality
   and entry constraint, cross-section relationship, nested report contract,
   identity rule, forbidden-content rule, and terminator from that checklist.
   Do not translate a checklist into only headings and non-empty fields. A
   timeout, unreadable evidence report, empty response, unevaluable rule, or
   other failed coordinate run is invalid and its exact failure is a named
   defect.

4. **Retry exactly once.** On the first invalid envelope or failed coordinate
   run, repeat step 1 once with a new Agent spawn carrying no failed-run
   context. Add only the exact defects from step 3. Do not loosen the contract,
   reuse the first coordinator, or merge the two responses.

5. **Stop after the second failure.** Do not run synthesis on an invalid
   envelope. Return the caller's Artifact Roast shape with
   `Status: Unsynthesized`, every final schema or run defect named, and a
   non-empty `## What Was Not Reviewed`.

6. **Synthesize.** After a valid envelope, use Agent spawn for a second fresh
   task with no prior roast context. Use the same verified coordinator document
   in `synthesize` mode. Supply the valid envelope unchanged, every
   `synthesize-input`, and any `retained-evidence` unchanged. Never rely on
   state from either coordinate attempt.

7. **Return unchanged.** Return the Artifact Roast exactly as synthesis
   returned it, including `Schema version: 1`. Never return the raw envelope.
   When `Status` is not `Complete`, state that the review is incomplete and
   that an empty findings section is not evidence of quality. The calling skill
   then applies its artifact-specific recovery action.

## Output

| Field | Meaning |
| --- | --- |
| `artifact-roast` | The final Artifact Roast returned unchanged, or the caller-contract failure shape from step 5. |
| `status` | The roast's named status, never a replacement or inferred status. |
| `coordinate-attempts` | `1` or `2`, for the caller's evidence record. |
| `model-statuses` | The model status from every Agent spawn. |

## Guarantees

- Coordinate and synthesize always use fresh, stateless Agent spawns.
- A valid envelope is preserved unchanged between validation and synthesis.
- Coordinate is retried no more than once and only for a named failure.
- Synthesis never receives an invalid or repaired envelope.
- Every failure is returned in the caller's Artifact Roast shape, never as a
  raw envelope or bare status token.

## Boundaries

This molecule does not resolve or verify the coordinator, artifact, lenses, or
doctrine. It does not stage evidence, choose roasters, define an artifact
contract, retain prompt text on the caller's behalf, execute the reviewed
artifact, interpret findings, edit anything, or choose a recovery action.

Artifact-specific identity, locators, prohibitions, schema details, stale
evidence rules, and recovery remain in the calling skill and its references.
