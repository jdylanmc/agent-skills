import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultModelRoles, resolveModelRoles } from './model-role-resolver.mjs';

test('defaults resolve deterministically when all requested models are available', () => {
  const result = resolveModelRoles({
    availableModels: [
      'claude-sonnet-5',
      'gpt-5.4-mini',
      'claude-opus-5',
      'gpt-5.6-sol',
      'gpt-5.5',
      'gpt-5-mini',
      'claude-haiku-4.5',
      'grok-4.6',
      'gemini-3.7-flash',
    ],
  });

  assert.equal(result.status, 'Resolved');
  assert.equal(result.fanout['architecture.candidates'], 3);
  assert.equal(result.fanout['qa.reviewers'], 3);
  assert.deepEqual(result.roles.map((role) => role.role), [
    'implementer',
    'cleanup',
    'architecture.candidates',
    'architecture.candidates',
    'architecture.candidates',
    'architecture.judge',
    'qa.reviewers',
    'qa.reviewers',
    'qa.reviewers',
    'qa.judge',
    'decision-trail.reviewer',
  ]);
  assert.ok(result.roles.every((role) => role['model-status'] === 'Requested'));
  assert.deepEqual(result.diversity['architecture.candidates'].families, { claude: 1, gpt: 1, grok: 1 });
});

test('empty override map preserves defaults', () => {
  const defaults = defaultModelRoles();
  const result = resolveModelRoles({ overrides: {}, availableModels: ['claude-sonnet-5'] });

  assert.equal(defaults.implementer.model, 'claude-sonnet-5');
  assert.equal(result.roles.find((role) => role.role === 'implementer').routing.model, 'claude-sonnet-5');
});

test('panel list length controls fanout and does not get padded', () => {
  const result = resolveModelRoles({
    overrides: {
      architecture: {
        candidates: [
          { model: 'claude-sonnet-5' },
          { model: 'gpt-5.6-sol' },
        ],
      },
    },
    availableModels: ['claude-sonnet-5', 'gpt-5.6-sol'],
  });

  assert.equal(result.fanout['architecture.candidates'], 2);
  assert.equal(result.roles.filter((role) => role.role === 'architecture.candidates').length, 2);
});

test('unknown roles degrade visibly without executing configuration text', () => {
  const result = resolveModelRoles({
    overrides: {
      saboteur: { model: 'claude-sonnet-5' },
      qa: { observers: [{ model: 'gpt-5.6-sol' }] },
    },
    availableModels: ['claude-sonnet-5', 'gpt-5.4-mini', 'claude-opus-5', 'gpt-5.6-sol', 'grok-4.6', 'gemini-3.7-flash'],
  });

  assert.equal(result.status, 'ResolvedWithDegradation');
  assert.match(result.warnings.join('\n'), /unknown role 'saboteur' ignored/);
  assert.match(result.warnings.join('\n'), /unknown role 'qa\.observers' ignored/);
});

test('auto omits the model and reports Runtime default instead of hiding it', () => {
  const result = resolveModelRoles({ overrides: { cleanup: { model: 'auto' } } });
  const cleanup = result.roles.find((role) => role.role === 'cleanup');

  assert.equal(cleanup['model-status'], 'Runtime default');
  assert.equal('model' in cleanup.routing, false);
  assert.match(result.warnings.join('\n'), /Runtime default/);
});

test('inherit-parent copies supplied parent routing and reports it', () => {
  const result = resolveModelRoles({
    overrides: { implementer: { model: 'inherit-parent' } },
    parentRouting: { model: 'gpt-5.6-sol', fallbackModels: ['claude-sonnet-5'], reasoningEffort: 'medium', contextTier: 'default' },
    availableModels: ['gpt-5.6-sol', 'claude-sonnet-5'],
  });
  const implementer = result.roles.find((role) => role.role === 'implementer');

  assert.equal(implementer.routing.model, 'gpt-5.6-sol');
  assert.equal(implementer['model-status'], 'Requested');
  assert.match(implementer.reasons.join('\n'), /Inherited parent routing/);
  assert.equal(implementer.routing['reasoning-effort'], 'medium');
});

