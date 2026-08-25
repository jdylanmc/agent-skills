const DEFAULTS = Object.freeze({
  implementer: Object.freeze({ model: 'claude-sonnet-5', fallbackModels: ['gpt-5.6-sol', 'gpt-5.5', 'claude-opus-5'], reasoningEffort: 'high', contextTier: 'default' }),
  cleanup: Object.freeze({ model: 'gpt-5.4-mini', fallbackModels: ['claude-haiku-4.5', 'gpt-5-mini'], reasoningEffort: 'low', contextTier: 'default' }),
  architecture: Object.freeze({
    candidates: Object.freeze([
      Object.freeze({ model: 'claude-opus-5', fallbackModels: ['gpt-5.6-sol', 'grok-4.6', 'claude-sonnet-5'], reasoningEffort: 'high', contextTier: 'long_context' }),
      Object.freeze({ model: 'gpt-5.6-sol', fallbackModels: ['claude-opus-5', 'grok-4.6', 'gpt-5.5'], reasoningEffort: 'high', contextTier: 'long_context' }),
      Object.freeze({ model: 'grok-4.6', fallbackModels: ['claude-opus-5', 'gpt-5.6-sol', 'gemini-3.7-flash'], reasoningEffort: 'high', contextTier: 'long_context' }),
    ]),
    judge: Object.freeze({ model: 'claude-opus-5', fallbackModels: ['gpt-5.6-sol', 'claude-sonnet-5'], reasoningEffort: 'xhigh', contextTier: 'long_context' }),
  }),
  qa: Object.freeze({
    reviewers: Object.freeze([
      Object.freeze({ model: 'gpt-5.6-sol', fallbackModels: ['claude-sonnet-5', 'gemini-3.7-flash'], reasoningEffort: 'high', contextTier: 'long_context' }),
      Object.freeze({ model: 'claude-sonnet-5', fallbackModels: ['gpt-5.6-sol', 'gemini-3.7-flash'], reasoningEffort: 'high', contextTier: 'long_context' }),
      Object.freeze({ model: 'gemini-3.7-flash', fallbackModels: ['gpt-5.6-sol', 'claude-sonnet-5'], reasoningEffort: 'high', contextTier: 'long_context' }),
    ]),
    judge: Object.freeze({ model: 'claude-opus-5', fallbackModels: ['gpt-5.6-sol', 'gpt-5.5'], reasoningEffort: 'xhigh', contextTier: 'long_context' }),
  }),
  'decision-trail': Object.freeze({
    reviewer: Object.freeze({ model: 'claude-sonnet-5', fallbackModels: ['gpt-5.6-sol', 'gpt-5.5'], reasoningEffort: 'medium', contextTier: 'default' }),
  }),
});

const KNOWN_TOP_LEVEL = new Set(['implementer', 'cleanup', 'architecture', 'qa', 'decision-trail', 'decisionTrail']);
const ROUTE_KEYS = new Set([
  'model',
  'fallbackModels',
  'fallback-models',
  'reasoningEffort',
  'reasoning-effort',
  'contextTier',
  'context-tier',
]);
const KNOWN_CHILDREN = Object.freeze({
  architecture: new Set(['candidates', 'judge']),
  qa: new Set(['reviewers', 'judge']),
  'decision-trail': new Set(['reviewer']),
  decisionTrail: new Set(['reviewer']),
});
const SLUG = /^[a-z0-9][a-z0-9._-]*$/;

export function defaultModelRoles() {
  return clone(DEFAULTS);
}

