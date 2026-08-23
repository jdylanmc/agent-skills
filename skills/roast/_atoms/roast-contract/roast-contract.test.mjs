/**
 * Tests for the accepted-finding schema.
 *
 * The operator's requirement is that every line item a roast produces carries a
 * way to resolve it, with no exception. Before this checker existed the rule
 * was prose in three places and enforced nowhere: a report with ten findings
 * and zero recommendations satisfied every envelope check, because those checks
 * inspected headings, roster shape, ordering, and terminators and never looked
 * inside a finding.
 *
 * Each test below is named for the behaviour it protects.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_FINDING_SECTIONS,
  FindingSchemaError,
  REQUIRED_FINDING_FIELDS,
  USAGE,
  fieldContent,
  parseArguments,
  parseFindings,
  run as runContract,
  validateFindingSchema,
} from './roast-contract.mjs';
import { ARTIFACT_TYPES, render } from '../artifact-profile/artifact-profile.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');

/** Repository-local scratch space; `.test-sandbox/` is git-ignored. */
function workspace(t, prefix = 'roast-contract-') {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(SANDBOX_ROOT, prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function captureStreams() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (value) => out.push(value) },
    stderr: { write: (value) => err.push(value) },
    output: () => out.join(''),
    errors: () => err.join(''),
  };
}

function readShared(relativePath) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, 'skills', relativePath), 'utf8');
}

/** One complete, well-formed finding, with fields overridable per test. */
function finding(overrides = {}) {
  const fields = {
    Priority: 'Must fix',
    Confidence: 'High',
    Location: 'skills/roast/SKILL.md:12',
    Evidence: 'the grant declares a tool no step uses',
    Consequence: 'the skill can do more than its workflow needs',
    Recommendation: 'remove the unused tool from allowed-tools',
    Validation: 'run node scripts/derive-skill-graph.mjs and see no grant violation',
    ...overrides,
  };
  const lines = ['### RM-F01'];
  for (const [name, value] of Object.entries(fields)) {
    if (value === null) {
      continue;
    }
    lines.push(`- ${name}:${value === '' ? '' : ` ${value}`}`);
  }
  return lines.join('\n');
}

function report(body, section = 'Must Fix') {
  return [
    '# Artifact Roast',
    '',
    'Schema version: 1',
    '',
    `## ${section}`,
    '',
    body,
    '',
    '## What Was Not Reviewed',
    '',
    'none',
    '',
    'END ARTIFACT ROAST ENVELOPE',
  ].join('\n');
}

test('a complete finding satisfies the schema', () => {
  const result = validateFindingSchema(report(finding()));
  assert.equal(result.status, 'Valid');
  assert.equal(result.findings, 1);
  assert.deepEqual(result.defects, []);
  assert.deepEqual(result.checked, ['Recommendation', 'Validation']);
});

test('a finding that omits Recommendation is rejected', () => {
  const result = validateFindingSchema(report(finding({ Recommendation: null })));
  assert.equal(result.status, 'Invalid');
  assert.equal(result.defects.length, 1);
  assert.equal(result.defects[0].category, 'Incomplete finding');
  assert.equal(result.defects[0].field, 'Recommendation');
  assert.equal(result.defects[0].finding, 'RM-F01');
  assert.match(result.defects[0].message, /missing the required field Recommendation/);
});

test('a finding whose Recommendation is a bare label is rejected', () => {
  for (const empty of ['', '   ']) {
    const result = validateFindingSchema(report(finding({ Recommendation: empty })));
    assert.equal(result.status, 'Invalid', `accepted a bare label: ${JSON.stringify(empty)}`);
    assert.equal(result.defects[0].field, 'Recommendation');
    assert.match(result.defects[0].message, /no content outside a fenced block/);
  }
});

test('a finding that omits Validation is rejected', () => {
  const result = validateFindingSchema(report(finding({ Validation: null })));
  assert.equal(result.status, 'Invalid');
  assert.equal(result.defects[0].field, 'Validation');
});

test('a finding whose Validation is a bare label is rejected', () => {
  const result = validateFindingSchema(report(finding({ Validation: '' })));
  assert.equal(result.status, 'Invalid');
  assert.equal(result.defects[0].field, 'Validation');
  assert.match(result.defects[0].message, /no content outside a fenced block/);
});

test('a Recommendation that appears only inside a fenced block does not satisfy the requirement', () => {
  const body = [
    '### RM-F01',
    '- Priority: Must fix',
    '- Confidence: High',
    '- Location: skills/roast/SKILL.md:12',
    '- Evidence: quoted below',
    '- Consequence: the reader cannot act',
    '- Recommendation:',
    '',
    '````text',
    '- Recommendation: remove the unused tool from allowed-tools',
    '- Validation: rerun the deriver',
    '````',
    '',
    '- Validation: rerun the deriver',
  ].join('\n');
  const result = validateFindingSchema(report(body));
  assert.equal(result.status, 'Invalid');
  assert.deepEqual(
    result.defects.map((defect) => defect.field),
    ['Recommendation'],
  );
});

