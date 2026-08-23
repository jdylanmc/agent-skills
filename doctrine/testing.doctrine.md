---
name: testing
description: "Behavior-focused discipline for valuable, maintainable automated tests."
scope: shared-engineering-doctrine
---

# Testing Doctrine

## Purpose and scope

A maintainable test suite supports sustainable delivery speed. Design improvement from testing is valuable but secondary. Tests earn their cost only when meaningful regression protection outweighs execution and upkeep.

This guidance applies beyond typical enterprise applications, including integration and end-to-end testing. All guidance is **confirmed** unless marked **open**.

## Conceptual map

A valuable suite connects:

- **Behavior:** a domain-meaningful unit, not a class or line.
- **Evidence:** explicit and implicit client-relevant outcomes.
- **Boundaries:** policy in domain behavior; external effects at clear edges.
- **Economics:** protection worth lifetime cost.
- **Feedback:** failures that help find the root cause.

A unit test checks a small, quick, shared-state-independent behavior. Integration testing reaches shared state, slow external work, or combines multiple behaviors. Serialize tests that share state, or replace or isolate that state. End-to-end testing is integration testing that covers all or most out-of-process dependencies from a user perspective. “Quick” is contextual; labels such as user interface or functional test alone are insufficient.

## Primary corrective biases

Prefer value over test count or coverage. Improve or remove tests that are weak, slow, costly, or implementation-coupled.

Isolation difficulty is a design warning, not proof that more mocks are needed. Growing setup can expose hidden external work, leaked responsibilities, or poor boundaries.

Favor behavior-preserving tests. Assertions about private structure, internal calls, production-generated formatting, or duplicated algorithms invite false positives. Repeatedly ignored, retried, or disabled failures are a warning of such coupling.

Coverage measures execution, not assertion quality. Use it to find unexecuted behavior, then create a black-box test with an independently meaningful expected result.

**Warning — never treat a numerical coverage target as a quality verdict.**

## Vocabulary and status-sensitive distinctions

**Observable behavior** serves a client goal regardless of member visibility. **Implementation detail** is not source-defined beyond its use here; internal structure is an example. Needing several calls for one goal can reveal a leaked operation or state.

- **Output-based testing** asserts a returned result without hidden external work.
- **State-based testing** asserts resulting state.
- **Communication-based testing** verifies calls to mocked collaborators.

Output-based tests usually resist refactoring best; state-based tests are intermediate; communication-based tests require the most setup and assertions.

Arrange-Act-Assert (**AAA**) makes setup, invocation, and verification visible. A system under test (**SUT**) is the tested entry point. A **test double** substitutes for a dependency: a **stub** supplies input, a **mock** examines interactions, and a **spy** captures calls or values. Do not interaction-verify a stub. Command-query separation (**CQS**) normally maps commands to mocks and queries to stubs; mixed operations are an exception.

A **shared dependency** lets one test affect another; a **private dependency** does not. An **out-of-process dependency** runs outside the application. A **volatile dependency** is configured or nondeterministic. These categories overlap without implying each other. Immutable values are not collaborators.

A **functional core** makes pure decisions. A **mutable shell** gathers inputs and applies returned effects. A **managed dependency** is application-controlled and internal; an **unmanaged dependency** has externally observable interactions. Use real managed dependencies and verify final state. Mock unmanaged dependencies only through an application-owned adapter at the **system edge**, the final application-side type before the external dependency.

### Open taxonomy: classical school and London school

**Open:** The classical school and London school disagree about isolation and therefore some unit-versus-integration classifications.

London isolates a SUT or class from mutable collaborators using doubles and tends toward interaction verification. Classical isolates tests from shared state, generally favors state verification, substitutes shared dependencies, and can use several in-memory classes. This guidance adopts the classical definition for practical classification only; it does not settle the dispute. State the applied definition before relabeling a test.

## Decision and interpretation rules

Test one domain-meaningful behavior. Several assertions may establish it, but multiple Acts usually mean several behaviors. Do not branch inside a test.

**Warning — do not combine unrelated actions merely to avoid repeated setup.**

A naturally consecutive slow integration sequence may be combined only when separate tests create harmful external-call cost.

Write tests from requirements, client goals, or independent domain knowledge. Use white-box analysis only to find gaps, then return to black-box testing. Complex utility algorithms can require direct algorithm-focused tests.

Test-Driven Development (**TDD**) specifies failing behavior, implements minimally, then refactors while tests pass. Assertion-first work is appropriate only before the relevant production behavior exists.

Choose verification by observable result: output first when meaningful, state when state is the result, and communication only at an externally visible inter-system boundary. If boundary status is unclear, prefer output or state assertions. Private out-of-process communication remains an implementation detail.

Do not add wrappers solely to mock managed collaborators. A one-implementation interface is speculative unless it enables mocking an unmanaged dependency.

## Tradeoffs and conflict resolvers

