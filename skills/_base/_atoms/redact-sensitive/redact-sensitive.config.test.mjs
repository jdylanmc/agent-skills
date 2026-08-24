import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findConfiguredIdentifiers,
  loadIdentifierConfig,
  normalizeIdentifier,
  redactConfiguredIdentifiers,
} from './redact-sensitive.config.mjs';

function configuration(value = ['Private', 'System'].join(' ')) {
  return JSON.stringify({
    version: 1,
    identifiers: [{ value, evidenceType: 'internal-system' }],
  });
}

test('normalization ignores casing, punctuation, and wrapping', () => {
  assert.equal(
    normalizeIdentifier(['PRIVATE', '\n', 'sys-tem'].join('')),
    'privatesystem',
  );
});

test('configured identifiers survive casing, wrapping, and splitting', () => {
  const config = loadIdentifierConfig({ json: configuration() });
  const source = ['Use pRiVaTe', '\n', 'sys-tem here.'].join('');
  const findings = findConfiguredIdentifiers(source, config.identifiers);

  assert.deepEqual(
    findings.map(({ evidenceType }) => evidenceType),
    ['internal-system'],
  );
});

test('configured identifiers require identifier boundaries', () => {
  const config = loadIdentifierConfig({ json: configuration('Alpha') });

  assert.deepEqual(findConfiguredIdentifiers('alphabetical', config.identifiers), []);
  assert.equal(findConfiguredIdentifiers('alpha.', config.identifiers).length, 1);
});

test('configured redaction emits only the evidence type', () => {
  const sensitive = ['Private', 'System'].join(' ');
  const config = loadIdentifierConfig({ json: configuration(sensitive) });
  const result = redactConfiguredIdentifiers(`Uses ${sensitive}.`, config.identifiers);

  assert.equal(result.text, 'Uses [REDACTED:internal-system].');
  assert.equal(JSON.stringify(result).includes(sensitive), false);
  assert.deepEqual(
    result.redactions,
    [{ category: 'internal-system', count: 1 }],
  );
});

test('configured redaction never matches inside an existing marker', () => {
  const config = loadIdentifierConfig({
    json: configuration(['REDACTED', 'email'].join(' ')),
  });
  const source = 'mail is [REDACTED:email] now';

  assert.deepEqual(redactConfiguredIdentifiers(source, config.identifiers), {
    text: source,
    redactions: [],
  });
});

test('malformed JSON never appears in its own error', () => {
  const privateFragment = ['Private', 'System'].join(' ');

  assert.throws(
    () => loadIdentifierConfig({ json: `{"version":1,"identifiers":["${privateFragment}",]}` }),
    (error) => (
      error.code === 'malformed_config'
      && error.message === 'REDACT_SENSITIVE_CONFIG_JSON is not valid JSON'
      && !error.message.includes(privateFragment)
    ),
  );
});

test('an unreadable configuration path never appears in its own error', () => {
  const privateFragment = ['Private', 'System'].join(' ');

  assert.throws(
    () => loadIdentifierConfig({ file: `${privateFragment}.json` }),
    (error) => (
      error.code === 'malformed_config'
      && error.message === 'identifier configuration could not be read'
      && !error.message.includes(privateFragment)
    ),
  );
});

test('configuration rejects weak or malformed identifiers', () => {
  assert.throws(
    () => loadIdentifierConfig({
      json: JSON.stringify({
        version: 1,
        identifiers: [{ value: 'x', evidenceType: 'internal-system' }],
      }),
    }),
    /at least 5 letters or digits/,
  );
  assert.throws(
    () => loadIdentifierConfig({
      json: JSON.stringify({
        version: 1,
        identifiers: [{ value: 'Private System', evidenceType: 'Internal System' }],
      }),
    }),
    /lowercase kebab-case/,
  );
});
