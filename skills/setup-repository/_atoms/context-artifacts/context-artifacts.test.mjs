/**
 * Behavioural tests for artifact rendering, the fenced machine-resolvable
 * grammar, the adapter contract, and the identity provenance proof.
 *
 * The guarantees under test are that output is a pure function of the context,
 * that a downstream adapter can parse every contract field back out of the
 * rendered bytes, that a value carrying pipes, newlines, commas, or backticks
 * still round-trips unchanged, and that no identity the context did not supply
 * reaches the bytes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeContext, classifyRemote } from '../repository-context/repository-context.mjs';
import {
  ContextArtifactsError,
  FORBIDDEN_LITERALS,
  TRACKER_ADAPTER_CONTRACT,
  assertRoundTrip,
  domainProjection,
  findForeignIdentities,
  issueTrackerProjection,
  parseDomain,
  parseIssueTracker,
  renderArtifacts,
  validateTargetDirectory,
  verifyAdapterContract,
  verifyProvenance,
} from './context-artifacts.mjs';

function answers(overrides = {}) {
  return {
    defaultBranch: 'main',
    targetDirectory: '.agent/context',
    trackerOperations: ['read-item', 'list-items'],
    relationshipKinds: ['relates-to', 'blocks'],
    mutationVocabulary: ['open', 'close', 'label'],
    itemTypes: ['issue', 'task'],
    labels: [
      { name: 'bug', meaning: 'a defect in shipped behavior' },
      { name: 'triage', meaning: 'awaiting an initial decision' },
    ],
    states: [
      { name: 'open', meaning: 'the item is unresolved' },
      { name: 'in-progress', meaning: 'the item is being worked' },
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

const PROVIDER_CONTEXTS = {
  github: normalizeContext({ ...classifyRemote('https://github.com/acme/widgets.git'), ...answers() }).context,
  gitlab: normalizeContext({ ...classifyRemote('https://gitlab.com/group/sub/widgets.git'), ...answers() }).context,
  'azure-devops': normalizeContext({
    ...classifyRemote('https://dev.azure.com/contoso/Platform/_git/widgets'),
    ...answers(),
  }).context,
  local: normalizeContext({
    provider: 'local',
    host: 'tracker.internal',
    organization: 'ops',
    repository: 'widgets',
    customTrackerInstructions: 'Read items from the internal board export at ops/board.json.',
    ...answers(),
  }).context,
};

/** Build a valid fenced tracker-adapter block for negative-path parse tests. */
function buildTrackerBlock(overrides = {}) {
  const defaults = {
    provider: 'github',
    host: 'github.com',
    organization: 'acme',
    project: null,
    repository: 'widgets',
    'default-branch': 'main',
    'item-types': ['issue'],
    'tracker-operations': ['read-item'],
    'relationship-kinds': ['relates-to'],
    'mutation-vocabulary': ['open'],
    'label-vocabulary': [{ name: 'bug', meaning: 'a defect' }],
    'state-vocabulary': [{ name: 'open', meaning: 'unresolved' }],
    'custom-tracker-instructions': null,
  };
  const merged = { ...defaults, ...overrides };
  const order = [
    ...TRACKER_ADAPTER_CONTRACT,
    'custom-tracker-instructions',
  ];
  const lines = ['```tracker-adapter-v1'];
  for (const key of order) {
    lines.push(`${key} = ${JSON.stringify(merged[key])}`);
  }
  lines.push('```');
  return lines.join('\n');
}

test('the three artifacts render in stable order under the target directory', () => {
  const artifacts = renderArtifacts(PROVIDER_CONTEXTS.github);
  assert.deepEqual(artifacts.map((entry) => entry.path), [
    '.agent/context/issue-tracker.md',
    '.agent/context/domain.md',
    '.agent/context/triage-labels.md',
  ]);
  for (const entry of artifacts) {
    assert.equal(typeof entry.content, 'string');
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  }
});

test('rendering is a pure function: an equal context yields byte-identical output', () => {
  const first = renderArtifacts(PROVIDER_CONTEXTS.github);
  const second = renderArtifacts(PROVIDER_CONTEXTS.github);
  assert.deepEqual(first, second);
  const rendered = first.map((entry) => entry.content).join('');
  assert.doesNotMatch(rendered, /\d{4}-\d{2}-\d{2}T/); // no timestamps
  assert.doesNotMatch(rendered, /\/Users\/|\/home\/|[A-Z]:\\\\/); // no absolute paths
});

