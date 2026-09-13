/**
 * Deterministic repository-context detection and normalization.
 *
 * This atom turns a remote URL and a set of operator answers into one
 * normalized context model. It performs no network calls and shells out to no
 * `git` process: the remote URL and every answer are inputs, so the parsing
 * surface is a pure function that the regression suite can drive through every
 * provider form without a fixture repository.
 *
 * The provider matrix is bounded on purpose. Four provider classes are
 * supported, plus a single `unsupported` disposition that names the custom
 * configuration an operator must supply. Guessing a provider from an unknown
 * host is how an unbounded matrix starts, so an unknown host stays
 * `unsupported` until the operator declares what it is.
 */

import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

export const EXIT_ACCEPTED = 0;
export const EXIT_REFUSED = 1;
export const EXIT_FINDINGS = 2;

export class RepositoryContextError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RepositoryContextError';
    this.code = code;
  }
}

/**
 * The bounded provider table. `supported` classes carry whether the provider
 * has a project layer between the organization and the repository. The single
 * `unsupported` class names the custom fields an operator must supply instead
 * of a provider the matrix does not recognize.
 */
export const PROVIDER_TABLE = Object.freeze({
  github: Object.freeze({ supported: true, projectLayer: false }),
  gitlab: Object.freeze({ supported: true, projectLayer: false }),
  'azure-devops': Object.freeze({ supported: true, projectLayer: true }),
  local: Object.freeze({ supported: true, projectLayer: false, custom: true }),
  unsupported: Object.freeze({
    supported: false,
    projectLayer: false,
    requiredCustomFields: Object.freeze([
      'provider',
      'host',
      'organization',
      'repository',
      'customTrackerInstructions',
    ]),
  }),
});

export const SUPPORTED_PROVIDERS = Object.freeze(['github', 'gitlab', 'azure-devops', 'local']);

/** Hosts whose provider is decidable without an operator declaring it. */
const WELL_KNOWN_HOSTS = Object.freeze({
  'github.com': 'github',
  'gitlab.com': 'gitlab',
  'dev.azure.com': 'azure-devops',
  'ssh.dev.azure.com': 'azure-devops',
});

/** The ceiling on bounded custom-tracker prose. Reject beyond it, never truncate. */
export const MAX_CUSTOM_INSTRUCTIONS = 2000;

/** Fields every supported context must settle, in report order. */
const BASE_REQUIRED_FIELDS = Object.freeze([
  'provider',
  'host',
  'organization',
  'repository',
  'defaultBranch',
  'targetDirectory',
  'trackerOperations',
  'relationshipKinds',
  'mutationVocabulary',
  'itemTypes',
  'labels',
  'states',
  'domain',
]);

/** The question detection cannot settle for each required field. */
const QUESTIONS = Object.freeze({
  provider: 'Which tracker provider hosts this repository?',
  host: 'Which host serves the tracker for this repository?',
  organization: 'Which organization or namespace owns this repository?',
  project: 'Which project contains this repository?',
  repository: 'What is the repository name?',
  defaultBranch: 'What is the default branch of this repository?',
  targetDirectory: 'Which repository-relative directory should hold the generated agent context?',
  trackerOperations: 'Which tracker read operations does downstream work rely on?',
  relationshipKinds: 'Which work-item relationship kinds does the tracker support?',
  mutationVocabulary: 'Which mutation verbs does the tracker use for its work items?',
  itemTypes: 'Which work-item types does the tracker expose?',
  labels: 'Which labels or states are available, and what does each mean?',
  states: 'Which workflow states can a work item hold, and what does each one mean?',
  domain: 'What is the repository product or domain identity, and where is its authoritative vocabulary?',
  customTrackerInstructions: 'What bounded instructions describe how to read this custom or local tracker?',
});

function normalizeRemote(remoteUrl) {
  const raw = typeof remoteUrl === 'string' ? remoteUrl.trim() : '';
  if (!raw) {
    return null;
  }

  let host;
  let pathPart;
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(raw);
  if (schemeMatch) {
    const rest = schemeMatch[2];
    const slash = rest.indexOf('/');
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    pathPart = slash === -1 ? '' : rest.slice(slash + 1);
    const afterUser = authority.includes('@') ? authority.slice(authority.indexOf('@') + 1) : authority;
    host = afterUser.split(':')[0];
  } else {
    const scp = /^(?:([^@/]+)@)?([^/:]+):(.+)$/.exec(raw);
    if (!scp) {
      return null;
    }
    host = scp[2];
    pathPart = scp[3];
  }

  host = String(host).toLowerCase();
  pathPart = pathPart.replace(/^\/+/, '').replace(/\/+$/, '');
  if (pathPart.toLowerCase().endsWith('.git')) {
    pathPart = pathPart.slice(0, -4);
  }
  const segments = pathPart.split('/').filter(Boolean);
  if (!host || segments.length === 0) {
    return null;
  }
  return { host, segments };
}

