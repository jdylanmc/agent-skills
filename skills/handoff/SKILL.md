---
name: handoff
description: Create a bounded continuation handoff for a future agent from the current confirmed conversation and repository context. Use only when the operator explicitly invokes handoff or asks to create, save, or prepare a handoff for the next agent/session. Do not invoke automatically, for general note-taking, summaries, memory writes, destination-specific exports, workspace files, publishing, triage, bug filing, or when the operator asks to resume an existing handoff.
allowed-tools: ["read", "search", "execute"]
includes: ["_base/_molecules/chronicler/chronicler.md","handoff/_atoms/handoff-context-adapter/handoff-context-adapter.md","_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","handoff/_atoms/handoff-context-adapter/handoff-context-adapter.md","_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md"]
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
2. [Human handoff context adapter](./_atoms/handoff-context-adapter/handoff-context-adapter.md)
3. [Persist bounded handoff](../_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md)

## Core Workflow

1. Start or reuse the Chronicler run context. Record the requested handoff and
   continue even when recording is unavailable.
2. Gather only confirmed context from the current conversation and repository.
   Inspect branch, status, commits, diffs, and relevant existing artifacts when
   needed, but do not conduct a filename, destination, visibility, or placement
   interview.
3. Treat invocation arguments as focus for the next session. Use them to tailor
   `Goal`, `Current Progress`, and `Next Steps` only where they agree with
   confirmed evidence. If they conflict with evidence, preserve the evidence and
   record the conflict as a constraint or follow-up.
4. Use the human handoff context adapter to build a `schema_version: 1` payload
   for `persist-bounded-handoff`. Include required sections even when a section
   has no confirmed information. Keep `Suggested Skills` absent unless an exact
   available skill is useful next, and then include the skill name and reason.
5. Link existing specifications, plans, Architecture Decision Records (ADRs),
   issues, commits, diffs, logs, and generated artifacts in
   `artifacts_and_references`. Do not paste their bodies into the handoff.
6. Invoke the shared `persist-bounded-handoff` molecule with the adapted payload.
   Let it validate, redact, render, resolve the operating-system temporary path,
   create the file, reread it, and return the verified result.
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
- No invented progress, validation result, decision, owner, or next step.
- No copied bodies from existing specifications, plans, ADRs, issues, commits,
  diffs, logs, or generated artifacts.
- Redaction by the shared core is a floor. Remove sensitive context the core
  cannot reliably recognize before invoking it.
- This skill creates a new handoff only. It does not resume or ingest an
  existing handoff.
