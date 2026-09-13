---
name: assertion-ladder
description: Advance one smallest safety-critical change assertion through source citation, ruled-out bad case, executable proof, and live reproduction, recording the exact stopping rung and reason.
level: atom
allowed-tools: ["execute","read","search"]
includes: []
composes: []
used-by: ["blast-radius/_molecules/blast-radius-proof/blast-radius-proof.md"]
---

# Assertion Ladder

Make one important safety claim earn each stronger kind of evidence.

## Assertion Selection

Select the smallest assertion whose failure would make the change unsafe at a
traced consumer or boundary. Split compound claims. Prefer a few assertions
that guard the material impact paths over a long list of generic concerns.

Each assertion names:

- the behavior claimed to remain safe or compatible;
- the affected consumer or boundary;
- the concrete bad case that would falsify it;
- why that bad case is safety-critical for this change.

## Five Evidence Rungs

Advance in order. A later rung supplements earlier evidence; it does not erase a
missing earlier rung.

| Rung | Required evidence |
| --- | --- |
| 1. `assertion` | One falsifiable, non-compound safety claim tied to a traced impact path. |
| 2. `exact-source-citation` | Exact source locations establishing the changed contract, consumer, assumptions, and relevant control flow. |
| 3. `ruled-out-bad-case` | Evidence that attempts to falsify the named bad case and either demonstrates it or rules it out within a stated scope. |
| 4. `executable-proof` | An existing bounded command or check, its exact invocation and result, run only when it is known not to mutate candidate or external state. |
| 5. `live-reproduction` | Observation in the real integration environment when available and authorized, performed without live-state mutation. |

Record two independent fields for every rung:

- `progression`: `completed`, `unavailable`, `not-applicable`, or
  `not-attempted`;
- `evidence-outcome`: `supports-assertion`, `supports-bad-case`,
  `inconclusive`, or `conflicting`.

`progression` says whether evidence acquisition occurred. `evidence-outcome`
says what acquired evidence means. Do not use an evidence outcome as a
progression value or treat command success as support for the assertion.
`not-applicable` is permitted only for live reproduction when no live
environment is relevant; explain why. A rung with no acquired evidence records
an `inconclusive` outcome.

## Stopping Rule

Stop at the first rung that cannot responsibly advance. Record:

- the exact stopping rung;
- the reason: missing evidence, inaccessible boundary, unsafe or mutating
  command, unavailable environment or hardware, authorization required,
  contradictory evidence, or another concrete blocker;
- the strongest claim the completed rungs support;
- the next evidence needed.

Mark every later rung `not-attempted`; do not call it unavailable when the
ladder never reached it. A `completed` rung with `inconclusive` or `conflicting`
evidence is a stopping rung unless another already-acquired result resolves the
same question without inference.

Do not replace a missing executable proof with source confidence. Do not replace
an unavailable live reproduction with a claim that the earlier command proves
production behavior.

## Executable and Live Safety

- Run only existing proof commands; do not author or edit tests, fixtures,
  scripts, or candidate code.
- Apply this execution-eligibility decision:

  | Command or environment | Progression decision |
  | --- | --- |
  | Documented read-only command | May run. |
  | Command inside already-provisioned isolation whose writes cannot reach candidate, tracked, external, or live state | May run. |
  | Hook, installer, cache-writing test, snapshot update, or live write | `unavailable`. |
  | Build, test, or other command with undocumented or unknown mutation behavior | `unavailable` until non-mutation is established. |
  | Build or test whose non-mutation is established for the stated environment | May run; being a build or test alone does not make it mutating. |

- Capture command, working directory, revision, material environment details,
  exit status, and relevant output.
- If an eligible command starts and returns a nonzero exit status, evidence
  acquisition is `completed`; classify the output as `supports-bad-case`,
  `supports-assertion`, `inconclusive`, or `conflicting` according to what the
  command actually establishes. If the command cannot start, its runner loses
  access, or evidence cannot be retrieved, acquisition is `unavailable`.
  Command failure is not automatically acquisition failure, and exit zero is
  not automatically `supports-assertion`.
- A passing command proves only its named behavior, inputs, and environment.
- Live reproduction is optional where unavailable or irrelevant. It never
  authorizes user-interface actions, deployment, data writes, or other mutation.

## Output

Return one ordered ladder per assertion. Every rung has progression,
evidence-outcome, evidence, and scope. Include the exact stopping rung and
reason, the strongest supported claim, and the next evidence needed.

## Boundaries

This atom does not classify the portfolio of assertions, recommend code
changes, accept risk, or approve the candidate.
