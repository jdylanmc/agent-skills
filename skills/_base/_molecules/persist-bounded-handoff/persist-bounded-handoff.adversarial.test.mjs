import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { closureFor, validateRepository } from '../../../../scripts/validate-skill-graph.mjs';
import {
  MAX_ARTIFACTS,
  MAX_DOCUMENT_BYTES,
  MAX_INPUT_BYTES,
  MAX_NAME_ATTEMPTS,
  MAX_REDACT_BYTES,
  MAX_SECTION_BYTES,
  MAX_SUGGESTED_SKILLS,
  TARGET_EXISTS,
  checkArtifactReferences,
  documentHeadings,
  namesSecret,
  normalizePayload,
  persistBoundedHandoff,
  redactText,
  renderHandoff,
  resolveHandoffPath,
  resolveTempDirectory,
  writeGuarded,
} from './persist-bounded-handoff.mjs';
import {
  ATOMS,
  MOLECULE_ENTRY,
  REPOSITORY_ROOT,
  completePayload,
  failureOf,
  sandbox,
  sandboxEnvironment,
  trySymlink,
} from './persist-bounded-handoff.fixtures.mjs';

const MOLECULE = '_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md';
const ATOM_UNITS = [
  '_base/_atoms/artifact-reference/artifact-reference.md',
  '_base/_atoms/handoff-render/handoff-render.md',
  '_base/_atoms/redact-sensitive/redact-sensitive.md',
  '_base/_atoms/temp-path-resolve/temp-path-resolve.md',
  '_base/_atoms/write-guarded/write-guarded.md',
];

/**
 * Reads a committed unit document with line endings normalized. A Windows
 * checkout stores these files with carriage returns, so a contract assertion
 * that spans a line break has to compare normalized text or it only ever
 * passes on the platform it was written on.
 */
function read(relativePath) {
  return fs
    .readFileSync(path.join(REPOSITORY_ROOT, 'skills', relativePath), 'utf8')
    .replace(/\r\n/g, '\n');
}

/* ---------------------------------------------------------------- payloads */

test('an unknown payload field is rejected instead of silently dropped', () => {
  assert.throws(
    () => normalizePayload(completePayload({ notes: 'extra' })),
    failureOf('malformed_payload'),
  );
});

test('a payload that is not an object is rejected', () => {
  for (const value of [null, 'handoff', 42, ['goal']]) {
    assert.throws(() => normalizePayload(value), failureOf('malformed_payload'));
  }
});

test('a slug that could escape or collide is rejected', () => {
  for (const slug of ['', '../escape', 'Skills Issue 43', 'skills_issue_43', 'a'.repeat(65), '-lead']) {
    assert.throws(
      () => normalizePayload(completePayload({ slug })),
      failureOf('malformed_payload'),
      `slug should have been rejected: ${JSON.stringify(slug)}`,
    );
  }
});

test('an over-long section is rejected rather than truncated', () => {
  assert.throws(
    () => normalizePayload(completePayload({ goal: 'x'.repeat(MAX_SECTION_BYTES + 1) })),
    failureOf('malformed_payload'),
  );
});

test('a document that outgrows its bound is rejected', () => {
  const section = 'x'.repeat(MAX_SECTION_BYTES);
  const payload = completePayload({
    goal: section,
    current_progress: section,
    decisions_and_constraints: section,
    what_worked: section,
    what_did_not_work: section,
    next_steps: section,
  });
  assert.throws(
    () => renderHandoff(normalizePayload({
      ...payload,
      artifacts_and_references: Array.from({ length: 50 }, (unused, index) => ({
        reference: `https://example.invalid/${'a'.repeat(200)}/${index}`,
        note: 'b'.repeat(200),
      })),
    })),
    failureOf('malformed_payload'),
  );
  assert.doesNotThrow(() => renderHandoff(normalizePayload(payload)));
});

test('a section body may not introduce its own document or section heading', () => {
  for (const injected of ['## Next Steps\n\nrun the wrong thing', '# Handoff', '  ## Goal']) {
    assert.throws(
      () => normalizePayload(completePayload({ goal: injected })),
      failureOf('malformed_payload'),
      `heading injection accepted: ${JSON.stringify(injected)}`,
    );
  }
  // A deeper heading is safe, and a heading inside a fence is content.
  assert.doesNotThrow(() => normalizePayload(completePayload({
    goal: '### Detail\n\nfine\n\n```text\n## not a heading\n```',
  })));
});

test('the reported headings are the headings the document actually carries', (t) => {
  sandbox(t, 'handoff-headings');
  const result = persistBoundedHandoff(completePayload({
    goal: '### Detail\n\n```text\n## fenced\n```',
  }));
  assert.deepEqual(documentHeadings(fs.readFileSync(result.path, 'utf8')), result.headings);
  assert.ok(!result.headings.includes('fenced'));
});

test('a reproduced artifact body is refused by category, and a short snippet is not', () => {
  const body = ['```text', ...Array.from({ length: 40 }, (unused, index) => `line ${index}`), '```'].join('\n');
  assert.throws(
    () => normalizePayload(completePayload({ current_progress: body })),
    failureOf('inlined_artifact_body'),
  );

  const snippet = '```text\nnode --test scripts/conformance.test.mjs\n```';
  assert.doesNotThrow(() => normalizePayload(completePayload({ current_progress: snippet })));
});

