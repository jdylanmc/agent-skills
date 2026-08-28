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
 * scp-like SSH shorthand that joins a user and host with an at-sign and the
 * path with a colon, and returns null rather
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
    // scp-like: [user@]host:path. The whole remote is anchored so a malformed
    // prefix or trailing text cannot slip a host past the parser. The path may
    // not begin with a backslash, which is what a Windows drive path such as
    // `C:\repo` looks like — a single-letter "host" followed by `\` — so those
    // are rejected here rather than mistaken for a single-label host.
    const scpLike = /^(?:[^@/\s]+@)?([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?):(?![\\/])[^\s]+$/i.exec(value);
    if (scpLike) {
      // A single-label host is returned as-is; whether it is honoured is
      // decided by `providerForHost`, which accepts a single-label host only
      // when the operator configured it.
      return scpLike[1].toLowerCase();
    }
    return null;
  }

  try {
    const url = new URL(value);
    // `URL.host` includes a non-default port; `URL.hostname` drops it. A ported
    // endpoint must round-trip through host matching, so the port is preserved
    // here as part of the transport host.
    return url.host ? url.host.toLowerCase() : null;
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
 * Transport hosts that are not the canonical API endpoint they belong to. An
 * SSH remote or a `www.` alias reaches the same provider deployment as its API
 * endpoint, so detection resolves it to that endpoint. Host matching downstream
 * then compares one canonical endpoint against another rather than a transport
 * alias against an API host.
 */
const TRANSPORT_TO_API_ENDPOINT = new Map([
  ['ssh.dev.azure.com', 'dev.azure.com'],
  ['ssh.github.com', 'github.com'],
  ['www.github.com', 'github.com'],
]);

function splitHostPort(hostValue) {
  const text = String(hostValue ?? '').toLowerCase();
  const colon = text.lastIndexOf(':');
  if (colon > 0 && /^[0-9]+$/.test(text.slice(colon + 1))) {
    return { host: text.slice(0, colon), port: text.slice(colon + 1) };
  }
  return { host: text, port: null };
}

/**
 * Whether a string is a plausible DNS hostname. Accepts single-label hosts
 * (`githost`) and dotted hosts (`github.com`, `ssh.dev.azure.com`), each label
 * alphanumeric with interior hyphens. Rejects anything carrying a scheme,
 * slash, whitespace, at-sign, or other non-hostname character, so a URL or a
 * free-text phrase never passes for a host.
 */
function isPlausibleHostname(host) {
  if (typeof host !== 'string' || host.length === 0 || host.length > 253) {
    return false;
  }
  return host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

/**
 * The canonical API endpoint for a transport host. A known SSH or alias host is
 * mapped to its API endpoint; any port is preserved so a ported endpoint stays
 * distinct. Returns null when there is no host to canonicalize, or when the
 * host part is not a plausible hostname or the port is out of range — a
 * malformed endpoint is unresolvable rather than passed through as a target.
 */
export function canonicalizeEndpoint(transportHost) {
  if (!transportHost) {
    return null;
  }
  const { host, port } = splitHostPort(transportHost);
  if (!isPlausibleHostname(host)) {
    return null;
  }
  if (port !== null) {
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return null;
    }
  }
  const canonicalHost = TRANSPORT_TO_API_ENDPOINT.get(host) ?? host;
  return port ? `${canonicalHost}:${port}` : canonicalHost;
}

/**
 * Classifies tool readiness from a caller-supplied probe. Availability and
 * authentication are two independent observations, and each is only acted on
 * when it was actually reported:
 *
 * - an absent probe is `provider-tool-unobserved`;
 * - an explicit `available: false` is `provider-tool-missing`;
 * - an explicit `authenticated: false` is `provider-tool-unauthenticated`;
 * - a probe that reports one field but leaves a required one absent is
 *   `provider-tool-unobserved`, because a probe that observed availability and
 *   said nothing about authentication has not established readiness.
 *
 * Collapsing an unreported field into an observed negative is the exact mistake
 * this unit exists to prevent: "not observed" and "observed false" send a
 * person to different places.
 *
 * A probe may optionally name the endpoint it observed (`host` or `endpoint`).
 * When it does and that endpoint disagrees with the one this run targets, the
 * probe observed a different account or deployment than the one being queried,
 * so readiness against the queried endpoint is unobserved. A probe that omits
 * the field stays permissive, so existing `{available,authenticated}` probes
 * are unaffected.
 */
function classifyTool(provider, toolAvailability, canonicalEndpoint = null) {
  if (!provider.cli) {
    return { status: 'provider-tool-unsupported', tool: null };
  }
  const probe = (toolAvailability ?? {})[provider.cli];
  if (probe === undefined || probe === null || typeof probe !== 'object') {
    return { status: 'provider-tool-unobserved', tool: provider.cli };
  }
  const rawProbeEndpoint = probe.host ?? probe.endpoint ?? null;
  const probedEndpoint = canonicalizeEndpoint(rawProbeEndpoint);
  // A probe that names an endpoint which does not resolve to a plausible host
  // cannot be confirmed to match the queried endpoint, so readiness is
  // unobserved rather than assumed. A probe that omits the field entirely stays
  // permissive.
  if (rawProbeEndpoint !== null && rawProbeEndpoint !== undefined && probedEndpoint === null) {
    return { status: 'provider-tool-unobserved', tool: provider.cli };
  }
  if (probedEndpoint !== null && canonicalEndpoint !== null && probedEndpoint !== canonicalEndpoint) {
    return { status: 'provider-tool-unobserved', tool: provider.cli };
  }
  if (probe.available === false) {
    return { status: 'provider-tool-missing', tool: provider.cli };
  }
  if (probe.authenticated === false) {
    return { status: 'provider-tool-unauthenticated', tool: provider.cli };
  }
  if (probe.available !== true || probe.authenticated !== true) {
    return { status: 'provider-tool-unobserved', tool: provider.cli };
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
 * A redacted evidence label for one inspected remote. A complete remote URL may
 * carry `user:token@` userinfo, so the raw URL is never copied into evidence;
 * only the parsed host is reported, and an unparsable remote is recorded as
 * `host:unparsed`. The redaction is centralized here so no evidence path can
 * reintroduce the raw URL.
 */
function inspectedLabel(host) {
  return host ? `host:${host}` : 'host:unparsed';
}

/**
 * Detects the provider for one repository.
 *
 * @param {object} options
 * @param {string|null} options.explicitProvider Operator-named provider id.
 * @param {string|null} options.explicitHost Canonical host for an operator-named
 *   provider, when the operator supplies one. Absent means the host is unknown.
 * @param {string[]} options.remoteUrls Git remote URLs, in caller preference order.
 * @param {Record<string,string>} options.hostProviders Configured host to provider id map.
 * @param {Record<string,{available:boolean,authenticated:boolean}>} options.toolAvailability
 *   Probed readiness per command-line tool. An absent entry is unobserved.
 */
export function detectProvider({
  explicitProvider = null,
  explicitHost = null,
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
    // An operator who names a provider may also name its host. When they do not,
    // the canonical endpoint is explicitly unknown rather than assumed public.
    const host = canonicalizeEndpoint(
      typeof explicitHost === 'string' && explicitHost.trim() ? explicitHost.trim() : null,
    );
    const tool = classifyTool(provider, toolAvailability, host);
    // A `supported-provider` requires a canonical endpoint. Named without a
    // resolvable endpoint, tool readiness cannot be established against any
    // known host, so the condition is `provider-tool-unobserved` rather than a
    // clean provider result whose commands would silently target `github.com`.
    const status = host === null && tool.status === 'supported-provider'
      ? 'provider-tool-unobserved'
      : tool.status;
    return {
      status,
      provider: provider.id,
      tool: tool.tool,
      host,
      source: 'explicit-provider',
      inspected: [`explicit-provider:${explicitProvider}`],
      observable: status === 'supported-provider',
    };
  }

  const inspected = [];
  for (const url of urls) {
    const transportHost = parseRemoteHost(url);
    inspected.push(inspectedLabel(transportHost));
    const match = providerForHost(transportHost, hostProviders);
    if (!match) {
      continue;
    }
    const provider = providerById(match.providerId);
    const host = canonicalizeEndpoint(transportHost);
    const tool = classifyTool(provider, toolAvailability, host);
    // A `supported-provider` requires a canonical endpoint here too. A matched
    // host that does not canonicalize (a malformed configured host) leaves tool
    // readiness unestablished against any known endpoint, so the condition is
    // `provider-tool-unobserved` rather than a clean result whose commands would
    // silently target `github.com`.
    const status = host === null && tool.status === 'supported-provider'
      ? 'provider-tool-unobserved'
      : tool.status;
    return {
      status,
      provider: provider.id,
      tool: tool.tool,
      host,
      source: match.source,
      inspected,
      observable: status === 'supported-provider',
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

/*
 * ---------------------------------------------------------------------------
 * Shared command-safety mechanism and address normalization.
 *
 * Detection already owns provider identity and the canonical host, so the two
 * things every reading unit needs from that identity live here rather than in
 * one reading unit that the other would then have to import across a skill
 * boundary:
 *
 *   1. Address and identifier normalization, host-qualified against the
 *      detected host, so the host a run detected is the host its commands
 *      target.
 *   2. The read-only command guard as an allow-list mechanism. A reading unit
 *      declares the exact command shapes it is allowed to construct and hands
 *      them here; anything that does not match one is refused at construction.
 *      A deny-list cannot enforce read-only against tools that switch to a
 *      write on a flag (`gh api -f`) or bury a mutation in an unlisted
 *      subcommand (`az repos pr reviewer add`), so the guard sanctions reads
 *      rather than trying to enumerate every write.
 * ---------------------------------------------------------------------------
 */

export class ProviderCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderCommandError';
    this.code = code;
  }
}

/** Public GitHub hostnames. Anything else is an enterprise or self-hosted host. */
const GITHUB_PUBLIC_HOSTS = new Set(['github.com', 'www.github.com', 'ssh.github.com']);

function detectedHostOf(detection) {
  const host = detection?.host;
  return typeof host === 'string' && host.trim() ? host.trim().toLowerCase() : null;
}

/** True when the detection points at an enterprise or self-hosted GitHub host. */
export function isEnterpriseGitHubHost(detection = {}) {
  const host = detectedHostOf(detection);
  return host !== null && !GITHUB_PUBLIC_HOSTS.has(host);
}

/**
 * Change-request identifiers are positive integers on both providers.
 *
 * A numeric input must be a positive safe integer: a JavaScript number above
 * `Number.MAX_SAFE_INTEGER` may already be a different integer than the digits
 * a caller typed, so accepting it would silently address a different change
 * request. An exact decimal string carries no such loss and is accepted as
 * written. Anything else is rejected rather than interpolated.
 */
export function normalizeChangeRequestId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ProviderCommandError(
        'invalid-change-request-identifier',
        'a change-request identifier must be a positive integer',
      );
    }
    return String(value);
  }
  const text = String(value ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(text)) {
    throw new ProviderCommandError(
      'invalid-change-request-identifier',
      'a change-request identifier must be a positive integer',
    );
  }
  return text;
}

/**
 * GitHub repositories are addressed as `owner/name`, host-qualified against the
 * detected host. `gh pr view --repo` accepts `[HOST/]OWNER/REPO`, so an
 * enterprise host detected here is carried into the argument rather than left
 * to `gh`'s default of `github.com`.
 */
export function normalizeGitHubRepository(repository, detection = {}) {
  const slug = typeof repository === 'string' ? repository : repository?.slug;
  const text = String(slug ?? '').trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/.test(text)) {
    throw new ProviderCommandError('invalid-repository', 'a GitHub repository must be an owner/name slug');
  }
  return isEnterpriseGitHubHost(detection) ? `${detectedHostOf(detection)}/${text}` : text;
}