test('inherit-parent without a parent degrades to No model available', () => {
  const result = resolveModelRoles({
    overrides: { implementer: { model: 'inherit-parent' } },
    availableModels: ['claude-sonnet-5'],
  });
  const implementer = result.roles.find((role) => role.role === 'implementer');

  assert.equal(result.status, 'ResolvedWithDegradation');
  assert.equal(implementer['model-status'], 'No model available');
  assert.match(result.warnings.join('\n'), /no parent routing/);
});

test('unavailable requested model selects only a listed available fallback', () => {
  const result = resolveModelRoles({
    overrides: { implementer: { model: 'missing-model', fallbackModels: ['claude-sonnet-5', 'gpt-5.6-sol'] } },
    availableModels: ['claude-sonnet-5'],
  });
  const implementer = result.roles.find((role) => role.role === 'implementer');

  assert.equal(result.status, 'ResolvedWithDegradation');
  assert.equal(implementer.routing.model, 'claude-sonnet-5');
  assert.equal(implementer['model-status'], 'Fallback: claude-sonnet-5');
  assert.deepEqual(implementer.unavailable, ['missing-model', 'gpt-5.6-sol']);
});

test('fallback exhaustion reports No model available and never invents another model', () => {
  const result = resolveModelRoles({
    overrides: { implementer: { model: 'missing-model', fallbackModels: ['also-missing'] } },
    availableModels: ['claude-sonnet-5'],
  });
  const implementer = result.roles.find((role) => role.role === 'implementer');

  assert.equal(implementer['model-status'], 'No model available');
  assert.equal('model' in implementer.routing, false);
  assert.match(result.warnings.join('\n'), /all listed fallbacks are unavailable/);
});

test('malformed configuration is InvalidConfig', () => {
  const result = resolveModelRoles({
    overrides: { architecture: { candidates: { model: 'claude-sonnet-5' } } },
    availableModels: ['claude-sonnet-5'],
  });

  assert.equal(result.status, 'InvalidConfig');
  assert.match(result.errors.join('\n'), /architecture\.candidates panel override must be an array/);
});

test('same-family panel diversity is explicit', () => {
  const result = resolveModelRoles({
    overrides: {
      qa: {
        reviewers: [
          { model: 'claude-sonnet-5' },
          { model: 'claude-opus-5' },
        ],
      },
    },
    availableModels: ['claude-sonnet-5', 'claude-opus-5', 'gpt-5.4-mini', 'gpt-5.6-sol'],
  });

  assert.equal(result.diversity['qa.reviewers'].status, 'Same-family degraded');
  assert.match(result.warnings.join('\n'), /collapse to one family/);
});

test('diversity survives JSON round trip as a keyed object', () => {
  const result = resolveModelRoles({
    overrides: { qa: { reviewers: [{ model: 'claude-sonnet-5' }, { model: 'gpt-5.6-sol' }] } },
    availableModels: ['claude-sonnet-5', 'gpt-5.6-sol'],
  });
  const roundTripped = JSON.parse(JSON.stringify(result));

  assert.equal(roundTripped.diversity['qa.reviewers'].panel, 'qa.reviewers');
  assert.equal(roundTripped.diversity['qa.reviewers'].status, 'Diverse');
});

test('insufficient and runtime-default panel diversity are visible', () => {
  const oneReviewer = resolveModelRoles({
    overrides: { qa: { reviewers: [{ model: 'claude-sonnet-5' }] } },
    availableModels: ['claude-sonnet-5', 'gpt-5.4-mini', 'gpt-5.6-sol'],
  });
  const emptyPanel = resolveModelRoles({
    overrides: { qa: { reviewers: [] } },
    availableModels: ['gpt-5.4-mini', 'gpt-5.6-sol'],
  });
  const runtimePanel = resolveModelRoles({
    overrides: { qa: { reviewers: [{ model: 'auto' }, { model: 'claude-sonnet-5' }] } },
    availableModels: ['claude-sonnet-5', 'gpt-5.4-mini', 'gpt-5.6-sol'],
  });

  assert.equal(oneReviewer.diversity['qa.reviewers'].status, 'Insufficient fanout');
  assert.equal(emptyPanel.diversity['qa.reviewers'].status, 'Insufficient fanout');
  assert.equal(runtimePanel.diversity['qa.reviewers'].status, 'Unverified runtime-default diversity');
  assert.deepEqual(runtimePanel.diversity['qa.reviewers'].selectedFamilies, ['claude']);
});

