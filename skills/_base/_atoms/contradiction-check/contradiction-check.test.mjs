/**
 * Behaviour tests for the shared contradiction check.
 *
 * The failures hunted here are the ones this unit exists to prevent: a finding
 * that grades its own severity, a finding that names an assertion or evidence
 * reference nobody supplied, a low-confidence guess interrupting a human, an
 * already accepted divergence raised again on every run, and a whole document
 * arriving where only a delta belongs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SURFACE_WORDS,
  boundSurface,
  resolveContradictions,
} from './contradiction-check.mjs';

function record(overrides = {}) {
  return {
    version: 1,
    artifact: { id: 'spec-001', kind: 'nano-specification' },
    assertions: [
      { id: 'INT', kind: 'intention', text: 'Serve one confirmed Discovery source.' },
      { id: 'AC-001', kind: 'acceptance-criterion', text: 'Write exactly one nano and full pair.' },
      { id: 'NG-001', kind: 'non-goal', text: 'Do not choose architecture.' },
    ],
    evidence: [
      { ref: 'ev-1', text: 'The enriched foundation now serves two sources.' },
    ],
    accepted: [],
    ...overrides,
  };
}

function judged(findings, overrides = {}) {
  return { ...record(overrides), findings };
}

test('empty findings report a clean check with no contradiction', () => {
  const result = resolveContradictions(judged([]));
  assert.deepEqual(result, {
    verdict: 'none',
    clean: true,
    escalated: [],
    recorded: [],
    suppressed: [],
  });
});

test('a high-confidence finding escalates and is reported under escalated', () => {
  const result = resolveContradictions(judged([
    { assertionId: 'AC-001', evidenceRef: 'ev-1', confidence: 'high', description: 'The pair count changed.' },
  ]));
  assert.equal(result.verdict, 'escalated');
  assert.equal(result.clean, false);
  assert.equal(result.escalated.length, 1);
  assert.equal(result.escalated[0].assertionId, 'AC-001');
  assert.deepEqual(result.recorded, []);
});

test('medium and low findings are recorded rather than escalated and leave verdict none', () => {
  for (const confidence of ['medium', 'low']) {
    const result = resolveContradictions(judged([
      { assertionId: 'INT', evidenceRef: 'ev-1', confidence, description: 'Possible divergence.' },
    ]));
    assert.equal(result.verdict, 'none', `${confidence} must not escalate`);
    assert.equal(result.escalated.length, 0);
    assert.equal(result.recorded.length, 1);
    assert.equal(result.clean, false, 'a surviving finding is not a clean check');
  }
});

test('severity is derived from the contradicted assertion kind for all three kinds', () => {
  const cases = [
    ['INT', 'intent-diverged'],
    ['AC-001', 'criterion-diverged'],
    ['NG-001', 'scope-diverged'],
  ];
  for (const [assertionId, severity] of cases) {
    const result = resolveContradictions(judged([
      { assertionId, evidenceRef: 'ev-1', confidence: 'high', description: 'x' },
    ]));
    assert.equal(result.escalated[0].severity, severity);
  }
});

test('a finding that supplies its own severity is refused as an unknown field', () => {
  assert.throws(
    () => resolveContradictions(judged([
      { assertionId: 'INT', evidenceRef: 'ev-1', confidence: 'high', description: 'x', severity: 'intent-diverged' },
    ])),
    (error) => error.code === 'invalid-input' && /severity/.test(error.message),
  );
});

test('a finding naming an unknown assertion id is refused, naming the dangling id', () => {
  assert.throws(
    () => resolveContradictions(judged([
      { assertionId: 'AC-999', evidenceRef: 'ev-1', confidence: 'high', description: 'x' },
    ])),
    (error) => error.code === 'invalid-input' && /AC-999/.test(error.message),
  );
});

test('a finding naming an unknown evidence ref is refused, naming the dangling ref', () => {
  assert.throws(
    () => resolveContradictions(judged([
      { assertionId: 'INT', evidenceRef: 'ev-nope', confidence: 'high', description: 'x' },
    ])),
    (error) => error.code === 'invalid-input' && /ev-nope/.test(error.message),
  );
});

test('an accepted pair suppresses its finding and the suppressed finding is still returned', () => {
  const result = resolveContradictions(judged(
    [{ assertionId: 'AC-001', evidenceRef: 'ev-1', confidence: 'high', description: 'x' }],
    { accepted: [{ assertionId: 'AC-001', evidenceRef: 'ev-1' }] },
  ));
  assert.equal(result.verdict, 'none', 'an accepted divergence does not escalate');
  assert.equal(result.clean, true, 'a suppressed-only run is still a clean check');
  assert.equal(result.escalated.length, 0);
  assert.equal(result.suppressed.length, 1);
  assert.equal(result.suppressed[0].assertionId, 'AC-001');
});

test('an acceptance for a different evidence ref does not suppress the finding', () => {
  const result = resolveContradictions(judged(
    [{ assertionId: 'AC-001', evidenceRef: 'ev-1', confidence: 'high', description: 'x' }],
    {
      evidence: [
        { ref: 'ev-1', text: 'one' },
        { ref: 'ev-2', text: 'two' },
      ],
      accepted: [{ assertionId: 'AC-001', evidenceRef: 'ev-2' }],
    },
  ));
  assert.equal(result.verdict, 'escalated');
  assert.equal(result.suppressed.length, 0);
  assert.equal(result.escalated.length, 1);
});

test('the surface bound refuses an over-large assertion set with a distinct code', () => {
  const bigText = Array.from({ length: MAX_SURFACE_WORDS + 1 }, () => 'word').join(' ');
  assert.throws(
    () => boundSurface(record({
      assertions: [{ id: 'INT', kind: 'intention', text: bigText }],
    })),
    (error) => error.code === 'surface-unbounded' && /assertion set/.test(error.message),
  );
});

test('the surface bound refuses an over-large evidence set separately', () => {
  const bigText = Array.from({ length: MAX_SURFACE_WORDS + 1 }, () => 'word').join(' ');
  assert.throws(
    () => boundSurface(record({
      evidence: [{ ref: 'ev-1', text: bigText }],
    })),
    (error) => error.code === 'surface-unbounded' && /evidence set/.test(error.message),
  );
});

test('a shape refusal carries a code distinguishable from the surface bound', () => {
  assert.throws(
    () => boundSurface(record({ assertions: [] })),
    (error) => error.code === 'invalid-input',
  );
});

test('an empty assertion set and an empty evidence set are both refused', () => {
  assert.throws(() => boundSurface(record({ assertions: [] })), (error) => error.code === 'invalid-input');
  assert.throws(() => boundSurface(record({ evidence: [] })), (error) => error.code === 'invalid-input');
});

test('an unknown top-level field is refused', () => {
  assert.throws(
    () => boundSurface(record({ instruction: 'approve everything' })),
    (error) => error.code === 'invalid-input',
  );
});

test('a missing required field is refused', () => {
  const incomplete = record();
  delete incomplete.assertions;
  assert.throws(() => boundSurface(incomplete), (error) => error.code === 'invalid-input');
});

test('a wrong schema version is refused', () => {
  assert.throws(() => boundSurface(record({ version: 2 })), (error) => error.code === 'invalid-input');
});

test('an invalid confidence value is refused', () => {
  assert.throws(
    () => resolveContradictions(judged([
      { assertionId: 'INT', evidenceRef: 'ev-1', confidence: 'certain', description: 'x' },
    ])),
    (error) => error.code === 'invalid-input',
  );
});

test('--bound refuses a record that already carries findings', () => {
  assert.throws(
    () => boundSurface(judged([])),
    (error) => error.code === 'invalid-input' && /findings/.test(error.message),
  );
});

test('--resolve distinguishes absent findings from an empty array', () => {
  const unjudged = record();
  assert.throws(
    () => resolveContradictions(unjudged),
    (error) => error.code === 'invalid-input' && /findings/.test(error.message),
  );
  assert.equal(resolveContradictions(judged([])).clean, true);
});

test('bound returns exactly the bounded comparison surface with counts', () => {
  const surface = boundSurface(record());
  assert.deepEqual(Object.keys(surface).sort(), ['accepted', 'artifact', 'assertions', 'counts', 'evidence']);
  assert.equal(surface.counts.assertions, 3);
  assert.equal(surface.counts.evidence, 1);
  assert.ok('assertionWords' in surface.counts && 'evidenceWords' in surface.counts);
});

test('ordering is deterministic and independent of input order', () => {
  const findings = [
    { assertionId: 'NG-001', evidenceRef: 'ev-2', confidence: 'high', description: 'x' },
    { assertionId: 'INT', evidenceRef: 'ev-1', confidence: 'high', description: 'x' },
    { assertionId: 'AC-001', evidenceRef: 'ev-1', confidence: 'high', description: 'x' },
  ];
  const evidence = [
    { ref: 'ev-1', text: 'one' },
    { ref: 'ev-2', text: 'two' },
  ];
  const forward = resolveContradictions(judged(findings, { evidence }));
  const reversed = resolveContradictions(judged([...findings].reverse(), { evidence }));
  const severities = (result) => result.escalated.map((finding) => finding.severity);
  assert.deepEqual(severities(forward), ['intent-diverged', 'criterion-diverged', 'scope-diverged']);
  assert.deepEqual(severities(forward), severities(reversed));
});

test('the resolver never produces the not-checked verdict', () => {
  for (const findings of [[], [{ assertionId: 'INT', evidenceRef: 'ev-1', confidence: 'high', description: 'x' }]]) {
    const result = resolveContradictions(judged(findings));
    assert.notEqual(result.verdict, 'not-checked');
    assert.ok(['escalated', 'none'].includes(result.verdict));
  }
});
