# Intent: shepherd

Shepherd exists to take one existing git-hosted change request, or an explicit branch/base pair when no host adapter is available, and keep it moving until it is either mergeable and green or honestly handed back with the smallest remaining human decision.

The work is repetitive but risky: fetch the current base, rebase the pull request branch, handle conflicts, regenerate derived metadata, run the repository's declared validation, push the rebased branch with a lease, and wait for continuous integration. The skill should make that loop dependable without taking ownership of the final merge.

The important distinction is between authored meaning and generated consequence. A conflict in a generated or derived file should be resolved by regenerating that file from its source of truth, never by hand-merging generated output. A conflict in authored content is different: when two sides disagree semantically, the skill should stop with the competing evidence instead of pretending it knows the product decision.

Repository-specific conflict behavior belongs in configuration supplied to the run. A reusable shepherd may accept a rule that names derived path patterns, regeneration commands, or structured merge strategies for a repository, but it should not bake this repository's file conventions into the skill body.

A successful run means the branch was rebased only when a real trigger required it, local declared validation completed with trustworthy evidence, provider validation is green when observable, and any push used only a lease. When no provider adapter matches, the git-level core should still run and the report should say that hosted merge and check state could not be observed. It never means the skill merged the change request.
