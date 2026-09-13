import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dispatchModelRoleAgent,
  dispatchResolvedAgent,
  MODEL_ROLE_KEYS,
  ModelRouteResolutionError,
  modelFamily,
  resolveDirectSpawnRoute,
  resolveEligibleModelRoute,
  resolveInlineModelRoute,
  resolveModelRolePanel,
  resolveModelRoleRoute,
  summarizeModelDiversity,
} from './agent-spawn.mjs';

test('exports the full stable model-role vocabulary for issue72', () => {
  assert.deepEqual(MODEL_ROLE_KEYS, [
    'implementer',
    'cleanup',
    'architecture-candidate',
    'architecture-judge',
    'qa-reviewer',
    'qa-judge',
    'decision-trail-reviewer',
  ]);
});

test('direct routing preserves runtime default behavior when no explicit model is requested', () => {
  const resolved = resolveDirectSpawnRoute();
  assert.equal(resolved.receipt.modelStatus, 'Runtime default');
  assert.equal(resolved.receipt.availabilityStatus, 'runtime-default');
  assert.equal(resolved.receipt.selectedModel, null);
});

test('eligible routing preserves inline receipts while enforcing caller constraints', () => {
  const request = {
    role: 'fixture-role',
    resolutionSource: 'fixture-policy',
    inlineRoute: {
      model: 'gpt-6-astra', fallbackModels: ['gpt-5.6-sol'],
      reasoningEffort: 'high', contextTier: 'default',
    },
    runtimeAvailableModels: ['gpt-5.6-sol'],
    eligibleModels: ['gpt-6-astra', 'gpt-5.6-sol'],
  };
  assert.deepEqual(resolveEligibleModelRoute(request), resolveInlineModelRoute(request));
  for (const overrides of [
    { runtimeAvailableModels: null }, { eligibleModels: [] }, { override: { alias: 'auto' } },
    { override: { 'fallback-models': [] } }, { override: { reasoningEffort: null } },
  ]) {
    assert.throws(() => resolveEligibleModelRoute({ ...request, ...overrides }), { code: 'invalid_input' });
  }
  assert.throws(() => resolveEligibleModelRoute({ ...request, eligibleModels: ['gpt-5.6-sol'] }),
    { code: 'ineligible_model' });
  assert.throws(() => resolveEligibleModelRoute(), { code: 'invalid_input' });
  const changed = resolveEligibleModelRoute({ ...request, override: { contextTier: 'long_context' } });
  assert.equal(changed.route.contextTier, 'long_context');
  assert.equal(request.inlineRoute.contextTier, 'default');
  assert.ok(Object.isFrozen(changed.receipt));
});

test('direct routing records a fallback only from the declared list', () => {
  const resolved = resolveDirectSpawnRoute({
    model: 'claude-opus-5',
    fallbackModels: ['gpt-5.6-sol', 'claude-sonnet-5'],
    reasoningEffort: 'max',
    contextTier: 'long_context',
    runtimeAvailableModels: ['gpt-5.6-sol'],
  });
  assert.equal(resolved.receipt.modelStatus, 'Fallback: gpt-5.6-sol');
  assert.equal(resolved.receipt.selectedModel, 'gpt-5.6-sol');
  assert.equal(resolved.receipt.family, 'gpt');
  assert.equal(resolved.route.model, 'gpt-5.6-sol');
  assert.deepEqual(resolved.route.fallbackModels, []);
});

test('user role mappings override repository mappings, which override the inline default', () => {
  const resolved = resolveModelRoleRoute({
    role: 'implementer',
    inlineDefault: {
      model: 'claude-opus-5',
      fallbackModels: ['gpt-5.6-sol'],
      reasoningEffort: 'max',
      contextTier: 'long_context',
    },
    repositoryModelRoles: {
      implementer: 'claude-sonnet-5',
    },
    userModelRoles: {
      implementer: 'gpt-5.6-sol',
    },
    runtimeAvailableModels: ['gpt-5.6-sol', 'claude-sonnet-5'],
  });
  assert.equal(resolved.receipt.resolutionSource, 'user-model-roles');
  assert.equal(resolved.receipt.requestedModel, 'gpt-5.6-sol');
  assert.equal(resolved.receipt.modelStatus, 'Requested');
});

