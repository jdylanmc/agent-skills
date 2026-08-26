import assert from 'node:assert/strict';
import test from 'node:test';

import { validateDiscoverySource } from './discovery-source.mjs';

function source(overrides = {}) {
  return {
    version: 1,
    kind: 'markdown',
    locator: 'docs/agent/discovery/payments.md',
    alignment: 'confirmed',
    capturedRevision: 'a'.repeat(64),
    currentRevision: 'a'.repeat(64),
    confirmedFacts: ['Checkout currently accepts one payment method [source: user research].'],
    decisions: ['Support one additional payment method.'],
    assumptions: [],
    contradictions: [],
    unresolvedQuestions: [],
    scope: ['Customer checkout payment selection.'],
    exclusions: ['Payment-provider implementation.'],
    ...overrides,
  };
}

function code(run) {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
}

test('accepts a confirmed fresh Markdown Discovery artifact', () => {
  const result = validateDiscoverySource(source());
  assert.equal(result.status, 'ready');
  assert.equal(result.source.kind, 'markdown');
  assert.equal(result.source.locator, 'docs/agent/discovery/payments.md');
});

test('accepts a revision-bound tracker issue as the same intake contract', () => {
  const result = validateDiscoverySource(source({
    kind: 'tracker-issue',
    locator: 'https://github.com/example/app/issues/42',
    capturedRevision: 'issue-42@2026-08-26T10:00:00Z',
    currentRevision: 'issue-42@2026-08-26T10:00:00Z',
  }));
  assert.equal(result.status, 'ready');
  assert.equal(result.source.kind, 'tracker-issue');
});

test('refuses raw or inferred alignment', () => {
  assert.equal(code(() => validateDiscoverySource(source({ alignment: 'verified' }))), 'unconfirmed');
  assert.equal(code(() => validateDiscoverySource(source({ alignment: 'we discussed it' }))), 'unconfirmed');
});

test('refuses a source that moved after confirmation', () => {
  assert.equal(
    code(() => validateDiscoverySource(source({ currentRevision: 'b'.repeat(64) }))),
    'stale',
  );
});

test('keeps Markdown inside the durable Discovery workspace', () => {
  assert.equal(
    code(() => validateDiscoverySource(source({ locator: '../private/discovery.md' }))),
    'invalid-source',
  );
  assert.equal(
    code(() => validateDiscoverySource(source({ locator: 'docs/discovery.md' }))),
    'invalid-source',
  );
});

test('refuses materially incomplete shared understanding', () => {
  assert.equal(code(() => validateDiscoverySource(source({ confirmedFacts: [] }))), 'incomplete');
  assert.equal(code(() => validateDiscoverySource(source({ scope: [] }))), 'incomplete');
  assert.equal(code(() => validateDiscoverySource(source({ exclusions: [] }))), 'incomplete');
});

test('rejects unknown fields instead of silently losing evidence', () => {
  assert.equal(code(() => validateDiscoverySource(source({ transcript: 'raw conversation' }))), 'invalid-source');
});

test('distinguishes a malformed record from materially incomplete Discovery', () => {
  const malformed = source();
  delete malformed.kind;
  assert.equal(code(() => validateDiscoverySource(malformed)), 'invalid-source');
  assert.equal(code(() => validateDiscoverySource(source({ confirmedFacts: [] }))), 'incomplete');
});
