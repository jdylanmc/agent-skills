---
name: explanation-ladder
description: Explain one subject at three increasing levels — five-year-old, junior practitioner, expert — each concise, bulleted, and adding depth the last did not, with a deterministic checker for the structure.
level: atom
allowed-tools: ["execute"]
includes: ["eli5/_atoms/explanation-ladder/explanation-ladder.mjs"]
composes: []
used-by: ["eli5/SKILL.md"]
---

# Explanation Ladder

Explain the same subject three times, each rung for a more expert reader.

The subject never changes between rungs. What changes is who is listening and
how much they already know. A rung is not a summary of the rung below it; it is
the same thing seen from higher up, and it may say plainly what a lower rung
had to simplify.

## The Three Levels

Return exactly these three sections, in this order, with these headings.

### Explain like I am five

- Audience: a **five-year-old**.
- Say what the thing is and why it exists.
- Concrete language. A simple analogy only when it makes the explanation
  **shorter**, never longer.
- No domain vocabulary unless a plain word follows it immediately.
- Must not: use jargon, list components, or teach mechanism.

### Explain like I am a junior practitioner

- Audience: a **junior practitioner of the subject's own field** — see role
  inference below. For a codebase this is a **junior software engineer**.
- Target high-school through early-college understanding.
- Use the field's real vocabulary and moderately sophisticated concepts.
- Explain the **major components**, the **workflow**, and the **practical
  purpose**.
- Must not: stay as vague as the five-year-old rung, or dive into expert-only
  tradeoffs.

### Explain like I am an expert

- Audience: an **expert, researcher, or PhD-level practitioner**.
- Skip foundational teaching entirely.
- Focus on **architecture, mechanisms, constraints, tradeoffs, unusual
  decisions, failure modes**, and the detail simpler summaries hide.
- Dense precision over introductory breadth.
- May **qualify** a simplification an earlier rung made, and should when the
  simplification would mislead an expert.

## Adaptive Junior Role

The junior rung adapts to the subject's field. It does not default to software.

- Infer the field from the grounded subject: a legal subject gets a **junior
  lawyer**, a biology subject a **junior biologist**, a monetary-policy subject
  a **junior economist**, a **codebase or software system a junior software
  engineer**.
- Infer the role from the strongest evidence of what the subject *is*, not from
  the words used to ask. "Explain the tax code" is law even when asked by an
  engineer.
- When the field is genuinely ambiguous, name the single most likely field,
  say it was inferred, and proceed — do not stack multiple audiences into one
  rung, and do not silently fall back to software engineering.

## Concision And Skimmability

All three rungs are **extremely concise**:

- Short bullets and short sentences. Sacrifice grammar for concision when it
  helps.
- **Bold** the key terms.
- No filler, no long introduction, no formal transitions, no repetition.
- The three levels stay visibly separate.

"Concise" is enforced arithmetically by the checker below, so the numbers are
fixed rather than felt:

| Rule | Limit |
| --- | --- |
| Words in one level | 120 |
| Words in one line | 40 |
| Minimum bullets per level | 2 |

These are ceilings, not targets. A rung well under them is better; a rung over
them is not concise.

## Progression, Not Repetition

- Each rung **adds depth** the rung below it did not have.
- A deeper rung may **qualify or correct** an earlier simplification. That is
  the point of the ladder, not a contradiction.
- No rung **restates** a line from another rung. That rule is a contract the
  drafting agent must honour; one explanation with three headings is the issue's
  explicit non-goal. What the checker actually catches is narrower: repeating a
  line that differs only in **surface form — punctuation and other
  non-alphanumeric symbols, emphasis markers, bullet style, whitespace, or
  letter case** — is the failure it calls `content-repeated`. A genuinely
  **reworded**
  restatement — the same point in different words — normalises differently and
  passes as `ladder-ok`, so keeping each rung distinct in substance is a
  judgement the checker cannot make, consistent with its "structure and
  repetition, not depth" disclaimer below.

## Required Files

1. [Ladder structure checker](./explanation-ladder.mjs)

Run the checker on the drafted three-level response before returning it. Feed
the rendered response on **stdin**; it exits zero on `ladder-ok` and non-zero on
`ladder-defective`, naming each defect and the section it applies to. On a
defect, fix the draft and re-check. Never return a defective ladder, and never
edit the checker to accept one.

**The checker checks structure and repetition, not depth.** Whether the expert
rung is genuinely deeper than the junior rung is a judgement no arithmetic can
make. What it removes is narrower and real: the wrong number of sections, the
wrong order, an empty or bloated section, a section that is not bulleted, and a
later section that literally restates an earlier line.

## Boundaries

This atom shapes and checks an explanation. It reads no files and grounds no
subject — that is the `subject-grounding` atom's job — and it never implements,
edits, or modifies the subject it explains. Its only tool is `execute`, to run
its own checker.
