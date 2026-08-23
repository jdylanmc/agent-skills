---
includes: []
requires-skills: []
---
# Executive Summary Composition

## Source of Truth

The frozen canonical technical details are the only source for the executive
summary. Treat them as an established technical artifact.

Invoke `/simplify-technical-language` in derived-summary mode with:

- primary audience: engineering leadership;
- primary audience assumed knowledge: understands product and delivery context
  but may not know the changed implementation;
- primary action: decide what blocks acceptance and what follow-up to fund;
- independent-consumption level: standalone;
- named implementation layer audience: implementation owner;
- implementation layer purpose: preserve exact change order, prerequisites,
  evidence checks, and validation;
- consequence of misunderstanding: incorrect merge, sequencing, or remediation
  decision;
- purpose: decide what must change, why it matters, and in what order;
- canonical technical details and their stable finding IDs;
- complete evidence ledger, source classifications, and claim-to-finding map;
- current candidate identifier and content hash;
- prior STE dispositions, or `none` on the first pass;
- locked priorities, confidence values, identifiers, locations, and technical
  terms;
- requirement to preserve every `Must fix`;
- prohibition on new claims, reprioritization, or technical-detail edits;
- conversation-only publication behavior.

Launch a read-only task subagent. Instruct it to load the resolved
`skills/simplify-technical-language/SKILL.md` package and run
`derived-summary` mode. That subagent can launch STE Coach execution monitoring
as required by the simplification skill. If nested task delegation is
unsupported, treat simplification as unavailable. Do not improvise a summary.

## Derived-Summary Requirements

The executive summary must include:

- overall assessment in one short paragraph;
- `Must fix` count and consequences;
- highest-value `Should fix` themes;
- recommended implementation order;
- residual uncertainty or evidence gaps;
- traceability from each statement to canonical finding IDs.

Humor is optional in the executive summary. Clarity and decision usefulness
take priority.

Exclude non-evidentiary roast lines from the derived-summary claim ledger.

## Traceability Gate

Compare the derived summary with the frozen technical details:

1. Every `Must fix` appears.
2. No accepted finding changes priority or confidence.
3. No new technical claim appears.
4. Counts match.
5. Implementation order matches the canonical report.
6. Residual uncertainties remain visible.
7. Every material statement cites one or more canonical finding IDs.

Reject a failed summary and retry derived-summary mode once with the exact
traceability defects and the same frozen candidate and ledger. If it fails
again, omit the executive summary and return
the unchanged technical details with the summary evidence gap.

The executive summary never becomes the source of truth.