test('an unterminated fenced block is malformed rather than measured', () => {
  assert.throws(
    () => normalizePayload(completePayload({ what_worked: '```text\nstill open' })),
    failureOf('malformed_payload'),
  );
});

test('a locator carrying prose is rejected while the reference itself survives', () => {
  assert.throws(
    () => normalizePayload(completePayload({
      artifacts_and_references: ['see https://example.invalid/spec for detail'],
    })),
    failureOf('malformed_payload'),
  );
  const kept = normalizePayload(completePayload({
    artifacts_and_references: [{ reference: 'https://example.invalid/spec', note: 'see for detail' }],
  }));
  assert.deepEqual(kept.artifacts_and_references, [
    { reference: 'https://example.invalid/spec', note: 'see for detail' },
  ]);
});

test('a suggested skill without a reason, or outside the caller\'s skills, never reaches the document', () => {
  assert.throws(
    () => normalizePayload(completePayload({ suggested_skills: [{ skill: 'shepherd' }] })),
    failureOf('malformed_payload'),
  );
  assert.throws(
    () => normalizePayload(completePayload({
      suggested_skills: [{ skill: 'shepherd', reason: 'monitor the pull request' }],
      available_skills: ['spec', 'discovery'],
    })),
    failureOf('unknown_skill'),
  );
  assert.doesNotThrow(() => normalizePayload(completePayload({
    suggested_skills: [{ skill: 'shepherd', reason: 'monitor the pull request' }],
    available_skills: ['shepherd'],
  })));
});

test('a title or skill identifier that trips a redaction rule is handled, not left to fail late', (t) => {
  sandbox(t, 'handoff-title');
  const titled = persistBoundedHandoff(completePayload({ title: 'Fix 415 555 1234 rollout' }));
  const written = fs.readFileSync(titled.path, 'utf8');
  assert.ok(written.startsWith('# Fix [REDACTED:phone] rollout\n'));
  assert.ok(titled.redactions.some((entry) => entry.category === 'phone'));

  assert.throws(
    () => normalizePayload(completePayload({
      suggested_skills: [{ skill: 'sk-abcdefghijklmnop', reason: 'looks like a key' }],
    })),
    failureOf('malformed_payload'),
  );
});

/* -------------------------------------------------------------- collisions */

test('two handoffs in the same second do not overwrite each other', (t) => {
  sandbox(t, 'handoff-collision');
  const now = new Date('2026-08-22T03:04:05Z');
  const first = persistBoundedHandoff(completePayload(), { now });
  const second = persistBoundedHandoff(completePayload({ goal: 'A later run.' }), { now });

  assert.notEqual(first.path, second.path);
  assert.equal(first.name, 'skills-issue-43-20260822T030405Z.md');
  assert.equal(second.name, 'skills-issue-43-20260822T030405Z-01.md');
  assert.ok(fs.readFileSync(first.path, 'utf8').includes('Establish the shared bounded-handoff core.'));
  assert.ok(fs.readFileSync(second.path, 'utf8').includes('A later run.'));
});

