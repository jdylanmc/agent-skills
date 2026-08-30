import crypto from 'node:crypto';

const ISSUE_STATUSES = new Set(['pending', 'active', 'completed', 'failed', 'deferred']);
const SATISFACTION = new Set(['human-merge', 'completed']);
const SAFE_PROVIDER_OPERATIONS = new Set(['read-issue', 'publish-change-request', 'observe-merge']);

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
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

export function normalizeFleetManifest(input = {}) {
  if (input.confirmation !== 'confirmed') {
    throw new Error('fleet manifest requires one explicit confirmed state');
  }
  const goal = nonEmpty(input.goal, 'goal');
  if (!Array.isArray(input.issues) || input.issues.length === 0) {
    throw new Error('issues must be a non-empty closed set');
  }

  const identities = new Set();
  const issues = input.issues.map((issue, index) => {
    const identity = nonEmpty(issue?.identity, `issues[${index}].identity`);
    if (identities.has(identity)) throw new Error(`duplicate issue identity: ${identity}`);
    identities.add(identity);
    const sourceRevision = nonEmpty(issue.sourceRevision, `${identity}.sourceRevision`);
    if (!Array.isArray(issue.acceptanceCriteria) || issue.acceptanceCriteria.length === 0) {
      throw new Error(`${identity}.acceptanceCriteria must be non-empty`);
    }
    const acceptanceCriteria = issue.acceptanceCriteria.map((criterion, criterionIndex) =>
      nonEmpty(criterion, `${identity}.acceptanceCriteria[${criterionIndex}]`));
    const status = issue.status ?? 'pending';
    if (!ISSUE_STATUSES.has(status)) throw new Error(`${identity}.status is invalid: ${status}`);
    return {
      identity,
      sourceRevision,
      acceptanceCriteria,
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
  if (!budget || typeof budget !== 'object') throw new Error('budget must be an object');
  for (const field of ['cost', 'timeMinutes', 'retries']) {
    if (!Number.isFinite(budget[field]) || budget[field] < 0) {
      throw new Error(`budget.${field} must be a non-negative number`);
    }
  }
  if (!['yes', 'no'].includes(input.shepherdIntent)) {
    throw new Error('shepherdIntent must be yes or no');
  }
  const repository = input.repository;
  if (!repository || typeof repository !== 'object') throw new Error('repository configuration is required');
  const provider = input.provider;
  if (!provider || typeof provider !== 'object') throw new Error('provider configuration is required');
  if (!Array.isArray(provider.allowedOperations) || provider.allowedOperations.length === 0) {
    throw new Error('provider.allowedOperations must be a non-empty array');
  }
  for (const operation of provider.allowedOperations) {
    if (!SAFE_PROVIDER_OPERATIONS.has(operation)) {
      throw new Error(`provider operation is outside fleet authority: ${operation}`);
    }
  }
  if (!Array.isArray(input.validationPolicy) || input.validationPolicy.length === 0) {
    throw new Error('validationPolicy must be a non-empty array');
  }
  if (!Array.isArray(input.stopConditions) || input.stopConditions.length === 0) {
    throw new Error('stopConditions must be a non-empty array');
  }
  if (!Array.isArray(input.humanBoundaries) || input.humanBoundaries.length === 0) {
    throw new Error('humanBoundaries must be a non-empty array');
  }

  const manifest = {
    schemaVersion: 1,
    goal,
    issues,
    dependencies,
    exclusions: Array.isArray(input.exclusions) ? input.exclusions.map((value, index) =>
      nonEmpty(value, `exclusions[${index}]`)) : [],
    concurrency,
    budget: {
      cost: budget.cost,
      timeMinutes: budget.timeMinutes,
      retries: budget.retries,
    },
    repository: {
      id: nonEmpty(repository.id, 'repository.id'),
      root: nonEmpty(repository.root, 'repository.root'),
      baseBranch: nonEmpty(repository.baseBranch, 'repository.baseBranch'),
    },
    provider: {
      name: nonEmpty(provider.name, 'provider.name'),
      allowedOperations: [...new Set(provider.allowedOperations)].sort(),
    },
    validationPolicy: input.validationPolicy.map((value, index) =>
      nonEmpty(value, `validationPolicy[${index}]`)),
    stopConditions: input.stopConditions.map((value, index) =>
      nonEmpty(value, `stopConditions[${index}]`)),
    shepherdIntent: input.shepherdIntent,
    humanBoundaries: input.humanBoundaries.map((value, index) =>
      nonEmpty(value, `humanBoundaries[${index}]`)),
    confirmation: 'confirmed',
    closedSet: true,
  };
  return { ...manifest, digest: manifestDigest(manifest) };
}