test('the adapter contract is satisfied for every provider class', () => {
  for (const [provider, context] of Object.entries(PROVIDER_CONTEXTS)) {
    const issueTracker = renderArtifacts(context).find((entry) => entry.path.endsWith('issue-tracker.md'));
    const result = verifyAdapterContract(issueTracker.content);
    assert.deepEqual(result, { satisfied: true, missing: [] }, provider);
    for (const field of TRACKER_ADAPTER_CONTRACT) {
      assert.match(issueTracker.content, new RegExp(`^${field} = `, 'm'), `${provider} names ${field}`);
    }
  }
});

test('a provider with no project layer resolves project to null, distinct from a value literally named "none"', () => {
  const issueTracker = renderArtifacts(PROVIDER_CONTEXTS.github)
    .find((entry) => entry.path.endsWith('issue-tracker.md'));
  const parsed = parseIssueTracker(issueTracker.content);
  assert.equal(parsed.project, null);
  assert.match(issueTracker.content, /^project = null$/m);
  assert.doesNotMatch(issueTracker.content, /^project = "none"$/m);
  assert.deepEqual(verifyAdapterContract(issueTracker.content).missing, []);
});

test('azure-devops resolves a concrete project while non-project providers resolve null', () => {
  const azure = parseIssueTracker(
    renderArtifacts(PROVIDER_CONTEXTS['azure-devops'])
      .find((entry) => entry.path.endsWith('issue-tracker.md')).content,
  );
  assert.equal(azure.project, 'Platform');
  for (const provider of ['github', 'gitlab', 'local']) {
    const parsed = parseIssueTracker(
      renderArtifacts(PROVIDER_CONTEXTS[provider])
        .find((entry) => entry.path.endsWith('issue-tracker.md')).content,
    );
    assert.equal(parsed.project, null, provider);
  }
});

test('an unresolved required scalar in a valid fenced block fails the contract naming exactly that scalar', () => {
  const broken = buildTrackerBlock({ host: null });
  const result = verifyAdapterContract(broken);
  assert.equal(result.satisfied, false);
  assert.deepEqual(result.missing, ['host']);
});

test('an empty required list in a valid fenced block fails the contract naming that list', () => {
  const broken = buildTrackerBlock({ 'state-vocabulary': [] });
  const result = verifyAdapterContract(broken);
  assert.equal(result.satisfied, false);
  assert.deepEqual(result.missing, ['state-vocabulary']);
});

test('an unparseable issue-tracker body reports every contract field missing rather than a partial pass', () => {
  const result = verifyAdapterContract('# no fenced block here');
  assert.equal(result.satisfied, false);
  assert.deepEqual(result.missing, [...TRACKER_ADAPTER_CONTRACT]);
});

test('a rendered issue-tracker.md round-trips through parseIssueTracker back to its context projection', () => {
  for (const [provider, context] of Object.entries(PROVIDER_CONTEXTS)) {
    const issueTracker = renderArtifacts(context).find((entry) => entry.path.endsWith('issue-tracker.md'));
    assert.deepEqual(parseIssueTracker(issueTracker.content), issueTrackerProjection(context), provider);
  }
});

test('a rendered domain.md round-trips through parseDomain back to its context projection', () => {
  for (const [provider, context] of Object.entries(PROVIDER_CONTEXTS)) {
    const domain = renderArtifacts(context).find((entry) => entry.path.endsWith('domain.md'));
    assert.deepEqual(parseDomain(domain.content), domainProjection(context), provider);
  }
});

