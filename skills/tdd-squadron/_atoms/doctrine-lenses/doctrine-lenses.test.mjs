import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { dispatchResolvedAgent } from '../../../_base/_atoms/agent-spawn/agent-spawn.mjs';
import { resolveTddModelAssignments, TDD_ELIGIBLE_MODELS } from './doctrine-lenses.mjs';

const ENTRY = fileURLToPath(new URL('./doctrine-lenses.mjs', import.meta.url));
const input = (overrides = {}) => ({ runtimeAvailableModels: [...TDD_ELIGIBLE_MODELS], ...overrides });
const slot = (result, role) => result.assignments.find((entry) => entry.role === role);

test('the executable policy preserves all eight existing role defaults', () => {
  const result = resolveTddModelAssignments(input());
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.assignments.map(({ role, route }) =>
    [role, route.model, route.reasoningEffort, route.contextTier]), [
    ['red', 'gpt-5.6-sol', 'high', 'default'],
    ['green', 'gpt-6-astra', 'high', 'default'],
    ['roastmaster', 'gpt-6-astra', 'xhigh', 'default'],
    ['roaster-1', 'gpt-5.6-sol', 'xhigh', 'default'],
    ['roaster-2', 'gpt-5.6-terra', 'xhigh', 'default'],
    ['roaster-3', 'gpt-5.6-luna', 'xhigh', 'default'],
    ['publication-agent', 'gpt-6-astra', 'high', 'default'],
    ['slop-sniper', 'gpt-6-astra', 'xhigh', 'default'],
  ]);
  assert.equal(result.modelVariety['red-green'].actualDistinctModels, 2);
  assert.equal(result.modelVariety.roasters.actualDistinctModels, 3);
  assert.equal(result.modelVariety.roasters.degradedModelVariety, false);
  assert.equal(result.modelVariety.roasters.familyDiversity.status, 'same-family');
});

test('all sixteen inventory subsets preserve eligible choices and honest group variety', () => {
  for (let mask = 0; mask < 16; mask += 1) {
    const available = TDD_ELIGIBLE_MODELS.filter((_, index) => mask & (1 << index));
    const result = resolveTddModelAssignments(input({ runtimeAvailableModels: available }));
    assert.equal(result.status, available.length ? 'resolved' : 'unavailable');
    for (const [group, intended] of [['red-green', 2], ['roasters', 3]]) {
      const variety = result.modelVariety[group];
      assert.equal(variety.intendedDistinctModels, intended);
      assert.equal(variety.actualDistinctModels, Math.min(intended, available.length));
      assert.equal(variety.degradedModelVariety, available.length < intended);
      assert.equal(variety.reason !== null, variety.degradedModelVariety);
    }
    for (const { route, receipt } of result.assignments) {
      if (!available.length) {
        assert.equal(route, null);
        assert.equal(receipt.selectedModel, null);
      } else {
        assert.ok(available.includes(route.model));
        assert.ok([receipt.requestedModel, ...receipt.fallbackModels].includes(route.model));
      }
    }
  }
});

test('ordered choices prefer unused IDs within each group and explain fallback', async () => {
  const result = resolveTddModelAssignments(input({
    runtimeAvailableModels: ['gpt-5.6-sol', 'gpt-5.6-terra'],
  }));
  assert.equal(slot(result, 'red').route.model, 'gpt-5.6-sol');
  const green = slot(result, 'green');
  assert.equal(green.route.model, 'gpt-5.6-terra');
  assert.equal(green.fallbackReason, 'preferred-model-unavailable');
  assert.equal(slot(result, 'roaster-3').route.model, 'gpt-5.6-sol');
  assert.equal(result.modelVariety.roasters.degradedModelVariety, true);
  const dispatched = await dispatchResolvedAgent({
    ...green,
    prompt: 'Read the bounded fixture.',
    tools: ['read'],
    transport: async (launch) => {
      assert.equal(launch.model, 'gpt-5.6-terra');
      return { response: 'fixture result', actualModel: launch.model };
    },
  });
  assert.equal(dispatched.actualModelStatus, 'matched-selection');
});

test('diversity exclusions and repeated fallback IDs never invent another model', () => {
  const result = resolveTddModelAssignments(input({
    runtimeAvailableModels: [' gpt-5.6-sol ', 'gpt-5.6-terra', 'gpt-6-astra'],
    roleOverrides: { green: { model: 'gpt-5.6-sol', fallbackModels: ['gpt-5.6-sol', 'gpt-5.6-terra'] } },
  }));
  assert.equal(slot(result, 'green').route.model, 'gpt-5.6-terra');
  assert.equal(slot(result, 'green').fallbackReason, 'preferred-model-already-used');
  assert.equal(slot(result, 'green').selectionBasis, 'unused-models');

  const repeated = resolveTddModelAssignments(input({
    roleOverrides: { green: { model: 'gpt-5.6-sol', fallbackModels: [] } },
  }));
  assert.equal(slot(repeated, 'green').route.model, 'gpt-5.6-sol');
  assert.equal(repeated.modelVariety['red-green'].actualDistinctModels, 1);
  assert.equal(repeated.modelVariety['red-green'].degradedModelVariety, true);
});

test('unavailable choices never dispatch or silently use an unproven model', async () => {
  const result = resolveTddModelAssignments(input({ runtimeAvailableModels: ['gpt-mini'] }));
  assert.equal(result.unavailableRoles.length, 8);
  const dispatched = await dispatchResolvedAgent({
    ...slot(result, 'red'),
    prompt: 'Read the bounded fixture.',
    tools: ['read'],
    transport: () => assert.fail('unavailable routes must not launch'),
  });
  assert.equal(dispatched.status, 'No model available');
  for (const override of [{ model: 'gpt-mini' }, { fallbackModels: ['gpt-mini'] }]) {
    assert.throws(() => resolveTddModelAssignments(input({ roleOverrides: { red: override } })),
      { code: 'ineligible_model' });
  }
});

test('invalid configuration fails and per-role context changes stay local', () => {
  for (const bad of [null, {}, [], input({ extra: true }), input({ runtimeAvailableModels: null }),
    input({ roleOverrides: { typo: {} } }), input({ roleOverrides: { red: null } }),
    input({ roleOverrides: { red: { 'fallback-models': [] } } })]) {
    assert.throws(() => resolveTddModelAssignments(bad), { code: 'invalid_input' });
  }
  const result = resolveTddModelAssignments(input({
    roleOverrides: { red: { contextTier: 'long_context' } },
  }));
  assert.equal(slot(result, 'red').route.contextTier, 'long_context');
  assert.equal(slot(result, 'green').route.contextTier, 'default');
  assert.ok(Object.isFrozen(result.modelVariety.roasters));
});

test('TDD uses the same CLI receipt and error protocol as Bench', () => {
  const run = (payload) => spawnSync(process.execPath, [ENTRY, '--stdin'], { input: payload, encoding: 'utf8' });
  const success = run(JSON.stringify(input()));
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(JSON.parse(success.stdout), resolveTddModelAssignments(input()));
  const unavailable = run(JSON.stringify(input({ runtimeAvailableModels: [] })));
  assert.equal(unavailable.status, 1);
  assert.equal(JSON.parse(unavailable.stdout).status, 'unavailable');
  const malformed = run('{');
  assert.equal(malformed.status, 1);
  assert.equal(JSON.parse(malformed.stderr).error.code, 'invalid_json');
});
