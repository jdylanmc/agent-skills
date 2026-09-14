---
name: patch
description: "Human kickoff or human-started Joe-mode only. Reproduce a bug or regression, establish cause, repair, review, and shepherd a green PR current with its target. Not planned behavior changes; explicit diagnosis-only stays read-only."
disable-model-invocation: false
user-invocable: true
---

Use [doctrine selection and application](../doctrine/APPLY.md): require `debugging` for diagnosis and `worktrees` before preparing PR changes. Preserve inherited selections; with none, consider `code` and `testing` for repair. Load selected texts before applying them; preserve diagnosis-only and mutation boundaries. Code Roast also requires `solid`.

# Patch

Separate observed symptom from inferred cause. Establish a mechanism explaining the evidence before changing product behavior. See the human-approved [intent](intent.md) and common [invocation policy](../setup/INVOCATION.md).

## Scope and safety

- **Human or human-started Joe-mode selects this root route.** Direct Patch invocation or Joe-mode selection authorizes in-scope isolation, repair, commits, push/PR, review/fixes, and Shepherd custody without repeated implementation/publication questions. Patch owns bug/regression delivery, not planned behavior changes; return those to Joe-mode/the human for routing.
- **Diagnosis-only when requested.** Explain/investigate/diagnose-only requests do not authorize fixes, even through this skill. Stop when evidence establishes the cause or exact blocker. Automatic selection cannot turn read-only scope into repair permission.
- **Continue, do not duplicate.** An existing Patch-owned PR may return from Shepherd for bounded repair. A scoped diagnostic assignment within another delivery returns evidence to that owner, not a second route, PR, or monitor. Other skills must not autonomously select Patch as a new root delivery.
- Read repository guidance, relevant `CONTEXT.md`, and architectural decisions before exploring. Respect the agreed scope.
- Redact secrets from commands, output, and captured artifacts. Use environment variables, not embedded credentials. Capture only needed evidence.
- Use existing checks, read-only inspection, and isolated reproduction artifacts during diagnosis. Ask before changing product code for instrumentation, touching production, or running destructive probes. Inspect bundled scripts and their inputs before using them.
- Preserve others' changes and evidence. Remove only artifacts this investigation created and is authorized to remove.

