import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTRACT_STATUSES,
  ContractResolutionError,
  EXIT_ACCEPTED,
  EXIT_FINDINGS,
  PROCEDURE_SECTIONS,
  exitCodeFor,
  resolveContract,
} from './qa-contract.mjs';

const CONTRACT = { id: 'refunds', revision: '3' };

function gherkin(overrides = {}) {
  return {
    status: 'clean',
    findings: [],
    scenarios: [{ identity: 'refund-granted', name: 'A refund is granted' }],
    ...overrides,
  };
}

function procedure(overrides = {}) {
  return {
    id: 'refund-through-the-app',
    revision: '2',
    sections: [...PROCEDURE_SECTIONS],
    ...overrides,
  };
}

function traceability(overrides = {}) {
  return {
    status: 'complete',
    findings: [],
    rows: [{ requirement: 'R1', evidence: ['refund-granted'] }, { requirement: 'R2', evidence: ['refund-through-the-app'] }],
    ...overrides,
  };
}

function constraints(overrides = {}) {
  return {
    status: 'constrained',
    findings: [],
    producers: [
      { id: 'refund-granted', requirementIds: ['R1'], traceabilityIds: ['T1'] },
      { id: 'refund-through-the-app', requirementIds: ['R2'], traceabilityIds: ['T2'] },
    ],
    ...overrides,
  };
}

function contract(overrides = {}) {
  return {
    contract: CONTRACT,
    rules: [{ id: 'R1', decidable: true }, { id: 'R2', decidable: true }],
    gherkin: gherkin(),
    procedures: [procedure()],
    traceability: traceability(),
    constraints: constraints(),
    ...overrides,
  };
}

function codes(result) {
  return result.findings.map((entry) => entry.code).sort();
}

test('a contract whose parts reconcile is designed', () => {
  const result = resolveContract(contract());

  assert.equal(result.status, 'designed');
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.rules, { declared: 2, undecidable: [] });
  assert.equal(result.proof.designedOnly, true);
});

test('an unresolved high Gherkin finding stops the contract reporting designed', () => {
  const result = resolveContract(contract({
    gherkin: gherkin({
      status: 'findings',
      findings: [
        { code: 'missing-then', severity: 'high', location: 'A refund is granted line 4', detail: 'no Then step' },
      ],
    }),
  }));

  assert.equal(result.status, 'unresolved');
  assert.deepEqual(codes(result), ['unresolved-gherkin-finding']);
  assert.match(result.findings[0].detail, /missing-then/);
});

test('an advisory Gherkin finding is carried without blocking the contract', () => {
  const result = resolveContract(contract({
    gherkin: gherkin({
      status: 'findings',
      findings: [
        { code: 'ambiguous-language', severity: 'medium', location: 'A refund is granted line 6', detail: '"correctly"' },
      ],
    }),
  }));

  assert.equal(result.status, 'designed');
  assert.deepEqual(result.findings, []);
  assert.equal(result.parts.gherkin, 'findings');
});

test('a procedure missing a required section stops the contract reporting designed', () => {
  const result = resolveContract(contract({
    procedures: [procedure({ sections: PROCEDURE_SECTIONS.filter((section) => section !== 'pass-fail') })],
  }));

  assert.equal(result.status, 'unresolved');
  assert.deepEqual(codes(result), ['incomplete-procedure']);
  assert.match(result.findings[0].detail, /pass-fail/);
  assert.deepEqual(result.parts.procedures[0].missingSections, ['pass-fail']);
});

test('a broken reconciliation makes the contract inconsistent rather than merely gapped', () => {
  const brokenMap = resolveContract(contract({ traceability: traceability({ status: 'invalid' }) }));
  const brokenConstraints = resolveContract(contract({ constraints: constraints({ status: 'invalid' }) }));
  const unparsed = resolveContract(contract({ gherkin: gherkin({ status: 'parse-failed' }) }));

  assert.equal(brokenMap.status, 'inconsistent');
  assert.equal(brokenConstraints.status, 'inconsistent');
  assert.equal(unparsed.status, 'inconsistent');
});

test('a specification with no decidable rule is underspecified before anything else is judged', () => {
  const undecidable = resolveContract(contract({
    rules: [{ id: 'R1', decidable: true }, { id: 'R2', decidable: false }],
    traceability: traceability({ status: 'invalid' }),
  }));
  const empty = resolveContract(contract({ rules: [] }));

  assert.equal(undecidable.status, 'underspecified');
  assert.deepEqual(undecidable.rules.undecidable, ['R2']);
  assert.equal(empty.status, 'underspecified');
});

