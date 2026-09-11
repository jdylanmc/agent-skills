import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FINDING_SECTIONS, FindingSchemaError, REQUIRED_FINDING_FIELDS, USAGE,
  fieldContent, parseArguments, parseFindings, run, validateFindingSchema,
} from './roast-contract.mjs';

const cli = fileURLToPath(new URL('./roast-contract.mjs', import.meta.url));
const finding = (recommendation = 'Remove the unused grant.', validation = 'Inspect the grant.') =>
  `### RM-F01\n- Priority: Must fix\n- Recommendation: ${recommendation}\n- Validation: ${validation}`;
const report = (body, section = 'Findings') => `# Report\n## ${section}\n${body}`;
function streams() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) },
    output: () => out.join(''), errors: () => err.join(''),
  };
}

test('generic finding APIs and default checked vocabulary remain compatible', () => {
  const result = validateFindingSchema(report(finding()));
  assert.equal(result.status, 'Valid');
  assert.equal(result.findings, 1);
  assert.deepEqual(result.checked, ['Recommendation', 'Validation']);
  assert.deepEqual(REQUIRED_FINDING_FIELDS, ['Recommendation', 'Validation']);
  assert.deepEqual(DEFAULT_FINDING_SECTIONS, ['Accepted Findings', 'Findings', 'Must Fix', 'Should Fix', 'Consider']);
  const parsed = parseFindings(report(finding()));
  assert.equal(parsed.findings[0].id, 'RM-F01');
  assert.equal(fieldContent(parsed.findings[0], 'Priority'), 'Must fix');
  assert.equal(fieldContent(parsed.findings[0], 'Absent'), null);
  assert.throws(() => parseFindings(42), FindingSchemaError);
  assert.throws(() => parseFindings(42), { code: 'invalid_report' });
});

test('missing and empty required fields cannot be silently accepted', () => {
  for (const field of REQUIRED_FINDING_FIELDS) {
    const source = report(finding());
    for (const replacement of ['', `- ${field}:`, `- ${field}:   `]) {
      const result = validateFindingSchema(source.replace(new RegExp(`^- ${field}:.*$`, 'm'), replacement));
      assert.equal(result.status, 'Invalid');
      assert.deepEqual(result.defects.map((defect) => defect.field), [field]);
    }
  }
});

test('field content may continue on unquoted following lines', () => {
  assert.equal(validateFindingSchema(report(finding('\n  Remove the grant\n  and inspect callers.'))).status, 'Valid');
});

test('quoted, commented, fenced, and indented templates cannot supply a required field', () => {
  for (const quote of [
    '> advice', '> advice\nlazy continuation of the quote', '    advice', '\tadvice', '<!-- advice -->',
    '```text\nadvice\n```', '~~~~text\nadvice\n~~~~',
    '````text\n```\nadvice\n```\n````',
  ]) {
    const result = validateFindingSchema(report(finding(`\n${quote}`)));
    assert.equal(result.status, 'Invalid', quote);
    assert.ok(result.defects.some((defect) => defect.field === 'Recommendation'));
  }
  const quotedFields = '```text\n- Recommendation: fix it\n- Validation: check it\n```';
  const result = validateFindingSchema(report(`### RM-F01\n${quotedFields}`));
  assert.deepEqual(result.defects.map((defect) => defect.field), ['Recommendation', 'Validation']);
});

test('duplicates and orphan fields fail closed', () => {
  for (const body of [
    `${finding()}\n- Recommendation: different advice`,
    `${finding()}\n${finding()}`,
    '- Recommendation: heading was omitted\n- Validation: inspect',
    '#### RM-F01\n- Recommendation: wrong heading level\n- Validation: inspect',
  ]) assert.equal(validateFindingSchema(report(body)).status, 'Invalid', body);
});

test('malformed apparent findings cannot yield a clean generic zero-findings result', () => {
  for (const body of [
    'R1: fix this problem', '- **Priority:** Must fix', '#### R1: incorrect level',
    '###\n- Recommendation: missing identifier', 'None.\nSomething was omitted.',
  ]) assert.equal(validateFindingSchema(report(body)).status, 'Invalid', body);
});

