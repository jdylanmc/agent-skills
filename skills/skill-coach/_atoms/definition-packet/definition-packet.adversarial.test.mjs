/**
 * Everything a packet could be asked to carry that it must not.
 *
 * Each case here is a way a coaching session could hand back something a caller
 * would act on and could not tell was wrong: a guess wearing the person's
 * voice, a confirmation the coach never had, a file that was never written, or
 * a `ready` sitting on top of an open question. None of them is loud. That is
 * why they are checked mechanically rather than described and hoped for.
 *
 * The fixture is rebuilt here rather than imported from the sibling suite:
 * importing a test module would register its tests a second time.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFIRMATION_CLAIM_NAMES,
  QUOTE_FLOOR,
  WRITE_CLAIM_NAMES,
  run,
  validatePacket,
} from './definition-packet.mjs';

function basePacket(overrides = {}) {
  return {
    schemaVersion: 1,
    skill: 'release-notes',
    status: 'ready',
    coaching: 'coached',
    persona: { status: 'adopted', path: 'agents/skill-coach.agent.md', digest: 'a'.repeat(64) },
    definition: {
      interaction: 'The author asks for release notes for a tag.',
      outcome: 'A draft the author edits.',
      agreement: 'in-conversation',
      quote: 'I want it to draft the notes and then get out of my way.',
    },
    explored: [
      {
        subject: 'failure behaviour',
        finding: 'A missing tag stops the run.',
        source: 'human',
        quote: 'if the tag is not there I would rather it just told me',
      },
    ],
    decisions: [
      {
        decision: 'It drafts and never publishes.',
        reasoning: 'Publishing is irreversible.',
        quote: 'nothing goes out without me reading it first',
      },
    ],
    recommendations: [],
    examples: [],
    unsettled: [],
    ...overrides,
  };
}

function codesFor(packet) {
  const result = validatePacket(packet);
  assert.equal(result.status, 'refused', 'the packet was accepted when it should have been refused');
  return result.defects.map((defect) => defect.code);
}

function paths(packet) {
  return validatePacket(packet).defects.map((defect) => defect.path);
}

test('a packet claiming the operator confirmed something is refused by name', () => {
  for (const field of ['confirmed', 'operator_confirmed', 'approved', 'intentPath', 'storedIntent', 'signOff']) {
    const packet = basePacket();
    packet[field] = true;
    assert.ok(
      codesFor(packet).includes('forged_confirmation'),
      `${field} must be refused as a forged confirmation, not as an anonymous unknown field`,
    );
  }
});

test('a confirmation claim nested inside a section is refused too', () => {
  const packet = basePacket();
  packet.definition.confirmation = 'sha256:deadbeef';
  const result = validatePacket(packet);
  assert.equal(result.status, 'refused');
  assert.ok(
    result.defects.some(
      (defect) => defect.code === 'forged_confirmation' && defect.path === 'definition.confirmation',
    ),
    'a confirmation smuggled one level down is still a confirmation',
  );
});

test('a packet reporting files it wrote is refused, because coaching writes nothing', () => {
  for (const field of ['files', 'writtenFiles', 'packagePath', 'intent_file']) {
    const packet = basePacket();
    packet[field] = ['skills/release-notes/SKILL.md'];
    assert.ok(codesFor(packet).includes('write_claim'), `${field} must be refused as a write claim`);
  }
});

test('every named confirmation and write claim is outside the allowed shape', () => {
  // A name in either list that the packet also allows would make the refusal
  // unreachable, which is how a guard reports every packet as clean.
  for (const name of [...CONFIRMATION_CLAIM_NAMES, ...WRITE_CLAIM_NAMES]) {
    const packet = basePacket();
    packet[name] = 'x';
    const codes = codesFor(packet);
    assert.ok(
      codes.includes('forged_confirmation') || codes.includes('write_claim'),
      `${name} is listed as a claim but reaches no refusal`,
    );
  }
});

test('a field the packet has no place for is refused rather than ignored', () => {
  assert.ok(codesFor(basePacket({ severity: 'blocker' })).includes('unknown_field'));
  const packet = basePacket();
  packet.explored[0].verdict = 'apply';
  assert.ok(codesFor(packet).includes('unknown_field'));
});

test('a ready packet carrying a blocking open question is refused', () => {
  const packet = basePacket({
    unsettled: [
      {
        question: 'What may it publish to?',
        whyItMatters: 'Nobody can grant a permission nobody has named.',
        blocking: true,
      },
    ],
  });
  assert.ok(codesFor(packet).includes('disguised_unsettled'));
});

test('ready is refused without agreement, out of a degraded run, and with nothing explored', () => {
  const withoutAgreement = basePacket();
  withoutAgreement.definition.agreement = 'none';
  assert.ok(codesFor(withoutAgreement).includes('unsupported_ready'));

  const degraded = basePacket({
    coaching: 'degraded',
    persona: { status: 'unavailable', reason: 'no candidate resolved' },
  });
  assert.ok(codesFor(degraded).includes('unsupported_ready'));

  assert.ok(codesFor(basePacket({ explored: [] })).includes('unsupported_ready'));
});

test('a degraded persona cannot be reported as a coached run', () => {
  const packet = basePacket({
    status: 'unsettled',
    persona: { status: 'unavailable', reason: 'no candidate resolved' },
  });
  assert.ok(codesFor(packet).includes('degraded_mismatch'));
});

test('a persona records a path and digest only when it was actually adopted', () => {
  const adoptedWithoutEvidence = basePacket({ persona: { status: 'adopted' } });
  assert.deepEqual(
    paths(adoptedWithoutEvidence).filter((location) => location.startsWith('persona.')).sort(),
    ['persona.digest', 'persona.path'],
  );

  const unavailableWithEvidence = basePacket({
    status: 'unsettled',
    coaching: 'degraded',
    persona: { status: 'unavailable', reason: 'no candidate resolved', path: 'agents/skill-coach.agent.md' },
  });
  assert.ok(codesFor(unavailableWithEvidence).includes('invalid_value'));
});

test('a claim attributed to the person needs the person\'s own words behind it', () => {
  const noQuote = basePacket();
  delete noQuote.explored[0].quote;
  assert.ok(codesFor(noQuote).includes('missing_field'));

  const thinQuote = basePacket();
  thinQuote.explored[0].quote = 'x'.repeat(QUOTE_FLOOR - 1);
  assert.ok(codesFor(thinQuote).includes('unsupported_quote'));

  const thinDecision = basePacket();
  thinDecision.decisions[0].quote = 'sure';
  assert.ok(codesFor(thinDecision).includes('unsupported_quote'));
});

test('a coach finding is not required to quote the person, because it is the coach\'s', () => {
  const packet = basePacket({
    explored: [
      { subject: 'overlap', finding: 'An existing skill already parses commits.', source: 'coach' },
      {
        subject: 'failure behaviour',
        finding: 'A missing tag stops the run.',
        source: 'human',
        quote: 'if the tag is not there I would rather it just told me',
      },
    ],
  });
  assert.equal(validatePacket(packet).status, 'valid');
});

test('an accepted or rejected recommendation carries the reason it was accepted or rejected', () => {
  for (const disposition of ['accepted', 'rejected']) {
    const packet = basePacket({
      recommendations: [{ recommendation: 'Split it in two.', disposition }],
    });
    assert.ok(
      codesFor(packet).includes('unattributed_disposition'),
      `a ${disposition} recommendation with no reasoning attributes a choice to nobody`,
    );
  }

  const open = basePacket({ recommendations: [{ recommendation: 'Split it in two.', disposition: 'open' }] });
  assert.equal(validatePacket(open).status, 'valid', 'an open recommendation has no decision to attribute');
});

test('an open question with no blocking marker is refused', () => {
  const packet = basePacket({
    status: 'unsettled',
    unsettled: [{ question: 'What may it publish to?', whyItMatters: 'It sets the permission.' }],
  });
  assert.ok(codesFor(packet).includes('invalid_value'));
});

test('a wrong schema version, status, or section type is refused rather than coerced', () => {
  assert.ok(codesFor(basePacket({ schemaVersion: 2 })).includes('invalid_value'));
  assert.ok(codesFor(basePacket({ status: 'shipped' })).includes('invalid_value'));
  assert.ok(codesFor(basePacket({ coaching: 'partial' })).includes('invalid_value'));
  assert.ok(codesFor(basePacket({ explored: 'none' })).includes('invalid_value'));
  assert.ok(codesFor(basePacket({ decisions: ['a decision'] })).includes('invalid_value'));
  assert.ok(codesFor(basePacket({ skill: '' })).includes('invalid_value'));
  for (const packet of [null, [], 'a packet', 7]) {
    assert.equal(validatePacket(packet).status, 'refused');
  }
});

test('every defect is returned together, not just the first one found', () => {
  const packet = basePacket({
    status: 'ready',
    explored: [],
    unsettled: [{ question: 'What may it publish to?', whyItMatters: 'It sets the permission.', blocking: true }],
  });
  packet.confirmed = true;
  packet.files = ['skills/release-notes/SKILL.md'];
  packet.definition.agreement = 'none';

  const codes = new Set(codesFor(packet));
  for (const expected of ['forged_confirmation', 'write_claim', 'disguised_unsettled', 'unsupported_ready']) {
    assert.ok(codes.has(expected), `a caller fixing this packet needs to be told about ${expected}`);
  }
});

test('a refused packet exits 2 and names its defects on standard output', () => {
  const out = [];
  const streams = { stdout: { write: (value) => out.push(value) }, stderr: { write: () => {} } };
  const packet = basePacket();
  packet.approved = true;
  const code = run(['--stdin'], streams, () => JSON.stringify(packet));
  assert.equal(code, 2);
  const result = JSON.parse(out.join(''));
  assert.equal(result.status, 'refused');
  assert.deepEqual(result.defects.map((defect) => defect.path), ['packet.approved']);
});
