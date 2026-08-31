# Intent: product-design

Product design sits between one aligned Discovery subject and specification. It
turns that subject into runnable, disposable product-design prototypes so a
human can settle what the experience should be before requirements are written.

Brand and user experience are separate specialist jobs. Brand goes first and
establishes an illustrative visual foundation through Storybook and static
HTML, CSS, and JavaScript. A human must align with that foundation before a
user-experience specialist explores the feature and flow. When a novel decision
needs comparison, the specialist should make genuinely distinct bounded
concepts rather than a fixed number of artificial variants.

Every concept must run independently with mocked data. It must include a
restartable walkthrough of its features and flows, using stable identifiers and
visible overlays, and it must represent accessibility expectations in both the
concept and the interaction contract.

Prototype artifacts live beneath `docs/agent/prototypes/<subject>/`. They are
illustrative, disposable, and untrusted. They do not establish a production
design system, production user interface, implementation, or architecture.
Downstream work may rely only on the exact human-approved experience and its
stable interaction contract, never on prototype code or structure.

Prototype artifacts do not require Roast. The product-design skill package
itself follows the repository's normal Ship gates.

Final approval binds the exact artifact bytes and interaction contract. A merge
confirms that exact approved revision. The contract handed to specification
traces stable features, flows, states, decisions, alternatives, accessibility
expectations, and open questions without selecting production user-interface
code or production architecture.