Assess every test through regression protection, refactoring resistance, feedback speed, and maintainability. Value is judgment-based and multiplicative: a zero pillar yields no value. Preserve refactoring resistance and maintainability before deliberately trading protection against speed.

The Test Pyramid prefers many unit tests, fewer integration tests, and the fewest end-to-end tests; it is not a quota. A simple create/read/update/delete application can be rectangular, while a dependency-facing application can need more end-to-end coverage. Use end-to-end tests for critical gaps lower scopes cannot protect.

Mock-heavy suites tend toward fragility; classical suites can cascade failures, mitigated by frequent runs and root-cause repair. Either school can overmock, and neither should mock away most behavior under test.

Keep decisions inward and effects outward, but do not pursue purity at excessive cost. Where a decision conditionally needs external data, prefetch it or stage a core request; do not inject a database into the functional core.

## Workflows

### Writing or improving a focused test

1. State the factual domain scenario.
2. Arrange only needed context.
3. Act once on the SUT.
4. Assert explicit and relevant implicit outcomes.
5. Name the test as a domain claim; keep teardown outside AAA.

If setup grows, use an explicit private factory with meaningful parameters; keep scenario facts in the test. Do not hide common setup in a test-class constructor merely to reduce lines. Split parameterized cases once they no longer express one behavior.

For a weak test, assess the four pillars, replace structural assertions with observable outcomes, remove needless dependencies, then retain, improve, or delete it. If no meaningful assertion remains, remove the test or extract observable behavior.

### Moving decisions and effects

When mock setup dominates or a decision reads or writes external state:

1. Represent needed external state as values.
2. Pass them into a core decision.
3. Return a value describing the required effect.
4. Let a controller, application service, or shell apply it.

Do not leave parsing, branching, or policy in an adapter merely because it performs external work. Keep controller work to loading state, reconstructing domain objects, invoking domain behavior, persisting changes, and publishing resulting domain events.

For costly conditional external work, validate eligibility first, return failure before later I/O, and keep the policy in domain behavior. External uniqueness and failure decisions that cannot move inward remain controller-integration concerns.

A domain event is immutable, past-tense data for a completed domain-significant change: create it only when state changes, persist the aggregate, then dispatch it after persistence.

### Selecting and verifying integration coverage

Start with the successful operation path that covers the maximum required out-of-process dependencies. Add paths only for dependencies it does not cover; keep business errors and preconditions at unit scope. Omit an edge case only after verifying it fails before any persisted mutation.

For a controller integration path, seed a real managed dependency, invoke the controller or service, independently reload persisted state, and verify required unmanaged effects at the system edge.

**Warning — do not infer persistence from the original Arrange objects.**

For an unmanaged boundary, derive calls, counts, and the permitted-call baseline from the external contract. Verify exact expected counts and that no calls fall outside the baseline. Capture outbound values and compare them with independently represented expectations. Do not generate expected messages with production formatting logic.

For database behavior, use a production-vendor test database and separate fresh contexts for Arrange, Act, and Assert. Preserve immutable reference data, clear scenario data before each test, independently query persisted state, and serialize shared-database tests.

**Warning — do not share one context across Arrange, Act, and Assert, rely on teardown or rollback-only cleanup, or let repositories transact independently.**

Schema and reference data are versioned code. Prefer additive post-release migrations, and commit one operation-spanning transaction only after success.

## Triggers and corrective patterns

Examine—not automatically redesign—when setup grows with the class graph; tests have multiple Acts or opaque cases; failures are ignored; mocks verify internal communication; stubs are interaction-verified; partial concrete mocks appear; time is ambient; controller code holds policy; cycles form; integration uses an in-memory database substitute; expected values duplicate production logic; or production has test-only switches. Select the response from observable behavior, dependency ownership, and net test value.

Do not expose private members solely for testing: delete dead complexity or extract explicit-input/output behavior. Controlled reflection can be justified for a non-public external contract.

Replace test-only production branches with a real contract and test-side substitute. Replace partial mocks by separating an external gateway from a calculator or pure decision. Break callback or interface cycles by returning plain values. Read or inject time at the operation boundary and pass it inward. Test support or business logging through explicit domain-language logging such as `DomainLogger`; omit developer-only diagnostics.

## Review, limits, and checklist

Review manageable subsets continuously; aggregate metrics cannot replace per-test judgment. Confirm that a test:

- protects consequential behavior with an independent oracle;
- uses black-box expectations and one meaningful behavior;
- preserves refactoring resistance and maintainability;
- uses the smallest suitable scope;
- asserts managed final state and mocks only unmanaged system edges;
- keeps policy in domain behavior and effects at boundaries;
- independently observes persisted state and preserves atomic updates.

**Open:** classical/London classification remains unresolved. Enterprise characteristics, execution speed, pillar scores, pyramid shape, fixture use, assertion count, and integration sequencing are contextual rather than universal. `API` and `SQL` remain locked terms with open expansions.
