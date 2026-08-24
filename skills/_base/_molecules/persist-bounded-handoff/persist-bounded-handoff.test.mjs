import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadIdentifierConfig } from '../../_atoms/redact-sensitive/redact-sensitive.config.mjs';
import {
  DEFAULT_CHILD_DIRECTORY,
  HandoffError,
  HEADING_ORDER,
  PLACEHOLDER,
  SCHEMA_VERSION,
  checkArtifactReferences,
  normalizePayload,
  persistBoundedHandoff,
  probeResponse,
  redactText,
  renderHandoff,
  resolveHandoffPath,
  resolveTempDirectory,
  slugify,
  utcStamp,
  writeGuarded,
} from './persist-bounded-handoff.mjs';
import {
  ATOMS,
  MOLECULE_ENTRY,
  completePayload,
  headingsOf,
  sandbox,
  sandboxEnvironment,
} from './persist-bounded-handoff.fixtures.mjs';

test('the renderer emits every required heading in the approved order', () => {
  const { document, headings } = renderHandoff(normalizePayload(completePayload()));
  assert.equal(document.split('\n')[0], '# Handoff');
  assert.deepEqual(
    headings,
    HEADING_ORDER.filter((heading) => heading !== 'Suggested Skills'),
  );
  assert.deepEqual(headingsOf(document), headings);
  assert.ok(document.endsWith('\n'));
  assert.ok(!document.endsWith('\n\n'));
});

test('the pickup-compatible five keep their relative order', () => {
  const { headings } = renderHandoff(normalizePayload(completePayload()));
  const pickup = ['Goal', 'Current Progress', 'What Worked', "What Didn't Work", 'Next Steps'];
  assert.deepEqual(headings.filter((heading) => pickup.includes(heading)), pickup);
});

test('Suggested Skills is omitted when no skill follows and placed before Next Steps when it does', () => {
  const without = renderHandoff(normalizePayload(completePayload()));
  assert.ok(!without.headings.includes('Suggested Skills'));
  assert.ok(!without.document.includes('Suggested Skills'));

  for (const empty of [undefined, null, []]) {
    const rendered = renderHandoff(normalizePayload(completePayload({ suggested_skills: empty })));
    assert.ok(!rendered.headings.includes('Suggested Skills'));
  }

  const withSkills = renderHandoff(normalizePayload(completePayload({
    suggested_skills: [{ skill: 'shepherd', reason: 'The pull request still needs monitoring.' }],
    available_skills: ['shepherd'],
  })));
  assert.deepEqual(withSkills.headings, HEADING_ORDER);
  assert.ok(withSkills.document.includes('- shepherd - The pull request still needs monitoring.'));
  assert.ok(
    withSkills.document.indexOf('## Suggested Skills')
      < withSkills.document.indexOf('## Next Steps'),
  );
});

test('a required section with nothing confirmed renders the placeholder rather than disappearing', () => {
  const { document, headings } = renderHandoff(normalizePayload(completePayload({
    what_did_not_work: '',
    artifacts_and_references: [],
  })));
  assert.deepEqual(
    headings,
    HEADING_ORDER.filter((heading) => heading !== 'Suggested Skills'),
  );
  assert.ok(document.includes(`## What Didn't Work\n\n${PLACEHOLDER}`));
  assert.ok(document.includes(`## Artifacts and References\n\n${PLACEHOLDER}`));
});

test('artifact references are retained, with and without a note', () => {
  const { document } = renderHandoff(normalizePayload(completePayload()));
  assert.ok(document.includes('- https://github.com/jdylanmc/skills/issues/43 - The issue'));
  assert.ok(
    document.includes('- docs/adr/0001-use-local-units-and-promote-proven-shared-units.md\n'),
  );

  const checked = checkArtifactReferences({
    references: ['#43', { reference: '62e8cbc', note: 'baseline' }],
    bodies: { current_progress: 'A short command:\n\n```text\nnode --test\n```' },
  });
  assert.deepEqual(checked.references, [
    { reference: '#43', note: '' },
    { reference: '62e8cbc', note: 'baseline' },
  ]);
  assert.deepEqual(checked.bodies_checked, ['current_progress']);
});

