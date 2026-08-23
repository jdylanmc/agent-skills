---
name: code
description: "Construction discipline for readable, verifiable, low-defect code."
scope: shared-engineering-doctrine
---

# Code Doctrine

## Applicability

Apply to production code work of any shape — building something new, altering something existing, reviewing a change, chasing a defect, restructuring, or tuning — whenever the objective is to hold defect risk down and leave the result open to inspection.

## Standing correction

Sound construction does not happen by itself. Code that has merely been typed out, code that succeeded once, and code that shows off a slick idiom are none of them finished construction. Among the implementations available, take the one that carries less defect risk and costs a reader less effort to reason about.

## 1. Readiness before large construction

**Standards**

- Confirm, before committing to a substantial piece of construction, that the ground underneath it is settled enough to build on: what is required, how the piece fits the architecture, which risks are the major ones, which coding conventions apply, what the implementation language can and cannot do, the policy for handling errors, how data is represented, what is being reused, how the work integrates, and how it will be tested.
- Where questions upstream remain open, produce a thin slice that can be validated rather than code written on assumption, and treat any decision that is expensive to reverse as one to be made on purpose rather than by default.

**Act when**

- Work arrives already framed as a proposed solution. Before implementing, restate the requirement it serves, where it sits in the architecture, which risks apply, which conventions bind it, and what constraints success must satisfy.

## 2. Reading cost as the first optimization

**Standards**

- Write for whoever reads the code next. Favor clarity, keeping related things together, saying things outright, control flow that can be seen rather than inferred, conventions applied uniformly, and correctness that holds in practice. None of these is to be traded away for cleverness, for typing fewer characters, or for whatever style is currently in fashion.
- Where a routine is genuinely complex, work its logic out first as intent comments or precise pseudocode pitched at one consistent level of abstraction, then convert that into code. Retain afterwards only the comments that still carry constraints, contracts, rationale, or intent.
- Lower reader effort deliberately through layout, comments, documentation, and shared coding standards. Structure that documents itself comes first; a comment earns its place by conveying intent, assumptions, constraints, limitations, intended usage, or anything else a reader cannot deduce from the code.

**Act when**

- A comment narrates mechanics already visible in the code, or has drifted out of step with it. Either restructure the code so the comment becomes unnecessary, or delete the comment. Conversely, where code cannot itself carry intent, constraints, or usage, place an accurate comment adjacent to it.
- A file or module starts developing a private dialect. Realign with the project's shared formatting, naming, file organization, and idioms instead.

## 3. Routine design

**Standards**

- A routine should do one coherent thing, carry a name that says precisely what that is, present a small interface, and resist incorrect use. Where setup, validation, computation, and effects on the outside world are conceptually distinct, hold them apart.

**Act when**

- A routine resists naming, runs several phases together, takes flag arguments that select behavior, accumulates a long parameter list, or changes state its caller cannot see. Rework the interface or divide the routine.

## 4. Data representation

**Standards**

- Make the meaning of every variable and data structure visible: names that reveal purpose, scope kept small, initialization done deliberately, constants given names, types that carry more meaning, and units or sentinel semantics stated rather than assumed.
- Prefer type choices under which ambiguous or invalid values become difficult to express at all. Reserve booleans for genuinely two-valued meanings, use enumerations for closed sets, and reach for records, maps, or tables only where that shape itself communicates what the data means.

**Act when**

- A reader has to decode units, permitted ranges, precision, encoding, ownership, what a status signifies, what a magic value stands for, or what a primitive flag encodes. Relocate that meaning into a name, a constant, a type, or a structure.

## 5. Control flow and dispatch

**Standards**

- Control flow must stay simple enough that a reader can verify it: nesting kept shallow, complicated conditions given predicate names, one clear normal path, loops whose initialization, termination, and update are all plain, no reliance on expressions whose side effects matter, and no clever one-liners.
- Logic driven by a table or by data suits stable, explicit mappings, but only where the table reads more clearly than the alternative, where its operation is obvious, where it stays synchronized with the rules it encodes, and where it is validated. Never bury complex behavior inside an encoding nobody can decipher.

