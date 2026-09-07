import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MODEL_ROLE_KEYS,
  ModelRouteResolutionError,
  modelFamily,
  resolveDirectSpawnRoute,
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
  assert.deepEqual(resolved.panel.reasons, ['fanout-capped']);
  assert.equal(resolved.panel.status, 'same-family');
  assert.equal(resolved.receipts[0].requestedModel, 'gemini-3.8-flash');
  assert.equal(resolved.receipts[1].panelIndex, 2);
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
  assert.deepEqual(same.reasons, ['fallback-used']);
});

test('modelFamily keeps the current runtime vendors grouped stably', () => {
  assert.equal(modelFamily('claude-opus-5'), 'claude');
  assert.equal(modelFamily('gpt-5.6-sol'), 'gpt');
  assert.equal(modelFamily('gemini-3.8-flash'), 'gemini');
  assert.equal(modelFamily('grok-4.6'), 'grok');
  assert.equal(modelFamily('mai-code-1.1-flash'), 'mai-code');
});
