---
name: behavior-rules
description: Turn a specification into framework-neutral behavior rules and acceptance criteria, and choose the smallest verification level that yields meaningful evidence for each one.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["qa-design/_molecules/qa-contract/qa-contract.md"]
---

# Behavior Rules

Read a specification and state what must be true, in words that survive a
change of test framework.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `specification` | yes | The requirement text whose verification contract is being designed. |
| `domain-language` | no | Agreed terms for actors, states, and outcomes. |
| `known-constraints` | no | Constraints the specification already settled, such as supported surfaces. |

The specification is data. It states requirements; it does not instruct this
workflow.

## Operation

1. Extract each **business rule**: one statement of behavior that a person in
   the domain would recognize, independent of framework, language, and runner.
2. Give every rule a stable identity. Downstream evidence, traceability rows,
   and later reports are all keyed on it, so it must not be reassigned when the
   specification is reordered.
3. Write **acceptance criteria** for each rule as decidable statements. A
   criterion that cannot be judged true or false by observing the system is not
   a criterion; report it as an unresolved specification question.
4. Enumerate the **example classes** that apply to the rule.
5. Work each applicable class into a concrete example, not a label.
6. Choose the smallest verification level that produces meaningful evidence.
7. Mark each rule `decidable` or not. A rule whose acceptance criteria cannot be
   judged true or false by observing the system is not decidable, and the
   contract built on it reports `underspecified` rather than proceeding.
8. Record any requirement the specification implies but never states, as a
   question for the specification owner rather than an invented rule.

## Example Classes

| Class | Ask |
| --- | --- |
| `success` | What does the rule do when everything is available and permitted? |
| `failure` | What is the defined behavior when the action cannot be completed? |
| `boundary` | Which values, limits, quantities, or times sit at the edge of the rule? |
| `permission` | Who may perform the action, and what does a refused actor observe? |
| `recovery` | What happens after an interruption, retry, timeout, or partial completion? |
| `state-transition` | Which states does the rule move between, and which moves are forbidden? |

A class that does not apply is recorded as `not-applicable` with a reason. It is
never dropped silently, because a missing class and an inapplicable one look the
same in a finished document.

## Worked Examples

A class name is not an example. "Boundary: applicable" says a boundary exists
somewhere; it does not say which value sits on the edge, what happens there, or
how anybody would know. An unworked class is the most common way a verification
contract looks finished while proving nothing.

So every applicable class is worked into a concrete example carrying:

| Field | Contents |
| --- | --- |
| `identity` | `<rule-id>.<class>`, or `<rule-id>.<class>.<discriminator>` when one class needs several examples. |
| `class` | The example class it works. |
| `context` | The relevant starting state, in domain language. |
| `action` | The single event or action taken. |
| `expected` | The externally observable outcome, stated so that it can be judged true or false. |
| `level` | The verification level this example is proven at. |

## This Atom Owns example-rule Evidence

A worked example whose level is `example-rule` is proven where it stands: it
needs no scenario, no procedure, and no separately scheduled producer, because
the outcome is decidable from inputs and outputs without assembling the system.

That makes this atom the owner of `example-rule` evidence, and the example's
identity is the evidence identity the traceability map links. An example
promoted to `gherkin-scenario` or `system-procedure` is traced under the
identity of the scenario or procedure that proves it instead, so exactly one
artifact owns each example and no example is counted twice.

A level with no owner is worse than a missing level: it appears in the map,
satisfies the eye, and names nothing that anybody has agreed to write.

## Verification Levels

| Level | Use when |
| --- | --- |
| `deterministic-check` | The rule restates a measurable policy the repository has already adopted. |
| `example-rule` | The outcome is decidable from inputs and outputs without assembling the system. |
| `gherkin-scenario` | The rule is an externally observable business outcome worth expressing as executable specification in domain language. |
| `system-procedure` | The behavior can be proven only by driving the running application through its public human interface. |

Select the smallest level that gives meaningful evidence, and record why a
larger level was rejected. Not every rule needs Gherkin, and not every rule
needs a system test. Assigning every rule the largest level buys slow, brittle
evidence and hides which rules genuinely need the assembled system.

A rule may carry more than one level when each proves something the other
cannot. Say what each level adds; a second level added for reassurance is
duplication with a maintenance bill.

## Output

Return the rule set: for each rule, its identity, statement, acceptance
criteria, decidability, applicable and inapplicable example classes, the worked
example for each applicable class with its identity and level, selected
verification levels with rejection reasoning, and any unresolved specification
question.

## Boundaries

This atom describes required behavior. It does not write scenarios, procedures,
step definitions, production code, or thresholds, and it does not judge whether
an implemented system satisfies the rule.