test('reserved aliases are invalid in fallbacks and availability lists', () => {
  const fallbackAlias = resolveModelRoles({ overrides: { implementer: { model: 'missing-model', fallbackModels: ['auto'] } } });
  const availabilityAlias = resolveModelRoles({ availableModels: ['inherit-parent'] });

  assert.equal(fallbackAlias.status, 'InvalidConfig');
  assert.match(fallbackAlias.errors.join('\n'), /concrete model slugs/);
  assert.equal(availabilityAlias.status, 'InvalidConfig');
  assert.match(availabilityAlias.errors.join('\n'), /concrete model slugs/);
});

test('unknown route fields are invalid instead of silently ignored', () => {
  const result = resolveModelRoles({ overrides: { implementer: { model: 'claude-sonnet-5', fallbackModel: 'gpt-5.6-sol' } } });

  assert.equal(result.status, 'InvalidConfig');
  assert.match(result.errors.join('\n'), /implementer\.fallbackModel is not an accepted model-role field/);
});

test('repository and user override layers merge deterministically with user precedence', () => {
  const result = resolveModelRoles({
    repositoryOverrides: {
      implementer: { model: 'gpt-5.6-sol', fallbackModels: ['claude-sonnet-5'] },
      qa: { reviewers: [{ model: 'claude-sonnet-5' }] },
    },
    userOverrides: {
      implementer: { model: 'claude-opus-5' },
    },
    availableModels: ['gpt-5.6-sol', 'claude-sonnet-5', 'claude-opus-5', 'gpt-5.4-mini', 'grok-4.6', 'gemini-3.7-flash', 'gpt-5.5', 'gpt-5-mini', 'claude-haiku-4.5'],
  });

  assert.deepEqual(result.configurationSources, ['inline-defaults', 'repositoryOverrides', 'userOverrides']);
  assert.equal(result.roles.find((role) => role.role === 'implementer').routing.model, 'claude-opus-5');
  assert.equal(result.fanout['qa.reviewers'], 1);
});

test('explicit call overrides win over user and repository layers', () => {
  const result = resolveModelRoles({
    repositoryOverrides: { implementer: { model: 'gpt-5.6-sol' } },
    userOverrides: { implementer: { model: 'claude-opus-5' } },
    overrides: { implementer: { model: 'claude-sonnet-5' } },
    availableModels: ['gpt-5.6-sol', 'claude-opus-5', 'claude-sonnet-5'],
  });

  assert.deepEqual(result.configurationSources, ['inline-defaults', 'repositoryOverrides', 'userOverrides', 'overrides']);
  assert.equal(result.roles.find((role) => role.role === 'implementer').routing.model, 'claude-sonnet-5');
});

test('diversity is JSON-stable and keyed by panel name', () => {
  const result = resolveModelRoles({ availableModels: ['claude-sonnet-5', 'gpt-5.4-mini', 'claude-opus-5', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5-mini', 'claude-haiku-4.5', 'grok-4.6', 'gemini-3.7-flash'] });
  const roundTrip = JSON.parse(JSON.stringify(result));

  assert.equal(roundTrip.diversity['architecture.candidates'].status, 'Diverse');
  assert.equal(roundTrip.diversity['qa.reviewers'].status, 'Diverse');
});

test('empty and one-member panels report degraded diversity', () => {
  const empty = resolveModelRoles({ overrides: { architecture: { candidates: [] } }, availableModels: ['claude-sonnet-5'] });
  assert.equal(empty.diversity['architecture.candidates'].status, 'Insufficient fanout');

  const single = resolveModelRoles({ overrides: { qa: { reviewers: [{ model: 'claude-sonnet-5' }] } }, availableModels: ['claude-sonnet-5'] });
  assert.equal(single.diversity['qa.reviewers'].status, 'Insufficient fanout');
});

test('auto panel entries are runtime-dependent rather than validated family diversity', () => {
  const result = resolveModelRoles({
    overrides: { qa: { reviewers: [{ model: 'auto' }, { model: 'auto' }] } },
    availableModels: ['claude-sonnet-5'],
  });

  assert.equal(result.roles.find((role) => role.role === 'qa.reviewers' && role.index === 0)['validation-status'], 'Runtime-selected; not slug-validated');
  assert.equal(result.diversity['qa.reviewers'].status, 'Unverified runtime-default diversity');
  assert.equal(result.diversity['qa.reviewers'].runtimeDependent, true);
});