test('auto reuses the inline default exactly as declared for the role', () => {
  const resolved = resolveModelRoleRoute({
    role: 'cleanup',
    inlineDefault: {
      model: 'claude-sonnet-5',
      fallbackModels: ['gpt-5.6-sol'],
      reasoningEffort: 'high',
      contextTier: 'default',
    },
    repositoryModelRoles: {
      cleanup: 'auto',
    },
  });
  assert.equal(resolved.receipt.alias, 'auto');
  assert.equal(resolved.receipt.requestedModel, 'claude-sonnet-5');
  assert.deepEqual(resolved.receipt.fallbackModels, ['gpt-5.6-sol']);
  assert.equal(resolved.receipt.reasoningEffort, 'high');
  assert.equal(resolved.receipt.contextTier, 'default');
});

test('inherit-parent copies the already resolved parent route and refuses when absent', () => {
  const parent = resolveInlineModelRoute({
    role: 'architecture-judge',
    inlineRoute: {
      model: 'gpt-5.6-sol',
      fallbackModels: ['claude-sonnet-5'],
      reasoningEffort: 'medium',
      contextTier: 'long_context',
    },
  });
  const inherited = resolveModelRoleRoute({
    role: 'architecture-judge',
    inlineDefault: {
      model: 'claude-opus-5',
      fallbackModels: ['claude-sonnet-5'],
      reasoningEffort: 'max',
      contextTier: 'long_context',
    },
    userModelRoles: {
      'architecture-judge': 'inherit-parent',
    },
    parentModelRoute: parent.route,
  });
  assert.equal(inherited.receipt.alias, 'inherit-parent');
  assert.equal(inherited.receipt.requestedModel, 'gpt-5.6-sol');
  assert.equal(inherited.receipt.reasoningEffort, 'medium');

  assert.throws(
    () => resolveModelRoleRoute({
      role: 'architecture-judge',
      inlineDefault: {
        model: 'claude-opus-5',
        fallbackModels: ['claude-sonnet-5'],
      },
      repositoryModelRoles: {
        'architecture-judge': 'inherit-parent',
      },
    }),
    (error) => error instanceof ModelRouteResolutionError && error.code === 'parent_route_required',
  );
});

test('panel fanout repeats a single mapped route, caps deterministically, and records degradation', () => {
  const resolved = resolveModelRolePanel({
    role: 'qa-reviewer',
    inlineDefaults: [{
      model: 'gpt-5.6-sol',
      fallbackModels: ['claude-opus-5'],
      reasoningEffort: 'max',
      contextTier: 'long_context',
    }],
    repositoryModelRoles: {
      'qa-reviewer': 'gemini-3.8-flash',
    },
    panelLength: 3,
    fanoutCap: 2,
    runtimeAvailableModels: ['gemini-3.8-flash'],
  });
  assert.equal(resolved.routes.length, 2);
  assert.equal(resolved.panel.fanoutRequested, 3);
  assert.equal(resolved.panel.fanoutApplied, 2);
  assert.equal(resolved.panel.degraded, true);
  assert.deepEqual(resolved.panel.reasons, ['fanout-capped', 'same-family']);
  assert.equal(resolved.panel.status, 'same-family');
  assert.equal(resolved.receipts[0].requestedModel, 'gemini-3.8-flash');
  assert.equal(resolved.receipts[1].panelIndex, 2);
  assert.deepEqual(resolved.panel.droppedSeats, [{
    panelIndex: 3,
    requestedModel: 'gemini-3.8-flash',
    fallbackModels: [],
    resolutionSource: 'repository-model-roles',
    alias: null,
  }]);
});

