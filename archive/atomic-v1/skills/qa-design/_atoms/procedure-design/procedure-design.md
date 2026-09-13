---
name: procedure-design
description: Write a system-test procedure that a person could follow and an agent could later execute, driving the assembled application only through its public human interface.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["qa-design/_molecules/qa-contract/qa-contract.md"]
---

# Procedure Design

Write the system test for behavior that can be proven only through the running
application, as a person would use it.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `rules` | yes | The behavior rules whose selected verification level includes `system-procedure`. |
| `target-surface` | yes | The user-facing surface the behavior appears on. |
| `known-environments` | no | Environments and builds the specification already names. |

## Voice

Write from a human operator's point of view, and make each instruction precise
enough for an agent to execute without guessing. Those pull in the same
direction more often than they conflict: "open the cart and remove the last
item" is readable and still ambiguous about which item, while "open the cart and
remove the bottom row" is both readable and decidable.

Where they do conflict, precision wins on the action and readability wins on the
narrative. Never buy precision by naming an element identifier; that is
automation detail, and it belongs to whoever writes the automation later.

## Required Sections

| Section | Contents |
| --- | --- |
| `identity` | Stable procedure identity and revision. |
| `target-surface` | The application, build class, and user-facing surface exercised. |
| `prerequisites` | State that must exist before step one, and how the operator confirms it. |
| `required-data` | Accounts, records, entitlements, and fixtures, with who provides them. |
| `actions` | Ordered, numbered instructions, each one observable action. |
| `checkpoints` | Points where the operator stops and observes, with the expected user-visible result. |
| `expected-results` | The observable outcome for every checkpoint, stated before execution. |
| `cleanup` | What is restored, deleted, or released, and the documented terminal state. |
| `pass-fail` | The condition that makes the procedure pass, and every condition that makes it fail. |

A procedure missing any of these is incomplete. Return it as incomplete rather
than filling the section with a plausible guess.

## Black-Box Rule

Every action and every observation goes through the same public interface a
person has. Do not write a step that reads internal state, calls a private
interface, edits storage directly, or flips a hidden switch to reach a
precondition.

If a precondition cannot be reached through the public interface, that is a
finding about the product's testability, and it is reported. It is not a licence
to reach inside; a procedure that sets up through the back door stops proving
that a person could get there at all.

Diagnostics such as logs may be recorded as supporting evidence during later
execution. They never replace the user-visible observation a checkpoint
requires.

## Authorization

Mark every action that is destructive, externally visible, production-affecting,
purchasing, notifying, or account-changing. Each one carries:

- what it changes and who observes the change;
- the authorization required before it may run;
- whether it is reversible, and the reversal;
- what the executor must do when authorization is refused.

Marking is done at design time because the executor should never be the first to
notice that a step spends money or emails a customer.

## Authoring Is Not Execution

This atom writes the procedure. It does not run it, does not open the
application, and does not report a result. Execution belongs to the QA procedure
capability, against an assembled build, under its own authorization policy.

The separation is what makes the expected result trustworthy: it was written
before anyone saw what the system actually did.

## Output

Return each procedure with its identity, revision, required sections, marked
authorization-required actions, testability findings, and the rules it proves.

## Boundaries

This atom does not execute procedures, write user-interface automation, select
an adapter, capture evidence, or judge an application. It does not invent an
environment, account, or build the specification has not established.