/**
 * The `gh api` host flag for the detected host. `gh api` defaults to
 * `github.com` unless `--hostname` is given, so an enterprise host must be
 * passed explicitly or the read silently hits the wrong deployment.
 */
export function githubApiHostFlags(detection = {}) {
  return isEnterpriseGitHubHost(detection) ? ['--hostname', detectedHostOf(detection)] : [];
}

/**
 * Parses and validates an Azure DevOps organization URL, shared by the
 * organization-only and full-repository normalizers. Parse with `URL` rather
 * than a permissive regex so an organization URL that smuggles credentials in
 * userinfo, or carries a query or fragment, is rejected instead of interpolated
 * verbatim into the argv. Only a clean https origin is accepted. Returns the
 * parsed URL when valid, or `null` so the caller can raise its own message.
 */
function parseAzureOrganizationUrl(organizationUrl) {
  let parsed = null;
  try {
    parsed = new URL(organizationUrl);
  } catch {
    parsed = null;
  }
  const valid = parsed !== null
    && parsed.protocol === 'https:'
    && parsed.username === ''
    && parsed.password === ''
    && parsed.search === ''
    && parsed.hash === '';
  return valid ? parsed : null;
}

/**
 * The organization URL's host must agree with the detected host: a URL pointing
 * somewhere else is a distinct, named failure rather than a silently accepted
 * target.
 */
