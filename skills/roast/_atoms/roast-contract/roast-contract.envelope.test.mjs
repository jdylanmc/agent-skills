import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArguments, run, validateEnvelopeFraming, validateFindingSchema } from './roast-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const expected = { artifactType: 'skill', artifactLocator: '/review/example', allowedReviewRoot: '/review' };
const producer = fs.readFileSync(path.join(ROOT, 'agents/artifact-roastmaster.agent.md'), 'utf8');
const template = producer.match(/```text\n(# Artifact Roast Envelope\n[\s\S]*?)\n```/)[1];
const roasterTemplate = producer.match(/```text\n(# Artifact Roaster Report\n[\s\S]*?)\n```/)[1];

function envelope(reports = 'none') {
  return template
    .replace('- Status: Complete | Insufficient review', '- Status: Insufficient review')
    .replace('- Artifact type:', '- Artifact type: skill')
    .replace('- Artifact locator:', '- Artifact locator: /review/example')
    .replace('- Allowed review root:', '- Allowed review root: /review')
    .replace('- Evidence-packet identifier:', '- Evidence-packet identifier: fixture-1')
    .replace('<complete reports in Roaster ID order>', reports);
}

function roaster(id = 'reviewer', findings = 'none') {
  return roasterTemplate
    .replace('- Roaster ID:', `- Roaster ID: ${id}`)
    .replace('- Artifact type:', '- Artifact type: skill')
    .replace('- Evidence-packet identifier:', '- Evidence-packet identifier: fixture-1')
    .replace('- Lens:', '- Lens: fixture lens')
    .replace('- Lens source:', '- Lens source: fixture source')
    .replace('- Doctrine status:', '- Doctrine status: unavailable')
    .replace(/(## Findings\n\n)[\s\S]*?(?=\n## Dismissed Suspicions)/, `$1${findings}\n`);
}

function finding(overrides = {}) {
  const fields = {
    'Proposed severity': 'Should fix', Confidence: 'High', Location: '/review/example:1',
    Evidence: 'Observed fixture issue.', Consequence: 'Fixture consequence.',
    Recommendation: 'Correct the fixture.', Validation: 'Inspect the corrected fixture.', ...overrides,
  };
  return ['### reviewer-F01', ...Object.entries(fields)
    .filter(([, value]) => value !== null).map(([field, value]) => `- ${field}: ${value}`)].join('\n');
}

test('the producer template passes only the explicitly checked framing scope', () => {
  for (const report of [envelope(), `${envelope()}\n`, `${envelope().replace(/\n/g, '\r\n')}\r\n`]) {
    const result = validateEnvelopeFraming(report, expected);
    assert.equal(result.status, 'Valid');
    assert.equal(result.scope, 'envelope-framing-and-finding-fields');
    assert.deepEqual(result.checkedItems, [1, 2, 3, 4, 10, 99]);
    assert.ok(result.remainingChecks.includes('council roster and report coverage'));
    assert.equal(result.roasterReports, 0);
    assert.equal(result.findings, 0);
    assert.deepEqual(result.defects, []);
  }
});

test('malformed envelope framing returns specific named defects', () => {
  const base = envelope();
  const cases = [
    [base.replace('# Artifact Roast Envelope', '# Other'), 'First-line mismatch', 'envelope title'],
    [base.replace('## Council Roster', '## Other'), 'Missing heading', 'Council Roster'],
    [base.replace('## Council Roster', '## Council Roster\n## Council Roster'), 'Duplicate heading', 'Council Roster'],
    [base.replace('## Evidence Manifest', '## PLACEHOLDER').replace('## Council Roster', '## Evidence Manifest')
      .replace('## PLACEHOLDER', '## Council Roster'), 'Misordered heading', 'Council Roster'],
    [base.replace('- Status: Insufficient review', '- Status:'), 'Empty field', 'Status'],
    [base.replace('- Status: Insufficient review', '- Status: Unknown'), 'Value mismatch', 'Status'],
    [base.replace('- Schema version: 1', '- Schema version: 2'), 'Value mismatch', 'Schema version'],
    [base.replace('- Artifact locator: /review/example', ''), 'Missing field', 'Artifact locator'],
    [base.replace('- Artifact type: skill', '- Artifact type: skill\n- Artifact type: skill'), 'Cardinality violation', 'Artifact type'],
    [`${base}\nextra`, 'Missing terminator', 'END ARTIFACT ROAST ENVELOPE'],
    [base.replace('## Council Roster', 'END ARTIFACT ROAST ENVELOPE\n## Council Roster'), 'Cardinality violation', 'END ARTIFACT ROAST ENVELOPE'],
  ];
  for (const [report, category, item] of cases) {
    const result = validateEnvelopeFraming(report, expected);
    assert.equal(result.status, 'Invalid', `${category}: ${item}`);
    assert.ok(result.defects.some((defect) => defect.category === category && defect.item === item),
      JSON.stringify(result.defects));
  }
});

test('artifact identity comes from caller inputs rather than trusting the envelope', () => {
  for (const key of ['artifactType', 'artifactLocator', 'allowedReviewRoot']) {
    const changed = { ...expected, [key]: key === 'artifactType' ? 'agent' : 'different' };
    assert.equal(validateEnvelopeFraming(envelope(), changed).status, 'Invalid');
  }
  assert.throws(() => validateEnvelopeFraming(envelope(), {}), { code: 'invalid_contract' });
});

test('quoted contract material and nested fields cannot satisfy the outer header', () => {
  const field = '- Artifact locator: /review/example';
  for (const replacement of [
    `> ${field}`,
    `\`\`\`text\n${field}\n\`\`\``,
    `~~~text\n${field}\n~~~`,
    `\`\`\`text\n\`\`\`not-a-closing-fence\n${field}\n\`\`\``,
  ]) {
    const result = validateEnvelopeFraming(envelope().replace(field, replacement), expected);
    assert.ok(result.defects.some((defect) => defect.category === 'Missing field' && defect.item === 'Artifact locator'));
  }
  const nested = envelope().replace(field, '').replace('## Contract-Valid Reports', `## Contract-Valid Reports\n${field}`);
  assert.ok(validateEnvelopeFraming(nested, expected).defects.some((defect) => defect.item === 'Artifact locator'));
  assert.equal(validateEnvelopeFraming(`\`\`\`\n${envelope()}\n\`\`\``, expected).status, 'Invalid');
});

test('existing accepted-finding checks run once alongside nested structure checks', () => {
  const report = envelope(roaster('reviewer', finding({ Validation: null })));
  const result = validateEnvelopeFraming(report, expected);
  assert.equal(result.status, 'Invalid');
  assert.equal(result.defects.filter((defect) => defect.category === 'Incomplete finding' && defect.field === 'Validation').length, 1);
  assert.equal(validateEnvelopeFraming(envelope(roaster('reviewer', finding())), expected).status, 'Valid');
});

test('complete nested templates allow zero findings while retaining unchecked semantic requirements', () => {
  const result = validateEnvelopeFraming(envelope(`${roaster('a')}\n\n${roaster('b')}`), expected);
  assert.equal(result.status, 'Valid');
  assert.equal(result.roasterReports, 2);
  assert.ok(result.checkedRoasterRules.includes('packet agreement'));
  assert.ok(result.remainingChecks.includes('dimension coverage and report semantics'));
  assert.deepEqual(result.defects, []);
});

test('a malformed sibling cannot be compensated for by a valid report', () => {
  const base = roaster('reviewer', finding());
  const cases = [
    [base.replace('- Evidence-packet identifier: fixture-1', '- Evidence-packet identifier: wrong'), 'Value mismatch'],
    [base.replace('- Artifact type: skill', '- Artifact type: agent'), 'Value mismatch'],
    [base.replace('- Lens: fixture lens', '- Lens:'), 'Empty field'],
    [base.replace('## Dimension Coverage', '## Other'), 'Missing heading'],
    [base.replace('## Evidence Gaps', '## Evidence Gaps\n## Evidence Gaps'), 'Duplicate heading'],
    [base.replace('END ARTIFACT ROASTER REPORT', ''), 'Missing terminator'],
    [base.replace('END ARTIFACT ROASTER REPORT', 'END ARTIFACT ROASTER REPORT\nextra'), 'Missing terminator'],
    [base.replace('- Confidence: High', '- Confidence: Certain'), 'Value mismatch'],
    [base.replace('- Proposed severity: Should fix', '- Proposed severity: Urgent'), 'Value mismatch'],
    [base.replace('- Evidence: Observed fixture issue.', '- Evidence:'), 'Incomplete finding'],
    [base.replace('- Confidence: High', '- Confidence: High\n- Confidence: Low'), 'Cardinality violation'],
    [base.replace('### reviewer-F01', ''), 'Incomplete finding'],
    [base.replace('### reviewer-F01', '> ### reviewer-F01'), 'Incomplete finding'],
  ];
  for (const [bad, category] of cases) {
    const report = envelope(`${roaster('a')}\n\n${bad}`);
    const result = validateEnvelopeFraming(report, expected);
    assert.equal(result.status, 'Invalid', category);
    assert.ok(result.defects.some((defect) =>
      defect.category === category && defect.roasterId === 'reviewer' && defect.reportLine > 1), JSON.stringify(result.defects));
  }
});

test('finding IDs belong to their roaster and are unique without inventing display-order rules', () => {
  for (const id of ['other-F01', 'reviewer-F00', 'reviewer-F001']) {
    const result = validateEnvelopeFraming(envelope(roaster('reviewer', finding().replace('reviewer-F01', id))), expected);
    assert.ok(result.defects.some((defect) => defect.category === 'Identity mismatch'));
  }
  const duplicate = validateEnvelopeFraming(envelope(roaster('reviewer', `${finding()}\n${finding()}`)), expected);
  assert.ok(duplicate.defects.some((defect) => defect.category === 'Identity mismatch'));
  const reordered = `${finding().replace('reviewer-F01', 'reviewer-F02')}\n${finding()}`;
  assert.equal(validateEnvelopeFraming(envelope(roaster('reviewer', reordered)), expected).status, 'Valid');
  const repeatedReport = validateEnvelopeFraming(envelope(`${roaster()}\n${roaster()}`), expected);
  assert.ok(repeatedReport.defects.some((defect) => defect.category === 'Cardinality violation' && defect.item === 'reviewer'));
});

test('quoted, misplaced, and disguised reports cannot evade nested checks', () => {
  const quoted = envelope(`\`\`\`\n${roaster()}\n\`\`\``);
  assert.equal(validateEnvelopeFraming(quoted, expected).status, 'Invalid');
  const misplaced = envelope().replace('## Evidence Manifest', `## Evidence Manifest\n${roaster()}`);
  assert.ok(validateEnvelopeFraming(misplaced, expected).defects.some((defect) => defect.category === 'Unexpected section entry'));
  const hiddenField = roaster().replace('- Lens: fixture lens', '```\n- Lens: fixture lens\n```');
  assert.equal(validateEnvelopeFraming(envelope(hiddenField), expected).status, 'Invalid');
  const badPacket = envelope(roaster().replace('fixture-1', 'wrong'))
    .replace('## Contract-Valid Reports', '## Contract-Valid Reports  ');
  assert.equal(validateEnvelopeFraming(badPacket, expected).status, 'Invalid');
  assert.equal(validateEnvelopeFraming(envelope(`${roaster()}\n\`\`\`\nquoted suffix\n\`\`\``), expected).status, 'Invalid');
});

test('a fence with trailing text cannot expose quoted finding fields', () => {
  const report = [
    '## Findings', '### reviewer-F01', '```text', '```not-a-closing-fence',
    '- Recommendation: Quoted advice.', '- Validation: Quoted check.', '```',
  ].join('\n');
  assert.deepEqual(validateFindingSchema(report).defects.map((defect) => defect.field), ['Recommendation', 'Validation']);
  const indented = [
    '## Findings', '### reviewer-F01', '    - Recommendation: Quoted advice.', '    - Validation: Quoted check.',
  ].join('\n');
  assert.deepEqual(validateFindingSchema(indented).defects.map((defect) => defect.field), ['Recommendation', 'Validation']);
});

test('the existing CLI runs framing mode and refuses incomplete or weakened contracts', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'roast-envelope-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const reportPath = path.join(directory, 'report.md');
  fs.writeFileSync(reportPath, envelope());
  const args = ['--report', reportPath, '--artifact-type', 'skill', '--artifact-locator', '/review/example', '--review-root', '/review'];
  const output = [];
  const streams = { stdout: { write: (text) => output.push(text) }, stderr: { write: (text) => assert.fail(text) } };
  assert.equal(run(args, streams), 0);
  assert.equal(JSON.parse(output.join('')).scope, 'envelope-framing-and-finding-fields');
  output.length = 0;
  fs.writeFileSync(reportPath, envelope(roaster().replace('fixture-1', 'wrong')));
  assert.equal(run(args, streams), 2);
  assert.equal(JSON.parse(output.join('')).roasterReports, 1);
  fs.writeFileSync(reportPath, envelope().replace('## Council Roster', '## Other'));
  assert.equal(run(args, streams), 2);
  assert.throws(() => parseArguments(args.slice(0, -2)), { code: 'usage' });
  assert.throws(() => parseArguments([...args, '--field', 'Evidence']), { code: 'usage' });
});
