---
name: prototype-run
description: Build and execute the smallest isolated prototype that can answer the scoped proof-of-concept question.
level: atom
allowed-tools: ["execute","read","search"]
includes: []
composes: []
used-by: ["proof-of-concept/_molecules/prototype-learning/prototype-learning.md"]
---

# Prototype Run

Build and run the throwaway experiment.

## Operation

1. Create or choose an isolated prototype workspace:
   - a session temporary directory by default;
   - an isolated git worktree only when repository integration is the question;
   - a repository path only with explicit approval.
2. Install dependencies only inside the isolated prototype workspace unless
   the human explicitly approves otherwise.
3. Use synthetic data and local endpoints by default.
4. Run the smallest commands needed to answer the question.
5. Capture command lines, relevant output, generated artifacts, screenshots or
   local browser observations when useful, and cleanup actions.
6. Retry setup once when the failure is clearly environmental. Do not retry a
   genuine negative result into a false positive.

## Failure Classification

| Failure | Meaning |
| --- | --- |
| `not-supported` | The library, framework, engine, or approach cannot satisfy the question. |
| `setup-failed` | The prototype could not start because of tooling, install, or environment. |
| `inconclusive` | The experiment did not produce enough signal. |
| `too-complex` | The idea works only with complexity that changes the recommendation. |
| `unsafe` | The experiment would require secrets, personal data, production access, or unapproved destructive action. |

## Boundaries

- Do not touch production data or real credentials.
- Do not deploy.
- Do not commit or push.
- Do not leave files in the repository unless explicitly approved.
- Do not harden prototype code into production implementation.