export function resolveModelRoles(input = {}) {
  const errors = [];
  const warnings = [];
  const layers = collectOverrideLayers(input, errors, warnings);
  const availableModels = normalizeAvailability(input.availableModels, errors);
  const parentRouting = normalizeRoute(input.parentRouting ?? null, 'parentRouting', errors);

  if (errors.length > 0) {
    return {
      status: 'InvalidConfig',
      roles: [],
      fanout: {},
      diversity: {},
      warnings: unique(warnings),
      errors,
      availabilityValidated: Array.isArray(input.availableModels),
      configurationSources: layers.map((layer) => layer.source),
    };
  }

  const merged = layers.reduce((current, layer) => mergeConfig(current, layer.overrides), defaultModelRoles());
  const roles = [
    resolveEntry('implementer', merged.implementer, { availableModels, parentRouting, warnings }),
    resolveEntry('cleanup', merged.cleanup, { availableModels, parentRouting, warnings }),
    ...merged.architecture.candidates.map((entry, index) => resolveEntry('architecture.candidates', entry, { index, availableModels, parentRouting, warnings })),
    resolveEntry('architecture.judge', merged.architecture.judge, { availableModels, parentRouting, warnings }),
    ...merged.qa.reviewers.map((entry, index) => resolveEntry('qa.reviewers', entry, { index, availableModels, parentRouting, warnings })),
    resolveEntry('qa.judge', merged.qa.judge, { availableModels, parentRouting, warnings }),
    resolveEntry('decision-trail.reviewer', merged['decision-trail'].reviewer, { availableModels, parentRouting, warnings }),
  ];

  const fanout = {
    'architecture.candidates': merged.architecture.candidates.length,
    'qa.reviewers': merged.qa.reviewers.length,
  };
  const diversityEntries = [
    panelDiversity('architecture.candidates', roles, warnings),
    panelDiversity('qa.reviewers', roles, warnings),
  ];
  const diversity = Object.fromEntries(diversityEntries.map((entry) => [entry.panel, entry]));
  const degraded = warnings.length > 0
    || roles.some((role) => role['model-status'] !== 'Requested')
    || diversityEntries.some((item) => item.status !== 'Diverse');

  return {
    status: degraded ? 'ResolvedWithDegradation' : 'Resolved',
    roles,
    fanout,
    diversity,
    warnings: unique(warnings),
    errors,
    availabilityValidated: availableModels !== null,
    configurationSources: layers.map((layer) => layer.source),
  };
}

function collectOverrideLayers(input, errors, warnings) {
  const specs = [
    ['repositoryOverrides', input.repositoryOverrides ?? input.repositoryConfig],
    ['userOverrides', input.userOverrides ?? input.userConfig],
    ['overrides', input.overrides ?? input.config],
  ];
  const layers = [{ source: 'inline-defaults', overrides: {} }];
  for (const [source, value] of specs) {
    if (value === undefined || value === null) continue;
    layers.push({ source, overrides: normalizeOverrides(value, source, errors, warnings) });
  }
  return layers;
}

function normalizeOverrides(value, source, errors, warnings) {
  if (value == null) return {};
  if (!isPlainObject(value)) {
    errors.push(`${source} must be a JSON object`);
    return {};
  }

  const normalized = {};
  for (const [rawKey, raw] of Object.entries(value)) {
    if (!KNOWN_TOP_LEVEL.has(rawKey)) {
      warnings.push(`${source}: unknown role '${rawKey}' ignored`);
      continue;
    }
    const key = rawKey === 'decisionTrail' ? 'decision-trail' : rawKey;
    if (key === 'implementer' || key === 'cleanup') {
      const route = normalizeRoute(raw, key, errors);
      if (route) normalized[key] = route;
      continue;
    }
    if (!isPlainObject(raw)) {
      errors.push(`${key} must be an object`);
      continue;
    }
    normalized[key] = {};
    for (const [child, childRaw] of Object.entries(raw)) {
      if (!KNOWN_CHILDREN[key].has(child)) {
        warnings.push(`${source}: unknown role '${key}.${child}' ignored`);
        continue;
      }
      const fullName = `${key}.${child}`;
      if (child === 'candidates' || child === 'reviewers') {
        if (!Array.isArray(childRaw)) {
          errors.push(`${fullName} panel override must be an array`);
          continue;
        }
        normalized[key][child] = childRaw.map((entry, index) => normalizeRoute(entry, `${fullName}[${index}]`, errors)).filter(Boolean);
      } else {
        const route = normalizeRoute(childRaw, fullName, errors);
        if (route) normalized[key][child] = route;
      }
    }
  }
  return normalized;
}

