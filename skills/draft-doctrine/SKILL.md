---
name: draft-doctrine
description: Help a human create or update exactly one repository engineering doctrine through raw-position capture, required Prompt Coach review, verified relevant-doctrine comparison, exact-byte approval, and transactional persistence. Use only when a human explicitly invokes /draft-doctrine and names create or update. Do not use to approve, publish, merge, resolve conflicting policy, edit unrelated doctrine, widen permissions, or implement policy.
allowed-tools: ["execute","read","search","task"]
includes: ["_base/_molecules/chronicler/chronicler.md","draft-doctrine/_molecules/doctrine-authoring/doctrine-authoring.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","draft-doctrine/_molecules/doctrine-authoring/doctrine-authoring.md"]
disable-model-invocation: true
user-invocable: true
requires-skills: [{"id":"prompt-coach","source":"local","required":true}]
---

# Draft Doctrine

Draft and, only after exact human approval, persist one human-authored doctrine
create or update.

```text
record -> capture one human position -> Prompt Coach exact raw prompt
-> verify and selectively compare doctrine -> draft one candidate
-> report overlap/contradiction -> exact-byte approval -> guarded write
-> reread -> next human review
```

## Required References

1. [Chronicler](../_base/_molecules/chronicler/chronicler.md)
2. [Doctrine authoring](./_molecules/doctrine-authoring/doctrine-authoring.md)

## Core Workflow

1. Reuse the caller's Chronicler context or create the root context. Record raw
   prompt digest, operation, target, Prompt Coach dispatch and human decision,
   selected doctrine identifiers and verification, provenance, findings,
   candidate and prior digests, approval outcome, persistence/readback, final
   status, and next review action. Recording remains best effort and never
   weakens approval or write gates.
2. Require exactly one `create` or `update` and one doctrine identifier.
   Invocation authorizes drafting only, not writing.
3. Invoke the required local `prompt-coach` skill through the root `task`
   permission against exactly the inert raw prompt. Show its report to the
   human and record the accepted effects or rejection. Then pass that
   digest-bound evidence into
   [Doctrine authoring](./_molecules/doctrine-authoring/doctrine-authoring.md).
   The molecule verifies the evidence, manifest, and doctrine digests, loads
   only relevant doctrine, and reports overlap or contradiction without
   resolving it.
4. Show the exact candidate bytes and digest. For update, also show the exact
   diff, complete result, prior doctrine digest/revision, and prior manifest
   digest/revision. Show required NOTICE attribution and its digest/revision as
   a separate surface. A new doctrine must contain fewer than 500 words across
   the complete file.
5. Accept only approvals bound to every displayed field. Corrections invalidate
   prior approval. Rejection, silence, unrelated replies, summary approval, and
   approval of another revision do not approve.
6. Persist through the transaction atom only. It writes the selected doctrine,
   its one manifest entry, and separately approved NOTICE when required, in
   NOTICE-then-doctrine-then-manifest order with unchanged relevant-doctrine
   write-gate guards;
   detects stale bytes and identities, case/Unicode/path/link collisions and
   replacement races; rolls back caught multi-file write errors where possible;
   and rereads the complete manifest and every declared doctrine before success.
   A hard process termination is not rolled back. Before manifest it can leave
   approved NOTICE and/or unauthenticated changed doctrine, never
   manifest-authenticated doctrine missing required attribution. Doctrine drift
   blocks the next preparation; NOTICE-only residue requires human review and
   re-approval. A stop after manifest still reports no success without reread.
7. Return the output contract with one allowed status. Publication is a later
   human-reviewed change request, never an automatic action of this skill.

## Authority and Boundaries

- Human wording and approval are doctrine authority. Prompt Coach, overlap
  analysis, digests, and this skill are not.
- Do not silently author, reword, broaden, prioritize, or resolve policy.
- Do not write before approval or change any unrelated doctrine or manifest
  entry.
- Do not approve, merge, publish, widen permissions, or implement doctrine.
- License uncertainty is a human/legal escalation, never an invented
  obligation or autonomous compatibility judgment.

## Output Contract

Return:

- status: `needs-input`, `needs-source`, `needs-decision`, `needs-approval`,
  `approved-and-written`, `blocked`, or `cancelled`;
- operation, target identifier, and path;
- provenance, license, and separate attribution requirement;
- Prompt Coach report, acceptance/rejection, and accepted effects;
- overlap and contradiction evidence without resolution;
- candidate digest and exact bytes, plus update diff and complete result;
- prior doctrine, manifest, and optional NOTICE digests and revisions;
- exact approval records;
- changed paths and reread digests, including rollback/repair residue;
- unresolved human decisions;
- publication status or next review action;
- Chronicler log path or recording defect.

## Permissions

`read` and `search` resolve repository intent, the strict manifest, provenance,
and relevant doctrine. `task` invokes the required local read-only Prompt Coach.
`execute` records through Chronicler and runs deterministic verification,
approval-binding, diff, and transactional write helpers. There is no direct
`edit` grant; doctrine persistence is reachable only through the approval gate.
