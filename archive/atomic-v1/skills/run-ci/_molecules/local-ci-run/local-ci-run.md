---
name: local-ci-run
description: Discover a supported local CI provider, execute its declared commands in order, and assemble the result envelope.
level: molecule
includes: ["run-ci/_atoms/ci-runner/ci-runner.md","run-ci/_atoms/ci-result-envelope/ci-result-envelope.md"]
composes: ["run-ci/_atoms/ci-runner/ci-runner.md","run-ci/_atoms/ci-result-envelope/ci-result-envelope.md"]
used-by: ["run-ci/SKILL.md"]
allowed-tools: ["execute","read","search"]
---

# Local CI Run

## Required References

1. [CI runner](../../_atoms/ci-runner/ci-runner.md)
2. [CI result envelope](../../_atoms/ci-result-envelope/ci-result-envelope.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `repository-root` | yes | Absolute path to the repository being validated. |
| `workflow-scope` | no | Optional workflow path when the caller explicitly narrows the run. |
| `run-context` | no | Chronicler `run_id`, `root_skill`, and `log_path` from the root invocation. |

## Operation

1. Use [CI runner](../../_atoms/ci-runner/ci-runner.md) in discovery mode to
   inspect GitHub Actions workflow files and return the ordered local `run:`
   commands. If no supported provider or no runnable commands are found, stop
   with `unsupported-provider` and list the inspected files.
2. Record the discovered provider, workflow files, command count, and skipped
   provider actions through Chronicler when recording is available.
3. Execute the discovered commands in order from the repository root. Stop on
   the first command whose final classification is not `passed` or
   `intermittent`, and mark later commands `skipped` because execution is
   incomplete.
4. Retry a command once only when the first attempt is a validation `failed`
   outcome. If the retry passes, classify the step and the run as
   `intermittent`; preserve both attempts in the evidence.
5. Pass every attempt and skipped step to
   [CI result envelope](../../_atoms/ci-result-envelope/ci-result-envelope.md).

## Output

| Field | Meaning |
| --- | --- |
| `provider` | `github-actions` or `unsupported-provider`. |
| `commands` | Ordered workflow-derived commands with workflow, job, step, shell, and command text. |
| `provider_actions` | Non-local `uses:` steps reported as setup assumptions. |
| `steps` | Executed and skipped steps with their attempts. |
| `status` | Overall status from the result envelope. |
| `evidence_complete` | `true` only when discovery and every required command completed. |

## Boundaries

This molecule does not invent commands, emulate hosted-runner actions, install
tools, edit files, continue past an unrecovered failure, or convert an
intermittent pass into an ordinary pass.
