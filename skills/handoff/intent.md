# Intent: handoff

Handoff exists to create one bounded continuation artifact for a future agent
or session. It is for the moment when the current context needs to be preserved
without pretending that a transcript, summary, memory entry, or workspace note
is the same thing as a verified continuation packet.

It should gather only confirmed conversation and repository context, link to
existing artifacts instead of copying their bodies, redact recognizable
sensitive content, write the handoff through the shared bounded-handoff core,
verify the written file by reading it back, and report the exact path.

It must not ask where to save the file, create a workspace copy, publish
anything externally, invent progress, decide the next workflow on the user's
behalf, or resume an existing handoff. Its job is to preserve enough truthful
context for someone else to continue safely.
