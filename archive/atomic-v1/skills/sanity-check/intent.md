# Intent: sanity-check

Sanity-check exists for the moment when a previous explanation did not land and the person needs a different pitch immediately.

The value is the trigger. A short human gesture says that comprehension failed, without requiring the person to diagnose the failure or write a careful follow-up question. The response is a second attempt at the same meaning from a different entry point, not a longer defense of the first attempt.

The skill is intentionally human-invoked. A model deciding by itself that its explanation failed would turn a useful interrupt into noise. A person owns the moment of interruption, and the package stays small enough to use at that moment.

The response is grounded in the previous answer, any nearby conversation context, and repository vocabulary when a `CONTEXT.md` or `CONTEXT-MAP.md` is available. It supplies context that the first answer assumed, uses stable domain terms, and writes in plain technical English informed by the repository's Simplified Technical English review lens.

The result is concise prose that helps the reader try the idea again from another angle. It is not a correctness review, not a new investigation, not an implementation step, and not an apology tour for the first explanation.
