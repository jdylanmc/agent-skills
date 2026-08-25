---
name: model-role-defaults
description: Define inline model-role defaults for implementation, cleanup, architecture, QA, and decision-trail roles without treating model identity as doctrine.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["model-role-resolution/_molecules/model-role-resolver/model-role-resolver.md"]
---

# Model Role Defaults

This atom defines the built-in role map consumed by the resolver when no caller
configuration overrides it. The defaults are infrastructure values. They are not
doctrine, policy, or a guarantee that a runtime will expose a slug.

## Default Roles

| Role | Shape | Requested model | Ordered fallbacks | Effort | Context |
| --- | --- | --- | --- | --- | --- |
| `implementer` | single | `claude-sonnet-5` | `gpt-5.6-sol`, `gpt-5.5`, `claude-opus-5` | `high` | `default` |
| `cleanup` | single | `gpt-5.4-mini` | `claude-haiku-4.5`, `gpt-5-mini` | `low` | `default` |
| `architecture.candidates` | panel | `claude-opus-5`, `gpt-5.6-sol`, `grok-4.6` | each candidate declares the other high-capability families before lower fallbacks | `high` | `long_context` |
| `architecture.judge` | single | `claude-opus-5` | `gpt-5.6-sol`, `claude-sonnet-5` | `xhigh` | `long_context` |
| `qa.reviewers` | panel | `gpt-5.6-sol`, `claude-sonnet-5`, `gemini-3.7-flash` | each reviewer declares alternate families where possible | `high` | `long_context` |
| `qa.judge` | single | `claude-opus-5` | `gpt-5.6-sol`, `gpt-5.5` | `xhigh` | `long_context` |
| `decision-trail.reviewer` | single | `claude-sonnet-5` | `gpt-5.6-sol`, `gpt-5.5` | `medium` | `default` |

A panel's configured list length is its fanout. A caller that overrides a panel
with two entries gets two candidates; a caller that overrides it with five
entries gets five candidates. The resolver does not pad, truncate, or silently
restore the default panel length after an override.

## Boundary

These defaults only fill missing routing fields. They do not grant tools, choose
agents, validate reports, or replace the caller's authority to decide whether a
resolved role should be spawned.
