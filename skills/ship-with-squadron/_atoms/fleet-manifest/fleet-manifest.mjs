import crypto from 'node:crypto';
import path from 'node:path';

const ISSUE_STATUSES = new Set([
  'pending', 'completed', 'blocked', 'failed', 'timed-out', 'deferred',
]);
const SATISFACTION = new Set(['human-merge', 'completed']);
const SAFE_PROVIDER_OPERATIONS = new Set([
  'read-issue',
  'read-issue-set',
  'publish-change-request',
  'observe-merge',
  'observe-change-request-revision',
]);
const BASELINE_POLICY = Object.freeze(['run-ci', 'roast', 'blast-radius-proof']);
const SOURCE_STATUS = 'observed';
const MANIFEST_INPUT_FIELDS = new Set([
  'confirmation', 'goal', 'acceptedScope', 'issues', 'issueSet', 'dependencies',
  'exclusions', 'concurrency', 'budget', 'repository', 'provider',
  'validationPolicy', 'stopConditions', 'shepherdIntent', 'humanBoundaries',
  'humanDecisions',
]);
const MANIFEST_FIELDS = new Set([
  'schemaVersion', 'goal', 'acceptedScope', 'issues', 'dependencies',
  'exclusions', 'concurrency', 'budget', 'repository', 'provider',
  'providerConfigurationDigest', 'validationPolicy', 'stopConditions',
  'shepherdIntent', 'humanBoundaries', 'humanDecisions',
  'confirmationBindingDigest', 'issueSet', 'confirmation', 'closedSet', 'digest',
]);

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