test('an exhausted name space fails loudly instead of overwriting the first handoff', (t) => {
  sandbox(t, 'handoff-exhausted');
  const directory = resolveTempDirectory();
  const now = new Date('2026-08-22T06:07:08Z');
  const stamp = '20260822T060708Z';
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${String(attempt).padStart(2, '0')}`;
    fs.writeFileSync(path.join(directory, `taken-${stamp}${suffix}.md`), 'occupied');
  }
  assert.throws(
    () => resolveHandoffPath({ slug: 'taken', now }),
    failureOf('name_exhausted'),
  );
  assert.equal(fs.readFileSync(path.join(directory, `taken-${stamp}.md`), 'utf8'), 'occupied');
});

/* ------------------------------------------------------------ path safety */

test('a destination outside the allowed root is refused and nothing is created', (t) => {
  const root = sandbox(t, 'handoff-escape');
  const directory = resolveTempDirectory();
  const outside = path.join(root, 'outside.md');

  assert.throws(
    () => writeGuarded({ destination: outside, allowedRoot: directory, content: 'x' }),
    failureOf('path_escape'),
  );
  assert.throws(
    () => writeGuarded({
      destination: path.join(directory, '..', 'traversed.md'),
      allowedRoot: directory,
      content: 'x',
    }),
    failureOf('path_escape'),
  );
  assert.throws(
    () => writeGuarded({
      destination: path.join(directory, 'nested', 'deep.md'),
      allowedRoot: directory,
      content: 'x',
    }),
    (error) => ['path_escape', 'unsafe_target'].includes(error.code),
  );
  assert.deepEqual(fs.readdirSync(directory), []);
  assert.ok(!fs.existsSync(outside));
});

test('a relative destination or allowed root is refused', (t) => {
  sandbox(t, 'handoff-relative');
  const directory = resolveTempDirectory();
  assert.throws(
    () => writeGuarded({ destination: 'relative.md', allowedRoot: directory, content: 'x' }),
    failureOf('malformed_payload'),
  );
  assert.throws(
    () => writeGuarded({
      destination: path.join(directory, 'a.md'),
      allowedRoot: 'handoffs',
      content: 'x',
    }),
    failureOf('malformed_payload'),
  );
});

test('a symbolic link at the destination is refused and its target is untouched', (t) => {
  const root = sandbox(t, 'handoff-symlink');
  const directory = resolveTempDirectory();
  const victim = path.join(root, 'victim.md');
  fs.writeFileSync(victim, 'original');
  const link = path.join(directory, 'link.md');
  if (!trySymlink(victim, link, 'file')) {
    t.skip('symbolic links are unavailable on this platform');
    return;
  }

  assert.throws(
    () => writeGuarded({ destination: link, allowedRoot: directory, content: 'replaced' }),
    failureOf('unsafe_target'),
  );
  assert.equal(fs.readFileSync(victim, 'utf8'), 'original');
});

test('a symbolic-link parent is refused even when it resolves inside the root', (t) => {
  const root = sandbox(t, 'handoff-symlink-parent');
  const directory = resolveTempDirectory();
  const alias = path.join(root, 'alias');
  if (!trySymlink(directory, alias, 'dir')) {
    t.skip('symbolic links are unavailable on this platform');
    return;
  }

  assert.throws(
    () => writeGuarded({
      destination: path.join(alias, 'through-link.md'),
      allowedRoot: directory,
      content: 'x',
    }),
    failureOf('unsafe_target'),
  );
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('a non-regular or already-present destination is refused', (t) => {
  sandbox(t, 'handoff-nonregular');
  const directory = resolveTempDirectory();

  const asDirectory = path.join(directory, 'directory.md');
  fs.mkdirSync(asDirectory);
  assert.throws(
    () => writeGuarded({ destination: asDirectory, allowedRoot: directory, content: 'x' }),
    (error) => error.code === 'unsafe_target' && error.reason !== TARGET_EXISTS,
  );
  assert.ok(fs.statSync(asDirectory).isDirectory());

  const existing = path.join(directory, 'existing.md');
  fs.writeFileSync(existing, 'earlier handoff');
  assert.throws(
    () => writeGuarded({ destination: existing, allowedRoot: directory, content: 'later' }),
    // The composed operation retries exactly this reason and nothing else, so
    // the two must stay coupled by a value rather than by a message.
    (error) => error.code === 'unsafe_target' && error.reason === TARGET_EXISTS,
  );
  assert.equal(fs.readFileSync(existing, 'utf8'), 'earlier handoff');
});

test('the renderer refuses a payload that never went through validation', () => {
  assert.throws(() => renderHandoff(completePayload()), failureOf('malformed_payload'));
  assert.throws(() => renderHandoff(null), failureOf('malformed_payload'));
});

test('a handoffs child that is not a real directory stops the write', (t) => {
  const root = sandbox(t, 'handoff-unsafe-child');
  fs.writeFileSync(path.join(root, 'handoffs'), 'not a directory');
  assert.throws(() => resolveTempDirectory(), failureOf('unsafe_temp_root'));
  assert.throws(() => persistBoundedHandoff(completePayload()), failureOf('unsafe_temp_root'));
});

test('a handoffs child that is a symbolic link is refused', (t) => {
  const root = sandbox(t, 'handoff-linked-child');
  const elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(elsewhere);
  if (!trySymlink(elsewhere, path.join(root, 'handoffs'), 'dir')) {
    t.skip('symbolic links are unavailable on this platform');
    return;
  }
  assert.throws(() => resolveTempDirectory(), failureOf('unsafe_temp_root'));
});

test('a handoffs child other users can write to is refused', (t) => {
  const root = sandbox(t, 'handoff-shared-child');
  if (typeof process.getuid !== 'function') {
    t.skip('POSIX ownership and permission bits are unavailable on this platform');
    return;
  }
  const child = path.join(root, 'handoffs');
  fs.mkdirSync(child, { mode: 0o777 });
  fs.chmodSync(child, 0o777);

  assert.throws(() => resolveTempDirectory(), failureOf('unsafe_temp_root'));
  assert.throws(() => persistBoundedHandoff(completePayload()), failureOf('unsafe_temp_root'));
  assert.deepEqual(fs.readdirSync(child), []);

  fs.chmodSync(child, 0o700);
  assert.equal(resolveTempDirectory(), child);
});

test('a child directory name that is a path is rejected before the file system is touched', (t) => {
  const root = sandbox(t, 'handoff-child-name');
  for (const child of ['../escape', 'handoffs/nested', '.', '..', '']) {
    assert.throws(() => resolveTempDirectory(child), failureOf('malformed_payload'));
  }
  assert.deepEqual(fs.readdirSync(root), []);
});

/* --------------------------------------------------------------- redaction */

test('a marker is never relabelled, re-bracketed, or nested by a later pass', () => {
  const seeded = 'Authorization: Bearer abcdefghijklmnop and api_key=Sup3rSecretValue';
  const once = redactText(seeded).text;
  assert.equal(once, 'Authorization: [REDACTED:credential] and api_key=[REDACTED:secret]');
  let text = once;
  for (let pass = 0; pass < 5; pass += 1) {
    const next = redactText(text);
    assert.equal(next.text, text);
    assert.deepEqual(next.redactions, []);
    text = next.text;
  }
});

test('redaction keeps the surrounding Markdown intact', () => {
  const link = 'See [the run](https://ci.example.invalid/r?sig=AbC123XyZ&job=42) for detail.';
  assert.equal(
    redactText(link).text,
    'See [the run](https://ci.example.invalid/r?sig=[REDACTED:secret]&job=42) for detail.',
  );
});

test('a persisted handoff is clean even when every field carries something sensitive', (t) => {
  sandbox(t, 'handoff-clean');
  const result = persistBoundedHandoff(completePayload({
    goal: 'Rotate ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345.',
    current_progress: 'Owner is dylan@contoso.example.',
    decisions_and_constraints: 'secret_key=Sup3rSecretValue must not ship.',
    what_worked: 'Paged +1 (415) 555-1234.',
    what_did_not_work: 'AKIAIOSFODNN7EXAMPLE stayed live.',
    next_steps: 'Revoke the key.',
    artifacts_and_references: [{ reference: 'https://example.invalid/x?token=Sup3rSecretValue', note: 'run' }],
  }));

  const written = fs.readFileSync(result.path, 'utf8');
  for (const secret of [
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    'dylan@contoso.example',
    'Sup3rSecretValue',
    '555-1234',
    'AKIAIOSFODNN7EXAMPLE',
  ]) {
    assert.ok(!written.includes(secret), `document still carries ${secret}`);
  }
  assert.equal(redactText(written).text, written);
});

test('every assignment shape the redaction contract claims is actually covered', () => {
  const covered = [
    'secret_key=Sup3rSecretValue',
    'signing_key=Sup3rSecretValue',
    'ssh_key=Sup3rSecretValue',
    'key=Sup3rSecretValue',
    'apiKey: Sup3rSecretValue',
    'AccountKey=Sup3rSecretValue',
    'connection_string="Server=x"',
    'PAT=Sup3rSecretValue',
  ];
  for (const line of covered) {
    assert.ok(
      redactText(line).text.includes('[REDACTED:secret]'),
      `assignment slipped through: ${line}`,
    );
  }

  const untouched = [
    'author=Dylan',
    'next_steps=three',
    'monkeys=12',
    'design: bounded',
  ];
  for (const line of untouched) {
    assert.equal(redactText(line).text, line, `over-redacted: ${line}`);
  }
});

test('a secret key is recognized however its words are joined', () => {
  const leaked = [
    'accessToken', 'authToken', 'signingKey', 'dbPassword', 'bearerToken',
    'sessionToken', 'npmToken', 'idToken', 'userPassword', 'clientKey',
    'sshKey', 'encryptionKey', 'masterKey', 'PGPASSWORD', 'ACCESS_TOKEN',
    'oauth2Token', 'AWSSECRETKEY',
  ];
  for (const key of leaked) {
    assert.ok(namesSecret(key), `key not recognized as a secret: ${key}`);
    assert.equal(
      redactText(`${key}=Sup3rSecretValue`).text,
      `${key}=[REDACTED:secret]`,
      `secret slipped through: ${key}`,
    );
  }

  // The short words are matched as whole words only. Recognizing `pat`,
  // `sig`, or `key` anywhere in a key would redact ordinary evidence.
  const ordinary = [
    'path', 'patch', 'pattern', 'pathway', 'author', 'authority', 'design',
    'assign', 'signal', 'sigma', 'keyboard', 'monkeys', 'turkey', 'next_steps',
  ];
  for (const key of ordinary) {
    assert.ok(!namesSecret(key), `ordinary key treated as a secret: ${key}`);
    assert.equal(redactText(`${key}=plain`).text, `${key}=plain`, `over-redacted: ${key}`);
  }
});

test('a marker beside a bracket or another marker is still inert', () => {
  const cases = [
    'secrets[dylan@contoso.example]',
    'keys[dylan@contoso.example]',
    'tokens[+1 (415) 555-1234]',
    'auth[dylan@contoso.example] and key[+1 (415) 555-1234]',
    'key: [REDACTED:secret]',
    'password=[REDACTED:email]',
    '[REDACTED:secret][REDACTED:email]',
    '[REDACTED:email][REDACTED:phone][REDACTED:secret]',
  ];
  for (const input of cases) {
    const once = redactText(input).text;
    assert.ok(
      !/\[REDACTED:[a-z-]*\[REDACTED/.test(once),
      `a marker was nested inside another: ${once}`,
    );
    for (let pass = 0; pass < 3; pass += 1) {
      const next = redactText(once);
      assert.equal(next.text, once, `redaction is not idempotent for ${JSON.stringify(input)}`);
      assert.deepEqual(next.redactions, []);
    }
  }

  // The sensitive span is still gone; idempotence is not achieved by giving up.
  assert.equal(redactText('secrets[dylan@contoso.example]').text, 'secrets[[REDACTED:email]]');
});

test('two addresses glued together are both removed on the first pass', () => {
  // Anchoring on the local part made the second address invisible until the
  // first had already been replaced: one pass leaked it, and the next pass
  // changed the text, which the composed operation reports as
  // `redaction_incomplete`. Both halves have to hold at once.
  const glued = [
    ['Owners: alice@corp.example_bob@corp.example', 'Owners: [REDACTED:email][REDACTED:email]'],
    ['a@b.example+c@d.example', '[REDACTED:email][REDACTED:email]'],
    // The first span is a well-formed address in its own right, so it goes
    // and what is left behind is a bare domain rather than an address.
    ['alice@corp.example.bob@corp.example', '[REDACTED:email]@corp.example'],
    // Here the first span's last label is too short to be a top-level domain,
    // so the scan advances by one `@` and finds the real address behind it.
    ['alice@corp.example.b@corp.example', 'alice@[REDACTED:email]'],
  ];
  for (const [input, expected] of glued) {
    const once = redactText(input);
    assert.equal(once.text, expected, `an address survived one pass: ${input}`);
    assert.equal(redactText(once.text).text, once.text, `not idempotent: ${input}`);
    assert.deepEqual(redactText(once.text).redactions, []);
  }

  // A domain whose last label cannot be a top-level domain must not consume
  // the real address behind it.
  assert.equal(
    redactText('alice@corp.example-bob@corp.example').text,
    'alice@[REDACTED:email]',
  );

  // Ordinary addresses, and the punctuation around them, are unchanged.
  assert.equal(
    redactText('Paged the owner at oncall@contoso.example.').text,
    'Paged the owner at [REDACTED:email].',
  );
  assert.equal(redactText('git@github.com:owner/repo').text, '[REDACTED:email]:owner/repo');
  for (const notAnAddress of ['@example.com', 'x@y', 'a @ b', 'build@2026']) {
    assert.equal(redactText(notAnAddress).text, notAnAddress, `over-redacted: ${notAnAddress}`);
  }
});

test('an assignment never crosses a line, so Markdown structure survives', () => {
  // A handoff is prose and lists. An indented line after `key:` is a nested
  // bullet or a wrapped sentence far more often than a wrapped value, and
  // pairing them replaces the bullet marker or the first word, destroys the
  // list, and claims a credential was removed from a line that never held one.
  // Worse, that result is a fixed point, so nothing downstream catches it.
  const structure = [
    '- Auth:\n  - uses Entra ID',
    '- Credentials:\n  - live in Key Vault, not in this document',
    '1. Secrets:\n   - live in Key Vault',
    'Ask Dana about the deploy key:\n  Rotation is owed in March.',
    'Run this to get the token:\n    curl https://host/x',
    'We compared the signature:\n  it matched the vendor copy',
    'We rotated the signing key:\nwe did it last week',
    'token:\n\n## Next Steps',
  ];
  for (const markdown of structure) {
    assert.equal(redactText(markdown).text, markdown, `Markdown was rewritten: ${markdown}`);
  }

  // The same-line forms a credential actually takes are still caught.
  for (const [input, expected] of [
    ['password: hunter2', 'password: [REDACTED:secret]'],
    ['password:hunter2', 'password:[REDACTED:secret]'],
    ['  api_key\t=\tSup3rSecretValue', '  api_key\t=\t[REDACTED:secret]'],
    ['- Config: api_key=Sup3rSecretValue', '- Config: api_key=[REDACTED:secret]'],
    // An outer key that names a secret takes the whole value with it.
    ['- Credentials: api_key=Sup3rSecretValue', '- Credentials: [REDACTED:secret]'],
  ]) {
    assert.equal(redactText(input).text, expected, `same-line assignment missed: ${input}`);
  }
});

test('a locator that ends in a separator is refused instead of failing after rendering', (t) => {
  sandbox(t, 'handoff-locator-separator');
  // `- <reference> - <note>` glues the two fields, so a locator ending in `:`
  // or `=` forms an assignment with the join that neither field forms alone.
  // That reached the post-render check as `redaction_incomplete`, a category
  // the contract tells the caller not to retry.
  for (const reference of ['token:', 'AUTH-1:', 'password:', 'config.pat=', 'C:/keys:']) {
    assert.throws(
      () => normalizePayload(completePayload({
        artifacts_and_references: [{ reference, note: 'see the wiki' }],
      })),
      failureOf('malformed_payload'),
      `a locator ending in a separator was accepted: ${reference}`,
    );
    assert.throws(
      () => checkArtifactReferences({ references: [reference] }),
      failureOf('malformed_payload'),
    );
  }

  // Real locators are untouched, including one carrying a query value.
  for (const reference of [
    'https://github.com/jdylanmc/skills/issues/43',
    'https://example.invalid/x?token=Sup3rSecretValue',
    '#43',
    '62e8cbc',
    'C:/keys/handoff.md',
    'docs/adr/0001-use-local-units-and-promote-proven-shared-units.md',
  ]) {
    const result = persistBoundedHandoff(completePayload({
      artifacts_and_references: [{ reference, note: 'why it matters' }],
    }));
    const written = fs.readFileSync(result.path, 'utf8');
    assert.equal(redactText(written).text, written, `document is not settled for ${reference}`);
    assert.ok(!written.includes('Sup3rSecretValue'));
  }
});

test('a secret named by a qualified word is caught without spending the bare word', () => {
  for (const key of ['MYSQL_PASS', 'DB_PASS', 'user_pass', 'dbPass', 'ftp_pass']) {
    assert.ok(namesSecret(key), `key not recognized as a secret: ${key}`);
    assert.equal(redactText(`${key}=hunter2`).text, `${key}=[REDACTED:secret]`);
  }
  // `pass` alone is ordinary prose in a handoff, so it stays ordinary.
  for (const key of ['pass', 'bypass', 'compass', 'passenger', 'passing']) {
    assert.ok(!namesSecret(key), `ordinary key treated as a secret: ${key}`);
    assert.equal(redactText(`${key}=plain`).text, `${key}=plain`);
  }
  assert.equal(redactText('Second pass: complete.').text, 'Second pass: complete.');
});

test('a bracketed address survives the whole composed operation', (t) => {
  sandbox(t, 'handoff-bracketed');
  const result = persistBoundedHandoff(completePayload({
    current_progress: 'Owner is recorded as secrets[dylan@contoso.example].',
    what_worked: 'Paged tokens[+1 (415) 555-1234].',
  }));
  const written = fs.readFileSync(result.path, 'utf8');
  assert.ok(!written.includes('dylan@contoso.example'));
  assert.ok(!written.includes('555-1234'));
  assert.ok(!/\[REDACTED:[a-z-]*\[REDACTED/.test(written), 'a nested marker reached the document');
  assert.equal(redactText(written).text, written);
});

test('prose that merely ends in a secret word is not read as an assignment', (t) => {
  sandbox(t, 'handoff-dangling-key');
  // The separator is bounded to horizontal whitespace. An unbounded one pairs
  // this trailing `key:` with the next section's `##` heading, rewrites the
  // document, and then reports the rewrite as `redaction_incomplete`.
  for (const dangling of ['We rotated the signing key:', 'Ask the owner for a token:', 'password ='])   {
    const document = renderHandoff(normalizePayload(completePayload({ goal: dangling }))).document;
    assert.equal(redactText(document).text, document, `prose was rewritten: ${dangling}`);
  }

  const result = persistBoundedHandoff(completePayload({
    goal: 'We rotated the signing key:',
    current_progress: 'The rotation is done. token:',
  }));
  const written = fs.readFileSync(result.path, 'utf8');
  assert.ok(written.includes('We rotated the signing key:'));
  assert.ok(written.includes('## Current Progress'));
  assert.deepEqual(result.redactions, []);

  // A real single-line assignment is still redacted.
  assert.equal(redactText('signing key: Sup3rSecretValue').text, 'signing key: [REDACTED:secret]');
});

