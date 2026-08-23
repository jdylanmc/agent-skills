---
name: validation-release-gate
description: Verify a new skill package with the repository validator, deriver, explicit CI test list, diff hygiene, and Skill Coach review before shipping.
level: atom
allowed-tools: ["read","search","edit","execute","task"]
includes: []
composes: []
used-by: ["create-skill/_molecules/skill-package-conformance/skill-package-conformance.md"]
---

# Validation and Release Gate

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `package-path` | yes | The new `skills/<skill>/` package path. |
| `changed-files` | yes | The complete diff for the package and any CI registration change. |
| `test-files` | no | Any new or changed `*.test.mjs` files. |
| `review-agent` | no | `agents/skill-coach.agent.md` when available for package review. |

## Operation

1. Verify the package has a stored intent before anything is called ready. Run
   the release check the intent gate provides; `blocked` means there is no
   finished package to ship, not an outstanding item. Report it, and stop. Every
   package this skill creates carries an intent, so a package without one is
   incomplete rather than merely unreviewed.
2. If a new test file is added, register it explicitly in
   `.github/workflows/validate-skills.yml`. The workflow does not glob tests;
   an unregistered test is not run in Continuous Integration (CI).
3. Inspect tests for cancellation hazards. Do not define a test inside another
   test's synchronous callback; watch the `cancelled` count in `node --test`
   output, not only `fail`.
4. Keep assertions independent of line wrapping. Match whitespace-normalized
   text rather than a hard-wrapped multi-line string, so a reflow of the source
   and a CRLF checkout both leave the assertion intact. A repository-wide
   `.gitattributes` normalizes checkouts; an assertion that also tolerates
   wrapping fails for the reason it tests rather than for its formatting.
5. Run the validation sequence from the repository root:

   ```text
   node scripts/validate-skill-graph.mjs
   node scripts/derive-skill-graph.mjs --write
   node scripts/derive-skill-graph.mjs
   node --test $(grep -oE "(scripts|skills)/[^ ]*\.test\.mjs" .github/workflows/validate-skills.yml | tr '\n' ' ')
   git diff --check
   ```

6. After `derive-skill-graph.mjs --write`, inspect the diff. The deriver may
   update `used-by` on composed units and `allowed-tools` on molecules. It must
   not widen a routable skill's `allowed-tools`.
7. If the combined test run reports one intermittent failure, rerun once before
   assigning blame. Report both outputs honestly. Any persistent failure or any
   `cancelled` test is blocking.
8. Review the package against `agents/skill-coach.agent.md`. Fix every finding
   that shows the package fails repository conventions, its own scope, or its
   safety boundaries. Record non-blocking improvements separately.
9. Before shipping, verify no signature footer was added and no external skill
   source was read, copied, or adapted.

## Output

| Field | Meaning |
| --- | --- |
| `intent_requirement` | `satisfied`, or `blocked` with the reason the package is not finished. |
| `validation_output` | Verbatim summaries from each command, including `cancelled`. |
| `derived_updates` | Files changed by the deriver. |
| `ci_registration` | Whether every new test is listed in the workflow. |
| `skill_coach_result` | Blocking findings, improvements, and what was fixed. |
| `ship_readiness` | `ready`, `blocked`, or `degraded`, with reason. |

## Guarantees

- A package with no stored intent is never reported as ready.
- Local validation matches the Continuous Integration (CI) test list.
- Generated graph fields are current after derivation.
- Test cancellations cannot be hidden by a zero-failure count.
- Skill Coach review happens before the package is called ready.

## Boundaries

This atom does not create package content, run the new skill, approve a pull
request, or treat an unregistered local test as validated by Continuous
Integration (CI).
