# Intent: decision-trail

Decision-trail exists for work where the reasoning matters after the run is over.
It makes material choices reviewable by a human who was not present for the
original context and may disagree with any individual choice.

The trail is not a transcript. It does not duplicate Chronicler's record of what
happened in a skill invocation. Chronicler records lifecycle operations and their
outcomes; decision-trail records why a consequential choice was made, what other
reasonable options were considered, what evidence supported the choice, what
uncertainty remained, who or what made the choice, and how confident the chooser
was.

Every material decision should become a structured, append-only row. The row
should name the decision, selected option, rejected alternatives and why they
lost, evidence references, decision maker, confidence, outcome state, and any
review or publication constraints. Trivial tool calls, routine progress, and
mechanical implementation steps should stay out of the trail.

The trail is evidence for review, never an approval mechanism. It must keep
missing or unreconstructable reasoning visible rather than omitting it. It must
make unsupported evidence claims detectable, protect against spreadsheet-formula
injection and accidental secret exposure, and make tampering or reordering
visible during self-audit.

A trail is local by default. It should be returned to the operator or stored as a
local uncommitted artifact unless a reviewer specifically needs it committed or
published. High-stakes or committed trails should receive an independent review
from a different model family before publication, and publication should use a
redacted copy rather than raw notes.
