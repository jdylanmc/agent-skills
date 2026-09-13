---
name: poc
description: Test a bounded idea with real, isolated code. Use for proof-of-concept work, library or framework feasibility, engine experiments, compatibility or performance questions, and logic or UI prototypes. Run it and return findings, not product changes.
disable-model-invocation: false
user-invocable: true
---

# Proof of Concept

Buy real information cheaply. The prototype is usually throwaway; the learning is not. The retained [intent](intent.md) defines the purpose.

## 1. Frame the experiment

Identify the question, the approach being tested, and what observation would support or contradict it. Ideas, libraries, frameworks, engines, integrations, data models, and UI behavior are all eligible. Do not force a technical feasibility question into a visual demo.

Resolve missing decisions with the human before building: the learning goal, relevant environment, success/failure observations, and a time or effort limit. Reuse boundaries already supplied. Name excluded questions so a promising experiment does not silently grow into a build.

When called from discovery, take one bounded question and return evidence to that discovery session. Do not assume authority over its alignment, domain model, handoff, compaction, tracker, or next cycle.

## 2. Isolate and choose the smallest useful shape

Use a uniquely named session or OS-temporary directory outside the product checkout by default. If the experiment needs the app's context, agree on a separate scratch copy or isolated worktree first. Do not edit the working product checkout, its dependency manifests, live services, or databases. Do not silently save experiment artifacts into the repository.

Use synthetic inputs, fake credentials, local stubs, and scratch stores. Do not use real secrets or personal data. If the real integration cannot be tested within those limits, test the safe subset and mark the integration unverified. Do not claim a stub proves the external system works.

Choose the form that answers the question:

- **Technical feasibility:** a minimal executable, script, harness, or small app using the actual candidate technology. Exercise the API, compatibility boundary, failure case, or measured threshold at issue.
- **Interactive logic/state:** [LOGIC.md](LOGIC.md), when a shareable HTML demo helps a person explore transitions and edge cases.
- **UI exploration:** [UI.md](UI.md), when alternative layouts or interactions need human comparison.
- **Another form:** agree a similarly small, runnable experiment. The listed forms are not a closed menu.

Read only the reference needed for the chosen form. Its presentation guidance does not override this skill's isolation, execution, or no-product-change boundaries.

## 3. Build and run

Keep the code clearly marked as experimental. Use existing tools where practical; explain necessary dependencies and install them only inside the agreed scratch environment. Ask before external services, paid resources, or broader environment changes.

Skip production polish, general-purpose abstractions, and unrelated infrastructure. Include the assertions, diagnostics, error handling, or small tests needed to trust the experiment. A demo that merely builds has not answered a runtime question.

Run the experiment. Record the exact invocation, relevant versions and environment, inputs, expected observations, and actual outputs. Exercise the main case and the edge or failure cases that could overturn the conclusion. For a performance or compatibility claim, measure the agreed threshold on the relevant environment; report limitations rather than generalizing from a different one.

For interactive demos, exercise the controls or route yourself when tools permit, then ask the human for the judgments that require them. Never invent their feedback. If execution or feedback is unavailable, report the missing evidence and an inconclusive or partial result, not a successful proof.

Stop at the agreed limit. An unanswered question is a valid result; ask before extending the experiment. Stop run-owned servers when finished unless the human asks to keep them available, and state any remaining scratch resources.

## 4. Return the findings

Produce a concise findings packet with:

- The question, scope, and tested approach.
- How to reproduce it: artifact location, commands, versions, and inputs.
- Observations and evidence, including failures, edge cases, and gaps.
- Human feedback, distinguished from agent observations; mark it pending when absent.
- A supported, contradicted, or inconclusive verdict against the agreed question, with limitations and possible next investigations.

Keep findings in the conversation or alongside the scratch experiment unless another destination was explicitly authorized. Report scratch artifacts as temporary; do not promise they will survive cleanup. Retain the evidence needed by the receiver rather than deleting it before handoff.

Return the packet to discovery when that was the caller. Otherwise deliver it to the human for use in discovery, specification, or implementation. Do not promote prototype code into product code, create tickets or specs, deploy, commit, or publish the experiment as a side effect. Product implementation is separate work.
