# Intent: run-ci

## What this is for

Run the validation a repository already declares for itself and report what
happened with enough evidence that the result can be trusted.

The skill exists because guessing a test command is not validation. In this
repository the GitHub Actions workflow names every test file explicitly and does
not glob. A command that looks plausible can run the wrong set, omit cancelled
tests, and produce a green result that continuous integration would not have
produced.

## What it must do

It discovers the validation provider before running anything. GitHub Actions is
the first supported provider. The workflow's `run` steps are the local command
authority, and they are run in workflow order rather than replaced by a guessed
lint, build, or test command.

It reports the full result envelope for every step: repository revision,
workflow, job, step name, command, started and completed times, exit code,
signal, missing-tool or environment failures, test failures, cancellations, and
whether later steps were skipped because execution was incomplete.

If a command fails like a real validation failure, it is retried once before the
result is reported. A pass after that retry is called intermittent, not hidden.
A missing tool is reported as an environment failure rather than as a red build.
A cancellation is reported as cancellation even when the process exits in a way
that could otherwise be mistaken for ordinary failure.

## What it is not

It is not a fixer, merger, approver, formatter, package installer, or workflow
designer. It does not invent new validation tooling, repair failures, requeue
remote jobs, change source files, or decide that a pull request is approved. It
runs the existing validation and reports evidence.

## What must be true

- The commands come from the repository's declared validation, not from habit.
- Unsupported providers degrade clearly instead of producing an invented
  command.
- Each command result is bound to the repository revision it verified.
- Cancellations, missing tools, incomplete execution, persistent failures, and
  intermittent failures are distinguishable in the output.
- The skill is read-only with respect to the project under validation.