test('panel fanout also honors an explicit route list and surfaces unavailable seats', () => {
  const resolved = resolveModelRolePanel({
    role: 'architecture-candidate',
    inlineDefaults: [{
      model: 'claude-opus-5',
      fallbackModels: ['gpt-5.6-sol'],
      reasoningEffort: 'max',
      contextTier: 'long_context',
    }],
    userModelRoles: {
      'architecture-candidate': [
        'claude-opus-5',
        'gpt-5.6-sol',
        'grok-4.6',
      ],
    },
    runtimeAvailableModels: ['claude-opus-5', 'gpt-5.6-sol'],
  });
  assert.equal(resolved.panel.fanoutRequested, 3);
  assert.equal(resolved.panel.fanoutApplied, 3);
  assert.equal(resolved.panel.degraded, true);
  assert.deepEqual(resolved.panel.reasons, ['unavailable-seat']);
  assert.equal(resolved.receipts[2].modelStatus, 'Unavailable');
  assert.equal(resolved.routes[2], null);
});

test('unobserved availability is explicit rather than pretending a verified launch', () => {
  const resolved = resolveModelRolePanel({
    role: 'qa-reviewer',
    inlineDefaults: [{
      model: 'gpt-5.6-sol',
      fallbackModels: ['claude-opus-5'],
    }],
    panelLength: 2,
  });
  assert.equal(resolved.panel.status, 'unobserved');
  assert.equal(resolved.panel.degraded, false);
  assert.equal(resolved.receipts[0].availabilityStatus, 'unobserved');
  assert.equal(resolved.receipts[1].modelStatus, 'Requested');
});

test('summarizeModelDiversity distinguishes distinct and same-family panels honestly', () => {
  const distinct = summarizeModelDiversity([
    { family: 'claude', availabilityStatus: 'observed', modelStatus: 'Requested' },
    { family: 'gpt', availabilityStatus: 'observed', modelStatus: 'Requested' },
  ]);
  assert.equal(distinct.status, 'distinct-families');
  assert.equal(distinct.degraded, false);

  const same = summarizeModelDiversity([
    { family: 'claude', availabilityStatus: 'observed', modelStatus: 'Requested' },
    { family: 'claude', availabilityStatus: 'observed', modelStatus: 'Fallback: claude-sonnet-5' },
  ]);
  assert.equal(same.status, 'same-family');
  assert.equal(same.degraded, true);
  assert.deepEqual(same.reasons, ['fallback-used', 'same-family']);
});

test('same-family diversity is informative degradation even without fallback', () => {
  const same = summarizeModelDiversity([
    { family: 'gpt', availabilityStatus: 'observed', modelStatus: 'Requested' },
    { family: 'gpt', availabilityStatus: 'observed', modelStatus: 'Requested' },
  ]);
  assert.equal(same.status, 'same-family');
  assert.equal(same.degraded, true);
  assert.deepEqual(same.reasons, ['same-family']);
});

test('all configured role mappings are validated before the selected role resolves', () => {
  assert.throws(
    () => resolveModelRoleRoute({
      role: 'qa-reviewer',
      inlineDefault: { model: 'gpt-5.6-sol' },
      repositoryModelRoles: {
        implementer: { bogus: true },
        'qa-reviewer': 'gpt-5.6-sol',
      },
    }),
    (error) => error instanceof ModelRouteResolutionError && error.code === 'invalid_input',
  );
});

test('resolved outputs are immutable snapshots', () => {
  const resolved = resolveModelRolePanel({
    role: 'qa-reviewer',
    inlineDefaults: [{ model: 'gpt-5.6-sol' }],
    panelLength: 2,
  });
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.routes), true);
  assert.equal(Object.isFrozen(resolved.receipts[0]), true);
  assert.equal(Object.isFrozen(resolved.panel), true);
  assert.throws(() => {
    resolved.receipts[0].requestedModel = 'changed';
  }, TypeError);
});

