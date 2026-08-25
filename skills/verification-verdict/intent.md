# Intent: verification-verdict

Verification-verdict exists to replace vague claims like "passed", "green", or "looks good" with a small auditable outcome that names exactly what was checked and exactly which artifact was checked.

The central requirement is artifact binding. A verdict is useful only when it is tied to a stable identity for the artifact under review: a digest, commit, build number, specification revision, Gherkin revision, procedure revision, or equivalent identifier. If the artifact changes, the verdict becomes stale. A passing verdict for one revision must not silently transfer to another revision.

The skill needs a closed vocabulary: VERIFIED, NOT_VERIFIED, INCONCLUSIVE, and BLOCKED. VERIFIED means the supplied evidence supports the declared verification claim for the exact artifact identity. NOT_VERIFIED means the evidence shows the claim did not hold. INCONCLUSIVE means the evidence is incomplete, weak, contradictory, or not enough to decide. BLOCKED means verification could not be performed because a dependency, environment, permission, or input was unavailable.

Evidence strength and evidence pointers are part of the verdict, not decoration. The reader should be able to tell whether the evidence is direct, indirect, self-reported, incomplete, or unavailable, and where to inspect it. Continuous Integration (CI) green results, test reports, reviewer reports, or generated summaries can be evidence, but they never grant approval or risk acceptance by themselves.

The skill should build on the same idea as run-ci's evidence envelope: failures, cancellations, missing tools, and incomplete execution remain distinguishable. It should also respect review-validate-report's boundary: a report can be checked for contract shape without deciding whether its findings are correct. A verification verdict may cite a report, but the verdict is still just evidence.

This package is routable because no existing skill composes it today. Issue #67 lists future consumers, but promotion to a shared base unit should wait until at least two actual skills compose the same primitive and the shared boundary is proven by use.
