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
8. Give every scenario a name and a durable identity.

## Scenario Identity

A scenario carries two labels, and they do different work. The **name** is prose
for a person; the **identity** is the token every other artifact refers to.

```text
  @id:refund-inside-window
  Scenario: A shopper refunds a delivered order inside the window
```

Declare the identity as an `@id:` tag matching `[A-Za-z0-9][A-Za-z0-9._-]*`. It
is declared rather than derived from the name, because a name is edited for
readability and an identity that moved every time somebody improved a sentence
would be no identity at all. A traceability row, a later Cucumber result, and a
QA analysis all key on it.

A scenario with no name is reported. So is a scenario with no identity, more
than one, a malformed one, or an identity another scenario already uses.

Two scenarios may end up sharing a name. That is still reported, but the
severity depends on whether the reference survives it: `medium` when both carry
distinct identities, because everything downstream still points somewhere exact,
and `high` when they do not, because the name is then the only handle and it
names two things.

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
| Parse | `missing-feature`, `multiple-features`, `content-before-feature`, `step-outside-scenario`, `examples-outside-outline`, `table-outside-step`, `doc-string-outside-step`, `unterminated-doc-string`, `malformed-tag-line`, `unrecognized-line` |
| Shape | `empty-scenario`, `missing-when`, `missing-then`, `unanchored-continuation-step`, `out-of-order-steps`, `no-scenarios`, `missing-scenario-name` |
| Identity | `missing-scenario-id`, `duplicate-scenario-id`, `malformed-scenario-id` |
| Breadth | `multiple-when` |
| Duplication | `duplicate-scenario-name`, `duplicate-scenario-body` |
| Contradiction | `contradictory-scenarios` |
| Ambiguity | `ambiguous-language` |
| Leakage | `implementation-leak`, `implementation-vocabulary` |
| Data binding | `outline-without-examples`, `outline-placeholder-unbound`, `examples-column-unused`, `examples-row-width-mismatch`, `examples-without-header`, `examples-without-rows` |

Vague and implementation-shaped terms are matched on word boundaries rather than
surrounding spaces, so a term that ends a step is caught along with one in the
middle of it. "Then the total is calculated correctly." is the ordinary shape of
the defect, and a space-delimited search misses exactly that case.

A doc string may declare a media type on its opening delimiter, as in `"""json`.
The closing delimiter is bare, and a doc string left open is reported rather
than swallowing the rest of the feature.

A parse code stops the review: the report returns `parse-failed` and no shape,
identity, or language finding is attempted, because a document that did not
parse cannot be reviewed honestly.

`malformed-tag-line` is the one parse code that looks like a technicality and is
not. A tag carries no whitespace, so `@id:a shopper` is the tag `@id:a` beside a
loose word. Accepting it would silently truncate the identity to `a` and leave a
scenario confidently referred to by a name nobody chose. Tags are also scoped
where they are written: tags above the `Feature` belong to the feature, and tags
above an `Examples` table belong to that table, so neither becomes the identity
of whatever scenario is declared next.

## Exit Codes

Every helper in this package uses the same three codes.

| Code | Meaning |
| --- | --- |
| `0` | The input was accepted and raised no finding. |
| `2` | The input was accepted and raised findings. |
| `1` | The input was refused and nothing was reviewed. |

The code reports findings, not disposition. Read `status` for the review's
disposition and the exit code for whether anything needs fixing.

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

Return the feature text, the scenario inventory with each scenario's declared
identity, the structural review report, findings you resolved, findings you are
handing on, and the explicit statement that executable coverage is unproven.

## Boundaries

This atom writes specification. It does not write step definitions, fixtures,
runner configuration, or product code, it does not execute scenarios, and it
does not treat a parse as a pass.
