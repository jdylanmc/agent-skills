---
name: ci-runner
description: Discover GitHub Actions run steps and execute those declared commands locally in workflow order.
level: atom
allowed-tools: ["read","search","execute"]
includes: ["run-ci/_atoms/ci-runner/ci-runner.mjs"]
composes: []
used-by: ["run-ci/_molecules/local-ci-run/local-ci-run.md"]
---

# CI Runner

## Required Files

1. [CI runner helper](./ci-runner.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `repository-root` | yes | Absolute path to the repository being validated. |
| `workflow-path` | no | One explicit GitHub Actions workflow path to inspect instead of every workflow. |
| `mode` | yes | `discover` or `run`. |

## Operation

1. Inspect `.github/workflows/*.yml` and `.github/workflows/*.yaml`, or the
   explicitly named workflow path.
2. Parse GitHub Actions jobs and ordered `steps`.
3. Return each `run:` step exactly as declared after YAML block-scalar folding.
   Do not infer commands from file names, package manifests, or common project
   conventions.
4. Return `uses:` steps separately as provider actions that the local run does
   not emulate.
5. In `run` mode, execute each discovered command from the repository root,
   retry a validation failure once, and stop after an unrecovered
   non-successful result.

## Helper Invocation

From the repository root:

```text
node skills/run-ci/_atoms/ci-runner/ci-runner.mjs --discover --json
node skills/run-ci/_atoms/ci-runner/ci-runner.mjs --run --json
```

The helper is deterministic support for the skill. Its output is evidence for
the skill's report, not a new validation standard.

## Boundaries

This atom supports GitHub Actions `run:` steps first. It does not execute
provider `uses:` actions, install missing tools, synthesize a replacement
command, or edit the repository.
