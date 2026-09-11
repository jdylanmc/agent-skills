// Filename retained for existing targeted workflow registrations.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROAST_FINDING_FIELDS, validateRoastReport } from './roast-contract.mjs';

function finding(id = 'R1', overrides = {}) {
  const fields = {
    Priority: 'Must fix', Confidence: 'High', Location: 'Supplied diagram, lower-right box.',
    Evidence: 'The recovery path terminates without an owner.', Consequence: 'Recovery can stall.',
    Standard: 'Supplied operating procedure, recovery ownership.',
    Recommendation: 'Identify a recovery owner.', Validation: 'Trace a failed rollout with that owner.',
    ...overrides,
  };
  return [`### ${id}: Recovery has no owner`, ...Object.entries(fields)
    .filter(([, value]) => value !== null).map(([name, value]) => `- ${name}: ${value}`)].join('\n');
}
function report(body = finding(), status = 'Complete') {
  return `# Roast\n- Status: ${status}\n- Scope: Supplied diagram.\n- Standards: Operating procedure.\n\n## Findings\n${body}\n\n## Coverage\nReviewed the supplied diagram by inspection, without execution or independent perspectives. No requested parts were missing.`;
}

test('one final report preserves coverage status independently from structural validity', () => {
  for (const status of ['Complete', 'Partial', 'Needs clarification']) {
    for (const body of [finding(), 'None.']) {
      const result = validateRoastReport(report(body, status));
      assert.equal(result.status, 'Valid', JSON.stringify(result.defects));
      assert.equal(result.reviewStatus, status);
      assert.equal(result.scope, 'final-report-structure');
      assert.equal(result.findings, body === 'None.' ? 0 : 1);
      assert.ok(result.remainingChecks.includes('coverage sufficiency'));
    }
  }
  for (const suffix of ['', '\n', '\r\n']) {
    assert.equal(validateRoastReport(report().replace(/\n/g, '\r\n') + suffix).status, 'Valid');
  }
});

test('every final finding field is required and non-empty outside quoted material', () => {
  for (const field of ROAST_FINDING_FIELDS) {
    for (const value of [null, '', '   ', '\n> quoted only', '\n```text\nquoted only\n```', '\n<!-- quoted only -->']) {
      const result = validateRoastReport(report(finding('R1', { [field]: value })));
      assert.equal(result.status, 'Invalid', `${field}: ${value}`);
      assert.ok(result.defects.some((defect) => defect.field === field), JSON.stringify(result.defects));
    }
  }
});

test('priority and confidence use exact enums, not substring matching', () => {
  for (const Priority of ['Must fix', 'Should fix', 'Consider']) {
    for (const Confidence of ['High', 'Medium', 'Low']) {
      assert.equal(validateRoastReport(report(finding('R1', { Priority, Confidence }))).status, 'Valid');
    }
  }
  for (const [name, values] of Object.entries({
    Priority: ['Critical', 'Must Fix', 'Must fix | Should fix', 'Must fix because urgent'],
    Confidence: ['Certain', 'high', 'High | Low'],
  })) {
    for (const value of values) assert.equal(validateRoastReport(report(finding('R1', { [name]: value }))).status, 'Invalid');
  }
});

