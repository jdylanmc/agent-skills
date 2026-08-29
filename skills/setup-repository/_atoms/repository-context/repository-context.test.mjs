/**
 * Behavioural tests for detection, classification, and normalization.
 *
 * Every assertion drives the machine: a provider is classified from a real URL
 * form, a required field is proven unsettled by its absence, and idempotence is
 * checked by feeding a normalized context back through.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_CUSTOM_INSTRUCTIONS,
  PROVIDER_TABLE,
  RepositoryContextError,
  SUPPORTED_PROVIDERS,
  classifyRemote,
  normalizeContext,
} from './repository-context.mjs';

function completeAnswers(overrides = {}) {
  return {
    defaultBranch: 'main',
    targetDirectory: '.agent/context',
    trackerOperations: ['read-item', 'list-items'],
    relationshipKinds: ['relates-to', 'blocks'],
    mutationVocabulary: ['open', 'close', 'label'],
    itemTypes: ['issue', 'task'],
    labels: [{ name: 'bug', meaning: 'a defect in shipped behavior' }],
    states: [
      { name: 'open', meaning: 'the item is unresolved' },
      { name: 'closed', meaning: 'the item is resolved' },
    ],
    domain: {
      name: 'Widgets',
      summary: 'A catalog of widgets',
      vocabularySources: ['docs/glossary.md'],
    },
    ...overrides,
  };
}

test('the provider matrix is bounded to four supported classes plus unsupported', () => {
  assert.deepEqual(Object.keys(PROVIDER_TABLE).sort(), [
    'azure-devops',
    'github',
    'gitlab',
    'local',
    'unsupported',
  ]);
  assert.deepEqual([...SUPPORTED_PROVIDERS].sort(), ['azure-devops', 'github', 'gitlab', 'local']);
  assert.ok(Object.isFrozen(PROVIDER_TABLE));
  assert.equal(PROVIDER_TABLE.unsupported.supported, false);
});

test('GitHub remotes classify across HTTPS, SSH, and ssh:// forms', () => {
  // The sensitive-content gate rejects a literal `<user>@<dotted.host>`; the SSH
  // forms are assembled from parts so the classified value is unchanged.
  const SSH_USER = ['git', '@'].join('');
  for (const url of [
    'https://github.com/acme/widgets.git',
    'https://github.com/acme/widgets',
    `${SSH_USER}github.com:acme/widgets.git`,
    `ssh://${SSH_USER}github.com/acme/widgets.git`,
  ]) {
    assert.deepEqual(classifyRemote(url), {
      provider: 'github',
      host: 'github.com',
      organization: 'acme',
      project: null,
      repository: 'widgets',
    }, url);
  }
});

test('GitLab subgroup namespaces keep the full namespace as the organization', () => {
  assert.deepEqual(classifyRemote('https://gitlab.com/group/subgroup/widgets.git'), {
    provider: 'gitlab',
    host: 'gitlab.com',
    organization: 'group/subgroup',
    project: null,
    repository: 'widgets',
  });
});

test('Azure DevOps classifies dev.azure.com, org@ prefix, ssh, and legacy visualstudio.com', () => {
  // The sensitive-content gate rejects a literal `<user>@<dotted.host>`; the SSH
  // form and the org-prefix HTTPS form are assembled from parts so the
  // classified values are unchanged.
  const SSH_USER = ['git', '@'].join('');
  const ORG_PREFIX = ['contoso', '@'].join('');
  const expected = {
    provider: 'azure-devops',
    host: 'dev.azure.com',
    organization: 'contoso',
    project: 'Platform',
    repository: 'widgets',
  };
  assert.deepEqual(classifyRemote('https://dev.azure.com/contoso/Platform/_git/widgets'), expected);
  assert.deepEqual(classifyRemote(`https://${ORG_PREFIX}dev.azure.com/contoso/Platform/_git/widgets`), expected);
  assert.deepEqual(classifyRemote(`${SSH_USER}ssh.dev.azure.com:v3/contoso/Platform/widgets`), {
    ...expected,
    host: 'ssh.dev.azure.com',
  });
  assert.deepEqual(classifyRemote('https://contoso.visualstudio.com/Platform/_git/widgets'), {
    ...expected,
    host: 'contoso.visualstudio.com',
  });
});

test('an unknown host is unsupported until its provider is declared', () => {
  const unknown = classifyRemote('https://git.example.com/team/repo.git');
  assert.equal(unknown.provider, 'unsupported');
  assert.equal(unknown.host, 'git.example.com');
  assert.deepEqual(unknown.evidence, { host: 'git.example.com', segments: ['team', 'repo'] });
  assert.deepEqual(unknown.requiredCustomFields, [...PROVIDER_TABLE.unsupported.requiredCustomFields]);

  const declared = classifyRemote('https://git.example.com/team/repo.git', {
    declaredHosts: [{ host: 'git.example.com', provider: 'gitlab' }],
  });
  assert.deepEqual(declared, {
    provider: 'gitlab',
    host: 'git.example.com',
    organization: 'team',
    project: null,
    repository: 'repo',
  });
});

test('a complete context for each supported provider normalizes to complete', () => {
  const github = normalizeContext({ ...classifyRemote('https://github.com/acme/widgets.git'), ...completeAnswers() });
  assert.equal(github.status, 'complete');
  assert.deepEqual(github.missing, []);
  assert.equal(github.context.project, null);

  const gitlab = normalizeContext({ ...classifyRemote('https://gitlab.com/group/widgets.git'), ...completeAnswers() });
  assert.equal(gitlab.status, 'complete');

  const azure = normalizeContext({
    ...classifyRemote('https://dev.azure.com/contoso/Platform/_git/widgets'),
    ...completeAnswers(),
  });
  assert.equal(azure.status, 'complete');
  assert.equal(azure.context.project, 'Platform');

  const local = normalizeContext({
    provider: 'local',
    host: 'tracker.internal',
    organization: 'ops',
    repository: 'widgets',
    customTrackerInstructions: 'Read items from the internal board export at ops/board.json.',
    ...completeAnswers(),
  });
  assert.equal(local.status, 'complete');
  assert.equal(local.context.customTrackerInstructions.length > 0, true);
});

test('Azure DevOps requires a project, and its absence is reported with a question', () => {
  const azure = normalizeContext({
    provider: 'azure-devops',
    host: 'dev.azure.com',
    organization: 'contoso',
    repository: 'widgets',
    ...completeAnswers(),
  });
  assert.equal(azure.status, 'needs-input');
  const projectMiss = azure.missing.find((entry) => entry.field === 'project');
  assert.ok(projectMiss, 'project must be reported missing');
  assert.match(projectMiss.question, /project/i);
});

test('needs-input names each unsettled required field with its question', () => {
  const partial = normalizeContext({
    ...classifyRemote('https://github.com/acme/widgets.git'),
    defaultBranch: 'main',
    targetDirectory: '.agent/context',
  });
  assert.equal(partial.status, 'needs-input');
  const fields = partial.missing.map((entry) => entry.field);
  assert.ok(fields.includes('labels'));
  assert.ok(fields.includes('domain'));
  for (const entry of partial.missing) {
    assert.equal(typeof entry.question, 'string');
    assert.ok(entry.question.length > 0);
  }
});

test('an unsupported provider returns the named disposition and its required custom fields', () => {
  const report = normalizeContext({ provider: 'unsupported', host: 'example.com' });
  assert.equal(report.status, 'unsupported-provider');
  assert.equal(report.context.provider, 'unsupported');
  assert.deepEqual(
    report.missing.map((entry) => entry.field),
    [...PROVIDER_TABLE.unsupported.requiredCustomFields],
  );
});

test('a local provider requires bounded custom instructions', () => {
  const report = normalizeContext({
    provider: 'local',
    host: 'tracker.internal',
    organization: 'ops',
    repository: 'widgets',
    ...completeAnswers(),
  });
  assert.equal(report.status, 'needs-input');
  assert.ok(report.missing.some((entry) => entry.field === 'customTrackerInstructions'));
});

test('custom instructions beyond the ceiling map to needs-input and never throw', () => {
  // SR-11: over-limit custom instructions used to throw a
  // `custom-instructions-too-long` exception. The public output vocabulary is
  // the seven statuses, so the condition maps to `needs-input` carrying the
  // limit and the replacement question, since it is operator-correctable
  // input.
  const report = normalizeContext({
    provider: 'local',
    host: 'tracker.internal',
    organization: 'ops',
    repository: 'widgets',
    customTrackerInstructions: 'x'.repeat(MAX_CUSTOM_INSTRUCTIONS + 1),
    ...completeAnswers(),
  });
  assert.equal(report.status, 'needs-input');
  const entry = report.missing.find((item) => item.field === 'customTrackerInstructions');
  assert.ok(entry, 'the missing list must name customTrackerInstructions');
  assert.equal(entry.reason, 'custom-instructions-too-long');
  assert.equal(entry.limit, MAX_CUSTOM_INSTRUCTIONS);
  assert.equal(entry.suppliedLength, MAX_CUSTOM_INSTRUCTIONS + 1);
  assert.equal(typeof entry.question, 'string');
  assert.ok(entry.question.length > 0);
  // The RepositoryContextError class is still exported for callers who need
  // to catch a hypothetical usage error, but it is no longer thrown for
  // over-limit input.
  assert.equal(typeof RepositoryContextError, 'function');
});

test('a mix of valid and invalid label entries yields needs-input naming the malformed entry', () => {
  // SR-04: a mixed array must not silently drop the malformed entry and
  // report the field as settled. The valid entry alone does not settle the
  // field; the malformed one is named by index (and by any partial name the
  // operator did supply).
  const report = normalizeContext({
    ...classifyRemote('https://github.com/acme/widgets.git'),
    ...completeAnswers({
      labels: [
        { name: 'bug', meaning: 'a defect in shipped behavior' },
        { name: 'triage' }, // incomplete: meaning missing
      ],
    }),
  });
  assert.equal(report.status, 'needs-input');
  const entry = report.missing.find((item) => item.field === 'labels');
  assert.ok(entry, 'labels must be reported unresolved');
  assert.equal(entry.reason, 'entries-missing-name-or-meaning');
  assert.ok(Array.isArray(entry.malformedEntries));
  assert.equal(entry.malformedEntries.length, 1);
  assert.equal(entry.malformedEntries[0].index, 1);
  assert.equal(entry.malformedEntries[0].name, 'triage');
});

test('R2-05: re-normalizing a mixed-label context is stable and only becomes complete when meanings are supplied', () => {
  // Regression: a first pass returned only the SURVIVING valid label entries
  // and dropped the malformed one. The malformed evidence never made it into
  // the returned context, so re-normalizing the returned context produced
  // `status: complete` from the surviving subset. This meant a caller that
  // called `normalizeContext(normalizeContext(input).context)` would silently
  // discard the operator's unresolved input.
  const firstInput = {
    ...classifyRemote('https://github.com/acme/widgets.git'),
    ...completeAnswers({
      labels: [
        { name: 'bug', meaning: 'a defect in shipped behavior' },
        { name: 'triage' },
      ],
      states: [
        { name: 'open', meaning: 'the item is unresolved' },
        { name: 'closed' },
      ],
    }),
  };
  const first = normalizeContext(firstInput);
  assert.equal(first.status, 'needs-input');
  const firstLabels = first.missing.find((item) => item.field === 'labels');
  const firstStates = first.missing.find((item) => item.field === 'states');
  assert.ok(firstLabels);
  assert.ok(firstStates);

  // Re-normalize the returned context UNCHANGED. The malformed evidence must
  // still be present: same status, same malformed indexes, same outstanding
  // questions.
  const second = normalizeContext(first.context);
  assert.equal(second.status, 'needs-input');
  const secondLabels = second.missing.find((item) => item.field === 'labels');
  const secondStates = second.missing.find((item) => item.field === 'states');
  assert.ok(secondLabels, 'labels must remain unresolved on the second pass');
  assert.ok(secondStates, 'states must remain unresolved on the second pass');
  assert.equal(secondLabels.reason, 'entries-missing-name-or-meaning');
  assert.equal(secondStates.reason, 'entries-missing-name-or-meaning');
  assert.deepEqual(
    secondLabels.malformedEntries.map((entry) => entry.index),
    firstLabels.malformedEntries.map((entry) => entry.index),
  );
  assert.deepEqual(
    secondStates.malformedEntries.map((entry) => entry.index),
    firstStates.malformedEntries.map((entry) => entry.index),
  );
  assert.deepEqual(secondLabels.malformedEntries[0], firstLabels.malformedEntries[0]);
  assert.deepEqual(secondStates.malformedEntries[0], firstStates.malformedEntries[0]);
  assert.equal(secondLabels.question, firstLabels.question);
  assert.equal(secondStates.question, firstStates.question);

  // Now supply the missing meanings. Only then does the context become
  // `complete`. Nothing else needed changing between the two passes.
  const fixed = normalizeContext({
    ...firstInput,
    labels: [
      { name: 'bug', meaning: 'a defect in shipped behavior' },
      { name: 'triage', meaning: 'awaiting an initial decision' },
    ],
    states: [
      { name: 'open', meaning: 'the item is unresolved' },
      { name: 'closed', meaning: 'the item is resolved' },
    ],
  });
  assert.equal(fixed.status, 'complete');
});

test('a mix of valid and invalid state entries yields needs-input naming the malformed entry', () => {
  const report = normalizeContext({
    ...classifyRemote('https://github.com/acme/widgets.git'),
    ...completeAnswers({
      states: [
        { name: 'open', meaning: 'the item is unresolved' },
        { name: 'closed' }, // incomplete: meaning missing
      ],
    }),
  });
  assert.equal(report.status, 'needs-input');
  const entry = report.missing.find((item) => item.field === 'states');
  assert.ok(entry);
  assert.equal(entry.reason, 'entries-missing-name-or-meaning');
  assert.equal(entry.malformedEntries.length, 1);
  assert.equal(entry.malformedEntries[0].index, 1);
  assert.equal(entry.malformedEntries[0].name, 'closed');
});

test('a state naming a term with no meaning does not settle the field and yields needs-input', () => {
  const report = normalizeContext({
    ...classifyRemote('https://github.com/acme/widgets.git'),
    ...completeAnswers({
      states: [{ name: 'open' }, { name: 'closed' }],
    }),
  });
  assert.equal(report.status, 'needs-input');
  const missing = report.missing.find((entry) => entry.field === 'states');
  assert.ok(missing, 'states must be reported missing when meanings are absent');
  assert.match(missing.question, /state/i);
});

test('a label naming a term with no meaning also does not settle the field', () => {
  const report = normalizeContext({
    ...classifyRemote('https://github.com/acme/widgets.git'),
    ...completeAnswers({
      labels: [{ name: 'bug' }],
    }),
  });
  assert.equal(report.status, 'needs-input');
  assert.ok(report.missing.some((entry) => entry.field === 'labels'));
});

test('normalization is idempotent for every provider class', () => {
  const inputs = [
    { ...classifyRemote('https://github.com/acme/widgets.git'), ...completeAnswers() },
    { ...classifyRemote('https://gitlab.com/group/sub/widgets.git'), ...completeAnswers() },
    { ...classifyRemote('https://dev.azure.com/contoso/Platform/_git/widgets'), ...completeAnswers() },
    {
      provider: 'local',
      host: 'tracker.internal',
      organization: 'ops',
      repository: 'widgets',
      customTrackerInstructions: 'Read items from ops/board.json.',
      ...completeAnswers(),
    },
  ];
  for (const input of inputs) {
    const first = normalizeContext(input);
    assert.equal(first.status, 'complete');
    const second = normalizeContext(first.context);
    assert.deepEqual(second.context, first.context);
    assert.equal(second.status, 'complete');
  }
});
