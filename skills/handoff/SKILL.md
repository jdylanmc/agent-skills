---
name: handoff
description: Create a bounded continuation handoff for a future agent from the current confirmed conversation and repository context. Use only when the operator explicitly invokes handoff or asks to create, save, or prepare a handoff for the next agent/session. Do not invoke automatically, for general note-taking, summaries, memory writes, destination-specific exports, workspace files, publishing, triage, bug filing, or when the operator asks to resume an existing handoff.
allowed-tools: ["read", "search", "execute"]
includes: ["_base/_molecules/chronicler/chronicler.md","_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
disable-model-invocation: true
user-invocable: true
requires-skills: []
---

# Handoff

Create one bounded continuation artifact for a future agent. The artifact uses
confirmed session and repository evidence, links existing artifacts instead of
copying them, and is written only by the shared bounded-handoff core to the
runtime-reported temporary handoffs directory.

This skill is explicitly invoked. It is never auto-routed from a vague request
for a summary, plan, note, memory, or export.

## Required References

1. [Chronicler recording molecule](../_base/_molecules/chronicler/chronicler.md)
2. [Persist bounded handoff](../_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md)

## Core Workflow

1. Start or reuse the Chronicler run context. Record the requested handoff and
   continue even when recording is unavailable.
2. Gather only confirmed context from the current conversation and repository.
   Keep read and search inside the repository; use execute only for bounded
   repository inspection such as `git status`, `git branch`, `git log`, and
   `git diff`, plus the recording and persistence operations below. Do not
   conduct a filename, destination, visibility, or placement interview.
3. Treat invocation arguments as focus for the next session. Use them to tailor
   `Goal`, `Current Progress`, and `Next Steps` only where they agree with
   confirmed evidence. If they conflict with evidence, preserve the evidence and
   record the conflict as a constraint or follow-up.
4. Build the shared payload documented by `persist-bounded-handoff`, with
   `schema_version: 1` and a `slug_source` from the repository, branch, or concise
   work title. Let the core normalize the slug. Leave sections empty when
   nothing is confirmed; refuse with the missing evidence if that would make
   the handoff misleading. Keep dirty files and known validation results in
   `current_progress`, explicit choices and constraints in
   `decisions_and_constraints`, and failed attempts plus problems still open
   when the session stopped in `what_did_not_work`.
   Order `next_steps`; label a judgement call with `Recommendation:` and name
   the alternative rather than stating it as fact.
   Include `suggested_skills` only for a useful next skill, with its exact name
   and reason, and populate `available_skills` with the real routable skill
   identifiers from the repository or runtime.
5. Link existing specifications, plans, Architecture Decision Records (ADRs),
   issues, commits, diffs, logs, and generated artifacts in
   `artifacts_and_references`. Do not paste their bodies into the handoff.
6. Remove sensitive context the redaction floor cannot recognize, including
   customer names, internal hostnames, and unnecessary private paths. Pass the
   payload unchanged on standard input to `persist-bounded-handoff.mjs --stdin`.
   Let that one operation validate, redact, render, resolve the temporary path,
   write, and reread. Do not manually run its individual stages or retry
   persistence failures.
7. Report the exact `path` returned by the molecule, plus any redaction counts
   and whether `Suggested Skills` was included. Do not create or copy a handoff
   file in the workspace.
8. Record the final outcome in Chronicler, including the exact created path on
   success or the stable failure category on failure.

## Output Contract

Return a concise completion message containing:

- the exact handoff path returned by `persist-bounded-handoff`;
- whether sensitive content was redacted, by category when reported;
- whether `Suggested Skills` was included;
- any failure category if persistence did not succeed.

Do not include the full handoff body in the response.

## Boundaries

- No filename, destination, visibility, or placement questions.
- No workspace handoff file, duplicate export, commit, pull request, issue, or
  external publication.
- No invented progress, validation result, decision, or owner. A next step
  presented as established fact must be backed by evidence; a recommended move
  is permitted only when it is labelled as a judgement, so the next agent can
  disagree with it knowingly.
- No `Suggested Skills` entry without `available_skills` populated, so an
  invented skill name is refused rather than handed to the next agent.
- No copied bodies from existing specifications, plans, ADRs, issues, commits,
  diffs, logs, or generated artifacts.
- Redaction by the shared core is a floor. Remove sensitive context the core
  cannot reliably recognize before invoking it.
- This skill creates a new handoff only. It does not resume or ingest an
  existing handoff.
