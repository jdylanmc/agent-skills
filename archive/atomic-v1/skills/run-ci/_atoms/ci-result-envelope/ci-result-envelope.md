---
name: ci-result-envelope
description: Classify CI command attempts and assemble evidence that separates pass, failure, cancellation, missing tools, intermittent results, and incomplete execution.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["run-ci/_molecules/local-ci-run/local-ci-run.md"]
---

# CI Result Envelope

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `revision` | yes | The exact repository revision validated. |
| `dirty-state` | yes | Whether local changes were present while validation ran. |
| `commands` | yes | Ordered commands discovered from the provider. |
| `attempts` | yes | Process receipts for each executed command. |
| `skipped-steps` | no | Commands not run because execution was incomplete. |

## Classification

Use the first matching classification:

1. `cancelled` when the process was signalled, the execution was interrupted, or
   a parsed test summary reports a non-zero `cancelled` count.
2. `environment-failed` when the command could not start or the shell reports a
   missing tool or missing command. This is not a red validation build.
3. `failed` when the process exits non-zero for the same command on its final
   attempt.
4. `intermittent` when the first attempt was `failed` and the single retry
   passed.
5. `incomplete` when discovery succeeded but one or more commands were skipped
   because an earlier command did not recover.
6. `passed` when every required command ran, no command failed, and no test
   summary reports cancelled tests.

## Evidence Requirements

Every report includes:

- repository root, revision, and dirty-state summary;
- provider name and workflow path;
- job id, step name, shell, and exact command;
- each attempt's start time, end time, elapsed milliseconds, exit code, signal,
  classification, and retry role;
- parsed Node TAP summary fields when present, especially `cancelled`;
- skipped command records with the reason;
- final status and `evidence_complete`.

Do not collapse attempts into one line. The distinction between a persistent
failure and a failure that passed on retry is part of the result.

## Boundaries

This atom classifies and reports. It does not decide fixes, suppress raw
receipts, approve work, or reinterpret a cancellation as success.
