#!/usr/bin/env node

export class ModelRouteResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModelRouteResolutionError';
    this.code = code;
  }
}

export const MODEL_ROLE_KEYS = Object.freeze([
  'implementer',
  'cleanup',
  'architecture-candidate',
  'architecture-judge',
  'qa-reviewer',
  'qa-judge',
  'decision-trail-reviewer',
]);

export const MODEL_ROLE_ALIASES = Object.freeze(['auto', 'inherit-parent']);

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ModelRouteResolutionError('invalid_input', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null) {
    return null;
  }
  return nonEmpty(value, field);
}

function normalizeStringArray(value, field) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ModelRouteResolutionError('invalid_input', `${field} must be an array`);
  }
  return value.map((entry, index) => nonEmpty(entry, `${field}[${index}]`));
}

function assertRole(role) {
  const normalized = nonEmpty(role, 'role');
  if (!MODEL_ROLE_KEYS.includes(normalized)) {
    throw new ModelRouteResolutionError('unknown_role', `unknown model role: ${normalized}`);
  }
  return normalized;
}

function normalizeRoleMappings(value, field) {
  if (value === undefined || value === null) {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModelRouteResolutionError('invalid_input', `${field} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !MODEL_ROLE_KEYS.includes(key));
  if (unknown.length) {
    throw new ModelRouteResolutionError(
      'unknown_role',
      `${field} contains unknown roles: ${unknown.sort().join(', ')}`,
    );
  }
  return value;
}

function normalizePositiveInteger(value, field, { allowNull = true } = {}) {
  if (value === undefined || value === null) {
    if (allowNull) {
      return null;
    }
    throw new ModelRouteResolutionError('invalid_input', `${field} is required`);
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new ModelRouteResolutionError('invalid_input', `${field} must be a positive integer`);
  }
  return value;
}

function normalizeRouteSpec(value, field) {
  if (typeof value === 'string') {
    const normalized = nonEmpty(value, field);
    if (MODEL_ROLE_ALIASES.includes(normalized)) {
      return { alias: normalized };
    }
    return {
      model: normalized,
      fallbackModels: [],
      reasoningEffort: null,
      contextTier: null,
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModelRouteResolutionError(
      'invalid_input',
      `${field} must be a string, alias, or object`,
    );
  }
  const allowed = new Set([
    'alias',
    'model',
    'fallbackModels',
    'fallback-models',
    'reasoningEffort',
    'reasoning-effort',
    'contextTier',
    'context-tier',
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new ModelRouteResolutionError(
      'invalid_input',
      `${field} contains unknown keys: ${unknown.sort().join(', ')}`,
    );
  }
  const alias = value.alias === undefined ? null : nonEmpty(value.alias, `${field}.alias`);
  if (alias !== null) {
    if (!MODEL_ROLE_ALIASES.includes(alias)) {
      throw new ModelRouteResolutionError('invalid_input', `${field}.alias is invalid`);
    }
    if (Object.keys(value).length !== 1) {
      throw new ModelRouteResolutionError(
        'invalid_input',
        `${field}.alias cannot be combined with explicit route fields`,
      );
    }
    return { alias };
  }
  return {
    model: nonEmpty(value.model, `${field}.model`),
    fallbackModels: normalizeStringArray(
      value.fallbackModels ?? value['fallback-models'],
      `${field}.fallbackModels`,
    ),
    reasoningEffort: optionalString(
      value.reasoningEffort ?? value['reasoning-effort'],
      `${field}.reasoningEffort`,
    ),
    contextTier: optionalString(
      value.contextTier ?? value['context-tier'],
      `${field}.contextTier`,
    ),
  };
}

function normalizeRouteList(value, field) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new ModelRouteResolutionError('invalid_input', `${field} must be non-empty`);
    }
    return value.map((entry, index) => normalizeRouteSpec(entry, `${field}[${index}]`));
  }
  return [normalizeRouteSpec(value, field)];
}

function normalizeInlineDefaults(value, field) {
  const defaults = normalizeRouteList(value, field);
  for (const [index, entry] of defaults.entries()) {
    if (entry.alias) {
      throw new ModelRouteResolutionError(
        'invalid_input',
        `${field}[${index}] cannot use ${entry.alias} as an inline default`,
      );
    }
  }
  return defaults;
}

function normalizeRuntimeAvailableModels(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof Set) {
    return new Set([...value].map((entry) => nonEmpty(entry, 'runtimeAvailableModels')));
  }
  if (!Array.isArray(value)) {
    throw new ModelRouteResolutionError(
      'invalid_input',
      'runtimeAvailableModels must be an array or set',
    );
  }
  return new Set(value.map((entry, index) => nonEmpty(entry, `runtimeAvailableModels[${index}]`)));
}

function cloneRoute(route) {
  return {
    model: route.model,
    fallbackModels: [...route.fallbackModels],
    reasoningEffort: route.reasoningEffort,
    contextTier: route.contextTier,
  };
}

function defaultAt(defaults, index) {
  return cloneRoute(defaults[Math.min(index, defaults.length - 1)]);
}

export function modelFamily(model) {
  const normalized = optionalString(model, 'modelFamily.model');
  if (normalized === null) {
    return null;
  }
  const lower = normalized.toLowerCase();
  for (const prefix of ['mai-code', 'claude', 'gpt', 'gemini', 'grok']) {
    if (lower.startsWith(prefix)) {
      return prefix;
    }
  }
  const match = /^[a-z]+(?:-[a-z]+)?/.exec(lower);
  return match?.[0] ?? lower;
}

function selectMappingValue(role, repositoryModelRoles, userModelRoles) {
  if (Object.hasOwn(userModelRoles, role)) {
    return { value: userModelRoles[role], source: 'user-model-roles' };
  }
  if (Object.hasOwn(repositoryModelRoles, role)) {
    return { value: repositoryModelRoles[role], source: 'repository-model-roles' };
  }
  return { value: null, source: 'inline-default' };
}

function resolveAlias(spec, { role, source, parentModelRoute, defaultRoute, position }) {
  if (!spec.alias) {
    return { route: cloneRoute(spec), alias: null, resolutionSource: source };
  }
  if (spec.alias === 'auto') {
    return {
      route: cloneRoute(defaultRoute),
      alias: 'auto',
      resolutionSource: source,
    };
  }
  if (!parentModelRoute) {
    throw new ModelRouteResolutionError(
      'parent_route_required',
      `${role}[${position}] uses inherit-parent without parentModelRoute`,
    );
  }
  return {
    route: cloneRoute(parentModelRoute),
    alias: 'inherit-parent',
    resolutionSource: source,
  };
}

function resolveAvailability(route, runtimeAvailableModels) {
  if (route.model === null) {
    return {
      availabilityStatus: 'runtime-default',
      selectedModel: null,
      modelStatus: 'Runtime default',
    };
  }
  if (runtimeAvailableModels === null) {
    return {
      availabilityStatus: 'unobserved',
      selectedModel: route.model,
      modelStatus: 'Requested',
    };
  }
  if (runtimeAvailableModels.has(route.model)) {
    return {
      availabilityStatus: 'observed',
      selectedModel: route.model,
      modelStatus: 'Requested',
    };
  }
  for (const fallback of route.fallbackModels) {
    if (runtimeAvailableModels.has(fallback)) {
      return {
        availabilityStatus: 'observed',
        selectedModel: fallback,
        modelStatus: `Fallback: ${fallback}`,
      };
    }
  }
  return {
    availabilityStatus: 'unavailable',
    selectedModel: null,
    modelStatus: 'Unavailable',
  };
}

export function resolveDirectSpawnRoute({
  model = null,
  fallbackModels = [],
  reasoningEffort = null,
  contextTier = null,
  runtimeAvailableModels = null,
} = {}) {
  const route = {
    model: model === null || model === undefined ? null : nonEmpty(model, 'model'),
    fallbackModels: normalizeStringArray(fallbackModels, 'fallbackModels'),
    reasoningEffort: optionalString(reasoningEffort, 'reasoningEffort'),
    contextTier: optionalString(contextTier, 'contextTier'),
  };
  const availability = resolveAvailability(route, normalizeRuntimeAvailableModels(runtimeAvailableModels));
  return {
    route,
    receipt: {
      role: null,
      resolutionSource: 'direct-input',
      alias: null,
      requestedModel: route.model,
      requestedFamily: modelFamily(route.model),
      fallbackModels: [...route.fallbackModels],
      reasoningEffort: route.reasoningEffort,
      contextTier: route.contextTier,
      availabilityStatus: availability.availabilityStatus,
      selectedModel: availability.selectedModel,
      modelStatus: availability.modelStatus,
      selectedFamily: modelFamily(availability.selectedModel),
      family: modelFamily(availability.selectedModel),
    },
  };
}

export function resolveInlineModelRoute({
  inlineRoute,
  runtimeAvailableModels = null,
  role = null,
  resolutionSource = 'inline-default',
} = {}) {
  const route = normalizeRouteSpec(inlineRoute, 'inlineRoute');
  if (route.alias) {
    throw new ModelRouteResolutionError(
      'invalid_input',
      'inlineRoute cannot use auto or inherit-parent',
    );
  }
  const availability = resolveAvailability(route, normalizeRuntimeAvailableModels(runtimeAvailableModels));
  return {
    route: cloneRoute(route),
    receipt: {
      role,
      resolutionSource,
      alias: null,
      requestedModel: route.model,
      requestedFamily: modelFamily(route.model),
      fallbackModels: [...route.fallbackModels],
      reasoningEffort: route.reasoningEffort,
      contextTier: route.contextTier,
      availabilityStatus: availability.availabilityStatus,
      selectedModel: availability.selectedModel,
      modelStatus: availability.modelStatus,
      selectedFamily: modelFamily(availability.selectedModel),
      family: modelFamily(availability.selectedModel),
    },
  };
}

export function resolveModelRoleRoute({
  role,
  inlineDefault,
  repositoryModelRoles = {},
  userModelRoles = {},
  parentModelRoute = null,
  runtimeAvailableModels = null,
} = {}) {
  const normalizedRole = assertRole(role);
  const defaults = normalizeInlineDefaults(inlineDefault, 'inlineDefault');
  if (defaults.length !== 1) {
    throw new ModelRouteResolutionError(
      'invalid_input',
      'resolveModelRoleRoute requires exactly one inline default route',
    );
  }
  const repository = normalizeRoleMappings(repositoryModelRoles, 'repositoryModelRoles');
  const user = normalizeRoleMappings(userModelRoles, 'userModelRoles');
  const runtime = normalizeRuntimeAvailableModels(runtimeAvailableModels);
  const selected = selectMappingValue(normalizedRole, repository, user);
  const specs = selected.value === null
    ? [defaults[0]]
    : normalizeRouteList(selected.value, `modelRoles.${normalizedRole}`);
  if (specs.length !== 1) {
    throw new ModelRouteResolutionError(
      'invalid_input',
      `${normalizedRole} resolves to ${specs.length} routes; one was required`,
    );
  }
  const resolved = resolveAlias(specs[0], {
    role: normalizedRole,
    source: selected.source,
    parentModelRoute,
    defaultRoute: defaults[0],
    position: 0,
  });
  const availability = resolveAvailability(resolved.route, runtime);
  return {
    route: resolved.route,
    receipt: {
      role: normalizedRole,
      resolutionSource: resolved.resolutionSource,
      alias: resolved.alias,
      requestedModel: resolved.route.model,
      requestedFamily: modelFamily(resolved.route.model),
      fallbackModels: [...resolved.route.fallbackModels],
      reasoningEffort: resolved.route.reasoningEffort,
      contextTier: resolved.route.contextTier,
      availabilityStatus: availability.availabilityStatus,
      selectedModel: availability.selectedModel,
      modelStatus: availability.modelStatus,
      selectedFamily: modelFamily(availability.selectedModel),
      family: modelFamily(availability.selectedModel),
    },
  };
}

export function summarizeModelDiversity(receipts, { fanoutRequested, fanoutApplied } = {}) {
  const requested = normalizePositiveInteger(fanoutRequested ?? receipts.length, 'fanoutRequested', { allowNull: false });
  const applied = normalizePositiveInteger(fanoutApplied ?? receipts.length, 'fanoutApplied', { allowNull: false });
  if (applied > requested) {
    throw new ModelRouteResolutionError('invalid_input', 'fanoutApplied cannot exceed fanoutRequested');
  }
  const selectedFamilies = [...new Set(
    receipts
      .map((entry) => entry.family)
      .filter((entry) => entry !== null),
  )].sort();
  const unobserved = receipts.some((entry) => entry.availabilityStatus === 'unobserved');
  const unavailable = receipts.some((entry) => entry.modelStatus === 'Unavailable');
  const fallback = receipts.some((entry) => entry.modelStatus.startsWith('Fallback: '));
  const reasons = [];
  if (requested !== applied) {
    reasons.push('fanout-capped');
  }
  if (fallback) {
    reasons.push('fallback-used');
  }
  if (unavailable) {
    reasons.push('unavailable-seat');
  }
  let status = 'distinct-families';
  if (applied <= 1) {
    status = 'single-route';
  } else if (unobserved) {
    status = 'unobserved';
  } else if (selectedFamilies.length <= 1) {
    status = 'same-family';
  }
  return {
    status,
    degraded: reasons.length > 0,
    reasons,
    selectedFamilies,
    availableSeats: receipts.filter((entry) => entry.modelStatus !== 'Unavailable').length,
    unavailableSeats: receipts.filter((entry) => entry.modelStatus === 'Unavailable').length,
    fanoutRequested: requested,
    fanoutApplied: applied,
  };
}

export function resolveModelRolePanel({
  role,
  inlineDefaults,
  repositoryModelRoles = {},
  userModelRoles = {},
  parentModelRoute = null,
  runtimeAvailableModels = null,
  panelLength = null,
  fanoutCap = null,
} = {}) {
  const normalizedRole = assertRole(role);
  const defaults = normalizeInlineDefaults(inlineDefaults, 'inlineDefaults');
  const repository = normalizeRoleMappings(repositoryModelRoles, 'repositoryModelRoles');
  const user = normalizeRoleMappings(userModelRoles, 'userModelRoles');
  const runtime = normalizeRuntimeAvailableModels(runtimeAvailableModels);
  const selected = selectMappingValue(normalizedRole, repository, user);
  const requestedPanelLength = normalizePositiveInteger(panelLength, 'panelLength');
  const cap = normalizePositiveInteger(fanoutCap, 'fanoutCap');

  let specs;
  if (selected.value === null) {
    specs = defaults.map((entry) => cloneRoute(entry));
  } else {
    specs = normalizeRouteList(selected.value, `modelRoles.${normalizedRole}`);
  }
  if (selected.value !== null && !Array.isArray(selected.value) && requestedPanelLength !== null) {
    specs = Array.from({ length: requestedPanelLength }, () => specs[0]);
  } else if (selected.value === null && requestedPanelLength !== null && specs.length === 1) {
    specs = Array.from({ length: requestedPanelLength }, () => defaults[0]);
  }

  const fanoutRequested = specs.length;
  const fanoutApplied = cap === null ? fanoutRequested : Math.min(fanoutRequested, cap);
  const receipts = [];
  const routes = [];
  for (let index = 0; index < fanoutApplied; index += 1) {
    const resolved = resolveAlias(specs[index], {
      role: normalizedRole,
      source: selected.source,
      parentModelRoute,
      defaultRoute: defaultAt(defaults, index),
      position: index,
    });
    const availability = resolveAvailability(resolved.route, runtime);
    routes.push(resolved.route);
    receipts.push({
      role: normalizedRole,
      resolutionSource: resolved.resolutionSource,
      alias: resolved.alias,
      requestedModel: resolved.route.model,
      requestedFamily: modelFamily(resolved.route.model),
      fallbackModels: [...resolved.route.fallbackModels],
      reasoningEffort: resolved.route.reasoningEffort,
      contextTier: resolved.route.contextTier,
      availabilityStatus: availability.availabilityStatus,
      selectedModel: availability.selectedModel,
      modelStatus: availability.modelStatus,
      selectedFamily: modelFamily(availability.selectedModel),
      family: modelFamily(availability.selectedModel),
      panelIndex: index + 1,
    });
  }
  return {
    role: normalizedRole,
    routes,
    receipts,
    panel: summarizeModelDiversity(receipts, { fanoutRequested, fanoutApplied }),
  };
}
