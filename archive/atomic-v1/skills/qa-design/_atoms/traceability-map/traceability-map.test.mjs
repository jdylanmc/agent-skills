import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXIT_ACCEPTED,
  EXIT_FINDINGS,
  TraceabilityError,
  exitCodeFor,
  reconcileTraceability,
} from './traceability-map.mjs';

function codes(report) {
  return report.findings.map((entry) => entry.code).sort();
}

const REQUIREMENTS = [{ id: 'R1' }, { id: 'R2' }];
const EVIDENCE = [
  { id: 'refund-granted', kind: 'gherkin-scenario' },
  { id: 'refund-through-the-app', kind: 'system-procedure' },
];
const ROWS = [
  { requirement: 'R1', evidence: ['refund-granted'] },
  { requirement: 'R2', evidence: ['refund-through-the-app'] },
];

test('a map where every requirement and every proof is linked is complete', () => {
  const report = reconcileTraceability({ requirements: REQUIREMENTS, evidence: EVIDENCE, rows: ROWS });

  assert.equal(report.status, 'complete');
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.coverage, {
    requirements: 2,
    covered: 2,
    partiallyCovered: [],
    uncovered: [],
  });
  assert.deepEqual(report.evidence.byKind, {
    'deterministic-check': 0,
    'example-rule': 0,
    'gherkin-scenario': 1,
    'system-procedure': 1,
  });
});

test('a complete map still states that linkage is not evidence', () => {
  const report = reconcileTraceability({ requirements: REQUIREMENTS, evidence: EVIDENCE, rows: ROWS });

  assert.equal(report.proof.linkageOnly, true);
  assert.match(report.proof.statement, /not evidence that the linked check exists, ran, or passed/);
});

test('a requirement nobody planned to prove is reported as an undeclared gap', () => {
  const report = reconcileTraceability({
    requirements: [...REQUIREMENTS, { id: 'R3' }],
    evidence: EVIDENCE,
    rows: ROWS,
  });

  assert.equal(report.status, 'gaps');
  assert.deepEqual(codes(report), ['undeclared-gap']);
  assert.deepEqual(report.coverage.uncovered, ['R3']);
});

test('a requirement declared as a known gap is carried with its reason', () => {
  const report = reconcileTraceability({
    requirements: [...REQUIREMENTS, { id: 'R3' }],
    evidence: EVIDENCE,
    rows: ROWS,
    gaps: [{
      requirement: 'R3',
      aspect: 'whole-requirement',
      reason: 'the payment outage cannot be forced safely',
    }],
  });

  assert.equal(report.status, 'gaps');
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.declaredGaps, [
    {
      requirement: 'R3',
      aspect: 'whole-requirement',
      scope: 'whole-requirement',
      preferredVocabulary: true,
      reason: 'the payment outage cannot be forced safely',
    },
  ]);
  assert.deepEqual(report.coverage.uncovered, ['R3']);
  assert.deepEqual(report.coverage.partiallyCovered, []);
});

test('a requirement proven in part carries its residual gap without losing its coverage', () => {
  const report = reconcileTraceability({
    requirements: REQUIREMENTS,
    evidence: EVIDENCE,
    rows: ROWS,
    gaps: [{
      requirement: 'R1',
      aspect: 'recovery',
      reason: 'the refund service cannot be interrupted mid-flight in any reachable environment',
    }],
  });

  assert.equal(report.status, 'gaps');
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.coverage, {
    requirements: 2,
    covered: 1,
    partiallyCovered: ['R1'],
    uncovered: [],
  });
  assert.deepEqual(report.rows[0], {
    requirement: 'R1',
    evidence: ['refund-granted'],
    gaps: [{
      aspect: 'recovery',
      reason: 'the refund service cannot be interrupted mid-flight in any reachable environment',
    }],
  });
});

test('a scoped gap names an aspect, and an example class is the preferred vocabulary', () => {
  const preferred = reconcileTraceability({
    requirements: REQUIREMENTS,
    evidence: EVIDENCE,
    rows: ROWS,
    gaps: [{ requirement: 'R1', aspect: 'boundary', reason: 'the window edge needs a clock nobody can move' }],
  });
  const named = reconcileTraceability({
    requirements: REQUIREMENTS,
    evidence: EVIDENCE,
    rows: ROWS,
    gaps: [{ requirement: 'R1', aspect: 'refunds above the manual-review limit', reason: 'no approver account exists outside production' }],
  });
  const unnamed = reconcileTraceability({
    requirements: REQUIREMENTS,
    evidence: EVIDENCE,
    rows: ROWS,
    gaps: [{ requirement: 'R1', reason: 'hard to test' }],
  });

  assert.equal(preferred.declaredGaps[0].preferredVocabulary, true);
  assert.equal(named.declaredGaps[0].preferredVocabulary, false);
  assert.equal(named.declaredGaps[0].scope, 'aspect');
  assert.equal(unnamed.status, 'invalid');
  assert.deepEqual(codes(unnamed), ['gap-without-aspect']);
});

