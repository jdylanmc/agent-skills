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
  MAX_SURFACE_CHARACTERS,
  MAX_IDENTIFIER_CHARACTERS,
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
      { ref: 'ev-1', text: 'The enriched foundation adds an onboarding walkthrough note.' },
    ],
    accepted: [],
    ...overrides,
  };
}

function judged(findings, overrides = {}) {
  return { ...record(overrides), findings };
}

test('the resolver reports an explicit clean check when judgement returned nothing', () => {
  // The evidence here is genuinely additive to the assertions — an onboarding
  // note that neither serves a second source, changes the pair count, nor
  // touches architecture — so the fixture and the claim agree. This test proves
  // the RESOLVER reports an explicit clean check when judgement returns no
  // finding; it does not and cannot prove that the additive evidence "produced"
  // no finding, because judging the evidence is the one step this unit does not
  // perform. See the judgement-boundary note in contradiction-check.md.
  const input = judged([]);
  assert.ok(input.evidence[0].text.length > 0,
    'the arrangement supplies additive evidence; the clean result is about the empty findings');

  let result;
  assert.doesNotThrow(() => { result = resolveContradictions(input); },
    'an empty findings array is a clean check, never an error');
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
});

test('the outcome is driven by the judged findings, not by the evidence text', () => {
  // Contrasting fixture: the evidence text genuinely contradicts the intention
  // ("serve one confirmed Discovery source"), and this time judgement is
  // represented by a corresponding finding. The pair with the clean test above
  // shows the result follows the findings the caller supplies, never the words
  // in the evidence — the same contradictory sentence with NO finding would
  // still resolve clean.
  const contradictory = {
    evidence: [{ ref: 'ev-1', text: 'The enriched foundation now serves two Discovery sources.' }],
  };
  const withoutFinding = resolveContradictions(judged([], contradictory));
  assert.equal(withoutFinding.clean, true, 'contradictory evidence with no finding is still a clean check');
  assert.equal(withoutFinding.verdict, 'none');

  const withFinding = resolveContradictions(judged(
    [{ assertionId: 'INT', evidenceRef: 'ev-1', confidence: 'high', description: 'serves a second source' }],
    contradictory,
  ));
  assert.equal(withFinding.clean, false, 'the same evidence with a finding is no longer clean');
  assert.equal(withFinding.verdict, 'escalated');
  assert.equal(withFinding.escalated[0].assertionId, 'INT');
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
  // A fixed, externally meaningful size (501 whitespace tokens) that exceeds the
  // documented 500-word bound. Fixed rather than derived from the exported
  // constant so the test pins the bound itself: raise the ceiling and this fails.
  const bigText = Array.from({ length: 501 }, () => 'word').join(' ');
  assert.throws(
    () => boundSurface(record({
      assertions: [{ id: 'INT', kind: 'intention', text: bigText }],
    })),
    (error) => error.code === 'surface-unbounded' && /assertion set/.test(error.message),
  );
});