test('a value carrying a pipe, a newline, a comma, and a backtick round-trips unchanged', () => {
  const nasty = 'pipe|inside, comma\nnewline `backtick`';
  const context = normalizeContext({
    ...classifyRemote('https://github.com/acme/widgets.git'),
    ...answers({
      labels: [
        { name: 'weird', meaning: nasty },
        { name: 'plain', meaning: 'ordinary' },
      ],
    }),
  }).context;

  const artifacts = renderArtifacts(context);
  const issueTracker = artifacts.find((entry) => entry.path.endsWith('issue-tracker.md'));
  const parsed = parseIssueTracker(issueTracker.content);
  assert.deepEqual(parsed.labels, [
    { name: 'weird', meaning: nasty },
    { name: 'plain', meaning: 'ordinary' },
  ]);

  // The display table in triage-labels.md must not merge the two entries into
  // one row or split one into three: exactly two data rows are present.
  const triage = artifacts.find((entry) => entry.path.endsWith('triage-labels.md'));
  const labelsSection = triage.content.match(
    /## Labels\n\n\| Label \| Meaning \|\n\| --- \| --- \|\n((?:\|.*\n)+)/,
  );
  assert.ok(labelsSection, 'labels table renders');
  const rows = labelsSection[1].split('\n').filter((line) => line.startsWith('| '));
  assert.equal(rows.length, 2, 'exactly two data rows survive delimiter injection');
});

test('a name carrying delimiter characters also round-trips through the fenced grammar', () => {
  const context = normalizeContext({
    ...classifyRemote('https://github.com/acme/widgets.git'),
    ...answers({
      states: [
        { name: 'in|review', meaning: 'a state, comma\nand newline' },
        { name: 'ok', meaning: 'plain' },
      ],
    }),
  }).context;

  const parsed = parseIssueTracker(
    renderArtifacts(context).find((entry) => entry.path.endsWith('issue-tracker.md')).content,
  );
  assert.deepEqual(parsed.states, [
    { name: 'in|review', meaning: 'a state, comma\nand newline' },
    { name: 'ok', meaning: 'plain' },
  ]);
});

test('assertRoundTrip refuses malformed rendered content with round-trip-failed', () => {
  // SR-10: the round-trip refusal is exposed as a public validation boundary,
  // so bypassing the production round-trip check would make this test fail.
  const context = PROVIDER_CONTEXTS.github;
  const good = renderArtifacts(context);
  const issueTracker = good.find((entry) => entry.path.endsWith('issue-tracker.md')).content;
  const domain = good.find((entry) => entry.path.endsWith('domain.md')).content;

  // Sanity: a genuine render passes.
  assert.doesNotThrow(() => assertRoundTrip({
    issueTrackerContent: issueTracker,
    domainContent: domain,
    context,
  }));

  // A tampered fenced identity is refused.
  const tamperedTracker = issueTracker.replace(
    'organization = "acme"',
    'organization = "not-the-acme-from-context"',
  );
  assert.throws(
    () => assertRoundTrip({
      issueTrackerContent: tamperedTracker,
      domainContent: domain,
      context,
    }),
    (error) => error instanceof ContextArtifactsError && error.code === 'round-trip-failed',
  );

  // Malformed bytes are refused.
  assert.throws(
    () => assertRoundTrip({
      issueTrackerContent: '# no fenced block here',
      domainContent: domain,
      context,
    }),
    (error) => error instanceof ContextArtifactsError && error.code === 'round-trip-failed',
  );
  assert.throws(
    () => assertRoundTrip({
      issueTrackerContent: issueTracker,
      domainContent: 'garbage-with-no-block',
      context,
    }),
    (error) => error instanceof ContextArtifactsError && error.code === 'round-trip-failed',
  );
});

test('verifyProvenance returns ok for a genuine render across every provider class', () => {
  for (const [provider, context] of Object.entries(PROVIDER_CONTEXTS)) {
    const artifacts = renderArtifacts(context);
    const result = verifyProvenance(artifacts, context);
    assert.deepEqual(result, { ok: true, violations: [] }, provider);
  }
});

test('verifyProvenance reports a violation when the rendered bytes are tampered with', () => {
  const context = PROVIDER_CONTEXTS.github;
  const artifacts = renderArtifacts(context);
  const tampered = artifacts.map((entry) => (
    entry.path.endsWith('issue-tracker.md')
      ? { ...entry, content: `${entry.content}\n<!-- injected -->\n` }
      : entry
  ));
  const result = verifyProvenance(tampered, context);
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some((v) => v.artifact === 'issue-tracker.md' && v.reason === 'not-pure-render-of-context'),
    'appended bytes are not a pure render of the context',
  );
});

