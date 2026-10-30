# Code review guidance

Use only for relevant code or design evidence. Repository requirements override optional heuristics. Roast's review-only boundaries and output contract apply throughout.

For code, load required `solid` through [Doctrine](../doctrine/SKILL.md) before applying these optional heuristics. Assess the relevant principles against evidence. Loading `solid` does not mandate abstractions or manufacture findings. Preserve other Roast work-packet selections.

## Requirements and correctness

Trace the actual behavior against the supplied acceptance requirements. Look for missing or partial functionality, scope creep, wrong state transitions, edge cases, error propagation, data loss, concurrency hazards, and incompatible API or data changes. Ground a finding in a real path or a bounded experiment. A suspicious-looking line alone is not enough.

Inspect tests for defect sensitivity and observable behavior, not coverage claims or mocked internals. Identify unverified requirements and whether recorded results cover the reviewed state. Migration or rollout claims need relevant compatibility and recovery evidence.

## Standards and design

Cite governing repository guidance or selected doctrine before alleging a violation. Consider naming, ownership, type safety, dependency direction, boundaries, maintainability, and the smallest design that meets the need where those affect the requested outcome.

The imported review's smell vocabulary can help identify a concern:

| Heuristic | Question to investigate |
| --- | --- |
| Mysterious Name | Does a misleading or ambiguous name obscure the actual contract? |
| Duplicated Code | Will the duplicate behavior diverge, or are the cases distinct on purpose? |
| Feature Envy | Does behavior belong with the data or responsibility it repeatedly reaches into? |
| Data Clumps | Do recurring values represent one domain concept with shared invariants? |
| Primitive Obsession | Does a bare primitive hide a real domain constraint? |
| Repeated Switches | Do repeated dispatch decisions drift apart or duplicate ownership? |
| Shotgun Surgery | Does one responsibility require unjustifiably scattered changes? |
| Divergent Change | Is one unit changing for unrelated responsibilities? |
| Speculative Generality | Is machinery present for requirements that do not exist? |
| Message Chains | Is a caller depending on internal navigation it should not know? |
| Middle Man | Is delegation obscuring rather than enforcing a useful boundary? |
| Refused Bequest | Does an inherited contract misrepresent what a subtype supports? |

These questions are not automatic refactoring instructions. Label supported smells as heuristic concerns with concrete consequences. Do not invent abstractions, mandate polymorphism, or report every familiar pattern as a defect.

Avoid duplicating routine formatter or linter output. When an actual check failure matters to review, cite the observed result and its consequence rather than claiming that tools will enforce it without evidence. Roast can inspect or run permitted non-mutating checks, and it does not auto-fix their findings.

Report one prioritized findings list. Close with short coverage that separates requirements from standards, and let neither hide the other's gaps.