**Act when**

- Branches, loops, recursion, exit points, or exception paths reach the point where correctness can no longer be verified by reading. Simplify first, then add the new logic.
- The same branching repeats across conversions, validation, dispatch, stable categories or ranges, or rules that amount to configuration. Consider a validated table.

## 6. Boundaries, validation, and failure

**Standards**

- Validate input where trust changes hands. Assumptions a programmer believes must hold are the province of invariant checks, assertions, and lightweight contracts; failures expected from external parties or from the business belong instead to validation results or domain errors.
- Errors belong to the abstraction level able to make sense of them, so handle them there. Carry diagnostic context forward, treat similar failures consistently, refuse to continue silently from state that is corrupted or that should have been impossible, and leave the reading of the normal path unobstructed.

**Act when**

- Input crosses a boundary of trust — from a user, a file, the network, an external system, or anywhere else. Decide explicitly what gets validated, what gets rejected, what gets recovered from, what gets asserted, and what remains diagnosable afterwards.

## 7. Module structure and complexity

**Standards**

- Classes and modules should stay narrow in purpose, internally cohesive, and delimited by contracts that are stated. Keep representation and internal bookkeeping hidden, and do not let persistence, formatting, business logic, and integration collect together in one place.
- Read rising complexity as rising defect risk: split routines or modules that have become tangled, strip out duplication that makes maintenance effort multiply, and cut down how much a maintainer must hold in working memory at once.

**Act when**

- A module or class leaks its representation, swells into a god object, or takes on responsibilities unrelated to each other. Restore the abstraction boundary.

## 8. Incremental construction and verification

**Standards**

- Construct in increments small enough to verify, integrate often enough that conflicts surface early and partly finished work does not rot, and treat review and improvement as part of construction rather than as something that follows it.
- Scale the verification effort to the defect risk: static checks, tests, regression suites, reviews, inspections, and pair work. When something breaks, work it out instead of guessing — reproduce it, isolate it, explain it, correct the root cause, and confirm the correction.
- Reach for editors, scripts, build automation, debuggers, profilers, and comparable tooling to remove manual steps that invite mistakes. Such leverage supplements understanding; it never substitutes for it.

**Act when**

- Tests exercise only the path where everything goes right. Extend them to normal cases, boundaries, invalid input, the defensive checks themselves, the contracts routines promise, and edge cases drawn from the data.
- A debugging session opens from a guess about the cause. Get the failure reproducing on demand first, gather evidence, narrow the path down, and account for the mechanism.

## 9. Changing code that already exists

**Standards**

- Refactor when the current structure hides intent, states the same knowledge more than once, or raises the probability of defects. Where reviewability benefits, keep the refactoring in a step separate from any change in behavior.
- Spend effort on performance only where a requirement and the evidence warrant it. Take measurements on both sides of the change, and retain the clearer form unless a measured tradeoff has been made explicit and is worth what it costs.

**Act when**

- The code to be refactored is risky or poorly understood. Put tests or analysis in place beforehand, and hold behavior changes out of that step.
- Performance work begins. Set the target, measure how the code behaves now, alter one thing, measure again, and document any clarity given up.

## Verification checklist

- Were the construction approach, applicable conventions, architectural fit, major risks, and underlying requirements clear enough to begin?
- Do the layout, comments, standards, names, routines, data, and classes each reduce what a reader must work out?
- Were trust boundaries, input handling, invariants, contracts, assertions, impossible states, and errors all settled deliberately?
- Can recursion, loops, control flow, tables, exit points, and exception paths be checked by inspection?
- Do tuning, tooling, integration, refactoring, debugging, reviews, and tests all rest on evidence?
- Is the change small enough to be verified, and would it survive close review?