function unsupported(host, segments) {
  return {
    provider: 'unsupported',
    host: host ?? null,
    organization: null,
    project: null,
    repository: null,
    evidence: { host: host ?? null, segments: segments ?? [] },
    requiredCustomFields: [...PROVIDER_TABLE.unsupported.requiredCustomFields],
  };
}

function classifyAzure(host, segments) {
  const gitIndex = segments.indexOf('_git');
  let organization = null;
  let project = null;
  let repository = null;

  if (host === 'ssh.dev.azure.com') {
    const parts = segments[0] === 'v3' ? segments.slice(1) : segments;
    [organization = null, project = null, repository = null] = parts;
  } else if (host === 'dev.azure.com') {
    organization = segments[0] ?? null;
    if (gitIndex > 0) {
      project = segments[gitIndex - 1] ?? null;
      repository = segments[gitIndex + 1] ?? null;
    }
  } else if (host.endsWith('.visualstudio.com')) {
    organization = host.slice(0, host.length - '.visualstudio.com'.length) || null;
    if (gitIndex >= 0) {
      project = segments[gitIndex - 1] ?? null;
      repository = segments[gitIndex + 1] ?? null;
    }
  }

  if (!organization || !project || !repository) {
    return unsupported(host, segments);
  }
  return {
    provider: 'azure-devops',
    host,
    organization,
    project,
    repository,
  };
}

/**
 * Classify one remote URL into a provider, host, organization, project, and
 * repository. Self-hosted GitHub Enterprise and GitLab hosts are recognized
 * only through an explicit `declaredHosts` entry, never guessed from a domain.
 */
export function classifyRemote(remoteUrl, { declaredHosts = [] } = {}) {
  const parsed = normalizeRemote(remoteUrl);
  if (!parsed) {
    return unsupported(null, []);
  }
  const { host, segments } = parsed;

  if (host === 'dev.azure.com' || host === 'ssh.dev.azure.com' || host.endsWith('.visualstudio.com')) {
    return classifyAzure(host, segments);
  }

  const declared = declaredHosts.find((entry) => entry && entry.host === host);
  const provider = WELL_KNOWN_HOSTS[host] ?? (declared ? declared.provider : null);

  if (provider === 'github') {
    if (segments.length < 2) {
      return unsupported(host, segments);
    }
    return {
      provider: 'github',
      host,
      organization: segments[0],
      project: null,
      repository: segments[segments.length - 1],
    };
  }

  if (provider === 'gitlab') {
    if (segments.length < 2) {
      return unsupported(host, segments);
    }
    return {
      provider: 'gitlab',
      host,
      organization: segments.slice(0, -1).join('/'),
      project: null,
      repository: segments[segments.length - 1],
    };
  }

  return unsupported(host, segments);
}

function isSettledString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSettledList(value) {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Normalize a list of `{ name, meaning }` records. Labels and states share
 * this shape: each is a named vocabulary term whose meaning must be stated,
 * so an entry missing either half is not a settled term.
 *
 * A malformed entry is NOT silently dropped. Doing that would let a mixed
 * array — some entries settled, some incomplete — pass as a settled field
 * while quietly discarding the operator's incomplete terms. Instead, the
 * function reports what could be resolved and what could not, so the caller
 * can leave the field unsettled and report the malformed entry by index.
 */
function normalizeNamedMeanings(value) {
  if (!Array.isArray(value)) {
    return { entries: [], malformed: [], hasArray: false };
  }
  const entries = [];
  const malformed = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (entry && isSettledString(entry.name) && isSettledString(entry.meaning)) {
      entries.push({ name: String(entry.name), meaning: String(entry.meaning) });
    } else {
      // Preserve the malformed entry in place. If we returned only the
      // surviving subset here, re-normalizing the returned context would see a
      // non-empty list of settled entries and report `complete` — silently
      // discarding the unresolved evidence and defeating idempotence. Carrying
      // the entry through with an explicit `meaning: null` means every later
      // pass sees the same unresolved state until the operator supplies the
      // missing meaning.
      const partialName = entry && isSettledString(entry.name) ? String(entry.name) : null;
      entries.push({ name: partialName, meaning: null });
      malformed.push({ index, name: partialName });
    }
  }
  return { entries, malformed, hasArray: true };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isSettledString).map((entry) => String(entry));
}

function normalizeDomain(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const name = isSettledString(value.name) ? String(value.name) : null;
  const summary = isSettledString(value.summary) ? String(value.summary) : null;
  const vocabularySources = normalizeStringList(value.vocabularySources);
  if (!name || !summary || vocabularySources.length === 0) {
    return null;
  }
  return { name, summary, vocabularySources };
}

function fieldIsSettled(field, context) {
  switch (field) {
    case 'trackerOperations':
    case 'relationshipKinds':
    case 'mutationVocabulary':
    case 'itemTypes':
      return isSettledList(context[field]);
    case 'labels':
    case 'states':
      return isSettledList(context[field])
        && context[field].every(
          (entry) => entry
            && isSettledString(entry.name)
            && isSettledString(entry.meaning),
        );
    case 'domain':
      return context.domain !== null;
    case 'project':
      return isSettledString(context.project);
    default:
      return isSettledString(context[field]);
  }
}

