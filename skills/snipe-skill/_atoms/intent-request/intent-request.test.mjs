/**
 * Seam tests for intent-request.
 *
 * Two properties are worth holding. The output contract Skill Sniper asks for is
 * stated in full and never inferred; and a result is usable only when it is
 * bound to this run's source, this run's contract terms, this run's candidate,
 * and the exact bytes the operator will be shown.
 *
 * There is deliberately no test of a capability probe, because there is no
 * probe. The unit that read a provider's frontmatter looking for a declared
 * capability was deleted, and with it the class of parser bug that defeated four
 * successive readers. A test asserting "an undeclared capability blocks the run"
 * would be asserting the behaviour this change exists to remove.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  INTENT_OUTPUT_CONTRACT,
  REQUEST_FAILURES,
  SYNTHESIS_PROVIDER,
  assertIntentResult,
  buildIntentRequest,
} from './intent-request.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function refusal(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

const BINDING = { digest: 'a'.repeat(64) };
const INTENT_TEXT = '# Intent: demo\n\nWhat this is for.\n';

const ATTEMPT = { slug: 'demo', runId: 'run-1', attempt: 1 };

function goodResult(request) {
  const candidateDigest = sha256(INTENT_TEXT);
  return {
    status: 'complete',
    synthesizedBy: SYNTHESIS_PROVIDER,
    profileId: `declared:${'0'.repeat(64)}`,
    contractTerms: INTENT_OUTPUT_CONTRACT,
    sourceDigest: BINDING.digest,
    candidatePath: request.candidate,
    candidateDigest,
    intentText: INTENT_TEXT,
    ledger: {
      status: 'clean',
      profileId: `declared:${'0'.repeat(64)}`,
      candidatePath: request.candidate,
      candidateDigest,
      digest: 'c'.repeat(64),
      entries: [{ id: 'purpose', disposition: 'retained' }],
    },
  };
}

test('the output contract is stated in full, and its terms cannot be edited at run time', () => {
  for (const term of [
    'goal', 'sourceKind', 'variantKind', 'workspaceRoot', 'outputPattern',
    'wordBudget', 'requiredContent', 'nonOmittableKinds', 'structuralHeadings',
  ]) {
    assert.ok(INTENT_OUTPUT_CONTRACT[term] !== undefined, `the reduction states no ${term}`);
  }
  assert.equal(INTENT_OUTPUT_CONTRACT.wordBudget, 500);
  assert.ok(INTENT_OUTPUT_CONTRACT.goal.length >= 24, 'the goal must say what the artifact is for');
  // The goal is worded for the two things the result has to survive: a byte-exact
  // operator confirmation, and the destination's own skill-creation workflow.
  assert.match(INTENT_OUTPUT_CONTRACT.goal, /plain requirements/);
  assert.match(INTENT_OUTPUT_CONTRACT.goal, /operator confirmation/);
  assert.match(INTENT_OUTPUT_CONTRACT.goal, /create-skill input/);
  assert.ok(INTENT_OUTPUT_CONTRACT.requiredContent.length > 0);
  assert.ok(INTENT_OUTPUT_CONTRACT.nonOmittableKinds.length > 0);
  assert.throws(() => { INTENT_OUTPUT_CONTRACT.wordBudget = 10_000; }, TypeError);
  assert.throws(() => { INTENT_OUTPUT_CONTRACT.requiredContent.length = 0; }, TypeError);
});

test('the required content is meaning, not the machinery of where the source lived', () => {
  // An intent that named its own source file would be a machine-facing document
  // instead of plain requirements, and would prove nothing: traceability is the
  // ledger's job.
  for (const machinery of ['source-path', 'source-identity', 'source-revision', 'digest']) {
    assert.ok(!INTENT_OUTPUT_CONTRACT.requiredContent.includes(machinery), machinery);
  }
  assert.deepEqual([...INTENT_OUTPUT_CONTRACT.requiredContent], ['subject', 'purpose', 'requirements', 'refusals']);
});

test('nothing about the provider is detected, so no document can declare or withhold a capability', async () => {
  // The frontmatter probe and its parser were deleted rather than fixed. This
  // asserts their absence against the real package: a reader that came back
  // would bring back the bug it was defeated by four times.
  const unit = await import('./intent-request.mjs');
  assert.deepEqual(Object.keys(unit).sort(), [
    'INTENT_OUTPUT_CONTRACT', 'IntentRequestError', 'REQUEST_FAILURES',
    'SYNTHESIS_PROVIDER', 'assertIntentResult', 'buildIntentRequest',
  ], 'the seam is two functions and the contract they carry, and stays that size');
  // Scanned with comments stripped: the module explains the deleted probe in
  // prose, and that history is worth keeping. What must not come back is code
  // that reads a document looking for a capability.
  const source = fs
    .readFileSync(path.join(ROOT, 'skills', 'snipe-skill', '_atoms', 'intent-request', 'intent-request.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const construct of ['---', 'frontmatter', 'JSON.parse', 'readFileSync']) {
    assert.ok(!source.includes(construct), `${construct} must not come back into the code`);
  }
  // That no phrase from the operator's intent was promoted to an identifier is
  // asserted once, package-wide, in snipe-skill.conformance.test.mjs. Repeating
  // it here would mean writing the phrase into a file the sweep then has to
  // excuse.
});

test('the request names one bundle, its one candidate, and the revision this run bound', () => {
  const request = buildIntentRequest({ binding: BINDING, slug: 'demo-adopter', runId: 'run-1', attempt: 1 });
  assert.deepEqual(request, {
    skill: 'synthesize',
    want: INTENT_OUTPUT_CONTRACT,
    slug: 'demo-adopter',
    runId: 'run-1',
    attempt: 1,
    source: 'synthesis/intent/s12-demo-adopter-r5-run-1-a1.bundle.md',
    candidate: 'synthesis/intent/s12-demo-adopter-r5-run-1-a1.intent.md',
    revision: BINDING.digest,
  });
  // The revision handed over is the digest intake pinned, never a label.
  assert.equal(request.revision, BINDING.digest);
  assert.equal(
    buildIntentRequest({ binding: BINDING, slug: 'two-word', runId: 'run-1', attempt: 1 }).candidate,
    'synthesis/intent/s8-two-word-r5-run-1-a1.intent.md',
  );
});

test('every corrected attempt gets its own bundle and candidate, over the same binding', () => {
  // The correction loop is the reason the confirmation gate exists: the operator
  // reads the proposed requirements, corrects them, and the reduction is asked
  // for again. Reusing the first attempt's candidate path made the provider
  // refuse the second with `replacement-not-authorized`, so the loop could not
  // turn at all.
  const seenSources = new Set();
  const seenCandidates = new Set();
  for (const attempt of [1, 2, 3, 17]) {
    const request = buildIntentRequest({ binding: BINDING, slug: 'demo-adopter', runId: 'run-1', attempt });
    assert.equal(request.attempt, attempt);
    assert.equal(request.source, `synthesis/intent/s12-demo-adopter-r5-run-1-a${attempt}.bundle.md`);
    assert.equal(request.candidate, `synthesis/intent/s12-demo-adopter-r5-run-1-a${attempt}.intent.md`);
    assert.ok(!seenSources.has(request.source), `attempt ${attempt} reuses a bundle path`);
    assert.ok(!seenCandidates.has(request.candidate), `attempt ${attempt} reuses a candidate path`);
    seenSources.add(request.source);
    seenCandidates.add(request.candidate);
    // A correction changes what is asked for, never which bytes are reduced.
    assert.equal(request.revision, BINDING.digest);
    assert.deepEqual(request.want, INTENT_OUTPUT_CONTRACT);
  }
  // Attempt one is numbered like the rest; a special case for it is exactly
  // where the collision would grow back.
  assert.match(buildIntentRequest({ binding: BINDING, slug: 'demo', runId: 'run-1', attempt: 1 }).candidate, /-a1\.intent\.md$/);
});

test('a later run for the same subject cannot reuse an earlier run candidate', () => {
  const first = buildIntentRequest({ binding: BINDING, slug: 'demo-adopter', runId: 'run-1', attempt: 1 });
  const later = buildIntentRequest({ binding: BINDING, slug: 'demo-adopter', runId: 'run-2', attempt: 1 });
  assert.notEqual(first.source, later.source);
  assert.notEqual(first.candidate, later.candidate);
  assert.equal(first.revision, later.revision);
});

test('variable-width subject and run slugs cannot encode to the same request identity', () => {
  const first = buildIntentRequest({ binding: BINDING, slug: 'demo', runId: 'run-1', attempt: 1 });
  const second = buildIntentRequest({ binding: BINDING, slug: 'demo-run', runId: '1', attempt: 1 });
  assert.notEqual(first.source, second.source);
  assert.notEqual(first.candidate, second.candidate);
  assert.equal(
    refusal(() => assertIntentResult(goodResult(first), BINDING, second)).code,
    REQUEST_FAILURES.substitutionForbidden,
  );
});

test('a hand-built request cannot claim an attempt it does not carry', () => {
  // Shape-checking the request let one be assembled by hand: naming attempt two
  // while carrying attempt one's paths, it accepted attempt one's result and
  // reported it as attempt two - a superseded proposal presented as the
  // corrected one. The request is rebuilt from its parts and compared instead.
  const honest = buildIntentRequest({ binding: BINDING, slug: 'demo', runId: 'run-1', attempt: 1 });
  const record = goodResult(honest);
  for (const forged of [
    { ...honest, attempt: 2 },
    { ...honest, slug: 'other' },
    { ...honest, runId: 'run-2' },
    { ...honest, candidate: 'synthesis/intent/other-attempt-1.intent.md' },
    { ...honest, source: 'synthesis/intent/other-attempt-1.bundle.md' },
    { ...honest, revision: 'b'.repeat(64) },
    { ...honest, skill: 'somebody-else' },
  ]) {
    assert.equal(refusal(() => assertIntentResult(record, BINDING, forged)).code, REQUEST_FAILURES.usage, JSON.stringify(forged.attempt ?? forged.slug));
  }
  // Rebuilding keeps transport working: a serialized round trip is the same
  // request and is still accepted.
  assert.equal(assertIntentResult(record, BINDING, JSON.parse(JSON.stringify(honest))).attempt, 1);
});

test('an attempt number past safe integers is refused, not silently collided', () => {
  // Two distinct attempt numbers past `Number.MAX_SAFE_INTEGER` stringify
  // identically, so they would derive one path - the collision this identity
  // exists to prevent, reached by arithmetic rather than by reuse.
  for (const attempt of [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 2, Infinity]) {
    assert.equal(
      refusal(() => buildIntentRequest({ binding: BINDING, slug: 'demo', runId: 'run-1', attempt })).code,
      REQUEST_FAILURES.usage,
      String(attempt),
    );
  }
  assert.equal(buildIntentRequest({ binding: BINDING, slug: 'demo', runId: 'run-1', attempt: Number.MAX_SAFE_INTEGER }).attempt, Number.MAX_SAFE_INTEGER);
});

test('contract terms must be own properties, not inherited ones', () => {
  // Counting keys and then reading through the prototype accepted an object
  // carrying the right NUMBER of junk own keys while inheriting the expected
  // ones - terms that are not on the object at all.
  const request = buildIntentRequest({ binding: BINDING, ...ATTEMPT });
  const disguised = Object.create(INTENT_OUTPUT_CONTRACT);
  for (const key of Object.keys(INTENT_OUTPUT_CONTRACT)) disguised[`junk-${key}`] = 1;
  assert.equal(Object.keys(disguised).length, Object.keys(INTENT_OUTPUT_CONTRACT).length);
  assert.equal(
    refusal(() => assertIntentResult({ ...goodResult(request), contractTerms: disguised }, BINDING, request)).code,
    REQUEST_FAILURES.substitutionForbidden,
  );
});

test('a result is bound to the attempt that asked for it', () => {
  // Attempt two must not be confirmable against attempt one's candidate, or the
  // superseded proposal could be presented as the corrected one.
  const first = buildIntentRequest({ binding: BINDING, slug: 'demo', runId: 'run-1', attempt: 1 });
  const second = buildIntentRequest({ binding: BINDING, slug: 'demo', runId: 'run-1', attempt: 2 });
  assert.equal(assertIntentResult(goodResult(first), BINDING, first).attempt, 1);
  assert.equal(
    refusal(() => assertIntentResult(goodResult(first), BINDING, second)).code,
    REQUEST_FAILURES.substitutionForbidden,
  );
  assert.equal(
    refusal(() => assertIntentResult(goodResult(second), BINDING, first)).code,
    REQUEST_FAILURES.substitutionForbidden,
  );
});

test('a subject or attempt that is not one is refused before the provider is invoked', () => {
  // The caller names a subject and an attempt; it does not hand in a path, so
  // there is no path to point somewhere else.
  for (const slug of ['/demo', '../demo', 'C:/demo', 'sub/demo', 'Demo', 'demo.bundle', '', undefined, 7]) {
    assert.equal(
      refusal(() => buildIntentRequest({ binding: BINDING, slug, runId: 'run-1', attempt: 1 })).code,
      REQUEST_FAILURES.usage,
      String(slug),
    );
  }
  for (const runId of ['/run', '../run', 'run/id', 'Run', '', undefined, 7]) {
    assert.equal(
      refusal(() => buildIntentRequest({ binding: BINDING, slug: 'demo', runId, attempt: 1 })).code,
      REQUEST_FAILURES.usage,
      String(runId),
    );
  }
  for (const attempt of [0, -1, 1.5, '1', undefined, null, Number.NaN]) {
    assert.equal(
      refusal(() => buildIntentRequest({ binding: BINDING, slug: 'demo', runId: 'run-1', attempt })).code,
      REQUEST_FAILURES.usage,
      String(attempt),
    );
  }
  assert.equal(refusal(() => buildIntentRequest({ slug: 'demo', runId: 'run-1', attempt: 1 })).code, REQUEST_FAILURES.usage);
  assert.equal(
    refusal(() => buildIntentRequest({ binding: { digest: 'short' }, slug: 'demo', runId: 'run-1', attempt: 1 })).code,
    REQUEST_FAILURES.usage,
  );
});

test('a result is bound to the provider, the contract terms, the source, the candidate, the ledger, and the bytes', () => {
  const request = buildIntentRequest({ binding: BINDING, ...ATTEMPT });
  const record = goodResult(request);
  assert.deepEqual(assertIntentResult(record, BINDING, request), {
    permitted: true,
    attempt: 1,
    contractId: `declared:${'0'.repeat(64)}`,
    sourceDigest: BINDING.digest,
    candidatePath: request.candidate,
    candidateDigest: sha256(INTENT_TEXT),
    ledgerDigest: 'c'.repeat(64),
    ledgerAuthenticated: false,
  });

  assert.equal(SYNTHESIS_PROVIDER, 'synthesize');
  for (const producer of ['snipe-skill', 'synthesize-skill', 'the model', undefined]) {
    assert.equal(
      refusal(() => assertIntentResult({ ...record, synthesizedBy: producer }, BINDING, request)).code,
      REQUEST_FAILURES.localSynthesisForbidden,
      String(producer),
    );
  }

  // Terms this request did not state are a different contract, however the run
  // labels itself.
  for (const contractTerms of [
    { ...INTENT_OUTPUT_CONTRACT, wordBudget: 5000 },
    { ...INTENT_OUTPUT_CONTRACT, nonOmittableKinds: [] },
    { ...INTENT_OUTPUT_CONTRACT, requiredContent: ['subject'] },
    { ...INTENT_OUTPUT_CONTRACT, goal: 'something else entirely, at some other level of detail' },
    undefined,
    'whatever you think best',
  ]) {
    assert.equal(
      refusal(() => assertIntentResult({ ...record, contractTerms }, BINDING, request)).code,
      REQUEST_FAILURES.substitutionForbidden,
      JSON.stringify(contractTerms),
    );
  }
  assert.equal(
    refusal(() => assertIntentResult({ ...record, profileId: '  ' }, BINDING, request)).code,
    REQUEST_FAILURES.substitutionForbidden,
  );

  // A candidate this request did not ask for is a reduction of something else.
  for (const stray of [
    'docs/agent/specs/demo.nano.md',
    'synthesis/intent/other.intent.md',
    '../../outside/demo.intent.md',
    'synthesis/intent/demo.md',
    undefined,
  ]) {
    assert.equal(
      refusal(() => assertIntentResult({ ...record, candidatePath: stray }, BINDING, request)).code,
      REQUEST_FAILURES.substitutionForbidden,
      String(stray),
    );
  }

  // A run that refused, split, or blocked produced nothing to confirm.
  for (const status of ['refused', 'needs-split', 'blocked', 'stale-source', undefined]) {
    assert.equal(
      refusal(() => assertIntentResult({ ...record, status }, BINDING, request)).code,
      REQUEST_FAILURES.outcomeNotComplete,
      String(status),
    );
  }

  // A reduction of other bytes cannot stand in for this one.
  assert.equal(
    refusal(() => assertIntentResult({ ...record, sourceDigest: 'b'.repeat(64) }, BINDING, request)).code,
    REQUEST_FAILURES.sourceMismatch,
  );

  // The bytes to be shown must be the bytes the record says it produced. This is
  // the one digest this package recomputes itself.
  assert.equal(
    refusal(() => assertIntentResult({ ...record, intentText: `${INTENT_TEXT}And one more thing.\n` }, BINDING, request)).code,
    REQUEST_FAILURES.candidateMismatch,
  );
  for (const change of [{ intentText: '   ' }, { intentText: 7 }, { candidateDigest: 'nope' }, { candidateDigest: undefined }]) {
    assert.equal(
      refusal(() => assertIntentResult({ ...record, ...change }, BINDING, request)).code,
      REQUEST_FAILURES.candidateMismatch,
      JSON.stringify(change),
    );
  }

  // The ledger must be a clean account of THIS candidate under THIS contract.
  for (const ledger of [
    undefined,
    'kept 4, merged 1, dropped 2',
    {},
    { ...record.ledger, status: 'defective' },
    { ...record.ledger, profileId: 'declared:something-else' },
    { ...record.ledger, candidatePath: 'docs/agent/specs/wrong.nano.md' },
    { ...record.ledger, candidateDigest: 'b'.repeat(64) },
    { ...record.ledger, digest: 'nope' },
    { ...record.ledger, entries: [] },
    { ...record.ledger, entries: [null] },
    { ...record.ledger, entries: [{ disposition: 'retained' }] },
  ]) {
    assert.equal(
      refusal(() => assertIntentResult({ ...record, ledger }, BINDING, request)).code,
      REQUEST_FAILURES.unaccountedReduction,
      JSON.stringify(ledger),
    );
  }

  // A request that crossed a process boundary is the same request. Recognising
  // it by object identity refused the ordinary way this call is made.
  const transported = JSON.parse(JSON.stringify(request));
  assert.equal(assertIntentResult(record, BINDING, transported).permitted, true);
  // A sparse term list constrains nothing while wearing the shape of one.
  assert.equal(
    refusal(() => assertIntentResult(
      { ...record, contractTerms: { ...INTENT_OUTPUT_CONTRACT, requiredContent: Array(INTENT_OUTPUT_CONTRACT.requiredContent.length) } },
      BINDING,
      request,
    )).code,
    REQUEST_FAILURES.substitutionForbidden,
  );
  // A record echoing these terms while reporting a NAMED profile contradicts
  // itself: a named profile is a settled contract with different terms.
  for (const profileId of ['spec-nano', 'declared:abcd', 'declared:', 'intent', 42]) {
    assert.equal(
      refusal(() => assertIntentResult({ ...record, profileId }, BINDING, request)).code,
      REQUEST_FAILURES.substitutionForbidden,
      String(profileId),
    );
  }
  assert.equal(refusal(() => assertIntentResult(record, BINDING)).code, REQUEST_FAILURES.usage);
  assert.equal(refusal(() => assertIntentResult(record, BINDING, { candidate: request.candidate })).code, REQUEST_FAILURES.usage);
  assert.equal(refusal(() => assertIntentResult(record, BINDING, { ...request, attempt: 0 })).code, REQUEST_FAILURES.usage);
  assert.equal(refusal(() => assertIntentResult(record, BINDING, { ...request, source: undefined })).code, REQUEST_FAILURES.usage);
  assert.equal(refusal(() => assertIntentResult(record)).code, REQUEST_FAILURES.usage);
  assert.equal(refusal(() => assertIntentResult('go ahead', BINDING, request)).code, REQUEST_FAILURES.usage);
});

test('which fields the provider supplied and which this run stamped on is distinguishable', () => {
  // A check against a field the caller wrote itself proves nothing about the
  // provider. `synthesizedBy` records which provider this run invoked and
  // `intentText` is the candidate bytes it read back, so neither corroborates
  // anything the provider said; the unit document says so rather than leaving a
  // reader to read the whole check as verified provenance.
  const request = buildIntentRequest({ binding: BINDING, ...ATTEMPT });
  const record = goodResult(request);
  for (const field of ['status', 'profileId', 'contractTerms', 'sourceDigest', 'candidatePath', 'candidateDigest', 'ledger']) {
    assert.ok(record[field] !== undefined, `the provider supplies no ${field}`);
  }
  const document = fs.readFileSync(path.join(ROOT, 'skills', 'snipe-skill', '_atoms', 'intent-request', 'intent-request.md'), 'utf8');
  assert.match(document, /corroborates nothing the provider said/i);
  assert.equal(assertIntentResult(record, BINDING, request).ledgerAuthenticated, false);
});