function assertAzureOrganizationHost(parsed, detection) {
  const detectedHost = detectedHostOf(detection);
  if (detectedHost) {
    const organizationHost = canonicalizeEndpoint(parsed.host);
    if (organizationHost !== detectedHost) {
      throw new ProviderCommandError(
        'repository-host-mismatch',
        `organization host ${organizationHost ?? 'unparsed'} disagrees with detected host ${detectedHost}`,
      );
    }
  }
}

/**
 * Azure DevOps repositories are addressed by organization URL, project, and
 * repository. Used by callers that genuinely need the project and repository
 * name as route parameters (for example `az devops invoke`).
 */
export function normalizeAzureRepository(repository, detection = {}) {
  const organizationUrl = String(repository?.organizationUrl ?? '').trim();
  const project = String(repository?.project ?? '').trim();
  const name = String(repository?.name ?? '').trim();

  const parsed = parseAzureOrganizationUrl(organizationUrl);
  if (!parsed || !project || !name) {
    throw new ProviderCommandError(
      'invalid-repository',
      'an Azure DevOps repository needs an https organizationUrl without credentials, query, or fragment, plus a project and name',
    );
  }
  assertAzureOrganizationHost(parsed, detection);
  return { organizationUrl, project, name };
}

/**
 * Some Azure DevOps reads are addressed by organization alone: `az repos pr
 * show` and `az repos pr policy list` take only `--id` and `--org`, because a
 * pull-request id is unique per organization. Requiring `project`/`name` for
 * those reads would validate an address the command never uses, so this
 * normalizer validates only the organization URL — with the same hygiene and
 * detected-host agreement as `normalizeAzureRepository` — and returns just the
 * organization URL.
 */
