/**
 * Provider detection: which hosted git provider a repository uses, and whether
 * that provider's official command-line tool can actually observe hosted state.
 *
 * Detection is deliberately evidence-driven and never inferential. A host is
 * recognized because the operator named the provider, because the operator
 * configured that host, or because it is one of a small set of exactly known
 * public hosts. Anything else is reported as unsupported along with the
 * evidence that was inspected, because a guessed provider produces a guessed
 * command against a differently configured host.
 *
 * The load-bearing property here is that "not observed" is its own answer.
 * Tool readiness is something a caller probes; when it has not been probed,
 * this module says so rather than assuming a working tool. Assuming readiness
 * is how an unobserved blocking check turns into a clean-looking report.
 */

export const PROVIDERS = [
  { id: 'github', cli: 'gh' },
  { id: 'azure-devops', cli: 'az' },
  { id: 'gitlab', cli: null },
  { id: 'bitbucket', cli: null },
  { id: 'gitea', cli: null },
];

/**
 * Exactly known public hosts. Deliberately exact: an enterprise or self-hosted
 * deployment lives on an arbitrary hostname and is named through configuration,
 * not pattern-matched from a hostname that merely looks familiar.
 */
const KNOWN_HOSTS = new Map([
  ['github.com', 'github'],
  ['www.github.com', 'github'],
  ['ssh.github.com', 'github'],
  ['dev.azure.com', 'azure-devops'],
  ['ssh.dev.azure.com', 'azure-devops'],
  ['gitlab.com', 'gitlab'],
  ['bitbucket.org', 'bitbucket'],
  ['codeberg.org', 'gitea'],
]);

/** Legacy Azure DevOps accounts are `<account>.visualstudio.com`. */
const KNOWN_HOST_SUFFIXES = [
  { suffix: '.visualstudio.com', provider: 'azure-devops' },
];

export const DETECTION_STATUSES = [
  'supported-provider',
  'provider-tool-missing',
  'provider-tool-unauthenticated',
  'provider-tool-unobserved',
  'provider-tool-unsupported',
  'provider-unsupported',
];

/** Every status other than `supported-provider` means hosted state is unobserved. */
const UNOBSERVED_STATUSES = new Set(DETECTION_STATUSES.filter((status) => status !== 'supported-provider'));

export function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function providerCli(id) {
  return providerById(id)?.cli ?? null;
}

/**
 * Extracts the host from a git remote. Handles `scheme://` remotes, the
 * scp-like `user@host:path` form used by SSH remotes, and returns null rather
 * than a partial guess when the remote has no host to read.
 */
export function parseRemoteHost(remoteUrl) {
  if (typeof remoteUrl !== 'string') {
    return null;
  }
  const value = remoteUrl.trim();
  if (!value) {
    return null;
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    // scp-like: [user@]host:path, where the colon precedes the path and there
    // is no `//`. A Windows drive path such as `C:\repo` has no `@` and a
    // single-character host, so it is rejected below by the host shape.
    const scpLike = /^(?:([^@/\s]+)@)?([^@/:\s]+):(?!\/)/.exec(value);
    if (scpLike) {
      const host = scpLike[2].toLowerCase();
      return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) && host.includes('.') ? host : null;
    }
    return null;
  }

  try {
    const url = new URL(value);
    return url.hostname ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a host to a provider id. Configured hosts win over known public
 * hosts so an operator can name an enterprise deployment, including one that
 * shadows a public hostname in a split-horizon network.
 */
export function providerForHost(host, hostProviders = {}) {
  if (!host) {
    return null;
  }
  const normalized = String(host).toLowerCase();

  for (const [configuredHost, providerId] of Object.entries(hostProviders ?? {})) {
    if (String(configuredHost).toLowerCase() === normalized) {
      return providerById(providerId) ? { providerId, source: 'configured-host' } : null;
    }
  }

  if (KNOWN_HOSTS.has(normalized)) {
    return { providerId: KNOWN_HOSTS.get(normalized), source: 'known-host' };
  }

  for (const { suffix, provider } of KNOWN_HOST_SUFFIXES) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
      return { providerId: provider, source: 'known-host' };
    }
  }

  return null;
}