test('generic accepted and disposition sections retain their separate meanings', () => {
  for (const section of DEFAULT_FINDING_SECTIONS) {
    assert.equal(validateFindingSchema(report(finding(), section)).status, 'Valid');
    assert.equal(validateFindingSchema(report('none', section)).findings, 0);
    assert.equal(validateFindingSchema(report('none', section)).status, 'Valid');
  }
  const source = `${report(finding())}\n## Open Risks and Evidence Gaps\n### RISK-01\n- Consequence: uncertain impact`;
  assert.equal(validateFindingSchema(source).status, 'Valid');
  assert.equal(validateFindingSchema(source).exempt, 1);
  assert.equal(validateFindingSchema(report(finding(), 'Surprises')).status, 'Invalid');
  assert.equal(validateFindingSchema(finding()).status, 'Invalid');
});

test('generic overrides check every requested section without changing defaults', () => {
  const source = `${report(finding())}\n${report(finding(''), 'Should Fix')}`;
  const result = validateFindingSchema(source);
  assert.equal(result.findings, 2);
  assert.equal(result.status, 'Invalid');
  const scoped = validateFindingSchema(report('### C1\n- Recommendation: fix', 'Custom'), {
    sections: ['Custom'], requiredFields: ['Recommendation'],
  });
  assert.equal(scoped.status, 'Valid');
  assert.deepEqual(REQUIRED_FINDING_FIELDS, ['Recommendation', 'Validation']);
});

test('unclosed and mismatched fences cannot turn missing findings into success', () => {
  for (const fence of [
    '```text\n### hidden', '```text\n### hidden\n~~~',
    '````text\n### hidden\n```', '```text\n### hidden\n```not-a-close',
  ]) {
    assert.equal(validateFindingSchema(`${report(finding())}\n${fence}`).status, 'Invalid');
  }
  assert.equal(validateFindingSchema(`${report(finding())}\n<!-- unclosed`).status, 'Invalid');
  assert.equal(validateFindingSchema(`${report(finding())}\n\`\`\`text\nquoted\n\`\`\``).status, 'Valid');
});

test('CLI accepts stdin without writing the reviewed material to disk', () => {
  const valid = spawnSync(process.execPath, [cli, '--report', '-'], { input: report(finding()), encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).status, 'Valid');
  const invalid = spawnSync(process.execPath, [cli, '--report', '-'], { input: report(finding('')), encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).defects[0].field, 'Recommendation');
  const scoped = spawnSync(process.execPath, [cli, '--report', '-', '--field', 'Advice', '--section', 'Custom'], {
    input: '## Custom\n### C1\n- Advice: read the source', encoding: 'utf8',
  });
  assert.equal(scoped.status, 0, scoped.stderr);
});

test('CLI retains probe, explicit usage errors, and stable exit codes', () => {
  const probe = streams();
  assert.equal(run(['--probe'], probe), 0);
  assert.match(probe.output(), /roast-contract: available/);
  for (const args of [
    [], ['--report'], ['--report', 'x', '--bogus'], ['--report', 'x', '--report', 'y'],
    ['--report', '-', '--roast', '--field', 'Evidence'],
    ['--report', '-', '--roast', '--section', 'Findings'],
    ['--report', '-', '--expected-revision', 'abc'], ['--report', '-', '--roast', '--roast'],
  ]) {
    assert.throws(() => parseArguments(args), { code: 'usage' });
    const output = streams();
    assert.equal(run(args, output), 1);
    assert.match(output.errors(), /usage:/);
  }
  assert.match(USAGE, /^Usage: roast-contract\.mjs/);
});

test('CLI file access failures are explicit and unsafe paths are rejected', () => {
  for (const candidate of ['relative.md', `${cli}/../roast-contract.md`, fileURLToPath(new URL('.', import.meta.url))]) {
    const output = streams();
    assert.equal(run(['--report', candidate], output), 1);
    assert.match(output.errors(), /unsafe_path:/);
  }
  const missing = streams();
  assert.equal(run(['--report', `${cli}.missing`], missing), 1);
  assert.match(missing.errors(), /file_access:.*ENOENT/);
  const readable = streams();
  assert.equal(run(['--report', cli], readable), 0);
});

test('CLI rejects symlinks and reports unreadable files distinctly', (t) => {
  t.mock.method(fs, 'lstatSync', () => ({ isSymbolicLink: () => true, isFile: () => true }));
  const linked = streams();
  assert.equal(run(['--report', cli], linked), 1);
  assert.match(linked.errors(), /unsafe_path:.*symlink/);
  t.mock.restoreAll();
  t.mock.method(fs, 'readFileSync', () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
  const denied = streams();
  assert.equal(run(['--report', cli], denied), 1);
  assert.match(denied.errors(), /file_access:.*EACCES/);
});
