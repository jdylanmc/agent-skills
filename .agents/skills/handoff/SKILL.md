---
name: handoff
description: "Human direction for cross-session or machine transfer; scoped agent-to-agent handoffs allowed. Transfer accessible evidence, permissions, doctrine, and explicit ownership without duplicating controllers."
argument-hint: "What will the next session be used for?"
disable-model-invocation: false
user-invocable: true
---

# Handoff

**Entry:** human direction for cross-session/machine transfers, or scoped
agent-to-agent work under the [invocation contract](../setup/INVOCATION.md).
Confirm destination/access and what transfers. A portable-document request
does not authorize starting another Joe-mode.

Follow [doctrine selection and application](../doctrine/APPLY.md); consider
`context` when none was preselected. Carry the task/delivery's doctrine packet:
operator choices, required and assigned IDs, reasons, accessible source locations,
pinned digests, and any missing/load/application status. Do not copy every
doctrine body; the receiver retrieves verified text before applying it.

For portable transfer, write a uniquely named handoff document in the session
workspace or OS-temporary directory, not the repository; report its lifetime.
For a live worker, send the bounded packet through the actual supported agent
interface; do not require a redundant document.

Include a "suggested skills" section in the document naming which skills the
next agent should call the Skill tool for.

Respect each suggested skill's caller contract. Carry objective and original
start evidence, permissions and pending human decisions, parent/controller IDs,
delivery route and PR/worktree owner, dependencies, current evidence, and stop/
return conditions. Source paths must be accessible at the destination; summaries
do not replace unavailable originals. Preserve status-report event identities
when transferring a controller to avoid duplicate reports on resumption.

The sender retains custody until the receiver acknowledges the assignment and
actual workspace/PR state. Do not imply that writing or sending the packet
transferred ownership, stopped a monitor, or scheduled work. Never leave two
writers on one branch or two Joe controllers for one repository.

Reference existing artifacts (specs, plans, ADRs, issues, commits, diffs) by path
or URL; do not duplicate their content.

Redact sensitive information, such as API keys, passwords, or personally
identifiable information.

Consult [Changelog](../changelog/SKILL.md) for authorized persistent changes;
ordinary temporary handoffs are not notable product changes and create no
changelog edit.

Treat any user arguments as the next session's focus; tailor the document accordingly.