test('a declared gap is reported as gaps once everything else reconciles', () => {
  const result = resolveContract(contract({ traceability: traceability({ status: 'gaps' }) }));

  assert.equal(result.status, 'gaps');
  assert.deepEqual(result.findings, []);
});

test('unfinished work outranks a declared gap', () => {
  const result = resolveContract(contract({
    traceability: traceability({ status: 'gaps' }),
    procedures: [procedure({ sections: [] })],
  }));

  assert.equal(result.status, 'unresolved');
});

test('a producer proving a requirement the map never declared is caught by the contract', () => {
  const result = resolveContract(contract({
    constraints: constraints({
      producers: [
        { id: 'refund-granted', requirementIds: ['R1'], traceabilityIds: ['T1'] },
        { id: 'refund-through-the-app', requirementIds: ['R9'], traceabilityIds: ['T2'] },
      ],
    }),
  }));

  assert.equal(result.status, 'inconsistent');
  assert.deepEqual(codes(result), ['producer-outside-contract']);
  assert.match(result.findings[0].detail, /R9/);
});

test('a scenario or procedure with no execution constraints is caught by the contract', () => {
  const result = resolveContract(contract({
    constraints: constraints({ producers: [] }),
  }));

  assert.equal(result.status, 'inconsistent');
  assert.deepEqual(codes(result), ['procedure-without-producer', 'scenario-without-producer']);
});

test('two procedures sharing an identity are caught before either is packaged', () => {
  const result = resolveContract(contract({
    procedures: [procedure(), procedure()],
  }));

  assert.equal(result.status, 'inconsistent');
  assert.deepEqual(codes(result), ['duplicate-procedure-id']);
});

test('every producer report identity carries the contract identity and revision', () => {
  const result = resolveContract(contract());

  assert.deepEqual(result.contract, { id: 'refunds', revision: '3' });
  assert.deepEqual(result.reportIdentities, [
    {
      producer: 'refund-granted',
      contractId: 'refunds',
      contractRevision: '3',
      requirementIds: ['R1'],
      traceabilityIds: ['T1'],
    },
    {
      producer: 'refund-through-the-app',
      contractId: 'refunds',
      contractRevision: '3',
      requirementIds: ['R2'],
      traceabilityIds: ['T2'],
    },
  ]);
});

test('a contract with no identity or revision is refused rather than resolved', () => {
  for (const identity of [undefined, {}, { id: 'refunds' }, { id: 'refunds', revision: '' }, { id: '-bad', revision: '1' }]) {
    assert.throws(() => resolveContract(contract({ contract: identity })), (error) => {
      assert.ok(error instanceof ContractResolutionError);
      assert.equal(error.code, 'invalid_input');
      return true;
    });
  }
});

test('a malformed part report is refused rather than resolved around', () => {
  assert.throws(() => resolveContract(contract({ traceability: { status: 'fine', findings: [] } })), (error) => {
    assert.equal(error.code, 'invalid_input');
    return true;
  });
  assert.throws(() => resolveContract(contract({ rules: [{ id: 'R1' }] })), (error) => {
    assert.equal(error.code, 'invalid_input');
    return true;
  });
});

test('a design with no Gherkin at all still resolves', () => {
  const result = resolveContract(contract({
    gherkin: null,
    traceability: traceability({ rows: [{ requirement: 'R2', evidence: ['refund-through-the-app'] }, { requirement: 'R1', evidence: ['example-r1-success'] }] }),
    constraints: constraints({ producers: [{ id: 'refund-through-the-app', requirementIds: ['R1', 'R2'], traceabilityIds: ['T2'] }] }),
  }));

  assert.equal(result.status, 'designed');
  assert.equal(result.parts.gherkin, 'not-applicable');
});

test('the resolver enumerates its statuses worst to best', () => {
  assert.deepEqual(CONTRACT_STATUSES, ['underspecified', 'inconsistent', 'unresolved', 'gaps', 'designed']);
});

test('the exit code reports findings rather than disposition', () => {
  const gapped = resolveContract(contract({ traceability: traceability({ status: 'gaps' }) }));
  const flagged = resolveContract(contract({ procedures: [procedure({ sections: [] })] }));

  assert.equal(gapped.status, 'gaps');
  assert.equal(exitCodeFor(gapped), EXIT_ACCEPTED);
  assert.equal(exitCodeFor(flagged), EXIT_FINDINGS);
});
