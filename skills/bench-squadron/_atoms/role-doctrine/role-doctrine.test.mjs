import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { dispatchResolvedAgent } from '../../../_base/_atoms/agent-spawn/agent-spawn.mjs';
import { BENCH_ELIGIBLE_MODELS, resolveBenchModelAssignments } from './role-doctrine.mjs';

const ENTRY = fileURLToPath(new URL('./role-doctrine.mjs', import.meta.url));
const input = (overrides = {}) => ({
  deliveryPoolSize: 5,
  runtimeAvailableModels: [...BENCH_ELIGIBLE_MODELS],
  ...overrides,
});

test('Bench resolves its existing role policy through shared routing receipts', () => {
  const result = resolveBenchModelAssignments(input());

  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.assignments.map(({ role, route }) => [role, route.model, route.reasoningEffort, route.contextTier]), [
    ['orchestrator', 'gpt-6-astra', 'high', 'default'],
    ['delivery-1', 'gpt-5.6-sol', 'high', 'default'],
    ['delivery-2', 'gpt-5.6-terra', 'high', 'default'],
    ['delivery-3', 'gpt-5.6-luna', 'high', 'default'],
    ['delivery-4', 'gpt-6-astra', 'high', 'default'],
    ['delivery-5', 'gpt-5.6-sol', 'high', 'default'],
    ['slop-sniper', 'gpt-6-astra', 'xhigh', 'default'],
  ]);
  assert.equal(result.deliveryDiversity.status, 'same-family');
  assert.deepEqual(result.deliveryDiversity.selectedFamilies, ['gpt']);
  assert.equal(result.deliveryDiversity.fanoutApplied, 5);
  assert.ok(result.assignments.every(({ receipt }) =>
    receipt.availabilityStatus === 'observed' && receipt.modelStatus === 'Requested'));
});

test('an explicit eligible fallback becomes the actual dispatch argument', async () => {
  const result = resolveBenchModelAssignments(input({
    deliveryPoolSize: 1,
    runtimeAvailableModels: ['gpt-6-astra', 'gpt-5.6-terra'],
    roleOverrides: { 'delivery-1': { fallbackModels: ['gpt-5.6-luna', 'gpt-5.6-terra'] } },
  }));
  const assignment = result.assignments.find(({ role }) => role === 'delivery-1');
  assert.equal(assignment.receipt.requestedModel, 'gpt-5.6-sol');
  assert.equal(assignment.receipt.modelStatus, 'Fallback: gpt-5.6-terra');
  assert.deepEqual(assignment.route.fallbackModels, []);
  const observed = [];
  const dispatched = await dispatchResolvedAgent({
    ...assignment,
    prompt: 'Inspect the bounded fixture.',
    tools: ['read'],
    transport: async (launch) => {
      observed.push(launch.model);
      return { response: 'fixture result', actualModel: launch.model };
    },
  });
  assert.deepEqual(observed, ['gpt-5.6-terra']);
  assert.equal(dispatched.actualModelStatus, 'matched-selection');
});

test('no available eligible route remains unavailable and never reaches transport', async () => {
  const result = resolveBenchModelAssignments(input({
    deliveryPoolSize: 1,
    runtimeAvailableModels: ['gpt-6-astra', 'gpt-mini'],
  }));
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.unavailableRoles, ['delivery-1']);
  const assignment = result.assignments.find(({ role }) => role === 'delivery-1');
  assert.equal(assignment.route, null);
  const dispatched = await dispatchResolvedAgent({
    ...assignment,
    prompt: 'Inspect the bounded fixture.',
    tools: ['read'],
    transport: () => assert.fail('an unavailable route must not launch'),
  });
  assert.equal(dispatched.status, 'No model available');
});

test('unproven requested or fallback models cannot enter Bench through overrides', () => {
  for (const override of [{ model: 'gpt-mini' }, { fallbackModels: ['gpt-mini'] }]) {
    assert.throws(
      () => resolveBenchModelAssignments(input({ roleOverrides: { 'delivery-1': override } })),
      { code: 'ineligible_model' },
    );
  }
});

test('missing inventory, invalid pool sizes, and unknown configuration are explicit errors', () => {
  for (const bad of [
    null, {}, input({ runtimeAvailableModels: null }), input({ runtimeAvailableModels: [42] }),
    input({ deliveryPoolSize: 0 }), input({ deliveryPoolSize: 6 }), input({ deliveryPoolSize: 1.5 }),
    input({ roleOverrides: { typo: {} } }), input({ roleOverrides: [] }),
    input({ deliveryPoolSize: 1, roleOverrides: { 'delivery-5': {} } }),
    input({ roleOverrides: { orchestrator: { model: null } } }), input({ extra: true }),
    input({ roleOverrides: { orchestrator: { 'fallback-models': ['gpt-5.6-sol'] } } }),
    input({ roleOverrides: { orchestrator: { reasoningEffort: null } } }),
    input({ roleOverrides: { orchestrator: { contextTier: null } } }),
  ]) {
    assert.throws(() => resolveBenchModelAssignments(bad), { code: 'invalid_input' });
  }
  assert.equal(resolveBenchModelAssignments(input({ runtimeAvailableModels: [] })).status, 'unavailable');
});

test('role-specific effort and context changes do not alter the other slots', () => {
  const result = resolveBenchModelAssignments(input({
    roleOverrides: { 'delivery-2': { contextTier: 'long_context' } },
  }));
  assert.equal(result.assignments.find(({ role }) => role === 'delivery-2').route.contextTier, 'long_context');
  assert.ok(result.assignments.filter(({ role }) => role !== 'delivery-2')
    .every(({ route }) => route.contextTier === 'default'));
});

test('the CLI exposes exact route receipts and exits nonzero for unavailable or invalid input', () => {
  const run = (payload) => spawnSync(process.execPath, [ENTRY, '--stdin'], { input: payload, encoding: 'utf8' });
  const success = run(JSON.stringify(input()));
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(JSON.parse(success.stdout), resolveBenchModelAssignments(input()));
  const unavailable = run(JSON.stringify(input({ runtimeAvailableModels: [] })));
  assert.equal(unavailable.status, 1);
  assert.equal(JSON.parse(unavailable.stdout).status, 'unavailable');
  const malformed = run('{');
  assert.equal(malformed.status, 1);
  assert.equal(JSON.parse(malformed.stderr).error.code, 'invalid_json');
});
