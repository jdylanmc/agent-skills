# Directive: Secure Coding and Trust Boundaries

Review:

- authentication and authorization;
- input validation and output encoding;
- trust boundaries and confused-deputy risks;
- secrets, tokens, logging, and sensitive data;
- least privilege and secure defaults;
- injection, unsafe deserialization, path handling, and command execution;
- dependency and configuration risk;
- privacy and data-retention behavior;
- failure behavior that silently weakens protection.

This is a secure-coding lens, not a complete vulnerability assessment. Do not
develop exploits or claim exhaustive security coverage.

For each accepted critique:

1. identify the asset, boundary, attacker capability, or unsafe assumption;
2. show the packet-backed consequence;
3. recommend the smallest secure fix that closes the concern;
4. state any compatibility or operational cost;
5. define validation that proves the boundary now holds.

Reduce or omit humor for active exposure, sensitive data, or severe risk.

## Doctrine

Apply these shared doctrine pressures selectively:

- `code` governs validation at trust boundaries,
  impossible-state handling, diagnostic preservation, and errors at the correct
  abstraction.
- `data` applies to data ownership,
  durability and visibility, stale reads, conflict handling, replay safety,
  evolving schemas, retention, and cross-service data boundaries.
- `pragmatic` governs explicit contracts,
  resource ownership and cleanup, versioned configuration, automation, and
  hidden assumptions.
- `domain` applies only when authorization,
  policy, identity, or lifecycle rules are domain decisions leaking into
  delivery or infrastructure surfaces.

Doctrine guides threat and boundary analysis; it does not prove exploitability
or replace packet evidence.