function assertOnlyKeys(value, allowed, field) {
  const unknown = Object.keys(value ?? {}).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${field} has unknown fields: ${unknown.sort().join(', ')}`);
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
    assertOnlyKeys(
      normalized,
      new Set(['id', 'description']),
      `${identity}.acceptanceCriteria[${index}]`,
    );
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
  assertOnlyKeys(receipt, new Set([
    'invocation', 'provider', 'repository', 'issue', 'revision', 'issueStatus',
    'status', 'terminal', 'complete', 'observedAt', 'manifestDigest', 'reobservedAt',
  ]), field);
  assertOnlyKeys(invocation, new Set(['id', 'operation']), `${field}.invocation`);
  const normalized = {
    invocation: {
      id: nonEmpty(invocation.id, `${field}.invocation.id`),
      operation: nonEmpty(invocation.operation, `${field}.invocation.operation`),
    },
    provider: nonEmpty(receipt.provider, `${field}.provider`).toLowerCase(),
    repository: nonEmpty(receipt.repository, `${field}.repository`),
    issue: nonEmpty(receipt.issue, `${field}.issue`),
    revision: nonEmpty(receipt.revision, `${field}.revision`),
    issueStatus: nonEmpty(receipt.issueStatus, `${field}.issueStatus`),
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
  for (const key of ['provider', 'repository', 'issue', 'revision', 'issueStatus']) {
    if (normalized[key] !== expected[key]) {
      throw new Error(`${field}.${key} does not match the confirmed manifest`);
    }
  }
  return normalized;
}

export function validateSourceRevisionReceipt(receipt, manifest, issueIdentity) {
  assertFleetManifest(manifest);
  const issue = manifest.issues.find((entry) => entry.identity === issueIdentity);
  if (!issue) throw new Error(`unknown manifest issue: ${issueIdentity}`);
  return normalizeSourceReceipt(receipt, {
    provider: manifest.provider.name,
    repository: manifest.repository.id,
    issue: issue.identity,
    revision: issue.sourceRevision,
    issueStatus: issue.status,
  }, `${issue.identity}.sourceReceipt`);
}

function membershipDigest(issues) {
  return manifestDigest(issues
    .map(({ identity, sourceRevision }) => ({ identity, sourceRevision }))
    .sort((left, right) => left.identity.localeCompare(right.identity)));
}

function normalizeIssueSetReceipt(receipt, expected, field) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error(`${field} is required`);
  }
  const invocation = receipt.invocation;
  if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) {
    throw new Error(`${field}.invocation is required`);
  }
  assertOnlyKeys(receipt, new Set([
    'invocation', 'provider', 'repository', 'queryIdentity', 'queryRevision',
    'membershipDigest', 'members', 'status', 'terminal', 'complete', 'observedAt',
    'manifestDigest', 'reobservedAt',
  ]), field);
  assertOnlyKeys(invocation, new Set(['id', 'operation']), `${field}.invocation`);
  const members = receipt.members;
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error(`${field}.members must be a non-empty array`);
  }
  const normalizedMembers = members.map((member, index) => ({
    ...(assertOnlyKeys(
      member,
      new Set(['identity', 'sourceRevision']),
      `${field}.members[${index}]`,
    ) ?? {}),
    identity: nonEmpty(member?.identity, `${field}.members[${index}].identity`),
    sourceRevision: nonEmpty(
      member?.sourceRevision,
      `${field}.members[${index}].sourceRevision`,
    ),
  }));
  const identities = normalizedMembers.map((member) => member.identity);
  if (new Set(identities).size !== identities.length) {
    throw new Error(`${field}.members contains duplicate issue identities`);
  }
  const normalized = {
    invocation: {
      id: nonEmpty(invocation.id, `${field}.invocation.id`),
      operation: nonEmpty(invocation.operation, `${field}.invocation.operation`),
    },
    provider: nonEmpty(receipt.provider, `${field}.provider`).toLowerCase(),
    repository: nonEmpty(receipt.repository, `${field}.repository`),
    queryIdentity: nonEmpty(receipt.queryIdentity, `${field}.queryIdentity`),
    queryRevision: nonEmpty(receipt.queryRevision, `${field}.queryRevision`),
    membershipDigest: nonEmpty(receipt.membershipDigest, `${field}.membershipDigest`),
    members: normalizedMembers.sort((left, right) => left.identity.localeCompare(right.identity)),
    status: nonEmpty(receipt.status, `${field}.status`),
    terminal: receipt.terminal === true,
    complete: receipt.complete === true,
    observedAt: timestamp(receipt.observedAt, `${field}.observedAt`),
  };
  if (normalized.invocation.operation !== 'read-issue-set') {
    throw new Error(`${field}.invocation.operation must be read-issue-set`);
  }
  if (normalized.status !== 'observed' || !normalized.terminal || !normalized.complete) {
    throw new Error(`${field} must be a complete terminal observed provider receipt`);
  }
  for (const key of ['provider', 'repository', 'queryIdentity', 'queryRevision', 'membershipDigest']) {
    if (normalized[key] !== expected[key]) {
      throw new Error(`${field}.${key} does not match the confirmed manifest`);
    }
  }
  if (manifestDigest(normalized.members) !== expected.membershipDigest
      || JSON.stringify(normalized.members) !== JSON.stringify(expected.members)) {
    throw new Error(`${field}.members does not match the confirmed closed membership`);
  }
  return normalized;
}

function normalizeHumanDecisions(input, issues, manifestBindingDigest) {
  if (!Object.hasOwn(input, 'humanDecisions') || !Array.isArray(input.humanDecisions)) {
    throw new Error('humanDecisions must be explicitly declared as an array');
  }
  const ids = new Set();
  const issueMap = new Map(issues.map((issue) => [issue.identity, issue]));
  return input.humanDecisions.map((decision, index) => {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
      throw new Error(`humanDecisions[${index}] must be an object`);
    }
    assertOnlyKeys(decision, new Set([
      'id', 'actor', 'issue', 'criterionId', 'sourceRevision', 'decision',
      'decisionText', 'decidedAt',
    ]), `humanDecisions[${index}]`);
    const id = nonEmpty(decision.id, `humanDecisions[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate human decision id: ${id}`);
    ids.add(id);
    const issue = nonEmpty(decision.issue, `humanDecisions[${index}].issue`);
    const criterionId = nonEmpty(
      decision.criterionId,
      `humanDecisions[${index}].criterionId`,
    );
    const manifestIssue = issueMap.get(issue);
    if (!manifestIssue) throw new Error(`human decision ${id} names unknown issue ${issue}`);
    if (!manifestIssue.acceptanceCriteria.some((criterion) => criterion.id === criterionId)) {
      throw new Error(`human decision ${id} names unknown criterion ${criterionId}`);
    }
    const sourceRevision = nonEmpty(
      decision.sourceRevision,
      `humanDecisions[${index}].sourceRevision`,
    );
    if (sourceRevision !== manifestIssue.sourceRevision) {
      throw new Error(`human decision ${id} source revision does not match issue`);
    }
    if (decision.decision !== 'descoped') {
      throw new Error(`human decision ${id} must record decision descoped`);
    }
    return {
      id,
      actor: nonEmpty(decision.actor, `humanDecisions[${index}].actor`),
      issue,
      criterionId,
      ...(manifestBindingDigest === null ? {} : { manifestDigest: manifestBindingDigest }),
      sourceRevision,
      decision: 'descoped',
      decisionText: nonEmpty(
        decision.decisionText,
        `humanDecisions[${index}].decisionText`,
      ),
      decidedAt: timestamp(decision.decidedAt, `humanDecisions[${index}].decidedAt`),
    };
  });
}

export function validateIssueSetReceipt(receipt, manifest) {
  assertFleetManifest(manifest);
  if (manifest.issueSet.kind !== 'tracker-query') {
    throw new Error('issue-set receipt is only valid for a tracker-query manifest');
  }
  return normalizeIssueSetReceipt(receipt, {
    provider: manifest.provider.name,
    repository: manifest.repository.id,
    queryIdentity: manifest.issueSet.queryIdentity,
    queryRevision: manifest.issueSet.queryRevision,
    membershipDigest: manifest.issueSet.membershipDigest,
    members: manifest.issueSet.members,
  }, 'issueSet.receipt');
}

export function normalizeFleetManifest(input = {}) {
  assertOnlyKeys(input, MANIFEST_INPUT_FIELDS, 'fleet manifest');
  if (input.confirmation !== 'confirmed') {
    throw new Error('fleet manifest requires one explicit confirmed state');
  }
  const goal = nonEmpty(input.goal, 'goal');
  if (!Array.isArray(input.issues) || input.issues.length === 0) {
    throw new Error('issues must be a non-empty closed set');
  }
  const acceptedScope = explicitStringArray(input, 'acceptedScope');
  const exclusions = explicitStringArray(input, 'exclusions');
  const repository = input.repository;
  if (!repository || typeof repository !== 'object' || Array.isArray(repository)) {
    throw new Error('repository configuration is required');
  }
  const normalizedRepository = {
    id: nonEmpty(repository.id, 'repository.id'),
    root: nonEmpty(repository.root, 'repository.root'),
    baseBranch: nonEmpty(repository.baseBranch, 'repository.baseBranch'),
  };
  assertOnlyKeys(repository, new Set(['id', 'root', 'baseBranch']), 'repository');
  if (!path.isAbsolute(normalizedRepository.root)
      || path.normalize(path.resolve(normalizedRepository.root)) !== normalizedRepository.root) {
    throw new Error('repository.root must be an exact normalized absolute path');
  }
  const provider = input.provider;
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new Error('provider configuration is required');
  }
  if (!Array.isArray(provider.allowedOperations) || provider.allowedOperations.length === 0) {
    throw new Error('provider.allowedOperations must be a non-empty array');
  }
  assertOnlyKeys(provider, new Set(['name', 'allowedOperations']), 'provider');
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
    assertOnlyKeys(issue, new Set([
      'identity', 'sourceRevision', 'sourceReceipt', 'acceptanceCriteria',
      'scope', 'allowedPaths', 'status',
    ]), `issues[${index}]`);
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
      issueStatus: status,
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

  const members = issues
    .map(({ identity, sourceRevision }) => ({ identity, sourceRevision }))
    .sort((left, right) => left.identity.localeCompare(right.identity));
  const expectedMembershipDigest = membershipDigest(issues);
  let issueSet;
  if (input.issueSet === undefined || input.issueSet?.kind === 'explicit') {
    if (input.issueSet !== undefined) {
      assertOnlyKeys(input.issueSet, new Set(['kind', 'membershipDigest', 'members']), 'issueSet');
      if (input.issueSet.membershipDigest !== undefined
          && input.issueSet.membershipDigest !== expectedMembershipDigest) {
        throw new Error('explicit issueSet.membershipDigest does not match the supplied issues');
      }
      if (input.issueSet.members !== undefined
          && JSON.stringify([...input.issueSet.members].sort((left, right) =>
            String(left.identity).localeCompare(String(right.identity)))) !== JSON.stringify(members)) {
        throw new Error('explicit issueSet.members does not match the supplied issues');
      }
    }
    issueSet = {
      kind: 'explicit',
      membershipDigest: expectedMembershipDigest,
      members,
    };
  } else if (input.issueSet?.kind === 'tracker-query') {
    assertOnlyKeys(input.issueSet, new Set([
      'kind', 'queryIdentity', 'queryRevision', 'membershipDigest', 'receipt',
    ]), 'issueSet');
    const queryIdentity = nonEmpty(input.issueSet.queryIdentity, 'issueSet.queryIdentity');
    const queryRevision = nonEmpty(input.issueSet.queryRevision, 'issueSet.queryRevision');
    if (input.issueSet.membershipDigest !== expectedMembershipDigest) {
      throw new Error('issueSet.membershipDigest does not match the supplied closed issue set');
    }
    issueSet = {
      kind: 'tracker-query',
      queryIdentity,
      queryRevision,
      membershipDigest: expectedMembershipDigest,
      members,
      receipt: normalizeIssueSetReceipt(input.issueSet.receipt, {
        provider: providerName,
        repository: normalizedRepository.id,
        queryIdentity,
        queryRevision,
        membershipDigest: expectedMembershipDigest,
        members,
      }, 'issueSet.receipt'),
    };
  } else {
    throw new Error('issueSet.kind must be explicit or tracker-query');
  }

  if (!Array.isArray(input.dependencies)) throw new Error('dependencies must be an array');
  const edgeKeys = new Set();
  const dependencies = input.dependencies.map((edge, index) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
      throw new Error(`dependencies[${index}] must be an object`);
    }
    if ('from' in edge || 'to' in edge || !('dependency' in edge) || !('dependent' in edge)) {
      throw new Error(`dependencies[${index}] has ambiguous direction; use dependency and dependent`);
    }
    assertOnlyKeys(
      edge,
      new Set(['dependency', 'dependent', 'satisfiedBy']),
      `dependencies[${index}]`,
    );
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
  assertOnlyKeys(budget, new Set(['cost', 'timeMinutes', 'retries']), 'budget');
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
  const unsupportedPolicy = validationPolicy.filter((entry) => !BASELINE_POLICY.includes(entry));
  if (unsupportedPolicy.length) {
    throw new Error(`validationPolicy contains unsupported checks: ${[...new Set(unsupportedPolicy)].sort().join(', ')}`);
  }
  if (new Set(validationPolicy).size !== validationPolicy.length) {
    throw new Error('validationPolicy contains duplicate checks');
  }
  const stopConditions = explicitStringArray(input, 'stopConditions', { nonEmptyArray: true });
  const humanBoundaries = explicitStringArray(input, 'humanBoundaries', { nonEmptyArray: true });
  const humanDecisionCores = normalizeHumanDecisions(input, issues, null);

  const confirmationBindingDigest = manifestDigest({
    goal,
    acceptedScope,
    issues,
    dependencies,
    exclusions,
    concurrency,
    budget,
    repository: normalizedRepository,
    provider: normalizedProvider,
    validationPolicy: [...BASELINE_POLICY],
    stopConditions,
    shepherdIntent: input.shepherdIntent,
    humanBoundaries,
    issueSet,
    humanDecisionCores,
  });
  const humanDecisions = humanDecisionCores.map((decision) => ({
    ...decision,
    manifestDigest: confirmationBindingDigest,
  }));
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
    validationPolicy: [...BASELINE_POLICY],
    stopConditions,
    shepherdIntent: input.shepherdIntent,
    humanBoundaries,
    humanDecisions,
    confirmationBindingDigest,
    issueSet,
    confirmation: 'confirmed',
    closedSet: true,
  };
  return { ...manifest, digest: manifestDigest(manifest) };
}

function manifestInput(manifest) {
  const sourceReceipt = (receipt) => ({
    invocation: structuredClone(receipt.invocation),
    provider: receipt.provider,
    repository: receipt.repository,
    issue: receipt.issue,
    revision: receipt.revision,
    issueStatus: receipt.issueStatus,
    status: receipt.status,
    terminal: receipt.terminal,
    complete: receipt.complete,
    observedAt: receipt.observedAt,
  });
  const issueSet = manifest.issueSet.kind === 'tracker-query'
    ? {
      kind: 'tracker-query',
      queryIdentity: manifest.issueSet.queryIdentity,
      queryRevision: manifest.issueSet.queryRevision,
      membershipDigest: manifest.issueSet.membershipDigest,
      receipt: structuredClone(manifest.issueSet.receipt),
    }
    : {
      kind: 'explicit',
      membershipDigest: manifest.issueSet.membershipDigest,
      members: structuredClone(manifest.issueSet.members),
    };
  return {
    confirmation: manifest.confirmation,
    goal: manifest.goal,
    acceptedScope: structuredClone(manifest.acceptedScope),
    issues: manifest.issues.map((issue) => ({
      identity: issue.identity,
      sourceRevision: issue.sourceRevision,
      sourceReceipt: sourceReceipt(issue.sourceReceipt),
      acceptanceCriteria: structuredClone(issue.acceptanceCriteria),
      scope: structuredClone(issue.scope),
      allowedPaths: structuredClone(issue.allowedPaths),
      status: issue.status,
    })),
    issueSet,
    dependencies: structuredClone(manifest.dependencies),
    exclusions: structuredClone(manifest.exclusions),
    concurrency: manifest.concurrency,
    budget: structuredClone(manifest.budget),
    repository: structuredClone(manifest.repository),
    provider: structuredClone(manifest.provider),
    validationPolicy: structuredClone(manifest.validationPolicy),
    stopConditions: structuredClone(manifest.stopConditions),
    shepherdIntent: manifest.shepherdIntent,
    humanBoundaries: structuredClone(manifest.humanBoundaries),
    humanDecisions: manifest.humanDecisions.map(({ manifestDigest: ignored, ...decision }) =>
      structuredClone(decision)),
  };
}

export function assertFleetManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('confirmed fleet manifest is required');
  }
  assertOnlyKeys(manifest, MANIFEST_FIELDS, 'normalized fleet manifest');
  if (manifest.schemaVersion !== 1 || manifest.confirmation !== 'confirmed'
      || manifest.closedSet !== true) {
    throw new Error('normalized fleet manifest authority is invalid');
  }
  const unsigned = structuredClone(manifest);
  delete unsigned.digest;
  if (manifest.digest !== manifestDigest(unsigned)) {
    throw new Error('fleet manifest digest does not match authority fields');
  }
  if (manifest.providerConfigurationDigest
      !== providerConfigurationDigest(manifest.repository, manifest.provider)) {
    throw new Error('provider configuration digest does not match authority fields');
  }
  const normalized = normalizeFleetManifest(manifestInput(manifest));
  if (JSON.stringify(stable(normalized)) !== JSON.stringify(stable(manifest))) {
    throw new Error('fleet manifest is not the exact normalized confirmed schema');
  }
  return manifest;
}

export { BASELINE_POLICY };