test('the surface bound refuses an over-large evidence set separately', () => {
  const bigText = Array.from({ length: 501 }, () => 'word').join(' ');
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
  // A fixed 5001-character single token, one over the documented 5000-character
  // bound, held as a literal size rather than derived from the constant.
  const oneHugeToken = 'x'.repeat(5001);
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
  const noWhitespace = '字'.repeat(5001);
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

// --- #123 second-pass remediation: nested prototype pollution, whole-record bounds,
// mode-before-file classification, and a collision proof driven through the public API ---

test('an accepted pair inheriting its members from a prototype cannot manufacture a false clean check', () => {
  // The reproduction: refuseUnknownFields used Object.keys (own only), so an
  // Object.create pair flagged nothing unknown, yet the members were read
  // through the prototype and muted a real high-confidence finding. The nested
  // own-property rule must refuse the inherited pair rather than resolve clean.
  const inheritedPair = Object.create({ assertionId: 'AC-001', evidenceRef: 'ev-1' });
  const input = judged(
    [{ assertionId: 'AC-001', evidenceRef: 'ev-1', confidence: 'high', description: 'real divergence' }],
    { accepted: [inheritedPair] },
  );
  assert.throws(
    () => resolveContradictions(input),
    (error) => error.code === 'invalid-input' && /own property|inherited/i.test(error.message),
  );
});

test('an inherited field on artifact, an assertion, and an evidence item are each refused', () => {
  const inheritedArtifact = Object.assign(Object.create({ id: 'ghost' }), { kind: 'nano-specification' });
  assert.throws(
    () => boundSurface(record({ artifact: inheritedArtifact })),
    (error) => error.code === 'invalid-input' && /own property|inherited/i.test(error.message),
  );

  const inheritedAssertion = Object.assign(Object.create({ id: 'INT' }), { kind: 'intention', text: 'one' });
  assert.throws(
    () => boundSurface(record({ assertions: [inheritedAssertion] })),
    (error) => error.code === 'invalid-input' && /own property|inherited/i.test(error.message),
  );

  const inheritedEvidence = Object.assign(Object.create({ ref: 'ev-1' }), { text: 'one' });
  assert.throws(
    () => boundSurface(record({ evidence: [inheritedEvidence] })),
    (error) => error.code === 'invalid-input' && /own property|inherited/i.test(error.message),
  );
});

test('the identifier ceiling is the surface character ceiling, and an over-long identifier is refused', () => {
  assert.equal(MAX_IDENTIFIER_CHARACTERS, MAX_SURFACE_CHARACTERS,
    'the identifier ceiling is derived from the surface character ceiling, not a fresh literal');
  // A fixed 5001-character identifier, one over the 5000-character ceiling.
  const overLong = 'a'.repeat(5001);
  assert.throws(
    () => boundSurface(record({ artifact: { id: overLong, kind: 'nano-specification' } })),
    (error) => error.code === 'invalid-input' && /identifier ceiling/i.test(error.message),
  );
  assert.throws(
    () => boundSurface(record({
      assertions: [{ id: overLong, kind: 'intention', text: 'one' }],
    })),
    (error) => error.code === 'invalid-input' && /identifier ceiling/i.test(error.message),
  );
});

test('the total of all finding descriptions is bounded separately, naming the finding-description side', () => {
  // Two findings whose descriptions individually fit but together exceed the
  // 5000-character ceiling, proving the bound is on the total description side,
  // not on a single description or on the assertion/evidence sides.
  const half = 'd'.repeat(3000);
  assert.throws(
    () => resolveContradictions(judged(
      [
        { assertionId: 'INT', evidenceRef: 'ev-1', confidence: 'low', description: half },
        { assertionId: 'AC-001', evidenceRef: 'ev-1', confidence: 'low', description: half },
      ],
    )),
    (error) => error.code === 'surface-unbounded'
      && /finding description/i.test(error.message)
      && /character/.test(error.message),
  );
});

test('a duplicate accepted pair is refused as invalid-input, naming the duplicate', () => {
  assert.throws(
    () => resolveContradictions(judged(
      [{ assertionId: 'AC-001', evidenceRef: 'ev-1', confidence: 'high', description: 'x' }],
      {
        accepted: [
          { assertionId: 'AC-001', evidenceRef: 'ev-1' },
          { assertionId: 'AC-001', evidenceRef: 'ev-1' },
        ],
      },
    )),
    (error) => error.code === 'invalid-input'
      && /duplicat/i.test(error.message)
      && /AC-001/.test(error.message),
  );
});

test('an unknown mode returns usage whether or not the path exists, and never writes stdout', () => {
  const existing = path.join(HERE, 'contradiction-check.usage.tmp.json');
  fs.writeFileSync(existing, JSON.stringify(judged([])), 'utf8');
  try {
    for (const target of [existing, path.join(HERE, 'no-such-file.json')]) {
      const captured = [];
      const streams = { stdout: { write: (chunk) => captured.push(chunk) } };
      assert.throws(
        () => run(['--wat', '--input', target], streams),
        (error) => error.code === 'usage',
        `an unknown mode must classify as usage, not as a file failure (${target})`,
      );
      assert.equal(captured.join(''), '', 'a usage failure writes nothing to stdout');
    }
  } finally {
    fs.rmSync(existing, { force: true });
  }
});

test('distinct identifier pairs with punctuation the validator accepts never suppress one another', () => {
  // Drives the public API with identifiers containing quotation marks,
  // backslashes, brackets, and commas — characters the validator accepts — to
  // exercise the collision-proof pairKey encoding rather than only the
  // control-character refusal. A delimiter-joined key would collide the accepted
  // pair (a,b | c) with the finding pair (a | b,c); the JSON encoding keeps them
  // distinct, so the real finding is never muted.
  const input = {
    version: 1,
    artifact: { id: 'spec-x', kind: 'nano-specification' },
    assertions: [
      { id: 'a,b', kind: 'intention', text: 'one' },
      { id: 'a', kind: 'acceptance-criterion', text: 'two' },
      { id: 'p["q"]', kind: 'non-goal', text: 'three' },
    ],
    evidence: [
      { ref: 'c', text: 'e1' },
      { ref: 'b,c', text: 'e2' },
      { ref: 'r\\s', text: 'e3' },
    ],
    accepted: [{ assertionId: 'a,b', evidenceRef: 'c' }],
    findings: [
      { assertionId: 'a,b', evidenceRef: 'c', confidence: 'high', description: 'the accepted divergence' },
      { assertionId: 'a', evidenceRef: 'b,c', confidence: 'high', description: 'a distinct pair, must not be muted' },
      { assertionId: 'p["q"]', evidenceRef: 'r\\s', confidence: 'high', description: 'a bracketed, quoted, backslashed pair' },
    ],
  };
  const result = resolveContradictions(input);
  assert.equal(result.suppressed.length, 1, 'only the exactly-accepted pair is muted');
  assert.equal(result.suppressed[0].assertionId, 'a,b');
  assert.equal(result.suppressed[0].evidenceRef, 'c');
  assert.equal(result.escalated.length, 2, 'the two distinct pairs survive, uncollided');
  assert.ok(result.escalated.some((f) => f.assertionId === 'a' && f.evidenceRef === 'b,c'));
  assert.ok(result.escalated.some((f) => f.assertionId === 'p["q"]' && f.evidenceRef === 'r\\s'));
});

// --- #123 third-pass remediation: the accepted list is bounded by a derived
// ceiling, and finding descriptions carry the character ceiling only ---

test('the accepted list is bounded by the assertion-evidence product, refused as surface-unbounded past it', () => {
  // 3 assertions × 1 evidence ⇒ a product ceiling of 3. Exactly three accepted
  // pairs sit at the ceiling and are accepted; a fourth is one past it. The
  // fourth must name an identifier outside the sets because only three real
  // pairs exist, which proves the refusal is a SIZE ceiling on the count, not a
  // membership rule.
  const atCeiling = boundSurface(record({
    accepted: [
      { assertionId: 'INT', evidenceRef: 'ev-1' },
      { assertionId: 'AC-001', evidenceRef: 'ev-1' },
      { assertionId: 'NG-001', evidenceRef: 'ev-1' },
    ],
  }));
  assert.equal(atCeiling.accepted.length, 3, 'a list exactly at the product ceiling is accepted');

  assert.throws(
    () => boundSurface(record({
      accepted: [
        { assertionId: 'INT', evidenceRef: 'ev-1' },
        { assertionId: 'AC-001', evidenceRef: 'ev-1' },
        { assertionId: 'NG-001', evidenceRef: 'ev-1' },
        { assertionId: 'STALE', evidenceRef: 'ev-1' },
      ],
    })),
    (error) => error.code === 'surface-unbounded'
      && /accepted/i.test(error.message)
      && /\b4\b/.test(error.message)
      && /\b3\b/.test(error.message),
  );
});

test('a stale acceptance naming an identifier absent from the current sets is still tolerated', () => {
  // Acceptances outlive the revision they were made against, so an accepted pair
  // may name an assertion that no longer exists. With 3 assertions × 1 evidence
  // the count ceiling is 3, and this single stale pair is within it; membership
  // is not policed, so the run proceeds and the pair simply mutes nothing it
  // does not exactly name.
  const result = resolveContradictions(judged(
    [{ assertionId: 'AC-001', evidenceRef: 'ev-1', confidence: 'high', description: 'x' }],
    { accepted: [{ assertionId: 'GONE', evidenceRef: 'ev-1' }] },
  ));
  assert.equal(result.verdict, 'escalated', 'the stale acceptance is tolerated and mutes nothing it does not name');
  assert.equal(result.escalated.length, 1);
  assert.equal(result.suppressed.length, 0);
});

test('a finding description carries the character ceiling only, not the word ceiling', () => {
  // 501 single-character words: past the 500-word bound yet only ~1001
  // characters, far under the 5000-character bound. It is accepted, pinning that
  // descriptions carry the character ceiling alone. A description is a bounded
  // description of one divergence, not a claim set, so no word ceiling applies.
  const manyWords = Array.from({ length: 501 }, () => 'w').join(' ');
  assert.equal(manyWords.trim().split(/\s+/).length, 501, '501 whitespace tokens, past the word bound');
  assert.ok(manyWords.length < MAX_SURFACE_CHARACTERS, 'yet well under the character ceiling');
  const result = resolveContradictions(judged([
    { assertionId: 'INT', evidenceRef: 'ev-1', confidence: 'low', description: manyWords },
  ]));
  assert.equal(result.clean, false);
  assert.equal(result.recorded.length, 1, 'the 501-word description is accepted, so the word bound does not apply to it');
});
