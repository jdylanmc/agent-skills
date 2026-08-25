---
name: repitch-frame
description: Write a second explanation from a new angle without defending or repeating the first one.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["sanity-check/_molecules/repitch-response/repitch-response.md"]
---

# Re-pitch Frame

Turn the context packet into a second explanation.

## Re-pitch Standard

The second explanation should:

- preserve the same subject and intended meaning;
- start from a different entry point than the first explanation;
- supply the context the first explanation assumed;
- use a concrete example, analogy, sequence, or smaller first piece when that
  helps comprehension;
- use locked repository terms from the context packet;
- use plain technical English informed by `agents/ste-coach.agent.md`:
  direct sentences, explicit actors, stable terms, and visible prerequisites;
- preserve exact identifiers, commands, product names, and domain terms;
- avoid apologizing at length, defending the first answer, or explaining why it
  should have been clear.

## Output Shape

Return one compact prose re-pitch for normal invocations. Keep status, subject,
context supplied, vocabulary source, and limits as internal drafting checks.
Surface a brief `Context note` only when a missing prior answer, missing context
file, or material evidence gap prevents a confident re-pitch.

## Boundaries

- Do not introduce new claims that require fresh investigation.
- Do not quote or reconstruct proprietary Simplified Technical English rule
  text.
- Do not replace repository vocabulary with simpler but incorrect synonyms.
- Do not make the response longer merely because the first response failed.