test('verifyProvenance reports a violation when the fenced identity is tampered with', () => {
  const context = PROVIDER_CONTEXTS.github;
  const artifacts = renderArtifacts(context);
  const tampered = artifacts.map((entry) => (
    entry.path.endsWith('issue-tracker.md')
      ? { ...entry, content: entry.content.replace('organization = "acme"', 'organization = "not-acme"') }
      : entry
  ));
  const result = verifyProvenance(tampered, context);
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some((v) => v.artifact === 'issue-tracker.md'),
    'a mismatched identity in the tracker block is a violation',
  );
});

test('rendered output carries no identity the context did not supply', () => {
  for (const [provider, context] of Object.entries(PROVIDER_CONTEXTS)) {
    for (const entry of renderArtifacts(context)) {
      assert.deepEqual(findForeignIdentities(entry.content, context), [], `${provider} ${entry.path}`);
    }
  }
});

test('the identity guard flags a foreign literal injected into the bytes', () => {
  const context = PROVIDER_CONTEXTS.github;
  const smuggled = `${renderArtifacts(context)[0].content}\n<!-- dev.azure.com -->`;
  assert.deepEqual(findForeignIdentities(smuggled, context), ['dev.azure.com']);
});

test('the Azure DevOps host is not foreign in an Azure DevOps context', () => {
  const context = PROVIDER_CONTEXTS['azure-devops'];
  const issueTracker = renderArtifacts(context).find((entry) => entry.path.endsWith('issue-tracker.md'));
  assert.match(issueTracker.content, /dev\.azure\.com/);
  assert.deepEqual(findForeignIdentities(issueTracker.content, context), []);
});

test('the forbidden-literal set is frozen and holds known-dangerous identities', () => {
  assert.ok(Object.isFrozen(FORBIDDEN_LITERALS));
  for (const literal of ['dev.azure.com', 'github.com', 'gitlab.com']) {
    assert.ok(FORBIDDEN_LITERALS.includes(literal), literal);
  }
});

test('the tracker-adapter contract names every field an adapter must resolve', () => {
  assert.deepEqual([...TRACKER_ADAPTER_CONTRACT], [
    'provider',
    'host',
    'organization',
    'project',
    'repository',
    'default-branch',
    'item-types',
    'tracker-operations',
    'relationship-kinds',
    'mutation-vocabulary',
    'label-vocabulary',
    'state-vocabulary',
  ]);
  assert.ok(Object.isFrozen(TRACKER_ADAPTER_CONTRACT));
});

test('triage-labels renders every label and state with its meaning', () => {
  const labels = renderArtifacts(PROVIDER_CONTEXTS.github)
    .find((entry) => entry.path.endsWith('triage-labels.md'));
  assert.match(labels.content, /\| bug \| a defect in shipped behavior \|/);
  assert.match(labels.content, /\| triage \| awaiting an initial decision \|/);
  assert.match(labels.content, /\| open \| the item is unresolved \|/);
  assert.match(labels.content, /\| closed \| the item is resolved \|/);
});

// --- SR-05: verifyProvenance is deterministic across repeated calls -------

test('verifyProvenance yields byte-identical intermediate renders across repeated calls', () => {
  // With a module-level sentinel counter, calling verifyProvenance twice with
  // the same input would produce different intermediate sentinelled renders
  // and could disagree on flag positions. With a call-local counter, both
  // calls return an identical result object.
  const context = PROVIDER_CONTEXTS.github;
  const artifacts = renderArtifacts(context);
  const first = verifyProvenance(artifacts, context);
  const second = verifyProvenance(artifacts, context);
  assert.deepEqual(first, second);
  const third = verifyProvenance(artifacts, context);
  assert.deepEqual(first, third);
});

test('verifyProvenance detects one known-dangerous literal from FORBIDDEN_LITERALS if injected', () => {
  const context = PROVIDER_CONTEXTS.github;
  const artifacts = renderArtifacts(context).map((entry) => (
    entry.path.endsWith('triage-labels.md')
      ? { ...entry, content: `${entry.content}\n<!-- planted: gitlab.com -->\n` }
      : entry
  ));
  const result = verifyProvenance(artifacts, context);
  assert.equal(result.ok, false);
});

// --- SR-08: consumer-perspective regression for backlog-publish contract --