/**
 * Classifies tool readiness from a caller-supplied probe. An absent probe is
 * `provider-tool-unobserved` rather than a working tool: readiness this module
 * was never told about is not readiness it may assert.
 */
function classifyTool(provider, toolAvailability) {
  if (!provider.cli) {
    return { status: 'provider-tool-unsupported', tool: null };
  }
  const probe = (toolAvailability ?? {})[provider.cli];
  if (probe === undefined || probe === null) {
    return { status: 'provider-tool-unobserved', tool: provider.cli };
  }
  if (probe.available !== true) {
    return { status: 'provider-tool-missing', tool: provider.cli };
  }
  if (probe.authenticated !== true) {
    return { status: 'provider-tool-unauthenticated', tool: provider.cli };
  }
  return { status: 'supported-provider', tool: provider.cli };
}

function unsupported(inspected, source) {
  return {
    status: 'provider-unsupported',
    provider: null,
    tool: null,
    host: null,
    source,
    inspected: [...inspected],
    observable: false,
  };
}

/**
 * Detects the provider for one repository.
 *
 * @param {object} options
 * @param {string|null} options.explicitProvider Operator-named provider id.
 * @param {string[]} options.remoteUrls Git remote URLs, in caller preference order.
 * @param {Record<string,string>} options.hostProviders Configured host to provider id map.
 * @param {Record<string,{available:boolean,authenticated:boolean}>} options.toolAvailability
 *   Probed readiness per command-line tool. An absent entry is unobserved.
 */
export function detectProvider({
  explicitProvider = null,
  remoteUrls = [],
  hostProviders = {},
  toolAvailability = {},
} = {}) {
  const urls = Array.isArray(remoteUrls) ? remoteUrls.filter((url) => typeof url === 'string') : [];

  if (explicitProvider) {
    const provider = providerById(explicitProvider);
    if (!provider) {
      return unsupported([`explicit-provider:${explicitProvider}`], 'explicit-provider');
    }
    const tool = classifyTool(provider, toolAvailability);
    return {
      status: tool.status,
      provider: provider.id,
      tool: tool.tool,
      host: null,
      source: 'explicit-provider',
      inspected: [`explicit-provider:${explicitProvider}`],
      observable: tool.status === 'supported-provider',
    };
  }

  const inspected = [];
  for (const url of urls) {
    const host = parseRemoteHost(url);
    inspected.push(host ? `remote:${url} host:${host}` : `remote:${url} host:unparsed`);
    const match = providerForHost(host, hostProviders);
    if (!match) {
      continue;
    }
    const provider = providerById(match.providerId);
    const tool = classifyTool(provider, toolAvailability);
    return {
      status: tool.status,
      provider: provider.id,
      tool: tool.tool,
      host,
      source: match.source,
      inspected,
      observable: tool.status === 'supported-provider',
    };
  }

  return unsupported(inspected, 'remote-url');
}

/** True only when a matched provider's official tool was probed and is ready. */
export function canObserveProviderState(detection = {}) {
  return detection.status === 'supported-provider';
}

/** True when hosted state was not observed, for any of the distinct reasons. */
export function isProviderStateUnobserved(detection = {}) {
  return UNOBSERVED_STATUSES.has(detection.status);
}

/**
 * A caller degrades rather than fails: every recognized detection outcome,
 * including the unobserved ones, still permits provider-independent work.
 */
export function shouldRunProviderIndependentCore(detection = {}) {
  return DETECTION_STATUSES.includes(detection.status);
}

/**
 * Guard for a command builder or interpreter. Returns the detection when the
 * provider can be observed, and otherwise an explicit refusal naming the
 * condition, so no caller can mistake an unobservable provider for a clean one.
 */
export function requireObservableProvider(detection = {}) {
  if (canObserveProviderState(detection)) {
    return { ok: true, detection };
  }
  return {
    ok: false,
    status: DETECTION_STATUSES.includes(detection.status) ? detection.status : 'provider-unsupported',
    provider: detection.provider ?? null,
    tool: detection.tool ?? null,
    inspected: Array.isArray(detection.inspected) ? [...detection.inspected] : [],
  };
}