test('the same aspect declared as a gap twice is reported', () => {
  const report = reconcileTraceability({
    requirements: REQUIREMENTS,
    evidence: EVIDENCE,
    rows: ROWS,
    gaps: [
      { requirement: 'R1', aspect: 'recovery', reason: 'no way to interrupt the refund' },
      { requirement: 'R1', aspect: 'recovery', reason: 'still no way to interrupt the refund' },
    ],
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['duplicate-gap']);
});

test('a scoped gap does not account for a requirement nothing proves', () => {
  const report = reconcileTraceability({
    requirements: [...REQUIREMENTS, { id: 'R3' }],
    evidence: EVIDENCE,
    rows: ROWS,
    gaps: [{ requirement: 'R3', aspect: 'recovery', reason: 'no way to interrupt the outage' }],
  });

  assert.equal(report.status, 'gaps');
  assert.deepEqual(codes(report), ['undeclared-gap']);
  assert.match(report.findings[0].detail, /no proving evidence at all/);
  assert.deepEqual(report.coverage.uncovered, ['R3']);
});

test('a gap declared for a requirement that is already proven is contradictory', () => {
  const report = reconcileTraceability({
    requirements: REQUIREMENTS,
    evidence: EVIDENCE,
    rows: ROWS,
    gaps: [{ requirement: 'R1', aspect: 'whole-requirement', reason: 'not provable' }],
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['contradictory-gap']);
});

test('a gap without a reason is not a usable gap', () => {
  const report = reconcileTraceability({
    requirements: [...REQUIREMENTS, { id: 'R3' }],
    evidence: EVIDENCE,
    rows: ROWS,
    gaps: [{ requirement: 'R3', aspect: 'whole-requirement', reason: '  ' }],
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['gap-without-reason']);
});

test('a planned proof traced to no requirement is reported', () => {
  const report = reconcileTraceability({
    requirements: REQUIREMENTS,
    evidence: [...EVIDENCE, { id: 'complexity-budget', kind: 'deterministic-check' }],
    rows: ROWS,
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['orphan-evidence']);
  assert.equal(report.evidence.declared, 3);
  assert.equal(report.evidence.referenced, 2);
});

test('rows pointing at things that were never declared invalidate the map', () => {
  const report = reconcileTraceability({
    requirements: REQUIREMENTS,
    evidence: EVIDENCE,
    rows: [...ROWS, { requirement: 'R9', evidence: ['refund-granted'] }, { requirement: 'R1', evidence: ['ghost'] }],
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['unknown-evidence', 'unknown-requirement']);
});

test('a row naming no proof is reported rather than counted as coverage', () => {
  const report = reconcileTraceability({
    requirements: REQUIREMENTS,
    evidence: EVIDENCE,
    rows: [{ requirement: 'R1', evidence: [] }, ROWS[1]],
  });

  assert.equal(report.status, 'invalid');
  assert.ok(codes(report).includes('empty-row'));
  assert.deepEqual(report.coverage.uncovered, ['R1']);
});

test('repeated identities and repeated rows are reported', () => {
  const report = reconcileTraceability({
    requirements: [...REQUIREMENTS, { id: 'R1' }],
    evidence: [...EVIDENCE, { id: 'refund-granted', kind: 'system-procedure' }],
    rows: [...ROWS, { requirement: 'R1', evidence: ['refund-granted'] }],
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['duplicate-evidence-id', 'duplicate-requirement-id', 'duplicate-row']);
});

test('an evidence kind outside the designed set is reported', () => {
  const report = reconcileTraceability({
    requirements: [{ id: 'R1' }],
    evidence: [{ id: 'vibes', kind: 'manual-spot-check' }],
    rows: [{ requirement: 'R1', evidence: ['vibes'] }],
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['unknown-evidence-kind']);
});

test('every finding that invalidates the map is raised at high severity', () => {
  const report = reconcileTraceability({
    requirements: [...REQUIREMENTS, { id: 'R1' }],
    evidence: [...EVIDENCE, { id: 'complexity-budget', kind: 'deterministic-check' }],
    rows: [...ROWS, ROWS[0], { requirement: 'R9', evidence: ['ghost'] }],
    gaps: [{ requirement: 'R1', aspect: 'whole-requirement', reason: 'not provable' }],
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual([...new Set(report.findings.map((entry) => entry.severity))], ['high']);
});

test('the exit code reports findings rather than disposition', () => {
  const complete = reconcileTraceability({ requirements: REQUIREMENTS, evidence: EVIDENCE, rows: ROWS });
  const declaredGap = reconcileTraceability({
    requirements: REQUIREMENTS,
    evidence: EVIDENCE,
    rows: ROWS,
    gaps: [{ requirement: 'R1', aspect: 'recovery', reason: 'no way to interrupt the refund' }],
  });
  const flagged = reconcileTraceability({
    requirements: [...REQUIREMENTS, { id: 'R3' }],
    evidence: EVIDENCE,
    rows: ROWS,
  });

  assert.equal(exitCodeFor(complete), EXIT_ACCEPTED);
  assert.equal(declaredGap.status, 'gaps');
  assert.equal(exitCodeFor(declaredGap), EXIT_ACCEPTED);
  assert.equal(exitCodeFor(flagged), EXIT_FINDINGS);
});

test('a malformed map is refused rather than reconciled', () => {
  assert.throws(() => reconcileTraceability({ requirements: REQUIREMENTS, evidence: EVIDENCE }), (error) => {
    assert.ok(error instanceof TraceabilityError);
    assert.equal(error.code, 'invalid_input');
    return true;
  });
  assert.throws(() => reconcileTraceability({ requirements: [{}], evidence: [], rows: [] }), (error) => {
    assert.equal(error.code, 'invalid_input');
    return true;
  });
});
