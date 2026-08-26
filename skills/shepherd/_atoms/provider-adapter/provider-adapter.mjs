import {
  normalizeUpToDatePolicy,
  requiresUpToDateBranch,
} from '../../../_base/_atoms/landability/landability.mjs';

const PROVIDERS = [
  { id: 'github', cli: 'gh', patterns: [/github\.com[:/]/i] },
  { id: 'azure-devops', cli: 'az', patterns: [/dev\.azure\.com[:/]/i, /visualstudio\.com[:/]/i] },
  { id: 'gitlab', cli: null, patterns: [/gitlab\.com[:/]/i] },
  { id: 'bitbucket', cli: null, patterns: [/bitbucket\.org[:/]/i] },
  { id: 'gitea', cli: null, patterns: [/gitea\./i, /codeberg\.org[:/]/i] },
];

function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

function classifyTool(provider, toolAvailability = {}) {
  if (!provider?.cli) {
    return { ok: false, status: 'provider-tool-unsupported', tool: null };
  }
  const tool = toolAvailability[provider.cli] ?? { available: true, authenticated: true };
  if (tool.available === false) {
    return { ok: false, status: 'provider-tool-missing', tool: provider.cli };
  }
  if (tool.authenticated === false) {
    return { ok: false, status: 'provider-tool-unauthenticated', tool: provider.cli };
  }
  return { ok: true, status: 'supported-provider', tool: provider.cli };
}

function resultForProvider(provider, source, inspected, toolAvailability) {
  const tool = classifyTool(provider, toolAvailability);
  return {
    status: tool.status,
    provider: provider.id,
    tool: tool.tool,
    source,
    inspected,
  };
}

export function detectProvider({ explicitProvider = null, remoteUrls = [], toolAvailability = {} } = {}) {
  if (explicitProvider) {
    const provider = providerById(explicitProvider);
    if (!provider) {
      return {
        status: 'provider-unsupported',
        provider: null,
        tool: null,
        source: 'explicit-provider',
        inspected: explicitProvider,
      };
    }
    return resultForProvider(provider, 'explicit-provider', explicitProvider, toolAvailability);
  }

  for (const url of remoteUrls) {
    for (const provider of PROVIDERS) {
      if (provider.patterns.some((pattern) => pattern.test(url))) {
        return resultForProvider(provider, 'remote-url', url, toolAvailability);
      }
    }
  }

  return {
    status: 'provider-unsupported',
    provider: null,
    tool: null,
    source: 'remote-url',
    inspected: remoteUrls,
  };
}

export function shouldRunProviderIndependentCore(adapterResult = {}) {
  return [
    'provider-unsupported',
    'provider-tool-unsupported',
    'provider-tool-missing',
    'provider-tool-unauthenticated',
    'supported-provider',
  ].includes(adapterResult.status);
}

/**
 * The up-to-date policy an adapter reads in `read-state` is shared vocabulary,
 * because the skill that publishes a change request consumes the same values.
 * One implementation lives in the shared landability unit and is re-exported
 * here so adapter callers keep one import, and so the two skills cannot end up
 * disagreeing about what a boolean means.
 */
export { normalizeUpToDatePolicy, requiresUpToDateBranch };