/**
 * Build one normalized context from detection output plus operator answers.
 *
 * The result is idempotent: `normalizeContext(normalizeContext(x).context)`
 * yields an equal context, because the model is rebuilt from a fixed field set
 * with deterministic defaults rather than accumulated across passes.
 */
export function normalizeContext(input = {}) {
  const providerRaw = isSettledString(input.provider) ? input.provider : null;
  const provider = providerRaw && Object.prototype.hasOwnProperty.call(PROVIDER_TABLE, providerRaw)
    ? providerRaw
    : (providerRaw ? 'unsupported' : null);

  if (provider === 'unsupported'
    || (providerRaw && !SUPPORTED_PROVIDERS.includes(provider))) {
    return {
      status: 'unsupported-provider',
      context: {
        provider: 'unsupported',
        host: isSettledString(input.host) ? input.host : null,
        organization: isSettledString(input.organization) ? input.organization : null,
        project: null,
        repository: isSettledString(input.repository) ? input.repository : null,
      },
      missing: PROVIDER_TABLE.unsupported.requiredCustomFields.map((field) => ({
        field,
        question: QUESTIONS[field] ?? `Provide ${field}.`,
      })),
    };
  }

  const definition = provider ? PROVIDER_TABLE[provider] : null;
  const projectLayer = Boolean(definition?.projectLayer);
  const isCustom = Boolean(definition?.custom);

  const customTrackerInstructions = isSettledString(input.customTrackerInstructions)
    ? String(input.customTrackerInstructions)
    : null;
  const customTooLong = customTrackerInstructions !== null
    && customTrackerInstructions.length > MAX_CUSTOM_INSTRUCTIONS;

  const labelsResult = normalizeNamedMeanings(input.labels);
  const statesResult = normalizeNamedMeanings(input.states);

  const context = {
    provider,
    host: isSettledString(input.host) ? String(input.host) : null,
    organization: isSettledString(input.organization) ? String(input.organization) : null,
    project: projectLayer && isSettledString(input.project) ? String(input.project) : null,
    repository: isSettledString(input.repository) ? String(input.repository) : null,
    defaultBranch: isSettledString(input.defaultBranch) ? String(input.defaultBranch) : null,
    targetDirectory: isSettledString(input.targetDirectory) ? String(input.targetDirectory) : null,
    trackerOperations: normalizeStringList(input.trackerOperations),
    relationshipKinds: normalizeStringList(input.relationshipKinds),
    mutationVocabulary: normalizeStringList(input.mutationVocabulary),
    itemTypes: normalizeStringList(input.itemTypes),
    labels: labelsResult.entries,
    states: statesResult.entries,
    domain: normalizeDomain(input.domain),
    customTrackerInstructions: isCustom && !customTooLong ? customTrackerInstructions : null,
  };

  const requiredFields = [...BASE_REQUIRED_FIELDS];
  if (projectLayer) {
    requiredFields.splice(requiredFields.indexOf('repository') + 1, 0, 'project');
  }
  if (isCustom) {
    requiredFields.push('customTrackerInstructions');
  }

  const missing = [];
  for (const field of requiredFields) {
    if (field === 'provider') {
      if (!provider) {
        missing.push({ field, question: QUESTIONS.provider });
      }
      continue;
    }
    if (field === 'customTrackerInstructions') {
      if (customTooLong) {
        missing.push({
          field,
          question: QUESTIONS.customTrackerInstructions,
          reason: 'custom-instructions-too-long',
          limit: MAX_CUSTOM_INSTRUCTIONS,
          suppliedLength: customTrackerInstructions.length,
        });
      } else if (!context.customTrackerInstructions) {
        missing.push({ field, question: QUESTIONS.customTrackerInstructions });
      }
      continue;
    }
    if (field === 'labels' && labelsResult.malformed.length > 0) {
      missing.push({
        field: 'labels',
        question: QUESTIONS.labels,
        reason: 'entries-missing-name-or-meaning',
        malformedEntries: labelsResult.malformed,
      });
      continue;
    }
    if (field === 'states' && statesResult.malformed.length > 0) {
      missing.push({
        field: 'states',
        question: QUESTIONS.states,
        reason: 'entries-missing-name-or-meaning',
        malformedEntries: statesResult.malformed,
      });
      continue;
    }
    if (!fieldIsSettled(field, context)) {
      missing.push({ field, question: QUESTIONS[field] ?? `Provide ${field}.` });
    }
  }

  return {
    status: missing.length === 0 ? 'complete' : 'needs-input',
    context,
    missing,
  };
}

export function exitCodeFor(report) {
  if (!report || report.status === 'complete') {
    return EXIT_ACCEPTED;
  }
  return EXIT_FINDINGS;
}

function main(argv) {
  if (argv.includes('--probe')) {
    process.stdout.write('repository-context: available\n');
    return;
  }
  throw new RepositoryContextError('usage', 'repository-context is a library; use --probe to check availability');
}

function isDirectInvocation() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: { code: error.code ?? 'usage', message: error.message } })}\n`);
    process.exitCode = 1;
  }
}
