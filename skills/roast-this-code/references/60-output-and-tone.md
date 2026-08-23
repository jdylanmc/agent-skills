---
includes: []
requires-skills: []
---
# Final Output and Tone

## Output Order

Return these sections:

## Executive Summary

Return the validated derived summary. If generation failed, state the evidence
gap without inventing a replacement.

## The Roast

Give a short opening monologue that reflects only accepted canonical findings.
Keep it memorable, code-focused, and proportionate. Do not introduce technical
claims that are absent from the canonical details.

For security, privacy, safety, data-loss, accessibility, incident, or other
consequential findings, state the literal warning and consequence first.
Suppress humor when it could reduce urgency or clarity. Every roast line must
display its canonical finding ID.

## Technical Details

Return the frozen Roastmaster report as an opaque payload:

1. state its SHA-256 content hash;
2. choose a fence at least one backtick longer than the longest fence in the
   report, and never shorter than four backticks;
3. place the report bytes unchanged inside that fence.

Treat headings and terminators inside the payload as content, not outer
structure.

## Recommended Handoff

State:

- the ordered canonical finding IDs another agent should address;
- exact locations and implementation objective for each group;
- prerequisite evidence checks and dependency order;
- validation expected after each group;
- unresolved evidence the implementation agent must inspect;
- explicit `Do not implement until resolved` conditions;
- explicit confirmation that this skill made no changes.

## Tone Rules

- Punch up at complexity, accidental behavior, misleading abstractions, and
  unjustified confidence.
- Never insult the author, contributor, team, user, or reviewer.
- Never use identity, protected traits, personal circumstances, competence,
  intelligence, or employment as joke material.
- Do not use threats, humiliation, harassment, sexual content, slurs, or
  demeaning comparisons.
- Use at most one roast line per accepted finding.
- Make the technical consequence understandable without the joke.
- Reduce humor when the finding concerns security, privacy, safety, data loss,
  accessibility, or an incident.
- Zero accepted findings is a successful result. Congratulate the code without
  inventing a roast.

## Human-Facing Content Gate

Before returning:

1. Verify technical details match the frozen Roastmaster report by exact
   content hash. Permit only explicitly defined line-ending normalization.
2. Verify the executive summary passes the traceability gate.
3. Verify every roast line maps to an accepted finding.
4. Verify priorities, confidence, counts, locations, and identifiers agree.
5. Verify no language targets a person.
6. Define unfamiliar abbreviations on first use outside unchanged technical
   identifiers.
7. Separate evidence, consequence, recommendation, and humor.
8. Remove ambiguity about what another agent should inspect or change.
9. Verify the outer headings appear exactly once and in the declared order
   outside every fenced block, with no unexpected top-level heading.

If the gate fails, correct only the derived summary, roast, or handoff. Never
silently modify frozen technical details.