test('a report that quotes the contract template does not thereby satisfy it', () => {
  const body = [
    '### RM-F01',
    '- Priority: Must fix',
    '- Confidence: High',
    '- Location: skills/roast/SKILL.md:12',
    '- Evidence: none supplied',
    '- Consequence: unactionable',
    '',
    '```text',
    '### <canonical finding ID>',
    '- Recommendation:',
    '- Validation:',
    '```',
  ].join('\n');
  const result = validateFindingSchema(report(body));
  assert.equal(result.status, 'Invalid');
  assert.deepEqual(
    result.defects.map((defect) => defect.field).sort(),
    ['Recommendation', 'Validation'],
  );
});

test('a recommendation continued on following lines is content', () => {
  const body = [
    '### RM-F01',
    '- Priority: Should fix',
    '- Confidence: Medium',
    '- Location: skills/roast/SKILL.md:12',
    '- Evidence: the description omits a negative trigger',
    '- Consequence: the router misfires',
    '- Recommendation:',
    '  add an explicit "do not use for" clause naming the security-review',
    '  workflow',
    '- Validation: reread the description and confirm the clause is present',
  ].join('\n');
  const result = validateFindingSchema(report(body));
  assert.equal(result.status, 'Valid');
});

test('a clean roast with zero findings is still valid', () => {
  for (const body of ['none', '  none  ']) {
    const result = validateFindingSchema(report(body));
    assert.equal(result.status, 'Valid');
    assert.equal(result.findings, 0);
    assert.deepEqual(result.defects, []);
  }
  const wholeReport = ['# Artifact Roast', '', '## Must Fix', '', 'none', '', '## Should Fix', '', 'none'].join('\n');
  assert.equal(validateFindingSchema(wholeReport).status, 'Valid');
});

test('every findings section of a final roast is checked, not only the first', () => {
  const body = [
    '## Must Fix',
    '',
    finding(),
    '',
    '## Should Fix',
    '',
    finding({ Recommendation: null }).replace('RM-F01', 'RM-F02'),
    '',
    '## Consider',
    '',
    'none',
  ].join('\n');
  const result = validateFindingSchema(body);
  assert.equal(result.findings, 2);
  assert.equal(result.status, 'Invalid');
  assert.equal(result.defects[0].finding, 'RM-F02');
  assert.equal(result.defects[0].section, 'Should Fix');
});

test('a roaster report Findings section is checked with the same rule', () => {
  const valid = ['## Findings', '', finding()].join('\n');
  assert.equal(validateFindingSchema(valid).status, 'Valid');

  const invalid = ['## Findings', '', finding({ Recommendation: null })].join('\n');
  assert.equal(validateFindingSchema(invalid).status, 'Invalid');
  assert.deepEqual(DEFAULT_FINDING_SECTIONS, [
    'Accepted Findings',
    'Findings',
    'Must Fix',
    'Should Fix',
    'Consider',
  ]);
});

test('material outside a findings section is never treated as a finding', () => {
  const body = [
    '## Open Risks and Evidence Gaps',
    '',
    '### RISK-01',
    '- Consequence: the dependency may change without notice',
    '',
    '## Must Fix',
    '',
    'none',
  ].join('\n');
  const result = validateFindingSchema(body);
  assert.equal(result.findings, 0);
  assert.equal(result.status, 'Valid');
});

test('both branches state the same mandatory-recommendation requirement', () => {
  const contract = readShared('roast/_atoms/roast-contract/roast-contract.md');
  const synthesis = readShared('roast/_atoms/code-synthesis/code-synthesis.md');
  const subagent = readShared('roast/_atoms/code-subagent-contract/code-subagent-contract.md');
  const directive = readShared('roast/references/bundled-roasters/the-roastmaster/directive.md');

  for (const [name, document] of Object.entries({ contract, synthesis, subagent, directive })) {
    assert.match(document, /Recommendation/, `${name} omits Recommendation`);
    assert.match(document, /non-empty/, `${name} does not require non-empty content`);
    assert.match(document, /no\s+exception/, `${name} leaves room for an exception`);
  }
  for (const [name, document] of Object.entries({ contract, synthesis, directive })) {
    assert.match(document, /Validation/, `${name} omits Validation`);
  }
});

