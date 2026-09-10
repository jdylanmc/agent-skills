#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ModelRouteResolutionError,
  resolveInlineModelRoute,
  summarizeModelDiversity,
} from '../../../_base/_atoms/agent-spawn/agent-spawn.mjs';
import { MAX_DELIVERY_POOL_AGENTS } from '../bench-epoch/bench-epoch.mjs';

export const BENCH_ELIGIBLE_MODELS = Object.freeze([
  'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
]);
const DELIVERY_MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-5.6-sol'];

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function refuse(message) {
  throw new ModelRouteResolutionError('invalid_input', message);
}

export function resolveBenchModelAssignments(input) {
  if (!record(input)
      || Object.keys(input).some((key) => !['deliveryPoolSize', 'runtimeAvailableModels', 'roleOverrides'].includes(key))) {
    refuse('expected deliveryPoolSize, runtimeAvailableModels, and optional roleOverrides');
  }
  const { deliveryPoolSize, runtimeAvailableModels, roleOverrides = {} } = input;
  if (!Number.isInteger(deliveryPoolSize) || deliveryPoolSize < 1 || deliveryPoolSize > MAX_DELIVERY_POOL_AGENTS) {
    refuse(`deliveryPoolSize must be between 1 and ${MAX_DELIVERY_POOL_AGENTS}`);
  }
  if (!Array.isArray(runtimeAvailableModels)) {
    refuse('runtimeAvailableModels must be an observed array of model IDs');
  }
  const defaults = [
    { role: 'orchestrator', model: 'gpt-6-astra', reasoningEffort: 'high' },
    ...DELIVERY_MODELS.slice(0, deliveryPoolSize).map((model, index) => ({
      role: `delivery-${index + 1}`, model, reasoningEffort: 'high',
    })),
    { role: 'slop-sniper', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
  ];
  if (!record(roleOverrides)
      || Object.entries(roleOverrides).some(([role, override]) =>
        !defaults.some((entry) => entry.role === role) || !record(override)
        || Object.keys(override).some((key) =>
          !['model', 'fallbackModels', 'reasoningEffort', 'contextTier'].includes(key)))) {
    refuse('roleOverrides must map configured slots to model, fallbackModels, reasoningEffort, or contextTier overrides');
  }
  const assignments = defaults.map(({ role, ...route }) => {
    const resolved = resolveInlineModelRoute({
      role,
      resolutionSource: 'bench-policy',
      inlineRoute: { ...route, contextTier: 'default', fallbackModels: [], ...roleOverrides[role] },
      runtimeAvailableModels,
    });
    const requested = [resolved.receipt.requestedModel, ...resolved.receipt.fallbackModels];
    if (requested.some((model) => !BENCH_ELIGIBLE_MODELS.includes(model))) {
      throw new ModelRouteResolutionError('ineligible_model', `${role} requests a model outside the confirmed Bench policy`);
    }
    if (resolved.receipt.reasoningEffort === null || resolved.receipt.contextTier === null) {
      refuse(`${role} must name its reasoning effort and context tier`);
    }
    return Object.freeze({ role, ...resolved });
  });
  const unavailableRoles = assignments.filter((entry) => entry.route === null).map((entry) => entry.role);
  return Object.freeze({
    status: unavailableRoles.length === 0 ? 'resolved' : 'unavailable',
    eligibleModels: BENCH_ELIGIBLE_MODELS,
    runtimeAvailableModels: Object.freeze([...runtimeAvailableModels]),
    assignments: Object.freeze(assignments),
    unavailableRoles: Object.freeze(unavailableRoles),
    deliveryDiversity: summarizeModelDiversity(
      assignments.filter((entry) => entry.role.startsWith('delivery-')).map((entry) => entry.receipt),
    ),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--stdin') {
      refuse('Usage: role-doctrine.mjs --stdin');
    }
    const result = resolveBenchModelAssignments(JSON.parse(fs.readFileSync(0, 'utf8')));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === 'unavailable') process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof ModelRouteResolutionError) && !(error instanceof SyntaxError)) throw error;
    process.stderr.write(`${JSON.stringify({
      error: {
        code: error instanceof SyntaxError ? 'invalid_json' : error.code,
        message: error instanceof SyntaxError ? 'Expected a JSON object on standard input' : error.message,
      },
    })}\n`);
    process.exitCode = 1;
  }
}
