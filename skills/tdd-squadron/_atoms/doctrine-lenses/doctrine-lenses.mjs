#!/usr/bin/env node

import {
  ModelRouteResolutionError,
  resolveEligibleModelRoute,
  runModelRouteCli,
  summarizeModelDiversity,
} from '../../../_base/_atoms/agent-spawn/agent-spawn.mjs';

const ASTRA_FIRST = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
const SOL_FIRST = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra'];
const TERRA_FIRST = ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-6-astra'];
const LUNA_FIRST = ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra'];
export const TDD_ELIGIBLE_MODELS = Object.freeze([...ASTRA_FIRST]);
const ROLES = [
  ['red', SOL_FIRST, 'high', 'red-green'],
  ['green', ASTRA_FIRST, 'high', 'red-green'],
  ['roastmaster', ASTRA_FIRST, 'xhigh', null],
  ['roaster-1', SOL_FIRST, 'xhigh', 'roasters'],
  ['roaster-2', TERRA_FIRST, 'xhigh', 'roasters'],
  ['roaster-3', LUNA_FIRST, 'xhigh', 'roasters'],
  ['publication-agent', ASTRA_FIRST, 'high', null],
  ['slop-sniper', ASTRA_FIRST, 'xhigh', null],
];

export function resolveTddModelAssignments(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['runtimeAvailableModels', 'roleOverrides'].includes(key))) {
    throw new ModelRouteResolutionError('invalid_input', 'expected runtimeAvailableModels and optional roleOverrides');
  }
  const { runtimeAvailableModels, roleOverrides = {} } = input;
  if (!roleOverrides || typeof roleOverrides !== 'object' || Array.isArray(roleOverrides)
      || Object.keys(roleOverrides).some((role) => !ROLES.some(([name]) => name === role))) {
    throw new ModelRouteResolutionError('invalid_input', 'roleOverrides must name configured TDD role slots');
  }
  const used = { 'red-green': new Set(), roasters: new Set() };
  const assignments = ROLES.map(([role, choices, reasoningEffort, diversityGroup]) => {
    const request = {
      role,
      resolutionSource: 'tdd-policy',
      inlineRoute: {
        model: choices[0], fallbackModels: choices.slice(1), reasoningEffort, contextTier: 'default',
      },
      override: roleOverrides[role],
      eligibleModels: TDD_ELIGIBLE_MODELS,
      runtimeAvailableModels,
    };
    const ordered = resolveEligibleModelRoute(request);
    const distinct = diversityGroup === null ? null : resolveEligibleModelRoute({
      ...request,
      runtimeAvailableModels: runtimeAvailableModels.filter((model) => !used[diversityGroup].has(model.trim())),
    });
    const resolved = distinct?.route ? distinct : ordered;
    const selected = resolved.receipt.selectedModel;
    const fallbackReason = selected === null
      ? 'no-eligible-model-available'
      : selected === resolved.receipt.requestedModel
        ? null
        : used[diversityGroup]?.has(resolved.receipt.requestedModel)
          ? 'preferred-model-already-used'
          : 'preferred-model-unavailable';
    if (diversityGroup !== null && selected !== null) used[diversityGroup].add(selected);
    return Object.freeze({
      role, ...resolved, diversityGroup, fallbackReason,
      selectionBasis: distinct?.route ? 'unused-models' : 'ordered-choices',
    });
  });
  const modelVariety = Object.fromEntries(Object.keys(used).map((group) => {
    const members = assignments.filter((entry) => entry.diversityGroup === group);
    const degraded = used[group].size < members.length;
    return [group, Object.freeze({
      intendedDistinctModels: members.length,
      actualDistinctModels: used[group].size,
      degradedModelVariety: degraded,
      reason: members.some((entry) => entry.route === null)
        ? 'unavailable-role'
        : degraded ? 'insufficient-distinct-eligible-models' : null,
      familyDiversity: summarizeModelDiversity(members.map((entry) => entry.receipt)),
    })];
  }));
  const unavailableRoles = assignments.filter((entry) => entry.route === null).map((entry) => entry.role);
  return Object.freeze({
    status: unavailableRoles.length === 0 ? 'resolved' : 'unavailable',
    eligibleModels: TDD_ELIGIBLE_MODELS,
    runtimeAvailableModels: Object.freeze([...runtimeAvailableModels]),
    assignments: Object.freeze(assignments),
    unavailableRoles: Object.freeze(unavailableRoles),
    modelVariety: Object.freeze(modelVariety),
  });
}

runModelRouteCli(import.meta.url, resolveTddModelAssignments);
