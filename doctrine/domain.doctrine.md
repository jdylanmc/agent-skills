---
name: domain
description: "Model-centered discipline for domain language, invariants, lifecycle, and bounded contexts."
scope: shared-engineering-doctrine
---

# Domain Doctrine

## When to use

Use when the hard part of the work is the business itself — intricate rules, contested or shifting terminology, objects whose permitted state changes matter, or seams between teams and systems — and those pressures should drive the design more than ordinary technical file, layer, or component organization.

## Primary bias to correct

A model earns its place only by driving working software. Storage schemas, screens, framework mechanics, wire formats, and modeling jargon are all convenient stand-ins for real modeling, and none of them is a model. Hold business behavior, source code, tests, written material, and the words the team actually speaks in one aligned expression of that model inside each named, deliberately drawn bounded context.

## Decision rules

- Run one agreed vocabulary inside each bounded context and apply it everywhere: type and operation names, test names, written material, diagrams, planning, and feature conversations. Diagrams or narratives that exist only to teach an idea may differ from the implementing model, but say plainly which is which.
- Keep a model only while it does three jobs at once: organizes what the business knows, gives people a precise way to talk, and can be written as running code. Grow it by cycling between implementation attempts, conversations with people who know the business, concrete scenarios, and refactoring, expecting understanding to arrive in steps rather than all at once.
- Business decisions belong in the layer that holds the model. Presentation, application-level coordination of a request or workflow, infrastructure, storage, messaging, and framework obligations stay outside that layer or reach it through adapters.
- Choose a building block by the meaning it carries: an entity when a thing has a continuing identity that outlives its attribute values, a value object when an immutable bundle of attributes merely describes something and is compared by those attributes, a domain service when a meaningful business operation belongs to no single object, and a module when concepts are understood together.
- Group objects that must stay mutually consistent behind a single aggregate root, let outside code reference only that root, and enforce the rules of the group inside its boundary.
- Move awkward or multi-step construction into dedicated creation code, give stored collections a retrieval point that hides the storage mechanism and answers business-shaped queries, and never let a half-built object become reachable.
- Let the model dictate shape and make the store adapt, not the reverse. Identity, aggregate boundaries, value semantics, and the criteria the business uses to find things must survive the mapping; table layout and query mechanics must not surface in the model.
- Design interfaces for the people who will call them: name operations after business purpose, keep questions that only compute answers apart from commands that change state, publish preconditions, postconditions, and rules that must hold instead of leaving them to be inferred, and cut boundaries along the natural joints of the concepts.
- Aim refactoring at understanding, not tidiness alone. When a constraint, policy, business process, calculation, allocation scheme, or rule for generating something carries real meaning, give it a name and a home in the model instead of leaving it implied inside procedural code.
- State where each model applies and never assume a word means the same thing in a neighboring team or system. Keep a map of the boundaries and how they touch, back it with tests, and keep communication live across the seams so the model does not quietly fragment.
- Pick each relationship between two models on purpose from the known options: a small jointly owned overlap maintained by both teams; an upstream that commits to a downstream's needs; a downstream that simply adopts the upstream model as given; a translating layer that keeps a foreign model out; a decision not to integrate at all; a stable general-purpose service interface offered to many consumers; an agreed interchange language shared by all participants; or a gradual, function-by-function takeover of a legacy system.
- Find the part of the model that carries the distinctive business value and defend it. Commodity subdomains, technical plumbing, reusable mechanisms, and supporting detail must be named, pushed aside, or split out so they do not absorb the attention that valuable part needs.
- Introduce a system-wide organizing scheme only once a model has outgrown what object-level structure can explain. Such a scheme must speak about the business, must be free to change as understanding changes, and holds only across boundaries whose models are compatible with it.
- Welcome borrowed material — recurring analysis models, technical design patterns, rule objects that answer whether a candidate satisfies a criterion, formal notations from an industry, and existing published work — only when it sharpens the model in hand and leaves the team's vocabulary intact.
- Write tests in the business vocabulary and cover the model before the plumbing: rules that must always hold, transitions that are allowed and those that must be refused, construction that is legal, criterion objects, application-level coordination, and translation at boundaries.
- Make large structural moves with people who hold both sides at once, hands in the code and a grasp of the business. Architectural and framework direction exists to serve the teams building applications and the goals of the business, not the reverse.

## Trigger rules

- Words are clumsy, mean different things to different people, drift between documents and code, or need constant translation in conversation: settle the vocabulary and rename the code first, before further behavior is layered on.
- Business decisions turn up in request handlers, coordinating services, batch scripts, SQL, scheduled jobs, or serialization code: relocate them into the model as an entity, a domain service, a criterion object, or a concept that finally gets its own name.
- Screens, storage, message transport, external APIs, or a framework start dictating what a domain concept looks like: push them back behind layering, adapters, or a translating boundary.
- One change ripples across unrelated modules, a wide set of objects, or several aggregate roots: re-examine how modules are grouped, which root owns which data, whether consistency must be immediate or may lag, and where the context boundaries truly fall.
- Callers must know how an object is created, how it moves through its life, how it is stored, how identifiers are minted, or how to mutate internals: repair the creation code, the retrieval point, the root, and the encapsulation around them.
- A new requirement resists explanation, testing, or extension: hunt for a better model or a concept the code implies but never names, and accept a large reshaping move instead of bolting on more conditional branches.
- Work is about to touch another team's or system's model: settle the relationship, the translation approach, the shared format or protocol, and the tests at the seam before writing any integration code.
- A change touches rules that must hold, lifecycle transitions, criterion objects, application coordination, or translation between contexts: add tests in business vocabulary that demonstrate correct behavior and refuse invalid states.
- Reusable machinery, a homegrown framework, or a supporting subdomain is crowding out what makes the product distinctive: split the machinery off or lift the valuable model clear of it.

## Final checklist

- Does business behavior sit inside the model instead of hiding in delivery, storage, or integration code?
- Within a single bounded context, do code, tests, written material, and everyday conversation use the same words for the same things?
- Do the building blocks earn their keep by protecting identity, value semantics, lifecycle, rules that must hold, and clear ownership of responsibility, rather than by adding ceremony?
- Does every integration across a boundary carry a stated relationship, a stated translation approach, and a test at the seam?
- Do the tests read as worked examples of the model, including the constructions and transitions that must be rejected?
- Is the distinctive part of the model easy to find and shielded from supporting complexity, reusable machinery, infrastructure, and frameworks?