test('a consumer-owned reader resolves every adapter-contract field from the rendered bytes alone', () => {
  // This test speaks for a hypothetical `backlog-publish` consumer that will
  // exist in issue #117 but is not in this repository yet. It reads the
  // rendered `issue-tracker.md` text and parses it with its OWN independent
  // reader written here, importing nothing from context-artifacts.mjs except
  // the published contract constant. Every field a downstream adapter needs
  // must be resolvable for all four provider classes without inference.
  const consumerReader = (renderedContent) => {
    const lines = renderedContent.split('\n');
    let inBlock = false;
    const fields = new Map();
    for (const line of lines) {
      if (line === '```tracker-adapter-v1') {
        inBlock = true;
        continue;
      }
      if (inBlock && line === '```') {
        inBlock = false;
        continue;
      }
      if (!inBlock || line.trim() === '') {
        continue;
      }
      const match = /^([a-z][a-z0-9-]*) = (.*)$/.exec(line);
      if (!match) {
        throw new Error(`consumer reader cannot parse line: ${line}`);
      }
      fields.set(match[1], JSON.parse(match[2]));
    }
    return fields;
  };

  for (const [provider, context] of Object.entries(PROVIDER_CONTEXTS)) {
    const issueTracker = renderArtifacts(context)
      .find((entry) => entry.path.endsWith('issue-tracker.md'));
    const resolved = consumerReader(issueTracker.content);

    for (const field of TRACKER_ADAPTER_CONTRACT) {
      assert.ok(resolved.has(field), `${provider}: consumer must resolve ${field} from bytes`);
      const value = resolved.get(field);
      // The consumer treats null as "not applicable" only for `project` on
      // non-project providers. Every other field must have a concrete value.
      if (field === 'project') {
        if (provider === 'azure-devops') {
          assert.equal(typeof value, 'string');
          assert.ok(value.length > 0, `${provider}: azure-devops resolves project`);
        } else {
          assert.equal(value, null, `${provider}: non-project provider resolves project to null`);
        }
        continue;
      }
      if (field === 'label-vocabulary' || field === 'state-vocabulary') {
        assert.ok(Array.isArray(value) && value.length > 0, `${provider}: ${field} is non-empty`);
        for (const entry of value) {
          assert.equal(typeof entry.name, 'string');
          assert.equal(typeof entry.meaning, 'string');
        }
        continue;
      }
      if (['item-types', 'tracker-operations', 'relationship-kinds', 'mutation-vocabulary'].includes(field)) {
        assert.ok(Array.isArray(value) && value.length > 0, `${provider}: ${field} is non-empty`);
        continue;
      }
      assert.equal(typeof value, 'string', `${provider}: ${field} is a string`);
      assert.ok(value.length > 0, `${provider}: ${field} is non-empty`);
    }
  }
});

test('removing any adapter-contract field from the render makes the consumer reader fail', () => {
  const context = PROVIDER_CONTEXTS.github;
  const issueTracker = renderArtifacts(context)
    .find((entry) => entry.path.endsWith('issue-tracker.md')).content;

  const consumerReader = (rendered) => {
    const lines = rendered.split('\n');
    let inBlock = false;
    const fields = new Map();
    for (const line of lines) {
      if (line === '```tracker-adapter-v1') { inBlock = true; continue; }
      if (inBlock && line === '```') { inBlock = false; continue; }
      if (!inBlock || line.trim() === '') { continue; }
      const match = /^([a-z][a-z0-9-]*) = (.*)$/.exec(line);
      if (!match) throw new Error(`unreadable line: ${line}`);
      fields.set(match[1], JSON.parse(match[2]));
    }
    return fields;
  };

  for (const field of TRACKER_ADAPTER_CONTRACT) {
    const stripped = issueTracker
      .split('\n')
      .filter((line) => !line.startsWith(`${field} = `))
      .join('\n');
    const resolved = consumerReader(stripped);
    assert.equal(resolved.has(field), false, `${field} removal must make the consumer unable to resolve it`);
  }
});

// --- SR-09: absolute, drive-qualified, UNC, escaping, and NUL target paths -

test('validateTargetDirectory refuses absolute, drive-qualified, UNC, escaping, and NUL paths', () => {
  for (const bad of [
    '/agent/context',
    '/x',
    'C:\\x',
    'C:/x',
    'c:\\x',
    '\\\\server\\share\\x',
    '//server/share/x',
    '../x',
    '../../x',
    'ok/../../../escape',
    'has\u0000nul',
  ]) {
    assert.throws(
      () => validateTargetDirectory(bad),
      (error) => error instanceof ContextArtifactsError && error.code === 'unsafe-target',
      `must refuse ${JSON.stringify(bad)}`,
    );
  }
});

