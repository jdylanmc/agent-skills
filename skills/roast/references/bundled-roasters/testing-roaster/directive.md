# Directive: Review the Submitted Tests

Focus on the tests included with the reviewed pull request, diff, commit range,
working-tree change, named files, or pasted code.

First determine:

- which production behaviors changed;
- which test files changed;
- which requirements, contracts, or expected behaviors govern the change;
- which existing test framework and conventions apply;
- which dependencies are shared, private, managed, unmanaged, volatile, or
  out-of-process when those distinctions affect the test seam;
- which relevant continuous-integration results are available.

## Testing Review Gate

Apply the declared doctrine pressures together. Use `testing` for test-specific
decisions without giving it more authority than applicable `code`, `data`,
`pragmatic`, or `domain` guidance. For every submitted or recommended test,
determine whether it:

- protects a consequential, domain-meaningful behavior rather than a class,
  line, method, or coverage target;
- has an independent oracle and would fail for the credible regression it
  claims to prevent;
- balances regression protection, resistance to refactoring, feedback speed,
  and maintainability without scoring zero on any dimension;
- verifies observable output or state before reaching for interaction checks;
- mocks only externally observable unmanaged dependencies at the final
  application-owned system edge;
- uses real managed dependencies when integration behavior is the subject;
- uses the smallest suitable test scope rather than mechanically preferring a
  unit, integration, or end-to-end label;
- remains deterministic, isolated from shared state, and independently
  observable.

Treat these as decision guidance, not as evidence. A finding still requires a
packet-backed behavior, test, consequence, and bounded correction.

## When No Tests Are Present

Do not stop at "add tests." Recommend the smallest risk-based test plan that
would prove the changed behavior and prevent its most credible regressions.

For each recommended test, state:

- behavior or requirement proved;
- setup and inputs;
- action or event;
- expected observable result;
- independent oracle;
- failure the test would catch;
- appropriate test level: unit, integration, contract, end-to-end, or another
  repository-supported seam;
- dependency treatment: real managed dependency, unmanaged boundary mock or
  spy, or no test double;
- priority and rationale.

Do not demand exhaustive coverage. Prioritize tests by consequence and
regression likelihood.

## When Tests Are Present

Nitpick the submitted tests. Verify that they would fail for the defect or
behavior they claim to cover and pass only when the implementation is correct.

Review:

- mapping from changed behavior to test coverage;
- whether each test verifies one domain-meaningful behavior without branching
  inside the test;
- happy path, boundaries, empty and null states, invalid inputs, and wrong
  types;
- error handling, timeouts, permission denial, and degraded dependencies;
- state transitions, repeated operations, idempotency, concurrency, and race
  conditions when applicable;
- assertion strength and whether expected outcomes are observable;
- tautological tests and assertions that merely restate fixtures or mocks;
- expected values derived through production logic rather than an independent
  oracle;
- false positives caused by broad matching, swallowed errors, or missing awaits;
- determinism, timing, ordering, cleanup, and shared mutable state;
- readability of scenario and expected-result names;
- fixture realism and independence;
- over-mocking and coupling to private implementation details;
- stub interaction verification, concrete partial mocks, and mocks placed
  before the final application-owned system edge;
- exact expected calls and counts, the permitted-call baseline, and rejection
  of unexpected unmanaged-boundary calls;
- whether unit, integration, contract, or end-to-end coverage is used at the
  correct seam;
- database-test fidelity when applicable: production database vendor, fresh
  Arrange/Act/Assert contexts, scenario cleanup that preserves reference data,
  independent reloads, and sequential shared-database execution;
- test-only production branches, ambient time, hidden setup, multiple Acts,
  and other testability anti-patterns;
- relevant user-interface states, realistic volume, and accessibility basics
  when the scoped change includes them.

Prefer one assertion per logical concept, not mechanically one assertion per
test. Preserve atomic scenarios.

## Evidence Standard

Use only packet-contained code, tests, contracts, and validation results. Do
not execute tests or claim reproduction that did not occur.

For each accepted critique:

1. identify the changed behavior and submitted test evidence;
2. state what the test proves and what it does not prove;
3. provide the concrete false-positive, missed-regression, flake, or
   maintainability scenario;
4. recommend the smallest test addition or correction that fixes and satisfies
   the critique;
5. state the expected failing signal before the production fix and passing
   signal afterward;
6. preserve the repository's framework, fixtures, naming, and test conventions;
7. define observable validation.

Separate confirmed test defects from lower-confidence test opportunities. If
requirements are ambiguous, report the evidence gap before recommending an
assertion.

## Never

- accept happy-path coverage as complete without checking applicable failure
  paths;
- recommend sleep-based waiting, order-dependent execution, shared-state
  ordering, or a different database vendor as a substitute for deterministic
  isolation;
- recommend skipping or quarantining a flaky test without addressing its cause;
- couple tests to private implementation details without a demonstrated need;
- mock third-party types directly when an application-owned unmanaged-boundary
  adapter is available or required;
- infer persisted state from the Arrange objects instead of independently
  reloading it;
- report "tests are missing" without naming the behaviors and cases to add;
- treat a passing suite as proof when the submitted assertions cannot detect the
  regression.

## Doctrine

Apply these shared doctrine pressures selectively and without a global
precedence:

- `testing` governs test value, behavior orientation,
  observable outcomes, test-double boundaries, test-level selection,
  integration fidelity, and testability anti-patterns.
- `code` governs risk-matched tests, trust-boundary
  cases, defensive checks, repeatable debugging, and tests or analysis before
  risky refactoring.
- `data` applies when the change
  involves write semantics, retries, replay, duplicates, ordering, schema
  evolution, derived data, stale reads, or distributed failure.
- `pragmatic` governs fast feedback, repairing
  flaky or environment-dependent tests, adding regression protection after a
  human-found defect, and proving unexplained behavior with data.
- `domain` applies when tests should express
  domain invariants, valid construction, allowed or forbidden transitions, or
  cross-context translation using the context's agreed vocabulary.

Doctrine guides test selection; it is not evidence that a test is missing or
defective.

An `**Open:**` doctrine statement may frame only an explicitly cited
assumption; it cannot back a finding. Record the statement, applied definition
or assumption, and unresolved consequence as a stable record under
`Doctrine Uncertainties`.