export function normalizeAzureOrganization(repository, detection = {}) {
  const organizationUrl = String(repository?.organizationUrl ?? '').trim();

  const parsed = parseAzureOrganizationUrl(organizationUrl);
  if (!parsed) {
    throw new ProviderCommandError(
      'invalid-repository',
      'an Azure DevOps organization needs an https organizationUrl without credentials, query, or fragment',
    );
  }
  assertAzureOrganizationHost(parsed, detection);
  return { organizationUrl };
}

const HTTP_METHOD_FLAGS = new Set(['--http-method', '--method', '-X']);
const GH_API_FIELD_FLAGS = new Set(['-f', '-F', '--field', '--raw-field']);
const WRITE_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A `gh api graphql` document is only sanctioned when its operation is a query.
 * The value arrives as `query=<document>`, where `query=` is the `gh` field
 * name; the document itself must be an anonymous `{ ... }` selection or a named
 * `query ...`, never a `mutation` or `subscription`.
 */
function graphqlDocumentIsQuery(fieldValue) {
  const text = String(fieldValue ?? '');
  if (!text.startsWith('query=')) {
    return false;
  }
  const document = text.slice('query='.length).replace(/^[\s\uFEFF]+/, '');
  if (/^(mutation|subscription)\b/i.test(document)) {
    return false;
  }
  return /^(query\b|\{)/i.test(document);
}

function tokenMatches(spec, actual) {
  if (typeof spec === 'string') {
    return spec === actual;
  }
  if (spec.id) {
    return /^[1-9][0-9]*$/.test(actual);
  }
  if (spec.value) {
    return actual.length > 0;
  }
  if (spec.prefix !== undefined) {
    return actual.startsWith(spec.prefix) && actual.length > spec.prefix.length;
  }
  if (spec.graphqlQuery) {
    return graphqlDocumentIsQuery(actual);
  }
  if (spec.graphqlQueryEquals !== undefined) {
    // A fixed query document is sanctioned by exact equality, so a tampered
    // document sharing the sanctioned prefix — a mutation appended after the
    // query, for instance — does not match. The generic query check stays as
    // defense in depth.
    return actual === spec.graphqlQueryEquals && graphqlDocumentIsQuery(actual);
  }
  return false;
}

function matchesShape(tool, args, shape) {
  if (shape.tool !== tool) {
    return false;
  }
  const spec = shape.argv;
  if (spec.length !== args.length) {
    return false;
  }
  for (let index = 0; index < spec.length; index += 1) {
    if (!tokenMatches(spec[index], args[index])) {
      return false;
    }
  }
  return true;
}

/**
 * The shared read-only guard. A unit passes the command it just built and the
 * set of shapes it is allowed to construct. The command is returned only when
 * it matches one sanctioned shape and clears the tool-level safety rules a
 * shape alone cannot express; otherwise construction fails.
 *
 * @param {{tool?: string, args?: string[]}} command
 * @param {Array<{tool: string, argv: unknown[]}>} sanctionedShapes
 */
export function assertSanctionedCommand(command, sanctionedShapes) {
  const tool = command?.tool ?? null;
  const args = (command?.args ?? []).map((argument) => String(argument));

  for (let index = 0; index < args.length; index += 1) {
    if (HTTP_METHOD_FLAGS.has(args[index]) && WRITE_HTTP_METHODS.has(String(args[index + 1] ?? '').toUpperCase())) {
      throw new ProviderCommandError('mutating-command', `refusing a write HTTP method: ${args[index]} ${args[index + 1]}`);
    }
  }

  // `gh api` switches to POST the moment a field is supplied. A field on a
  // non-graphql `gh api` call is therefore refused unless the method is an
  // explicit GET, closing the bypass a deny-list of subcommands cannot see.
  if (tool === 'gh' && args[0] === 'api' && args[1] !== 'graphql') {
    const hasField = args.some((argument) => GH_API_FIELD_FLAGS.has(argument));
    const methodIndex = args.findIndex((argument) => HTTP_METHOD_FLAGS.has(argument));
    const isExplicitGet = methodIndex >= 0 && String(args[methodIndex + 1] ?? '').toUpperCase() === 'GET';
    if (hasField && !isExplicitGet) {
      throw new ProviderCommandError('mutating-command', 'refusing gh api fields without an explicit GET method');
    }
  }

  for (const shape of sanctionedShapes) {
    if (matchesShape(tool, args, shape)) {
      return command;
    }
  }

  throw new ProviderCommandError(
    'mutating-command',
    `refusing an unsanctioned provider command: ${tool ?? 'unknown'} ${args.join(' ')}`,
  );
}
