---
name: rubber-duck-brief
description: Build the neutral fresh-context brief that decides a Should fix or Consider finding, screen it so it leaks neither authorship nor a preferred outcome, dispatch it to a sub-agent, and return an apply, decline, or needs-human verdict with its reasoning.
level: atom
allowed-tools: ["read","execute","task"]
includes: ["create-skill/_atoms/rubber-duck-brief/rubber-duck-brief.mjs"]
composes: []
used-by: ["create-skill/_molecules/self-roast-remediation/self-roast-remediation.md"]
---

# Rubber Duck Brief

A `Should fix` or `Consider` finding is judged by an evaluator that did not
build the thing being judged.

The author of a package is the worst judge of criticism of it. A fresh
evaluator carries neither defensive bias nor sunk-cost bias. It is also the only
thing standing outside the `create-skill` to `/roast` loop: without it, one
wrong recommendation is applied to every skill built from here on, and the roast
that produced it is the same roast that reviews the result. It guards the stated
limit of doctrine evaluation as well, because a plausible-but-wrong finding that
cites a real rule at a real locator passes every mechanical check.

## Required References

1. [Brief builder and neutrality screen](./rubber-duck-brief.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `finding` | yes | One `Should fix` or `Consider` finding, with its identifier, priority, location, evidence, consequence, recommendation, and validation. |
| `cited-rule` | no | The doctrine identifier, section, rule label, and verbatim rule text the finding rests on. |
| `artifact-excerpts` | yes | Verbatim slices of the artifact at the finding's locator, each with its locator. |

## The Brief Must Be Neutral

**A prompt that leaks the desired answer defeats the entire mechanism.** A duck
told who wrote the artifact, which verdict is wanted, or what the caller thinks
of the finding is not a fresh evaluator; it is a mirror that returns the answer
it was handed. The three prohibitions are absolute:

1. **No authorship.** The duck is never told the artifact was just authored, by
   whom, by this skill, or in this session.
2. **No preferred outcome.** Neither verdict is presented as wanted, expected,
   or correct. `apply` and `decline` are equally acceptable results.
3. **No rebuttal.** The caller's disagreement with the finding is never
   supplied, in any form, including as background or context.

Neutrality here is structural rather than aspirational. The brief is assembled
from a fixed template by
[the brief builder](./rubber-duck-brief.mjs), which accepts only an
allow-listed set of fields. There is no field for provenance, no field for a
preferred verdict, and deliberately no field for a rebuttal, so the shape cannot
carry one. Any unknown key is refused rather than ignored, which stops a leak
being smuggled in as an extra property.

## Operation

1. Assemble the brief:

   ```text
   node <atoms>/rubber-duck-brief/rubber-duck-brief.mjs \
     --finding "$absolute_finding_json" --out "$absolute_brief_path"
   ```

   Exit `0` writes the brief, `2` refuses it because a supplied field carried a
   leak or an unknown key, and `1` is a usage or path failure.

2. Screen any brief that was not produced by the builder before it is sent:

   ```text
   node <atoms>/rubber-duck-brief/rubber-duck-brief.mjs --screen "$absolute_brief_path"
   ```

   Exit `2` names each leaking line and its kind. A leak is a refusal to send,
   never a warning. Resolve it by removing the leaking statement, never by
   disabling the screen.

3. Dispatch the screened brief to a sub-agent with **fresh context**. The
   sub-agent receives the brief and nothing else: no conversation history, no
   package rationale, and no prior verdicts.

4. Require the reply to open with a verdict line and a confidence line, then its
   reasoning. Accept exactly one of `apply`, `decline`, or `needs-human`. A
   verdict with no reasoning is not a verdict, and an unrecognised verdict is a
   failed dispatch rather than a defaulted one.

5. Record the verdict and the reasoning for **every** non-`Must fix` finding,
   including declined ones. A declined finding without recorded reasoning is
   indistinguishable from a finding that was quietly dropped.

## Output

| Field | Meaning |
| --- | --- |
| `brief_path` | The screened brief that was sent. |
| `screen_status` | `neutral`, or the leaks that stopped the dispatch. |
| `verdict` | `apply`, `decline`, or `needs-human`. |
| `reasoning` | The duck's reasoning, recorded verbatim for the final account. |

## Guarantees

- No `Should fix` or `Consider` finding is applied or dismissed without a
  verdict.
- The brief carries no authorship, no preferred outcome, and no rebuttal, and
  the screen refuses it if it does.
- Quoted rule text and artifact excerpts sit inside fenced blocks chosen longer
  than any fence they contain, so an excerpt cannot escape its block and become
  an instruction.
- Every verdict arrives with reasoning that survives into the final report.

## Boundaries

- The rubber duck **advises**. It does not edit the package, does not run it,
  and its verdict is not an approval. A human still signs off.
- The duck never judges a `Must fix` finding. Those are resolved.
- A brief is never re-sent with an added hint after an unwanted verdict.
  Re-asking until the answer changes is the leak the screen cannot catch, and it
  is prohibited here.
- The duck's verdict never authorises editing a repository gate.