test('an unpaired surrogate is refused before anything is written', (t) => {
  const root = sandbox(t, 'handoff-surrogate');
  const lone = ['a\uD800b', 'a\uDC00b', '\uD83D', '\uDE00'];
  for (const value of lone) {
    assert.throws(
      () => normalizePayload(completePayload({ goal: value })),
      failureOf('malformed_payload'),
      'an unpaired surrogate reached the renderer',
    );
    assert.throws(
      () => normalizePayload(completePayload({ title: `Fix ${value}` })),
      failureOf('malformed_payload'),
    );
    assert.throws(
      () => persistBoundedHandoff(completePayload({ next_steps: value })),
      failureOf('malformed_payload'),
    );
  }
  assert.ok(!fs.existsSync(path.join(root, 'handoffs')) || fs.readdirSync(path.join(root, 'handoffs')).length === 0);

  // The guarded write refuses the same content rather than creating a file it
  // is about to fail to verify.
  const directory = resolveTempDirectory();
  assert.throws(
    () => writeGuarded({
      destination: path.join(directory, 'lone.md'),
      allowedRoot: directory,
      content: 'a\uD800b',
    }),
    failureOf('malformed_payload'),
  );
  assert.deepEqual(fs.readdirSync(directory), []);

  // A well-formed pair is content, not a defect.
  const emoji = persistBoundedHandoff(completePayload({
    goal: 'Ship it \uD83D\uDE80 and celebrate \u{1F389}.',
  }));
  const written = fs.readFileSync(emoji.path, 'utf8');
  assert.ok(written.includes('Ship it \uD83D\uDE80 and celebrate \u{1F389}.'));
  assert.equal(Buffer.byteLength(written, 'utf8'), emoji.bytes);
});

