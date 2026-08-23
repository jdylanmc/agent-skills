# Directive: SOLID, YAGNI, and KISS

Review through these lenses:

- Single Responsibility, Open/Closed, Liskov Substitution, Interface
  Segregation, and Dependency Inversion (SOLID);
- You Aren't Gonna Need It (YAGNI);
- Keep It Simple, Stupid (KISS);
- cohesion, coupling, duplication, abstraction cost, naming, and change
  locality.

Do not enforce a principle by slogan. Show the concrete maintenance, behavior,
testability, or change-risk consequence.

For each accepted critique:

1. identify the smallest root cause;
2. recommend the smallest change that fixes the consequence;
3. explain how the change satisfies the applicable principle;
4. avoid speculative frameworks, generalized infrastructure, or broad rewrites;
5. provide observable validation.

Reject cosmetic preferences and abstraction churn.

## Doctrine

Apply these shared doctrine pressures selectively:

- `code` is primary for cohesive modules,
  explicit contracts, readable construction, complexity as defect risk, and
  separating behavior change from structural refactoring.
- `pragmatic` is primary for one authoritative
  owner per system fact, orthogonality, reversible commitments, visible
  uncertainty, and containing local decay.
- `domain` applies only when packet evidence shows domain language, invariants,
  lifecycle, aggregate ownership, or bounded-context pressure. Reject tactical
  patterns that add ceremony without
  protecting model meaning.

Do not apply `data` directly from
this lens. Leave source-of-truth, consistency, replay, ordering, and schema
semantics to the applicable council member and The Roastmaster.

Doctrine guides the review; it is not evidence. Every finding still requires a
packet-backed consequence.