function normalizeRoute(raw, location, errors) {
  if (raw == null) return null;
  if (!isPlainObject(raw)) {
    errors.push(`${location} must be an object`);
    return null;
  }
  for (const key of Object.keys(raw)) {
    if (!ROUTE_KEYS.has(key)) errors.push(`${location}.${key} is not an accepted model-role field`);
  }
  const route = {};
  if ('model' in raw) {
    if (!validModelValue(raw.model)) errors.push(`${location}.model must be a slug, auto, or inherit-parent`);
    else route.model = raw.model;
  }
  const fallbackRaw = raw.fallbackModels ?? raw['fallback-models'];
  if (fallbackRaw !== undefined) {
    if (!Array.isArray(fallbackRaw) || !fallbackRaw.every(isConcreteModelSlug)) {
      errors.push(`${location}.fallback-models must be an array of concrete model slugs`);
    } else {
      route.fallbackModels = [...fallbackRaw];
    }
  }
  const effort = raw.reasoningEffort ?? raw['reasoning-effort'];
  if (effort !== undefined) {
    if (typeof effort !== 'string' || effort.length === 0) errors.push(`${location}.reasoning-effort must be a string`);
    else route.reasoningEffort = effort;
  }
  const context = raw.contextTier ?? raw['context-tier'];
  if (context !== undefined) {
    if (typeof context !== 'string' || context.length === 0) errors.push(`${location}.context-tier must be a string`);
    else route.contextTier = context;
  }
  return route;
}

function normalizeAvailability(value, errors) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || !value.every(isConcreteModelSlug)) {
    errors.push('availableModels must be an array of concrete model slugs');
    return null;
  }
  return new Set(value);
}

function validModelValue(value) {
  return value === 'auto' || value === 'inherit-parent' || isConcreteModelSlug(value);
}

function isConcreteModelSlug(value) {
  return typeof value === 'string' && value !== 'auto' && value !== 'inherit-parent' && SLUG.test(value);
}

function mergeConfig(base, overrides) {
  const result = clone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'implementer' || key === 'cleanup') {
      result[key] = { ...result[key], ...value };
    } else {
      for (const [child, childValue] of Object.entries(value)) {
        if (Array.isArray(childValue)) result[key][child] = childValue.map((entry) => ({ ...entry }));
        else result[key][child] = { ...result[key][child], ...childValue };
      }
    }
  }
  return result;
}

function resolveEntry(role, route, options) {
  const { index, availableModels, parentRouting, warnings } = options;
  const record = { role, routing: {}, reasons: [], unavailable: [], 'validation-status': availableModels ? 'Validated' : 'Not validated' };
  if (index !== undefined) record.index = index;

  let effective = { ...route };
  if (route.model === 'inherit-parent') {
    if (!parentRouting) return noModel(record, 'inherit-parent requested but no parent routing was supplied', warnings);
    effective = { ...parentRouting, fallbackModels: parentRouting.fallbackModels ?? parentRouting['fallback-models'] ?? [] };
    record.inherited = true;
    record.reasons.push('Inherited parent routing');
  }

  if (effective.model === 'auto' || effective.model === undefined) {
    applyForwarded(record.routing, effective);
    record['model-status'] = 'Runtime default';
    record['validation-status'] = 'Runtime-selected; not slug-validated';
    record.reasons.push(effective.model === 'auto' ? 'auto alias requested' : 'model omitted');
    warnings.push(`${role}${indexSuffix(index)} uses Runtime default; selected model and family are runtime-dependent`);
    return record;
  }

  const requested = effective.model;
  const fallbacks = [...(effective.fallbackModels ?? [])];
  if (!availableModels) {
    record.routing.model = requested;
    if (fallbacks.length) record.routing['fallback-models'] = fallbacks;
    applyForwarded(record.routing, effective);
    record['model-status'] = 'Requested';
    record.reasons.push('Availability was not validated; requested slug was not runtime-validated');
    warnings.push(`${role}${indexSuffix(index)} requested '${requested}' without availability validation; availability was not validated`);
    return record;
  }

  if (availableModels.has(requested)) {
    record.routing.model = requested;
    const availableFallbacks = fallbacks.filter((model) => availableModels.has(model));
    if (availableFallbacks.length) record.routing['fallback-models'] = availableFallbacks;
    for (const unavailable of fallbacks.filter((model) => !availableModels.has(model))) record.unavailable.push(unavailable);
    applyForwarded(record.routing, effective);
    record['model-status'] = 'Requested';
    if (record.unavailable.length) warnings.push(`${role}${indexSuffix(index)} has unavailable fallback(s): ${record.unavailable.join(', ')}`);
    return record;
  }

  record.unavailable.push(requested);
  const fallback = fallbacks.find((model) => availableModels.has(model));
  if (fallback) {
    record.routing.model = fallback;
    record.routing['fallback-models'] = fallbacks.slice(fallbacks.indexOf(fallback) + 1).filter((model) => availableModels.has(model));
    applyForwarded(record.routing, effective);
    record['model-status'] = `Fallback: ${fallback}`;
    record.reasons.push(`Requested model '${requested}' unavailable`);
    warnings.push(`${role}${indexSuffix(index)} fell back from '${requested}' to '${fallback}'`);
    for (const unavailable of fallbacks.filter((model) => !availableModels.has(model))) record.unavailable.push(unavailable);
    return record;
  }

  for (const unavailable of fallbacks) record.unavailable.push(unavailable);
  return noModel(record, `requested model '${requested}' and all listed fallbacks are unavailable`, warnings);
}