test('adversarial input cannot make redaction run away, and oversized input is refused', () => {
  const pathological = `${'a.'.repeat(20000)}@${'b.'.repeat(10000)}`;
  assert.ok(Buffer.byteLength(pathological, 'utf8') < MAX_REDACT_BYTES);
  const started = Date.now();
  redactText(pathological);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `redaction took ${elapsed}ms on adversarial input`);

  assert.throws(
    () => redactText('x'.repeat(MAX_REDACT_BYTES + 1)),
    failureOf('malformed_payload'),
  );
  assert.ok(MAX_INPUT_BYTES > MAX_DOCUMENT_BYTES);
});

test('the artifact-reference check refuses input it cannot understand', () => {
  for (const input of [null, undefined, 'references', 42, ['#43']]) {
    assert.throws(() => checkArtifactReferences(input), failureOf('malformed_payload'));
  }
  assert.throws(
    () => checkArtifactReferences({ references: [], extra: true }),
    failureOf('malformed_payload'),
  );
});

/* ------------------------------------------------------------- entry point */

test('the entry point reports a stable category and writes nothing on bad input', (t) => {
  const root = sandbox(t, 'handoff-cli-failure');
  const cases = [
    { input: '{ not json', code: 'malformed_payload' },
    { input: JSON.stringify(completePayload({ slug: '../escape' })), code: 'malformed_payload' },
    { input: JSON.stringify(completePayload({ extra: true })), code: 'malformed_payload' },
  ];
  for (const { input, code } of cases) {
    assert.throws(
      () => execFileSync(process.execPath, [MOLECULE_ENTRY, '--stdin'], {
        input,
        env: sandboxEnvironment(root),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
      (error) => {
        const failure = JSON.parse(error.stderr);
        return error.status === 1
          && failure.error.code === code
          && failure.error.reason === null
          && typeof failure.error.message === 'string';
      },
      `expected ${code} for ${input.slice(0, 40)}`,
    );
  }
  assert.ok(!fs.existsSync(path.join(root, 'handoffs')) || fs.readdirSync(path.join(root, 'handoffs')).length === 0);
});

test('the entry point refuses arguments it does not understand', (t) => {
  const root = sandbox(t, 'handoff-cli-usage');
  for (const args of [['--stdin', '--payload', 'x.json'], ['--where', 'here'], []]) {
    assert.throws(
      () => execFileSync(process.execPath, [MOLECULE_ENTRY, ...args], {
        input: '{}',
        env: sandboxEnvironment(root),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
      (error) => error.status === 1 && JSON.parse(error.stderr).error.code === 'usage',
    );
  }
});

test('a caller running an atom can see the one retryable refusal in the failure it is given', (t) => {
  const root = sandbox(t, 'handoff-cli-reason');
  const directory = resolveTempDirectory();
  const taken = path.join(directory, 'earlier-20260822T000000Z.md');
  fs.writeFileSync(taken, 'earlier handoff');
  const entry = path.join(ATOMS, 'write-guarded', 'write-guarded.mjs');

  // A shell adapter has only stdout, stderr, and the exit status. The reason
  // that tells it to resolve a fresh name has to be a field it can read, not
  // a phrase it has to match inside a message.
  assert.throws(
    () => execFileSync(
      process.execPath,
      [entry, '--destination', taken, '--allowed-root', directory, '--stdin'],
      { input: 'later', env: sandboxEnvironment(root), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ),
    (error) => {
      const failure = JSON.parse(error.stderr);
      return error.status === 1
        && failure.error.code === 'unsafe_target'
        && failure.error.reason === TARGET_EXISTS;
    },
  );
  assert.equal(fs.readFileSync(taken, 'utf8'), 'earlier handoff');

  const asDirectory = path.join(directory, 'directory.md');
  fs.mkdirSync(asDirectory);
  assert.throws(
    () => execFileSync(
      process.execPath,
      [entry, '--destination', asDirectory, '--allowed-root', directory, '--stdin'],
      { input: 'later', env: sandboxEnvironment(root), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ),
    (error) => {
      const failure = JSON.parse(error.stderr);
      return failure.error.code === 'unsafe_target' && failure.error.reason === null;
    },
  );
});

/* ------------------------------------------------------------------- graph */

test('the shared core is one molecule over exactly five non-routable atoms', () => {
  const repository = validateRepository(REPOSITORY_ROOT);
  const closure = closureFor(repository, MOLECULE);
  for (const atom of ATOM_UNITS) {
    assert.ok(closure.includes(atom), `${MOLECULE} must compose ${atom}`);
  }
  assert.deepEqual(
    repository.graph.get(MOLECULE).filter((target) => target.endsWith('.md')).sort(),
    [...ATOM_UNITS].sort(),
  );
  assert.ok(!repository.routableSkills.includes('persist-bounded-handoff'));
  for (const unit of [MOLECULE, ...ATOM_UNITS]) {
    assert.ok(!fs.existsSync(path.join(REPOSITORY_ROOT, 'skills', path.dirname(unit), 'SKILL.md')));
  }
});

test('the molecule grants exactly what its atoms need and no more', () => {
  const molecule = read(MOLECULE);
  assert.match(molecule, /^allowed-tools: \["execute"\]$/m);
  for (const atom of ATOM_UNITS) {
    assert.match(read(atom), /^allowed-tools: \["execute"\]$/m);
    assert.match(read(atom), /^composes: \[\]$/m);
    assert.match(
      read(atom),
      /^used-by: \["_base\/_molecules\/persist-bounded-handoff\/persist-bounded-handoff\.md"\]$/m,
    );
  }
});

/* ---------------------------------------------------------------- contract */

test('the documented contract keeps the approved schema, path, and prohibitions', () => {
  const molecule = read(MOLECULE);
  for (const required of [
    '<os-temp>/handoffs/<repository-or-work-slug>-<UTC timestamp>.md',
    'No caller asks where to save',
    'bounded continuation artifact',
    'reread',
    'Suggested Skills',
  ]) {
    assert.ok(molecule.includes(required), `missing contract requirement: ${required}`);
  }

  const renderer = read('_base/_atoms/handoff-render/handoff-render.md');
  const order = [
    'Goal',
    'Current Progress',
    'Decisions and Constraints',
    'Artifacts and References',
    'What Worked',
    "What Didn't Work",
    'Suggested Skills',
    'Next Steps',
  ];
  let cursor = -1;
  for (const heading of order) {
    const next = renderer.indexOf(`| \`${heading}\` |`);
    assert.ok(next > cursor, `heading out of order in the renderer contract: ${heading}`);
    cursor = next;
  }
  assert.match(renderer, /No confirmed information yet\./);
  assert.match(renderer, /\*\*omitted entirely\*\*/);
});

test('the molecule names every failure category the implementation can report', () => {
  const molecule = read(MOLECULE);
  // Every category `fail` can raise, plus the two a caller sees only from the
  // entry point. A category the implementation reports and the contract omits
  // is a caller that cannot tell a fixable payload from an environment fault.
  const categories = [
    'usage',
    'malformed_payload',
    'inlined_artifact_body',
    'unknown_skill',
    'redaction_incomplete',
    'temp_unavailable',
    'unsafe_temp_root',
    'name_exhausted',
    'path_escape',
    'unsafe_target',
    'write_failed',
    'verification_failed',
    'internal_error',
  ];
  for (const category of categories) {
    assert.ok(
      molecule.includes(`| \`${category}\` |`),
      `the molecule does not document the ${category} failure category`,
    );
  }

  const source = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills', '_base', '_molecules', 'persist-bounded-handoff', 'persist-bounded-handoff.mjs'),
    'utf8',
  );
  const raised = new Set([...source.matchAll(/fail\(\s*'([a-z_]+)'/g)].map((match) => match[1]));
  for (const category of raised) {
    assert.ok(categories.includes(category), `the implementation raises an undocumented category: ${category}`);
  }
});

test('the documented inputs, bounds, and flags match what the implementation enforces', () => {
  const molecule = read(MOLECULE);
  const renderer = read('_base/_atoms/handoff-render/handoff-render.md');

  // Every payload field a caller may send is named in both contracts.
  for (const field of ['slug', 'slug_source', 'title', 'available_skills', 'schema_version']) {
    assert.ok(molecule.includes(`\`${field}\``), `the molecule does not document ${field}`);
    assert.ok(renderer.includes(`\`${field}\``), `the renderer does not document ${field}`);
  }

  // Bounds a caller sizes its input against.
  for (const bound of [
    String(MAX_SECTION_BYTES),
    String(MAX_DOCUMENT_BYTES),
    String(MAX_INPUT_BYTES),
    String(MAX_ARTIFACTS),
    String(MAX_SUGGESTED_SKILLS),
  ]) {
    assert.ok(molecule.includes(bound), `the molecule does not document the bound ${bound}`);
  }

  // The flags each entry point actually parses.
  assert.ok(molecule.includes('--payload'), 'the molecule does not document --payload');
  assert.ok(renderer.includes('--payload'), 'the renderer does not document --payload');
  assert.ok(
    read('_base/_atoms/redact-sensitive/redact-sensitive.md').includes('--file'),
    'redact-sensitive does not document --file',
  );
  assert.ok(
    read('_base/_atoms/write-guarded/write-guarded.md').includes('--content-file'),
    'write-guarded does not document --content-file',
  );
  assert.ok(
    read('_base/_atoms/temp-path-resolve/temp-path-resolve.md').includes('--slug-source'),
    'temp-path-resolve does not document --slug-source',
  );

  // The renderer's heading is the title, not a fixed word.
  assert.ok(renderer.includes('# <title>'), 'the renderer still claims a fixed document heading');

  // The caller obligation redaction cannot discharge survives in the molecule.
  assert.match(molecule, /floor, not a guarantee/);
  assert.ok(
    !/so nothing\nsensitive reaches the renderer/.test(molecule),
    'the molecule claims redaction removes everything sensitive',
  );
});

test('every unit documents the failures it can report and answers a probe by its own name', (t) => {
  const root = sandbox(t, 'handoff-unit-contracts');
  for (const unit of ATOM_UNITS) {
    const name = path.basename(unit, '.md');
    const document = read(unit);
    assert.ok(
      document.includes('## Failure Categories'),
      `${name} does not document its failure categories`,
    );
    assert.ok(
      document.includes('| `internal_error` |'),
      `${name} does not document internal_error`,
    );
    assert.ok(
      document.includes(`${name}: available`),
      `${name} does not document its own probe response`,
    );
    assert.ok(
      !document.includes('handoff: available'),
      `${name} still claims the domain-coupled probe response`,
    );

    const probe = execFileSync(
      process.execPath,
      [path.join(ATOMS, name, `${name}.mjs`), '--probe'],
      { env: sandboxEnvironment(root), encoding: 'utf8' },
    );
    assert.equal(probe.trim(), `${name}: available`, `${name} does not probe by its own name`);
  }
  assert.ok(read(MOLECULE).includes('persist-bounded-handoff: available'));
});
test('the adapted Matt Pocock material keeps its copyright and permission notice', () => {
  const molecule = read(MOLECULE);
  assert.match(molecule, /MIT License/);
  assert.match(molecule, /Copyright \(c\) 2026 Matt Pocock/);
  assert.match(
    molecule,
    /The above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software\./,
  );
  assert.match(molecule, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.match(molecule, /https:\/\/github\.com\/mattpocock\/skills/);
});
