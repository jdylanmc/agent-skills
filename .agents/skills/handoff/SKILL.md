---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Follow [doctrine selection and application](../doctrine/APPLY.md); `context` is a candidate when none was preselected. Preserve the task/delivery's doctrine packet in the handoff: operator choices, required and assigned IDs, reasons, accessible source locations, pinned digests, and any missing/load/application status. Do not copy every doctrine body; the receiving agent retrieves verified text before applying it.

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
