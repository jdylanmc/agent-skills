#!/usr/bin/env node

import {
  ModelRouteResolutionError,
  resolveEligibleModelRoute,
  runModelRouteCli,
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
  const defaults = [
    { role: 'orchestrator', model: 'gpt-6-astra', reasoningEffort: 'high' },
    ...DELIVERY_MODELS.slice(0, deliveryPoolSize).map((model, index) => ({
      role: `delivery-${index + 1}`, model, reasoningEffort: 'high',
    })),
    { role: 'slop-sniper', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
  ];
  if (!record(roleOverrides)
      || Object.entries(roleOverrides).some(([role, override]) =>
        !defaults.some((entry) => entry.role === role) || !record(override))) {
    refuse('roleOverrides must map configured role slots to route objects');
  }
  const assignments = defaults.map(({ role, ...route }) => {
    const resolved = resolveEligibleModelRoute({
      role,
      resolutionSource: 'bench-policy',
      inlineRoute: { ...route, contextTier: 'default', fallbackModels: [] },
      override: roleOverrides[role],
      eligibleModels: BENCH_ELIGIBLE_MODELS,
      runtimeAvailableModels,
    });
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

runModelRouteCli(import.meta.url, resolveBenchModelAssignments);
