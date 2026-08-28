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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  MAX_SURFACE_WORDS,
  MAX_SURFACE_CHARACTERS,
  boundSurface,
  resolveContradictions,
  run,
} from './contradiction-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

test('evidence that produces no finding yields an explicit clean check, not an error or an absent result', () => {
  // The record carries real, non-additive evidence text; the client judged it
  // and produced no finding. The contract is that this is a reported clean
  // check driven by the findings, distinct from a thrown error and from a
  // missing/absent result.
  const input = judged([]);
  assert.ok(input.evidence.length > 0 && input.evidence[0].text.length > 0,
    'the arrangement supplies real evidence, so a clean result is about the judged findings');

  let result;
  assert.doesNotThrow(() => { result = resolveContradictions(input); },
    'evidence with no finding is a clean check, never an error');
  assert.notEqual(result, undefined, 'a clean check is a reported result, not an absent one');
  assert.equal(result.clean, true);
  assert.equal(result.verdict, 'none');
  assert.deepEqual(result, {
    verdict: 'none',
    clean: true,
    escalated: [],
    recorded: [],
    suppressed: [],
  });

  // The result is driven by the judged findings: the same evidence with one
  // real finding is no longer a clean check.
  const withFinding = resolveContradictions(judged([
    { assertionId: 'INT', evidenceRef: 'ev-1', confidence: 'high', description: 'x' },
  ]));
  assert.equal(withFinding.clean, false);
  assert.equal(withFinding.verdict, 'escalated');
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

// --- #123 remediation: boundary defects that reproduced while the suite was green ---

test('a control character in any identifier is refused, so no serialization collision is possible', () => {
  // The reproduced false clean check: two distinct (assertionId, evidenceRef)
  // pairs whose delimiter-joined keys collided. With control characters refused
  // and the key encoded unambiguously, the real high-confidence finding can
  // never be reported as suppressed.
  const colliding = {
    version: 1,
    artifact: { id: 'spec-001', kind: 'nano-specification' },
    assertions: [
      { id: 'a\u0000b', kind: 'intention', text: 'one' },
      { id: 'a', kind: 'acceptance-criterion', text: 'two' },
    ],
    evidence: [
      { ref: 'c', text: 'three' },
      { ref: 'b\u0000c', text: 'four' },
    ],
    accepted: [{ assertionId: 'a\u0000b', evidenceRef: 'c' }],
    findings: [{ assertionId: 'a', evidenceRef: 'b\u0000c', confidence: 'high', description: 'real' }],
  };
  assert.throws(
    () => resolveContradictions(colliding),
    (error) => error.code === 'invalid-input' && /control character/i.test(error.message),
  );
});

test('a control character in an accepted pair identifier is refused', () => {
  assert.throws(
    () => resolveContradictions(judged(
      [{ assertionId: 'INT', evidenceRef: 'ev-1', confidence: 'high', description: 'x' }],
      { accepted: [{ assertionId: 'INT\u0001', evidenceRef: 'ev-1' }] },
    )),
    (error) => error.code === 'invalid-input' && /control character/i.test(error.message),
  );
});

test('a duplicate assertion id is refused, naming the duplicate', () => {
  assert.throws(
    () => boundSurface(record({
      assertions: [
        { id: 'DUP', kind: 'intention', text: 'one' },
        { id: 'DUP', kind: 'non-goal', text: 'two' },
      ],
    })),
    (error) => error.code === 'invalid-input' && /DUP/.test(error.message) && /duplicat/i.test(error.message),
  );
});

test('a duplicate evidence ref is refused, naming the duplicate', () => {
  assert.throws(
    () => boundSurface(record({
      evidence: [
        { ref: 'ev-dup', text: 'one' },
        { ref: 'ev-dup', text: 'two' },
      ],
    })),
    (error) => error.code === 'invalid-input' && /ev-dup/.test(error.message) && /duplicat/i.test(error.message),
  );
});

test('a duplicate finding pair is refused so one divergence stays one finding', () => {
  assert.throws(
    () => resolveContradictions(judged([
      { assertionId: 'INT', evidenceRef: 'ev-1', confidence: 'high', description: 'first' },
      { assertionId: 'INT', evidenceRef: 'ev-1', confidence: 'low', description: 'second' },
    ])),
    (error) => error.code === 'invalid-input' && /duplicat/i.test(error.message),
  );
});

test('an oversized single token is refused as surface-unbounded even though it is one word', () => {
  const oneHugeToken = 'x'.repeat(MAX_SURFACE_CHARACTERS + 1);
  assert.equal(oneHugeToken.trim().split(/\s+/).length, 1, 'the arrangement is a single whitespace token');
  assert.throws(
    () => boundSurface(record({
      assertions: [{ id: 'INT', kind: 'intention', text: oneHugeToken }],
    })),
    (error) => error.code === 'surface-unbounded'
      && /assertion set/.test(error.message)
      && /character/.test(error.message),
  );
});

test('a whitespace-free oversized string is refused as surface-unbounded', () => {
  const noWhitespace = '字'.repeat(MAX_SURFACE_CHARACTERS + 1);
  assert.equal(noWhitespace.trim().split(/\s+/).length, 1, 'a script without whitespace counts as one word');
  assert.throws(
    () => boundSurface(record({
      evidence: [{ ref: 'ev-1', text: noWhitespace }],
    })),
    (error) => error.code === 'surface-unbounded'
      && /evidence set/.test(error.message)
      && /character/.test(error.message),
  );
});

test('a record inheriting findings from its prototype is refused by --resolve', () => {
  const polluted = Object.assign(Object.create({ findings: [] }), record());
  assert.throws(
    () => resolveContradictions(polluted),
    (error) => error.code === 'invalid-input' && /findings/.test(error.message),
  );
});

test('a record inheriting findings from its prototype is refused by --bound, not seen as absent', () => {
  const polluted = Object.assign(Object.create({ findings: [] }), record());
  assert.throws(
    () => boundSurface(polluted),
    (error) => error.code === 'invalid-input' && /findings/.test(error.message),
  );
});

test('the command line reports unreadable-input for a missing path without a clean-looking stdout', () => {
  const captured = [];
  const streams = { stdout: { write: (chunk) => captured.push(chunk) } };
  const missing = path.join(HERE, 'no-such-contradiction-input.json');
  assert.throws(
    () => run(['--resolve', '--input', missing], streams),
    (error) => error.code === 'unreadable-input' && /no-such-contradiction-input/.test(error.message),
  );
  assert.equal(captured.join(''), '', 'no failure path writes anything that could read as a clean result');
});

test('the command line reports unreadable-input for a directory without a clean-looking stdout', () => {
  const captured = [];
  const streams = { stdout: { write: (chunk) => captured.push(chunk) } };
  assert.throws(
    () => run(['--bound', '--input', HERE], streams),
    (error) => error.code === 'unreadable-input',
  );
  assert.equal(captured.join(''), '', 'no failure path writes anything that could read as a clean result');
});

test('the command line round-trips a valid record to stdout, proving the failure paths are the exception', () => {
  const captured = [];
  const streams = { stdout: { write: (chunk) => captured.push(chunk) } };
  const scratch = path.join(HERE, 'contradiction-check.roundtrip.tmp.json');
  fs.writeFileSync(scratch, JSON.stringify(judged([])), 'utf8');
  try {
    const code = run(['--resolve', '--input', scratch], streams);
    assert.equal(code, 0);
    const parsed = JSON.parse(captured.join(''));
    assert.equal(parsed.clean, true);
    assert.equal(parsed.verdict, 'none');
  } finally {
    fs.rmSync(scratch, { force: true });
  }
});
