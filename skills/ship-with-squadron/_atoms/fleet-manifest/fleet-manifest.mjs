import crypto from 'node:crypto';

const ISSUE_STATUSES = new Set(['pending', 'completed', 'failed', 'deferred']);
const SATISFACTION = new Set(['human-merge', 'completed']);
const SAFE_PROVIDER_OPERATIONS = new Set(['read-issue', 'publish-change-request', 'observe-merge']);
const BASELINE_POLICY = Object.freeze(['run-ci', 'roast', 'blast-radius-proof']);
const SOURCE_STATUS = 'observed';

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function timestamp(value, field) {
  const normalized = nonEmpty(value, field);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${field} must be a valid timestamp`);
  return normalized;
}

function explicitStringArray(input, field, { nonEmptyArray = false } = {}) {
  if (!Object.hasOwn(input, field) || !Array.isArray(input[field])) {
    throw new Error(`${field} must be explicitly declared as an array`);
  }
  if (nonEmptyArray && input[field].length === 0) throw new Error(`${field} must be non-empty`);
  return input[field].map((value, index) => nonEmpty(value, `${field}[${index}]`));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function manifestDigest(manifest) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(manifest))).digest('hex');
}

export function providerConfigurationDigest(repository, provider) {
  return manifestDigest({
    repository: {
      id: repository.id,
      baseBranch: repository.baseBranch,
    },
    provider: {
      name: provider.name,
      allowedOperations: [...provider.allowedOperations].sort(),
    },
  });
}

function normalizeCriteria(criteria, identity) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new Error(`${identity}.acceptanceCriteria must be non-empty`);
  }
  const ids = new Set();
  return criteria.map((criterion, index) => {
    const normalized = typeof criterion === 'string'
      ? { id: `C${index + 1}`, description: criterion }
      : criterion;
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
      throw new Error(`${identity}.acceptanceCriteria[${index}] must be a string or object`);
    }
    const id = nonEmpty(normalized.id, `${identity}.acceptanceCriteria[${index}].id`);
    if (ids.has(id)) throw new Error(`${identity} has duplicate criterion id: ${id}`);
    ids.add(id);
    return {
      id,
      description: nonEmpty(
        normalized.description,
        `${identity}.acceptanceCriteria[${index}].description`,
      ),
    };
  });
}

function normalizeSourceReceipt(receipt, expected, field) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error(`${field} is required`);
  }
  const invocation = receipt.invocation;
  if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) {
    throw new Error(`${field}.invocation is required`);
  }
  const normalized = {
    invocation: {
      id: nonEmpty(invocation.id, `${field}.invocation.id`),
      operation: nonEmpty(invocation.operation, `${field}.invocation.operation`),
    },
    provider: nonEmpty(receipt.provider, `${field}.provider`).toLowerCase(),
    repository: nonEmpty(receipt.repository, `${field}.repository`),
    issue: nonEmpty(receipt.issue, `${field}.issue`),
    revision: nonEmpty(receipt.revision, `${field}.revision`),
    status: nonEmpty(receipt.status, `${field}.status`),
    terminal: receipt.terminal === true,
    complete: receipt.complete === true,
    observedAt: timestamp(receipt.observedAt, `${field}.observedAt`),
  };
  if (normalized.invocation.operation !== 'read-issue') {
    throw new Error(`${field}.invocation.operation must be read-issue`);
  }
  if (normalized.status !== SOURCE_STATUS || !normalized.terminal || !normalized.complete) {
    throw new Error(`${field} must be a complete terminal observed provider receipt`);
  }
  for (const key of ['provider', 'repository', 'issue', 'revision']) {
    if (normalized[key] !== expected[key]) {
      throw new Error(`${field}.${key} does not match the confirmed manifest`);
    }
  }
  return normalized;
}

export function validateSourceRevisionReceipt(receipt, manifest, issueIdentity) {
  const issue = manifest.issues.find((entry) => entry.identity === issueIdentity);
  if (!issue) throw new Error(`unknown manifest issue: ${issueIdentity}`);
  return normalizeSourceReceipt(receipt, {
    provider: manifest.provider.name,
    repository: manifest.repository.id,
    issue: issue.identity,
    revision: issue.sourceRevision,
  }, `${issue.identity}.sourceReceipt`);
}

function normalizeHumanDecisions(input) {
  if (!Object.hasOwn(input, 'humanDecisions') || !Array.isArray(input.humanDecisions)) {
    throw new Error('humanDecisions must be explicitly declared as an array');
  }
  const ids = new Set();
  return input.humanDecisions.map((decision, index) => {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
      throw new Error(`humanDecisions[${index}] must be an object`);
    }
    const id = nonEmpty(decision.id, `humanDecisions[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate human decision id: ${id}`);
    ids.add(id);
    return {
      id,
      decision: nonEmpty(decision.decision, `humanDecisions[${index}].decision`),
      decidedAt: timestamp(decision.decidedAt, `humanDecisions[${index}].decidedAt`),
      actor: nonEmpty(decision.actor, `humanDecisions[${index}].actor`),
    };
  });
}

export function normalizeFleetManifest(input = {}) {
  if (input.confirmation !== 'confirmed') {
    throw new Error('fleet manifest requires one explicit confirmed state');
  }
  const goal = nonEmpty(input.goal, 'goal');
  if (!Array.isArray(input.issues) || input.issues.length === 0) {
    throw new Error('issues must be a non-empty closed set');
  }
  const acceptedScope = explicitStringArray(input, 'acceptedScope');
  const exclusions = explicitStringArray(input, 'exclusions');
  const humanDecisions = normalizeHumanDecisions(input);

  const repository = input.repository;
  if (!repository || typeof repository !== 'object' || Array.isArray(repository)) {
    throw new Error('repository configuration is required');
  }
  const normalizedRepository = {
    id: nonEmpty(repository.id, 'repository.id'),
    root: nonEmpty(repository.root, 'repository.root'),
    baseBranch: nonEmpty(repository.baseBranch, 'repository.baseBranch'),
  };
  const provider = input.provider;
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new Error('provider configuration is required');
  }
  if (!Array.isArray(provider.allowedOperations) || provider.allowedOperations.length === 0) {
    throw new Error('provider.allowedOperations must be a non-empty array');
  }
  const providerName = nonEmpty(provider.name, 'provider.name').toLowerCase();
  for (const operation of provider.allowedOperations) {
    if (!SAFE_PROVIDER_OPERATIONS.has(operation)) {
      throw new Error(`provider operation is outside fleet authority: ${operation}`);
    }
  }
  const normalizedProvider = {
    name: providerName,
    allowedOperations: [...new Set(provider.allowedOperations)].sort(),
  };

  const identities = new Set();
  const issues = input.issues.map((issue, index) => {
    const identity = nonEmpty(issue?.identity, `issues[${index}].identity`);
    if (identities.has(identity)) throw new Error(`duplicate issue identity: ${identity}`);
    identities.add(identity);
    const sourceRevision = nonEmpty(issue.sourceRevision, `${identity}.sourceRevision`);
    const status = issue.status ?? 'pending';
    if (!ISSUE_STATUSES.has(status)) throw new Error(`${identity}.status is invalid: ${status}`);
    const scope = explicitStringArray(issue, 'scope');
    const allowedPaths = explicitStringArray(issue, 'allowedPaths', { nonEmptyArray: status === 'pending' });
    const acceptanceCriteria = normalizeCriteria(issue.acceptanceCriteria, identity);
    const sourceReceipt = normalizeSourceReceipt(issue.sourceReceipt, {
      provider: providerName,
      repository: normalizedRepository.id,
      issue: identity,
      revision: sourceRevision,
    }, `${identity}.sourceReceipt`);
    return {
      identity,
      sourceRevision,
      sourceReceipt,
      acceptanceCriteria,
      scope,
      allowedPaths,
      status,
      order: index,
    };
  });

  if (!Array.isArray(input.dependencies)) throw new Error('dependencies must be an array');
  const edgeKeys = new Set();
  const dependencies = input.dependencies.map((edge, index) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
      throw new Error(`dependencies[${index}] must be an object`);
    }
    if ('from' in edge || 'to' in edge || !('dependency' in edge) || !('dependent' in edge)) {
      throw new Error(`dependencies[${index}] has ambiguous direction; use dependency and dependent`);
    }
    const dependency = nonEmpty(edge.dependency, `dependencies[${index}].dependency`);
    const dependent = nonEmpty(edge.dependent, `dependencies[${index}].dependent`);
    if (!identities.has(dependency)) throw new Error(`missing dependency endpoint: ${dependency}`);
    if (!identities.has(dependent)) throw new Error(`missing dependent endpoint: ${dependent}`);
    if (dependency === dependent) throw new Error(`self dependency: ${dependency}`);
    const satisfiedBy = edge.satisfiedBy ?? 'human-merge';
    if (!SATISFACTION.has(satisfiedBy)) {
      throw new Error(`dependencies[${index}].satisfiedBy is invalid: ${satisfiedBy}`);
    }
    const key = `${dependency}\0${dependent}`;
    if (edgeKeys.has(key)) throw new Error(`duplicate dependency edge: ${dependency} -> ${dependent}`);
    edgeKeys.add(key);
    return { dependency, dependent, satisfiedBy };
  });

  const outgoing = new Map(issues.map((issue) => [issue.identity, []]));
  const indegree = new Map(issues.map((issue) => [issue.identity, 0]));
  for (const edge of dependencies) {
    outgoing.get(edge.dependency).push(edge.dependent);
    indegree.set(edge.dependent, indegree.get(edge.dependent) + 1);
  }
  const queue = issues.filter((issue) => indegree.get(issue.identity) === 0).map((issue) => issue.identity);
  let visited = 0;
  while (queue.length) {
    const identity = queue.shift();
    visited += 1;
    for (const dependent of outgoing.get(identity)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) queue.push(dependent);
    }
  }
  if (visited !== issues.length) throw new Error('dependency graph contains a cycle');

  const concurrency = Number(input.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }
  const budget = input.budget;
  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) {
    throw new Error('budget must be an object');
  }
  for (const field of ['cost', 'timeMinutes', 'retries']) {
    if (!Number.isFinite(budget[field]) || budget[field] < 0) {
      throw new Error(`budget.${field} must be a non-negative number`);
    }
  }
  if (!['yes', 'no'].includes(input.shepherdIntent)) {
    throw new Error('shepherdIntent must be yes or no');
  }
  const validationPolicy = explicitStringArray(input, 'validationPolicy', { nonEmptyArray: true });
  for (const baseline of BASELINE_POLICY) {
    if (!validationPolicy.includes(baseline)) {
      throw new Error(`validationPolicy is missing mandatory baseline: ${baseline}`);
    }
  }
  const stopConditions = explicitStringArray(input, 'stopConditions', { nonEmptyArray: true });
  const humanBoundaries = explicitStringArray(input, 'humanBoundaries', { nonEmptyArray: true });

  const manifest = {
    schemaVersion: 1,
    goal,
    acceptedScope,
    issues,
    dependencies,
    exclusions,
    concurrency,
    budget: {
      cost: budget.cost,
      timeMinutes: budget.timeMinutes,
      retries: budget.retries,
    },
    repository: normalizedRepository,
    provider: normalizedProvider,
    providerConfigurationDigest: providerConfigurationDigest(normalizedRepository, normalizedProvider),
    validationPolicy: [...new Set(validationPolicy)],
    stopConditions,
    shepherdIntent: input.shepherdIntent,
    humanBoundaries,
    humanDecisions,
    confirmation: 'confirmed',
    closedSet: true,
  };
  return { ...manifest, digest: manifestDigest(manifest) };
}

export { BASELINE_POLICY };
