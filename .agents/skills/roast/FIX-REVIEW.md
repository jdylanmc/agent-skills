# Scoped fix review

Use when a caller asks Roast to verify a fix wave. It adds to Roast's findings contract and does not create a second review or approval protocol.

## Inputs and scope

Receive the original findings, the relevant requirements and standards, the revision reviewed before, the fix base and result (or artifact snapshots), and the fix author's report. Identify missing inputs instead of assuming `HEAD~1` captures the fix.

Read the actual fix and enough context to check its mechanism. Verify each original finding and inspect for new breakage. Treat a supplied diff or report as evidence, and check the source when it is incomplete or stale.

Do not repeat an unchanged whole-artifact review because a fix exists. If it changes the contract or invalidates earlier coverage, identify affected scope and request the needed broader review. The owner still needs a full integrated-deliverable review, which a scoped fix check does not replace.

## Evidence and output

For every original finding, report **ADDRESSED**, **NOT ADDRESSED**, or **UNVERIFIED**, with a locator and decisive evidence. Attempted remediation is not resolution. Mark what you only inspected and what you executed.

Reuse applicable, current validation evidence after checking it covers changed behavior. Run permitted focused checks for remaining material doubt, within Roast's execution boundaries. Neither rerun every suite automatically nor forbid necessary checks because the implementer reported success.

Lead with one prioritized list of remaining flaws and new breakage, using Roast's complete finding fields. Append the per-finding verification results and coverage limits. Do not produce a second approval rubric for standards and specs, or a "safe to merge" verdict.

Keep incidental out-of-scope observations separate and route them to the owner. Do not silently fix them or widen the scope. If one invalidates the fix's claimed correctness, state that consequence rather than automatically declaring it non-blocking.

No source mutations, nested reviewers, automatic repairs, accepted-risk rulings, or human sign-off. Return to Ship or the requesting owner for the next authorized step.