test('dispatch boundary launches the selected fallback with exact bounded arguments', async () => {
  const resolved = resolveModelRoleRoute({
    role: 'implementer',
    inlineDefault: {
      model: 'missing-model',
      fallbackModels: ['gpt-5.6-sol'],
      reasoningEffort: 'high',
      contextTier: 'long_context',
    },
    runtimeAvailableModels: ['gpt-5.6-sol'],
  });
  const calls = [];
  const result = await dispatchResolvedAgent({
    prompt: 'Implement the bounded change.',
    persona: 'Be concise.',
    tools: ['read', 'execute'],
    route: resolved.route,
    receipt: resolved.receipt,
    transport: async (launch) => {
      calls.push(launch);
      return { response: 'done', actualModel: 'gpt-5.6-sol' };
    },
  });
  assert.equal(result.status, 'Complete');
  assert.equal(result.actualModel, 'gpt-5.6-sol');
  assert.equal(result.actualModelStatus, 'matched-selection');
  assert.deepEqual(calls, [{
    prompt: 'Implement the bounded change.',
    persona: 'Be concise.',
    tools: ['read', 'execute'],
    model: 'gpt-5.6-sol',
    fallbackModels: [],
    reasoningEffort: 'high',
    contextTier: 'long_context',
  }]);
});

test('dispatch boundary never launches an unavailable seat', async () => {
  const resolved = resolveModelRoleRoute({
    role: 'qa-reviewer',
    inlineDefault: {
      model: 'missing-model',
      fallbackModels: ['also-missing'],
    },
    runtimeAvailableModels: [],
  });
  let calls = 0;
  const result = await dispatchResolvedAgent({
    prompt: 'Review.',
    tools: ['read'],
    route: resolved.route,
    receipt: resolved.receipt,
    transport: async () => {
      calls += 1;
      return 'should not run';
    },
  });
  assert.equal(result.status, 'No model available');
  assert.equal(calls, 0);
});

test('dispatch boundary preserves an unknown runtime default honestly', async () => {
  const resolved = resolveDirectSpawnRoute();
  const calls = [];
  const result = await dispatchResolvedAgent({
    prompt: 'Use the runtime default.',
    tools: [],
    route: resolved.route,
    receipt: resolved.receipt,
    transport: async (launch) => {
      calls.push(launch);
      return 'default response';
    },
  });
  assert.equal(result.modelStatus, 'Runtime default');
  assert.equal(result.routingReceipt.selectedModel, null);
  assert.equal(result.actualModel, null);
  assert.equal(result.actualModelStatus, 'unobserved');
  assert.equal(calls[0].model, null);
});

test('dispatch boundary records a transport model mismatch without rewriting the receipt', async () => {
  const resolved = resolveModelRoleRoute({
    role: 'qa-reviewer',
    inlineDefault: { model: 'gpt-5.6-sol' },
    runtimeAvailableModels: ['gpt-5.6-sol'],
  });
  const result = await dispatchResolvedAgent({
    prompt: 'Review.',
    tools: ['read'],
    route: resolved.route,
    receipt: resolved.receipt,
    transport: async () => ({
      response: 'review',
      actualModel: 'claude-opus-5',
    }),
  });
  assert.equal(result.status, 'Unexpected model');
  assert.equal(result.actualModelStatus, 'mismatched-selection');
  assert.equal(result.routingReceipt.selectedModel, 'gpt-5.6-sol');
});

test('the generic dispatch seam is callable for every declared role', async () => {
  for (const role of MODEL_ROLE_KEYS) {
    const result = await dispatchModelRoleAgent({
      role,
      inlineDefault: { model: 'gpt-5.6-sol' },
      prompt: `Run ${role}.`,
      tools: [],
      runtimeAvailableModels: ['gpt-5.6-sol'],
      transport: async () => role,
    });
    assert.equal(result.response, role);
    assert.equal(result.routingReceipt.role, role);
  }
});

test('modelFamily keeps the current runtime vendors grouped stably', () => {
  assert.equal(modelFamily('claude-opus-5'), 'claude');
  assert.equal(modelFamily('gpt-5.6-sol'), 'gpt');
  assert.equal(modelFamily('gemini-3.8-flash'), 'gemini');
  assert.equal(modelFamily('grok-4.6'), 'grok');
  assert.equal(modelFamily('mai-code-1.1-flash'), 'mai-code');
});
