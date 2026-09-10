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

function envelope() {
  return template
    .replace('- Status: Complete | Insufficient review', '- Status: Insufficient review')
    .replace('- Artifact type:', '- Artifact type: skill')
    .replace('- Artifact locator:', '- Artifact locator: /review/example')
    .replace('- Allowed review root:', '- Allowed review root: /review')
    .replace('- Evidence-packet identifier:', '- Evidence-packet identifier: fixture-1');
}

test('the producer template passes only the explicitly checked framing scope', () => {
  for (const report of [envelope(), `${envelope()}\n`, `${envelope().replace(/\n/g, '\r\n')}\r\n`]) {
    const result = validateEnvelopeFraming(report, expected);
    assert.equal(result.status, 'Valid');
    assert.equal(result.scope, 'envelope-framing-and-finding-fields');
    assert.deepEqual(result.checkedItems, [1, 2, 3, 4, 10, 99]);
    assert.ok(result.remainingChecks.includes('nested reports and coverage'));
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

test('existing accepted-finding checks are included without claiming nested-report validity', () => {
  const report = envelope().replace('<complete reports in Roaster ID order>', [
    '## Findings', '### reviewer-F01', '- Recommendation: Correct the example.',
  ].join('\n'));
  const result = validateEnvelopeFraming(report, expected);
  assert.equal(result.status, 'Invalid');
  assert.ok(result.defects.some((defect) => defect.category === 'Incomplete finding' && defect.field === 'Validation'));
  assert.equal(validateEnvelopeFraming(report.replace('- Recommendation:', '- Validation: Inspect the example.\n- Recommendation:'), expected).status, 'Valid');
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
  fs.writeFileSync(reportPath, envelope().replace('## Council Roster', '## Other'));
  assert.equal(run(args, streams), 2);
  assert.throws(() => parseArguments(args.slice(0, -2)), { code: 'usage' });
  assert.throws(() => parseArguments([...args, '--field', 'Evidence']), { code: 'usage' });
});