function noModel(record, reason, warnings) {
  record.status = 'Unavailable';
  record['model-status'] = 'No model available';
  record['validation-status'] = 'Unavailable';
  record.reasons.push(reason);
  warnings.push(`${record.role}${indexSuffix(record.index)} has no model available: ${reason}`);
  return record;
}

function applyForwarded(target, source) {
  if (source.reasoningEffort) target['reasoning-effort'] = source.reasoningEffort;
  if (source.contextTier) target['context-tier'] = source.contextTier;
}

function panelDiversity(role, roles, warnings) {
  const members = roles.filter((item) => item.role === role);
  const unresolvedRuntime = members.some((item) => item['model-status'] === 'Runtime default');
  const models = members.map((item) => item.routing.model).filter(Boolean);
  const selectedFamilies = [...new Set(models.map(modelFamily))].sort();
  const fallbackDegraded = members.some((item) => item['model-status'].startsWith('Fallback:') || item['model-status'] === 'No model available');
  let status = 'Diverse';
  if (members.length < 2) {
    status = 'Insufficient fanout';
    warnings.push(`${role} diversity degraded: configured fanout is ${members.length}`);
  } else if (unresolvedRuntime) {
    status = 'Unverified runtime-default diversity';
    warnings.push(`${role} diversity is unverified because at least one entry uses Runtime default`);
  } else if (selectedFamilies.length <= 1) {
    status = 'Same-family degraded';
    warnings.push(`${role} diversity degraded: effective models collapse to one family`);
  } else if (fallbackDegraded) {
    status = 'Fallback degraded';
    warnings.push(`${role} diversity degraded by fallback or unavailable reviewer`);
  }
  return {
    panel: role,
    status,
    fanout: members.length,
    selectedFamilies,
    families: Object.fromEntries(selectedFamilies.map((family) => [family, models.filter((model) => modelFamily(model) === family).length])),
    runtimeDependent: unresolvedRuntime,
  };
}

function modelFamily(model) {
  if (model === 'Runtime default') return 'runtime-default';
  if (model.startsWith('claude-')) return 'claude';
  if (model.startsWith('gpt-')) return 'gpt';
  if (model.startsWith('gemini-')) return 'gemini';
  if (model.startsWith('grok-')) return 'grok';
  if (model.startsWith('mai-')) return 'mai';
  return model.split('-')[0];
}

function indexSuffix(index) {
  return index === undefined ? '' : `[${index}]`;
}

function unique(values) {
  return [...new Set(values)];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