test('validateTargetDirectory normalizes a valid contained path', () => {
  assert.equal(validateTargetDirectory('.agent/context'), '.agent/context');
  assert.equal(validateTargetDirectory('agent/context'), 'agent/context');
  assert.equal(validateTargetDirectory('./agent/context/'), 'agent/context');
  // Mixed separators pass so long as they do not escape or become absolute.
  assert.equal(validateTargetDirectory('agent\\context'), 'agent/context');
});

test('renderArtifacts refuses a rendering with an unsafe targetDirectory', () => {
  const bad = {
    ...PROVIDER_CONTEXTS.github,
    targetDirectory: '/agent/context',
  };
  assert.throws(
    () => renderArtifacts(bad),
    (error) => error instanceof ContextArtifactsError && error.code === 'unsafe-target',
  );
});

// --- R2-06: renderArtifacts itself enforces the adapter-contract check.
// The provenance check is a public helper for validating FOREIGN bytes and
// is deliberately not invoked from inside `renderArtifacts`, so there is no
// wiring test for it here.

test('R2-06: renderArtifacts itself refuses when the adapter contract is unsatisfied', () => {
  // A github context whose `itemTypes` is an empty array parses back
  // cleanly (round-trip succeeds because [] parses to []), but the adapter
  // contract requires `item-types` non-empty. `renderArtifacts` must refuse
  // through `verifyAdapterContract` rather than by round-trip alone — the
  // test never touches the helper itself.
  const context = {
    ...PROVIDER_CONTEXTS.github,
    itemTypes: [],
  };
  assert.throws(
    () => renderArtifacts(context),
    (error) => error instanceof ContextArtifactsError
      && error.code === 'contract-unsatisfied'
      && /item-types/.test(error.message),
  );
});

// --- F-2: requireContext refuses an unresolved label or state entry --------

test('renderArtifacts refuses a context whose label carries meaning: null', () => {
  // The upstream normalizer preserves a malformed entry in place with an
  // explicit `meaning: null` so idempotence holds and the unresolved state
  // survives every later pass. Rendering such a context would emit
  // `"meaning":"null"` in the fenced block and a `| bug | null |` row in
  // the display table — an unsettled context rendered as if it were
  // settled. `requireContext` refuses instead.
  const unresolved = {
    ...PROVIDER_CONTEXTS.github,
    labels: [{ name: 'bug', meaning: null }],
  };
  assert.throws(
    () => renderArtifacts(unresolved),
    (error) => error instanceof ContextArtifactsError
      && error.code === 'usage'
      && /labels\[0\]\.meaning/.test(error.message),
  );
});

test('renderArtifacts refuses a context whose state carries name: null', () => {
  const unresolved = {
    ...PROVIDER_CONTEXTS.github,
    states: [{ name: null, meaning: 'unresolved' }],
  };
  assert.throws(
    () => renderArtifacts(unresolved),
    (error) => error instanceof ContextArtifactsError
      && error.code === 'usage'
      && /states\[0\]\.name/.test(error.message),
  );
});

test('every provider fixture renders bytes that never carry the "null" sentinel through a labels or states row', () => {
  // Even after F-2's refusal, prove BEHAVIOURALLY that no rendered artifact
  // for any provider fixture ever contains the byte sequences an unresolved
  // context would have produced. This is the positive proof: the substrings
  // `| null |` in a display table and `"meaning":"null"` or `"name":"null"`
  // in the fenced block never appear in production renders.
  for (const [provider, context] of Object.entries(PROVIDER_CONTEXTS)) {
    for (const entry of renderArtifacts(context)) {
      assert.equal(
        entry.content.includes('| null |'),
        false,
        `${provider} ${entry.path} must not emit "| null |" in any table row`,
      );
      assert.equal(
        entry.content.includes('"meaning":"null"'),
        false,
        `${provider} ${entry.path} must not emit "meaning":"null" in any fenced block`,
      );
      assert.equal(
        entry.content.includes('"name":"null"'),
        false,
        `${provider} ${entry.path} must not emit "name":"null" in any fenced block`,
      );
    }
  }
});