test('requiring a recommendation grants the roast no authority to act or gate', () => {
  const contract = readShared('roast/_atoms/roast-contract/roast-contract.md');
  assert.match(contract, /advice on how to resolve/);
  assert.match(contract, /never an instruction this roast executes/);
  assert.match(contract, /never an approval/);
  assert.match(contract, /severity stays a\s+category/);

  const entry = readShared('roast/SKILL.md');
  assert.match(entry, /never an approval/);
  assert.match(entry, /approves nothing, blocks nothing/);
});

test('the envelope checklist enforces the requirement for every artifact type', () => {
  const template = readShared('roast/_atoms/roast-contract/roast-contract.md');
  for (const artifactType of ARTIFACT_TYPES) {
    const contract = render(template, artifactType);
    assert.match(contract, /^10\. Every accepted finding in every contract-valid report carries a non-empty$/m);
    assert.match(contract, /`Recommendation` and a non-empty `Validation`/);
    assert.match(contract, /A section whose whole body\s+is `none` declares no findings and satisfies this item/);
    assert.match(contract, /ordinary schema\s+failure/);
    assert.match(contract, /END ARTIFACT ROAST ENVELOPE/);
  }
});

test("a profile's extra envelope rules are numbered after the fixed items", () => {
  // Items 10 and 11 are fixed for every artifact type: the accepted-finding
  // schema and the intent rules. A profile's own extra rules follow them, so a
  // new fixed item must push the profile rules down rather than collide.
  const template = readShared('roast/_atoms/roast-contract/roast-contract.md');
  for (const artifactType of ARTIFACT_TYPES) {
    const contract = render(template, artifactType);
    assert.match(contract, /^11\. No entry in any section names the intent as the artifact to change, by$/m);
  }

  const prompt = render(template, 'prompt');
  assert.match(prompt, /^12\. No section contains the full supplied prompt body\.$/m);
  for (const artifactType of ['agent', 'skill']) {
    assert.doesNotMatch(render(template, artifactType), /^12\. /m);
  }
});

test('the command line validates, rejects, and probes with stable exit codes', (t) => {
  const root = workspace(t);

  const valid = path.join(root, 'valid.md');
  fs.writeFileSync(valid, report(finding()));
  const pass = captureStreams();
  assert.equal(runContract(['--report', valid], pass), 0);
  assert.equal(JSON.parse(pass.output()).status, 'Valid');

  const invalid = path.join(root, 'invalid.md');
  fs.writeFileSync(invalid, report(finding({ Recommendation: null })));
  const fail = captureStreams();
  assert.equal(runContract(['--report', invalid], fail), 2);
  assert.equal(JSON.parse(fail.output()).defects[0].field, 'Recommendation');

  const probe = captureStreams();
  assert.equal(runContract(['--probe'], probe), 0);
  assert.match(probe.output(), /roast-contract: available/);
});

test('the command line rejects an unknown argument and an unsafe report path', (t) => {
  const unknown = captureStreams();
  assert.equal(runContract(['--report', 'x', '--bogus'], unknown), 1);
  assert.match(unknown.errors(), /usage: unknown argument: --bogus/);
  assert.match(unknown.errors(), /--report/);

  const relative = captureStreams();
  assert.equal(runContract(['--report', 'report.md'], relative), 1);
  assert.match(relative.errors(), /unsafe_path/);

  const root = workspace(t);
  const link = path.join(root, 'linked.md');
  fs.symlinkSync(path.join(REPOSITORY_ROOT, 'README.md'), link);
  const symlinked = captureStreams();
  assert.equal(runContract(['--report', link], symlinked), 1);
  assert.match(symlinked.errors(), /unsafe_path/);

  assert.throws(() => parseArguments([]), (error) => {
    assert.ok(error instanceof FindingSchemaError);
    assert.match(error.message, /missing required argument for --report/);
    return true;
  });
  assert.match(USAGE, /^Usage: roast-contract\.mjs/);
});

test('the required field set is overridable without weakening the default', () => {
  assert.deepEqual(REQUIRED_FINDING_FIELDS, ['Recommendation', 'Validation']);
  const result = validateFindingSchema(report(finding({ Validation: null })), {
    requiredFields: ['Recommendation'],
  });
  assert.equal(result.status, 'Valid');
  assert.deepEqual(result.checked, ['Recommendation']);
});

test('parseFindings exposes field content for a caller that needs it', () => {
  const { findings } = parseFindings(report(finding()));
  assert.equal(findings.length, 1);
  assert.equal(fieldContent(findings[0], 'Priority'), 'Must fix');
  assert.equal(fieldContent(findings[0], 'Absent'), null);
  assert.throws(() => parseFindings(42), (error) => {
    assert.equal(error.code, 'invalid_report');
    return true;
  });
});
