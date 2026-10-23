`/stack this bug ontop: <url>`

A pull request stack is an ordered series of smaller, dependent pull requests where each PR builds on the branch of the one below it, allowing focused reviews and easier merging of large changes.

Overview
A pull request stack (also called stacked pull requests) is a workflow where a large feature or change is split into multiple, smaller PRs arranged in a dependency chain.

The bottom PR targets the main branch (or another chosen trunk).
Each subsequent PR targets the branch of the PR below it.
Reviewers see only the diff for that layer, not the entire feature.

How It Works
Trunk (base): The bottom PR's target branch (often main).
Stack layers: Each PR represents a discrete, reviewable change.
Dependency chain: Higher layers depend on lower ones; foundational changes go at the bottom.
Evaluation: All PRs are evaluated against the trunk's branch protections and checks, even if they target intermediate branches.

Why Use Pull Request Stacks
Smaller, focused reviews → reduces reviewer fatigue and improves clarity.
Keeps work moving → you can continue building on unmerged work.
Fewer merge conflicts → each layer stays rebased and aligned with the trunk.
Better for large or AI‑generated code changes → each task becomes its own PR.

So, /stack it may refer to breaking up a PR into smaller chunks

it may also refer to stacking changes ontop of another PR

it may also refer to preserving a chain of PRs
