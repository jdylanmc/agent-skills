---
name: gherkin-design
description: Write Gherkin scenarios in domain language for the rules that warrant executable specification, and review them structurally for ambiguity, duplication, contradiction, breadth, and implementation leakage.
level: atom
allowed-tools: ["execute","read"]
includes: ["qa-design/_atoms/gherkin-design/gherkin-design.mjs"]
composes: []
used-by: ["qa-design/_molecules/qa-contract/qa-contract.md"]
---

# Gherkin Design

Express the rules that deserve executable specification as examples a person in
the domain would recognize.

## Required Files

1. [Gherkin structural review helper](./gherkin-design.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `rules` | yes | The behavior rules whose selected verification level includes `gherkin-scenario`. |
| `domain-language` | no | Agreed terms for actors, states, and outcomes. |
| `existing-features` | no | Feature text the repository already keeps, so a new scenario does not duplicate one. |

## Authoring Rules

1. Use `Feature` for the capability, `Rule` for a business rule, and `Scenario`
   for one example of that rule.
2. `Given` states the relevant initial context. `When` states the single event
   or action. `Then` states an externally observable outcome.
3. One `When` per scenario. A second action is a second example, or a sequence
   that belongs in a system-test procedure.
4. Write in domain language. A reader who has never seen the code should be able
   to say whether the scenario is right.
5. Keep selectors, routes, queries, private calls, storage assertions, and
   step-definition code out of the specification. Where behavior is observed is
   an implementation decision made later.
6. Prefer a `Scenario Outline` only when the same rule is proven by varying
   data. Every placeholder is bound by an `Examples` column, and every column is
   used by a step.
7. Name the outcome, not the mechanism. "Then the order is rejected" is a
   scenario; "Then the validation flag is false" is an assertion about the
   inside.

## Structural Review

Run the helper on the designed feature text before the scenarios leave this
workflow:

```text
echo '{"feature": "<gherkin text>", "locator": "checkout.feature"}' \
  | node skills/qa-design/_atoms/gherkin-design/gherkin-design.mjs
```

It returns `clean`, `findings`, or `parse-failed`, plus one finding per defect
with a code, severity, and location. The codes cover the defects that are
decidable from feature text:

| Concern | Codes |
| --- | --- |
| Shape | `empty-scenario`, `missing-when`, `missing-then`, `unanchored-continuation-step`, `out-of-order-steps`, `no-scenarios` |
| Breadth | `multiple-when` |
| Duplication | `duplicate-scenario-name`, `duplicate-scenario-body` |
| Contradiction | `contradictory-scenarios` |
| Ambiguity | `ambiguous-language` |
| Leakage | `implementation-leak`, `implementation-vocabulary` |
| Data binding | `outline-without-examples`, `outline-placeholder-unbound`, `examples-column-unused`, `examples-row-width-mismatch`, `examples-without-header`, `examples-without-rows` |

## Parsing Is Not Coverage

Every report carries `coverage.executable: unknown`, and that is not a
limitation to be worked around. Valid Gherkin proves the text is well formed. It
says nothing about whether a step definition exists, whether it binds, or
whether the product behaves as described. Only executing the scenarios answers
that, and executing them belongs to the Cucumber capability after
implementation.

A missing scenario is likewise not visible here. Feature text cannot report what
it does not contain; an unproven rule is found by reconciling the traceability
map.

Report a finding the helper raised and a finding you raised by reading, and keep
them distinguishable. The helper decides structure; a person decides whether the
example is the right example.

## Output

Return the feature text, the scenario inventory with stable scenario identities,
the structural review report, findings you resolved, findings you are handing
on, and the explicit statement that executable coverage is unproven.

## Boundaries

This atom writes specification. It does not write step definitions, fixtures,
runner configuration, or product code, it does not execute scenarios, and it
does not treat a parse as a pass.
