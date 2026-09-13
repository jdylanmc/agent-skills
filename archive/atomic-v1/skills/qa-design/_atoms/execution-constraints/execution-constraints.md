---
name: execution-constraints
description: Declare the environment, data, isolation, duration, ordering, concurrency safety, and report identity of every planned evidence producer, and reconcile which of them may never run at the same time.
level: atom
allowed-tools: ["execute"]
includes: ["qa-design/_atoms/execution-constraints/execution-constraints.mjs"]
composes: []
used-by: ["qa-design/_molecules/qa-contract/qa-contract.md"]
---

# Execution Constraints

Say what each planned proof needs to run, and which proofs conflict, before
anyone tries to run them in parallel.

## Required Files

1. [Execution constraint reconciler](./execution-constraints.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `producers` | yes | Every planned scenario, procedure, and deterministic check, with its declaration. |

A producer is a proof that is separately run and separately reported: a
`system-procedure`, a `gherkin-scenario`, or a `deterministic-check`. An
`example-rule` is not one. It is proven inside the repository's own test run,
carries no environment, account, or fixture of its own, and requiring a full
declaration for it would bury the producers whose conflicts actually matter.

## Declaration

Every producer declares all of the following. There are no optional fields and
no defaults.

| Field | Meaning |
| --- | --- |
| `id` | Stable identity of the evidence producer. |
| `kind` | `deterministic-check`, `gherkin-scenario`, or `system-procedure`. |
| `requirementIds` | The requirement identities its later report must carry. |
| `traceabilityIds` | The traceability identities its later report must carry. |
| `environment` | The target environment or surface it runs against. |
| `accounts` | Accounts it signs in as or consumes. |
| `data` | Fixtures and records it depends on. |
| `mutableResources` | Everything it changes that another producer could observe. |
| `isolation` | `shared`, `isolated`, or `exclusive`. |
| `expectedDurationMinutes` | Expected duration, as a positive number. |
| `concurrencySafe` | `false` when the producer runs alone, whatever else is happening. |
| `runAfter` | Producers that must complete first, or an empty list. |

An empty list is a declaration. An absent field is an omission, and the two are
deliberately not the same: defaulting an omitted `mutableResources` to "conflicts
with nothing" is exactly how two state-conflicting procedures end up running
together later.

## Isolation and Concurrency Are Different Questions

`isolation` describes what the producer needs from its environment.
`concurrencySafe` describes whether it tolerates anything running beside it.
They are not two spellings of one field, and neither implies the other.

| Declaration | Constraint produced |
| --- | --- |
| `isolation: shared` | None by itself. Conflicts come from declared accounts, data, and mutable resources. |
| `isolation: isolated` | None by itself. The producer states that its resources are its own; anything it still shares is declared and still conflicts. |
| `isolation: exclusive` | Conflicts with every producer in the same environment. |
| `concurrencySafe: false` | Conflicts with every other producer, in any environment. |

A producer may be exclusive and still concurrency safe: it needs staging to
itself, and preview work is none of its business. A producer that declares
`concurrencySafe: false` is making the stronger claim, and it is honored as
stated.

The reconciliation never reports `parallel-safe` while any producer has declared
itself serial or claimed an environment exclusively, even when it is the only
producer and has nothing to conflict with. The declaration is the answer, not
the pair count: a lone exclusive procedure still needs an environment held for
it, and reporting the run as parallel safe would describe a freedom nobody
declared.

## Reconciliation

```text
echo '{"producers": [ ... ]}' \
  | node skills/qa-design/_atoms/execution-constraints/execution-constraints.mjs
```

The helper returns `parallel-safe`, `constrained`, or `invalid`, together with:

- `mustNotRunConcurrently`: every pair that shares a mutable resource, an
  account, a data fixture, or an environment one of them holds exclusively, plus
  every pair involving a producer that declared itself serial, with the reason
  for each;
- `serialOnly`: producers that declared `concurrencySafe: false`;
- `exclusiveAccess`: producers that need the environment to themselves;
- `orderingEdges`: the declared sequence;
- `findings`: `incomplete-declaration`, `duplicate-producer-id`,
  `unknown-producer-kind`, `unknown-isolation-mode`, `missing-report-identity`,
  `self-ordering-dependency`, `unknown-ordering-dependency`, `ordering-cycle`,
  and `undeclared-conflict`.

`undeclared-conflict` is the finding this atom exists for: two producers that
both claim to be concurrency safe while sharing state. Resolve it by correcting
the declaration or by isolating the shared resource, not by removing the
declaration that revealed it.

## Exit Codes

Every helper in this package uses the same three codes.

| Code | Meaning |
| --- | --- |
| `0` | The input was accepted and raised no finding. |
| `2` | The input was accepted and raised findings. |
| `1` | The input was refused and nothing was reconciled. |

The code reports findings, not disposition. A correct declaration set that
carries real constraints exits `0` and says `constrained` in `status`, so read
`status` for the design and the exit code for whether anything needs fixing.

## Constraints, Not a Schedule

The report contains no schedule, and `scheduling.schedule` is always null.
Deciding what actually runs, when, and beside what is an execution decision that
belongs to whoever runs the evidence. A design artifact that emitted a schedule
would be making that decision without owning the environment it applies to.

What this atom guarantees is narrower and more useful: an orchestrator that
honors `mustNotRunConcurrently`, `exclusiveAccess`, and `orderingEdges` cannot
parallelize two state-conflicting proofs merely because it had the capacity to.

## Report Identity

Every producer names the requirement and traceability identities its later
report must carry. Without them, a returned result cannot be attached to the
requirement it was supposed to prove, and evidence from two runs cannot be told
apart.

## Output

Return the reconciled declarations, the conflict set with reasons, the exclusive
and ordered producers, the required report identities, and every finding.

## Boundaries

This atom does not schedule, dispatch, parallelize, execute, cancel, or budget
anything. It does not provision an environment, create an account, or seed data.