For authorized repair, establish an owned isolated workspace through [the workspace procedure](../ship/WORKSPACE.md) before preparing PR changes. In [the shared delivery packet](../ship/DELIVERY.md#one-delivery-packet-one-owner), record `patch` as owner route, return owner, source/target refs, requirements, validation, and doctrine sources/digests. The shared finish does not invoke Ship. Clarify material missing requirements, semantic conflicts, and scope changes; invocation grants no destructive-probe or production-data access.

## 1. Establish the failure

Read the complete relevant error and stack trace. Record expected/actual behavior, inputs, environment, version, and exact failing command or interaction.

Check recent code, dependency, configuration, and environment changes. Compare with a working example or known-good state. A nearby failure is not necessarily the reported bug.

Establish why the expected behavior is the existing contract or previously worked. Return planned behavior additions for routing; do not manufacture a defect to keep them in Patch.

## 2. Build and minimize a feedback loop

Find one repeatable command exercising the real failing path and distinguishing the user's symptom from success. Observe its failure before proposing a repair.

Choose the smallest useful mechanism:

- A focused unit, integration, or end-to-end test at a public interface.
- An HTTP or CLI invocation with a fixture and an independent expected result.
- A browser interaction with an assertion on the actual behavior.
- A redacted trace replay or isolated harness for the affected code path.
- Differential testing or bisection between known-good and failing states.
- A property or stress loop for intermittent behavior.
- A human-assisted loop only when the interaction cannot be automated; adapt [the template](scripts/hitl-loop.template.sh) to the approved environment.

Narrow setup, pin controllable inputs, and assert the specific symptom rather than "did not crash." Minimize inputs, steps, and dependencies one at a time; rerun after each reduction.

For intermittent failures, record attempts and failures under a controlled workload; increase reproduction frequency without claiming one successful run proves a fix. For performance failures, establish a baseline and an explicit comparison or threshold before changing anything.

If no usable loop is possible, report attempts and the exact blocker. Ask for the smallest missing access, redacted capture, or instrumentation permission. Never present an untested hypothesis as a diagnosis.

## 3. Explain the cause

Trace inputs, state transitions, and ownership boundaries backward from the symptom. Compare the failing path with working code and list the relevant differences.

Rank plausible hypotheses by evidence and falsification cost. State each prediction: "If X causes this, changing Y should produce Z." Do not invent alternatives when evidence already distinguishes the mechanism.

Test **one hypothesis and one variable at a time**. Prefer debugger inspection and targeted probes over broad logging. Tag temporary instrumentation for discovery/removal. For performance regressions, measure and profile rather than increasing log volume.

Record what each experiment rules in/out. A failed hypothesis is evidence, not reason to stack speculative fixes. Stop once a credible mechanism explains the observations and a discriminating experiment supports it.

**Diagnosis-only exit:** report cause, proof, confidence, and remaining uncertainty. A proposed fix is a recommendation, not implementation permission.

## 4. Repair only when authorized

Use [tdd](../tdd/SKILL.md) to turn the minimized reproduction into a failing test at the real boundary. Tests unable to reproduce the actual interaction give false confidence. Pass the established diagnosis and Patch return owner; TDD must not restart Patch or create another delivery.

If no suitable test boundary exists, document the limitation and retain reproduction evidence. Discuss the missing boundary; do not add unrelated architecture or pretend the bug is covered.

Change the narrowest layer owning the incorrect behavior. Preserve surrounding behavior, out-of-scope interfaces, and the user's changes. Do not add retries, timeouts, validation layers, renaming, cleanup, or abstractions merely to suppress symptoms or improve unrelated code.

If a fix fails, revisit evidence and revise the hypothesis instead of stacking fixes. After three failed repair attempts, stop and discuss assumptions and architecture with the user before another attempt. Repeated failure warrants reconsidering the approach, not concluding the architecture is wrong.

## 5. Verify the repair

Use [verify](../verify/SKILL.md) for evidence freshness and completion claims; it does not expand the repair's scope.

- Rerun the original, unminimized reproduction and the regression test.
- Check the affected behavior and relevant surrounding tests. Use the same workload and acceptance threshold for performance or intermittent failures.
- Remove only this investigation's temporary instrumentation and disposable artifacts; preserve still-relevant evidence.
- State the actual result. Distinguish a verified fix from an untested change, partial mitigation, unavailable check, or blocked investigation.
- Report cause, decisive proof, authorized changes, and unresolved risk. Preserve the causal explanation in the delivery's commit or PR description.

## 6. Deliver under Patch ownership

For repair delivery, execute [the shared finish and maintenance contract](../ship/DELIVERY.md): independent Roast, required integrated validation, criterion verdicts, one PR, current-target readiness, and actual Shepherd custody until a terminal state or explicit blocker. A verified local diff or internal draft is not the final handoff. Patch delivers its own work; do not invoke Ship to finish it.

Every modifying agent uses [changelog](../changelog/SKILL.md); isolated workers return proposals and the integration owner consolidates/deduplicates the notable entry before review. Use the [shared commit-message policy](../setup/COMMIT-STYLE.md), keeping the causal explanation when consequential.

On functional feedback, recover the current PR and original bug evidence. Classify the finding within Patch's bug/regression scope; repeat affected diagnosis/repair/proof and independent review on the same branch/PR. Return head/results to its existing Shepherd, not a second monitor. Return different-kind or scope-changing work to Joe-mode/the human. Explicit diagnosis-only or scoped worker requests return evidence without publication; never treat them as repair authority. No deployment, self-approval, merge, or automatic merge.

## Supporting techniques

Load these only when relevant; examples do not expand the task's mutation authority or justify unrelated changes:

- [Root-cause tracing](root-cause-tracing.md): follow a bad value to its origin; includes the test-pollution helper.
- [Condition-based waiting](condition-based-waiting.md): replace guessed delays with bounded waits for an observable condition, except when elapsed time is itself the behavior under test.
- [Defense in depth](defense-in-depth.md): choose additional validation only for demonstrated bypass paths and clear ownership of invariants.

`test-academic.md` and `test-pressure-*.md` are evaluation prompts, not instructions for a real environment. `CREATION-LOG.md` records upstream history, not validation of this merged skill.
