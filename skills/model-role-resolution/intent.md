# Intent: model-role-resolution

Model-role-resolution exists so skills can choose reviewer and worker models from a small, explicit role map instead of scattering model slugs through workflow prose.

The package should make defaults and overrides deterministic. It should cover the common implementation, cleanup, architecture, QA, and decision-trail roles, including panel roles where the configured list length is the fanout. A caller should be able to pass repository or user mappings, inherit the parent routing where that is intentional, or ask the runtime to choose automatically.

The resolver should be honest when it cannot prove a model is available. Unknown or unavailable slugs, fallback selection, no-model outcomes, and same-family or reduced panel diversity should be visible in the result that a caller records and passes to agent-spawn. It should never silently pick an unlisted model, never turn model identity into doctrine, and never alter another skill's permissions.

This is infrastructure for other skills. It is routable only so humans and parent workflows can inspect and validate a configuration before consumers compose it directly.