test('redaction replaces each category with a visible marker and is idempotent', () => {
  const cases = [
    ['postgres://user:password@database.example/app', 'connection-string'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIB\n-----END RSA PRIVATE KEY-----', 'private-key'],
    ['Authorization: Bearer abcdefghijklmnop', 'credential'],
    ['token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'token'],
    ['client_secret=Sup3rSecretValue', 'secret'],
    ['reach me at dylan.mccurry@contoso.example', 'email'],
    ['call +1 (415) 555-1234 today', 'phone'],
  ];
  for (const [input, category] of cases) {
    const once = redactText(input);
    assert.ok(once.text.includes(`[REDACTED:${category}]`), `${category} was not marked`);
    assert.deepEqual(once.redactions, [{ category, count: 1 }]);

    const twice = redactText(once.text);
    assert.equal(twice.text, once.text, `${category} redaction is not idempotent`);
    assert.deepEqual(twice.redactions, []);
  }
});

test('redaction leaves ordinary engineering evidence alone', () => {
  const evidence = [
    'Baseline commit 62e8cbc7b951e51338426d96f6156250f78f6ee5.',
    'See https://github.com/jdylanmc/skills/pull/50 and issue #43.',
    'Version 1.0.81-3 on ports 8080-8090, released 2026-08-22.',
    'Run `node --test scripts/conformance.test.mjs`.',
  ];
  for (const line of evidence) {
    assert.equal(redactText(line).text, line, `redaction damaged: ${line}`);
  }
});

test('the destination is the runtime temporary directory with exactly one handoffs child', (t) => {
  const root = sandbox(t, 'handoff-path');
  assert.equal(fs.realpathSync(os.tmpdir()), root);

  const directory = resolveTempDirectory();
  assert.equal(directory, path.join(root, DEFAULT_CHILD_DIRECTORY));
  assert.ok(fs.statSync(directory).isDirectory());
  assert.deepEqual(fs.readdirSync(root), [DEFAULT_CHILD_DIRECTORY]);

  const now = new Date('2026-08-22T12:34:56.789Z');
  const resolved = resolveHandoffPath({ slug: 'skills-issue-43', now });
  assert.equal(resolved.directory, directory);
  assert.equal(resolved.name, 'skills-issue-43-20260822T123456Z.md');
  assert.equal(resolved.attempt, 1);
  assert.equal(utcStamp(now), '20260822T123456Z');
  assert.equal(path.dirname(resolved.path), directory);
});

test('a guarded write creates the file, rereads it, and reports its size', (t) => {
  const root = sandbox(t, 'handoff-write');
  const directory = resolveTempDirectory();
  const destination = path.join(directory, 'example-20260822T000000Z.md');
  const content = '# Handoff\n\n## Goal\n\nShip it.\n';

  const written = writeGuarded({ destination, allowedRoot: directory, content });
  assert.equal(written.path, destination);
  assert.equal(written.bytes, Buffer.byteLength(content, 'utf8'));
  assert.equal(fs.readFileSync(destination, 'utf8'), content);
  assert.ok(fs.lstatSync(destination).isFile());
  assert.equal(path.relative(root, written.path), path.join('handoffs', 'example-20260822T000000Z.md'));
});

test('the composed operation writes one verified handoff and returns its exact path', (t) => {
  const root = sandbox(t, 'handoff-persist');
  const result = persistBoundedHandoff(completePayload(), {
    now: new Date('2026-08-22T01:02:03Z'),
  });

  assert.equal(result.path, path.join(root, 'handoffs', 'skills-issue-43-20260822T010203Z.md'));
  assert.equal(result.name, 'skills-issue-43-20260822T010203Z.md');
  assert.equal(result.suggested_skills_included, false);
  assert.deepEqual(result.redactions, []);

  const written = fs.readFileSync(result.path, 'utf8');
  assert.equal(Buffer.byteLength(written, 'utf8'), result.bytes);
  assert.deepEqual(headingsOf(written), result.headings);
  assert.equal(written, renderHandoff(normalizePayload(completePayload())).document);
});

test('sensitive content never reaches the written document', (t) => {
  sandbox(t, 'handoff-redacted');
  const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  const result = persistBoundedHandoff(completePayload({
    current_progress: `Rotated ${secret} after the leak.`,
    what_worked: 'Paged the owner at oncall@contoso.example.',
  }));

  const written = fs.readFileSync(result.path, 'utf8');
  assert.ok(!written.includes(secret));
  assert.ok(!written.includes('oncall@contoso.example'));
  assert.ok(written.includes('[REDACTED:token]'));
  assert.ok(written.includes('[REDACTED:email]'));
  assert.deepEqual(
    result.redactions,
    [{ category: 'email', count: 1 }, { category: 'token', count: 1 }],
  );
});

test('configured identifiers are redacted in persisted fields and after rendering', (t) => {
  sandbox(t, 'handoff-configured-redaction');
  const identifier = ['Private', 'System'].join(' ');
  const configuration = loadIdentifierConfig({
    json: JSON.stringify({
      version: 1,
      identifiers: [{ value: identifier, evidenceType: 'internal-system' }],
    }),
  });
  const result = persistBoundedHandoff(completePayload({
    title: `Transfer ${identifier}`,
    goal: `Escalate ${identifier}.`,
    artifacts_and_references: [{
      reference: 'https://example.invalid/private',
      note: 'system',
    }],
  }), {
    identifiers: configuration.identifiers,
  });

  const written = fs.readFileSync(result.path, 'utf8');
  assert.equal(written.toLocaleLowerCase().includes('private system'), false);
  assert.equal(written.includes('[REDACTED:internal-system]'), true);
  assert.deepEqual(result.redactions, [{ category: 'internal-system', count: 3 }]);
});

test('slugify normalizes a repository or work name into a usable slug', () => {
  assert.equal(slugify('Acme.Widgets.StoreApp'), 'acme-widgets-storeapp');
  assert.equal(slugify('  users/dylanmccurry/fix-queue  '), 'users-dylanmccurry-fix-queue');
  assert.equal(slugify('A'.repeat(200)).length, 64);
  assert.throws(() => slugify('///'), (error) => error instanceof HandoffError && error.code === 'malformed_payload');
});

test('a raw repository or work name is accepted as slug_source and normalized here', (t) => {
  const root = sandbox(t, 'handoff-slug-source');
  for (const [source, expected] of [
    ['Acme.Widgets', 'acme-widgets'],
    ['Ship_With_Squadron', 'ship-with-squadron'],
    ['users/dylanmccurry/fix-queue', 'users-dylanmccurry-fix-queue'],
  ]) {
    assert.equal(normalizePayload(completePayload({ slug: undefined, slug_source: source })).slug, expected);
  }

  const result = persistBoundedHandoff(
    completePayload({ slug: undefined, slug_source: 'Acme.Widgets' }),
    { now: new Date('2026-08-22T07:08:09Z') },
  );
  assert.equal(result.name, 'acme-widgets-20260822T070809Z.md');
  assert.equal(path.dirname(result.path), path.join(root, 'handoffs'));

  // The two forms are alternatives, not a fallback chain.
  assert.throws(
    () => normalizePayload(completePayload({ slug_source: 'Acme.Widgets' })),
    (error) => error instanceof HandoffError && error.code === 'malformed_payload',
  );
  assert.equal(
    resolveHandoffPath({ slugSource: 'Acme.Widgets', now: new Date('2026-08-22T07:08:09Z') }).name,
    'acme-widgets-20260822T070809Z-01.md',
  );
});

test('a payload may declare the schema version it was written against', () => {
  assert.equal(normalizePayload(completePayload()).schema_version, SCHEMA_VERSION);
  assert.equal(
    normalizePayload(completePayload({ schema_version: SCHEMA_VERSION })).schema_version,
    SCHEMA_VERSION,
  );
  assert.throws(
    () => normalizePayload(completePayload({ schema_version: SCHEMA_VERSION + 1 })),
    (error) => error instanceof HandoffError && error.code === 'malformed_payload',
  );
});

test('the molecule entry point persists a handoff supplied on standard input', (t) => {
  const root = sandbox(t, 'handoff-cli');
  const stdout = execFileSync(process.execPath, [MOLECULE_ENTRY, '--stdin'], {
    input: JSON.stringify(completePayload()),
    env: sandboxEnvironment(root),
    encoding: 'utf8',
  });
  const result = JSON.parse(stdout);
  assert.equal(path.dirname(result.path), path.join(root, 'handoffs'));
  assert.ok(fs.readFileSync(result.path, 'utf8').startsWith('# Handoff\n'));

  const probe = execFileSync(process.execPath, [MOLECULE_ENTRY, '--probe'], {
    env: sandboxEnvironment(root),
    encoding: 'utf8',
  });
  assert.equal(probe.trim(), probeResponse('persist-bounded-handoff'));
});

test('every atom entry point is available and performs its own step', (t) => {
  const root = sandbox(t, 'handoff-atoms');
  const environment = sandboxEnvironment(root);
  const entry = (name) => path.join(ATOMS, name, `${name}.mjs`);
  const run = (name, args, input) => execFileSync(process.execPath, [entry(name), ...args], {
    input,
    env: environment,
    encoding: 'utf8',
  });

  // Each unit answers with its own name. A shared `handoff: available` would
  // tie generic atoms to a caller they know nothing about.
  for (const name of [
    'artifact-reference',
    'handoff-render',
    'redact-sensitive',
    'temp-path-resolve',
    'write-guarded',
  ]) {
    assert.equal(run(name, ['--probe']).trim(), probeResponse(name), `${name} is not probeable`);
  }

  const redacted = JSON.parse(run('redact-sensitive', ['--stdin'], 'api_key=Sup3rSecretValue'));
  assert.equal(redacted.text, 'api_key=[REDACTED:secret]');

  const references = JSON.parse(
    run('artifact-reference', ['--stdin'], JSON.stringify({ references: ['#43'] })),
  );
  assert.deepEqual(references.references, [{ reference: '#43', note: '' }]);

  const document = run('handoff-render', ['--stdin'], JSON.stringify(completePayload()));
  assert.equal(document, renderHandoff(normalizePayload(completePayload())).document);

  const resolved = JSON.parse(run('temp-path-resolve', ['--slug', 'skills-issue-43']));
  assert.equal(resolved.directory, path.join(root, 'handoffs'));

  const written = JSON.parse(run(
    'write-guarded',
    ['--destination', resolved.path, '--allowed-root', resolved.directory, '--stdin'],
    document,
  ));
  assert.equal(written.path, resolved.path);
  assert.equal(fs.readFileSync(resolved.path, 'utf8'), document);
});