test('IDs are unique regardless of title; stable IDs need not be sequential', () => {
  const duplicate = `${finding()}\n${finding().replace('no owner', 'a different title')}`;
  assert.equal(validateRoastReport(report(duplicate)).status, 'Invalid');
  assert.equal(validateRoastReport(report(`${finding('R5')}\n${finding('R2')}`)).status, 'Valid');
  for (const heading of ['### R0: title', '### R01: title', '### R1', '### R1: ', '### F1: title', '#### R1: title']) {
    assert.equal(validateRoastReport(report(finding().replace(/^###.*$/m, heading))).status, 'Invalid', heading);
  }
});

test('report header and section defects cannot be repaired by quoting a valid template', () => {
  const base = report();
  for (const broken of [
    base.replace('# Roast', '# Artifact Roast'),
    base.replace('- Status: Complete', '- Status: Approved'),
    base.replace('- Scope: Supplied diagram.', '- Scope:'),
    base.replace('- Standards: Operating procedure.', '- Standards:'),
    base.replace('- Scope: Supplied diagram.', '> - Scope: Supplied diagram.'),
    base.replace('- Standards: Operating procedure.', '```\n- Standards: Operating procedure.\n```'),
    base.replace('- Status: Complete', '- Status: Complete\n- Status: Partial'),
    base.replace('## Findings', '## Findings\n## Findings'),
    base.replace('## Coverage', '## Other'),
    base.replace('## Coverage', '## Coverage\n## Coverage'),
    base.replace(/## Coverage[\s\S]*/, '## Coverage\n> Coverage only in a quote'),
    base.replace(/## Coverage[\s\S]*/, '## Coverage\n```\nQuoted coverage\n```'),
    base.replace('## Findings', '## Coverage').replace('## Coverage\nReviewed', '## Findings\nReviewed'),
    `\`\`\`markdown\n${base}\n\`\`\``,
  ]) assert.equal(validateRoastReport(broken).status, 'Invalid', broken);
});

test('missing or malformed findings never turn into clean zero findings', () => {
  for (const body of [
    '', 'none', 'None', 'No issues found.', 'None.\n- Evidence: hidden concern',
    'None.\n### R1: hidden concern', '- Priority: Must fix\n- Recommendation: fix',
    '#### R1: hidden concern\n- Priority: Must fix',
    '### R1: hidden concern\n```text\n- Recommendation: fix\n- Validation: inspect\n```',
  ]) assert.equal(validateRoastReport(report(body)).status, 'Invalid', body);
  assert.equal(validateRoastReport(`${report('None.')}\n${finding()}`).status, 'Invalid');
  assert.equal(validateRoastReport(`${report('None.')}\n## Open Risks and Evidence Gaps\n${finding()}`).status, 'Invalid');
  assert.equal(validateRoastReport(report().replace('## Findings', '## Hidden Findings')).status, 'Invalid');
  assert.equal(validateRoastReport(report().replace('## Findings', `- Evidence: stray\n## Findings`)).status, 'Invalid');
});

test('duplicate fields and findings hidden by heading transitions are invalid', () => {
  for (const body of [
    `${finding()}\n- Evidence: a different claim`,
    `${finding()}\n#### hidden\n- Recommendation: hidden advice`,
    `${finding()}\n# Unexpected\n- Evidence: hidden evidence`,
    `${finding()}\n- Roast line: joke cannot substitute for the report fields`,
  ]) assert.equal(validateRoastReport(report(body)).status, 'Invalid', body);
});

test('quoted headings are evidence, but unclosed or mismatched fences are not success', () => {
  const quoted = report(finding('R1', { Evidence: 'Observed below.\n````text\n### R9: quoted only\n- Evidence: not report structure\n```\n````' }));
  assert.equal(validateRoastReport(quoted).status, 'Valid');
  for (const suffix of ['\n```text\nhidden', '\n```text\nhidden\n~~~', '\n~~~~text\nhidden\n~~~']) {
    assert.equal(validateRoastReport(report() + suffix).status, 'Invalid');
  }
});

test('bound revision is compared exactly with caller input, never self-attested', () => {
  const revision = 'abcd1234';
  const source = report().replace('- Status: Complete', `- Status: Complete\n- Revision: ${revision}`);
  assert.equal(validateRoastReport(source, { expectedRevision: revision }).status, 'Valid');
  for (const expectedRevision of ['different', 'abcd', 'ABCD1234']) {
    assert.equal(validateRoastReport(source, { expectedRevision }).status, 'Invalid');
  }
  assert.equal(validateRoastReport(report(), { expectedRevision: revision }).status, 'Invalid');
  assert.equal(validateRoastReport(source.replace(`- Revision: ${revision}`, `> - Revision: ${revision}`), { expectedRevision: revision }).status, 'Invalid');
  assert.equal(validateRoastReport(source.replace(`- Revision: ${revision}`, `- Revision: ${revision}\n- Revision: ${revision}`)).status, 'Invalid');
  assert.equal(validateRoastReport(source.replace(`- Revision: ${revision}`, '- Revision:')).status, 'Invalid');
  for (const expectedRevision of ['', ' ', 42, null]) {
    assert.throws(() => validateRoastReport(source, { expectedRevision }), { code: 'invalid_contract' });
  }
});

test('locators are opaque and structural success does not claim semantic correctness', () => {
  const source = report(finding('R1', { Location: 'email:message-17, quoted paragraph 3', Evidence: 'Claim requiring human verification.' }));
  const result = validateRoastReport(source);
  assert.equal(result.status, 'Valid');
  assert.ok(result.remainingChecks.includes('evidence truth and freshness'));
  assert.equal(result.revision, null);
});

test('full CLI mode handles stdin and exact revision with structural exit codes', () => {
  const cli = fileURLToPath(new URL('./roast-contract.mjs', import.meta.url));
  const source = report('None.', 'Needs clarification').replace('- Scope:', '- Revision: abc\n- Scope:');
  for (const [revision, expectedStatus] of [['abc', 0], ['wrong', 2]]) {
    const result = spawnSync(process.execPath, [cli, '--roast', '--report', '-', '--expected-revision', revision], {
      input: source, encoding: 'utf8',
    });
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.equal(JSON.parse(result.stdout).reviewStatus, 'Needs clarification');
  }
});
