import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderStatus } from './_atoms/concise-report/concise-report.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const normalized = (name) => read(name).replace(/\s+/gu, ' ');

test('routing stays a small on-demand status snapshot rather than task selection or execution', () => {
  const skill = normalized('SKILL.md');
  assert.match(skill, /Use when the operator asks for a status report/);
  assert.match(skill, /Do not use to select the next action/);
  assert.match(skill, /disable-model-invocation: false/);
  assert.match(skill, /user-invocable: true/);
  assert.match(skill, /allowed-tools: \["execute","read"\]/);
  assert.match(skill, /requires-skills: \[\]/);
  assert.match(skill, /one snapshot, no monitoring loop/);
  assert.match(skill, /only persistence exception is best-effort Chronicle diagnostics/);
});

test('local composition keeps evidence separate from presentation and records through Chronicler', () => {
  const skill = read('SKILL.md');
  const molecule = read('_molecules/objective-report/objective-report.md');
  assert.match(skill, /_base\/_molecules\/chronicler\/chronicler\.md/);
  assert.match(molecule, /snapshot-evidence\/snapshot-evidence\.md/);
  assert.match(molecule, /concise-report\/concise-report\.md/);
  for (const atom of ['snapshot-evidence', 'concise-report']) {
    assert.match(read(`_atoms/${atom}/${atom}.md`), /composes: \[\]/);
  }
});

test('collection requires objective ownership, runtime evidence and explicit partial coverage', () => {
  const evidence = normalized('_atoms/snapshot-evidence/snapshot-evidence.md');
  for (const expected of [
    /not the whole conversation or repository/,
    /never infer ownership/i,
    /objective-bound start timestamp/,
    /deduplicated by native call ID/,
    /both agent ownership and objective membership/,
    /Exclude the status-report invocation's own calls/,
    /ancestry beneath the reporting agent/,
    /Include nested descendants/,
    /exclude the reporting agent, idle\/completed workers, and unrelated agents/,
    /No start-without-completion log heuristic proves/,
    /later; do not call that a complete cutoff-time count/,
    /number and title/,
    /title unavailable/,
  ]) assert.match(evidence, expected);
});

test('formatter contract preserves readable tickets, explicit unknowns and compact objective wording', () => {
  const contract = normalized('_atoms/concise-report/concise-report.md');
  assert.match(contract, /at most 360 characters and three sentences/);
  assert.match(contract, /put ticket references|Introduced references belong in that array/);
  assert.match(contract, /partial lists may show their observed items but never claim a total/iu);
  assert.match(contract, /without asserting|collection owns the evidence's authenticity/i);
  assert.match(contract, /Do not add a guessed progress bar/);
  assert.match(contract, /no report/);
  assert.match(contract, /fixed, source-free fallback/);
  assert.match(contract, /Do not append raw titles, assignments, reasons, or error output/);
});

test('the documented synthetic snapshot satisfies the formatter contract', () => {
  const match = read('_atoms/concise-report/concise-report.md').match(/```json\n([\s\S]*?)\n```/u);
  assert.ok(match);
  const rendered = renderStatus(JSON.parse(match[1]));
  assert.match(rendered, /#202 - Migrate the cache reader/);
  assert.match(rendered, /Tool calls \(this agent\):\*\* Unavailable/);
  assert.match(rendered, /Running subagents:\*\* 1/);
});

test('confirmed intent exists without runtime metadata or a signature footer', () => {
  const intent = read('intent.md');
  assert.ok(intent.startsWith('# Intent: status-report\n'));
  assert.doesNotMatch(intent, /^---/);
  assert.match(intent.replace(/\s+/gu, ' '), /ticket number and the ticket title/);
  assert.doesNotMatch(read('SKILL.md'), /🤖|created using the create-skill AI skill/);
});

function registeredPaths(workflow) {
  const lines = workflow.replace(/\r\n/gu, '\n').split('\n');
  const jobs = lines.indexOf('jobs:');
  const job = lines.findIndex((line, index) => index > jobs && /^  validate:\s*$/u.test(line));
  assert.ok(jobs >= 0 && job > jobs, 'expected the active validate job');
  let end = lines.findIndex((line, index) => index > job && /^(?:\S|  \S)/u.test(line));
  if (end < 0) end = lines.length;
  const jobLines = lines.slice(job + 1, end);
  assert.ok(!jobLines.some((line) => /^    if:/u.test(line)), 'conditional validate job needs explicit coverage reasoning');
  const step = jobLines.findIndex((line) => /^      - name: Run validator and conformance tests\s*$/u.test(line));
  assert.ok(step >= 0, 'expected the test execution step');
  let stepEnd = jobLines.findIndex((line, index) => index > step && /^      - /u.test(line));
  if (stepEnd < 0) stepEnd = jobLines.length;
  const stepLines = jobLines.slice(step + 1, stepEnd);
  assert.ok(!stepLines.some((line) => /^        if:/u.test(line)), 'conditional test step needs explicit coverage reasoning');
  const run = stepLines.findIndex((line) => /^        run: >-?\s*$/u.test(line));
  assert.ok(run >= 0, 'expected the repository folded run command');
  const command = [];
  for (const line of stepLines.slice(run + 1)) {
    if (!line.trim()) continue;
    if (!/^          /u.test(line)) break;
    if (!line.trimStart().startsWith('#')) command.push(line.trim());
  }
  const tokens = command.join(' ').split(/\s+/u);
  assert.deepEqual(tokens.slice(0, 2), ['node', 'scripts/run-registered-tests.mjs']);
  assert.ok(tokens.slice(2).every((token) =>
    /^(?:scripts|skills)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.test\.mjs$/u.test(token) &&
    !token.split('/').includes('..')),
  'only direct registered-test arguments are allowed; shell operators and other commands are not registration');
  return new Set(tokens.slice(2));
}

function assertRegistered(workflow) {
  const paths = registeredPaths(workflow);
  assert.ok(paths.has('skills/status-report/status-report.conformance.test.mjs'));
  assert.ok(paths.has('skills/status-report/_atoms/concise-report/concise-report.test.mjs'));
}

const workflow = () => fs.readFileSync(path.join(ROOT, '../../.github/workflows/validate-skills.yml'), 'utf8');

test('new tests are arguments of the active registered-test runner', () => {
  assertRegistered(workflow());
});

test('commented paths do not count as test registration', () => {
  assert.throws(() => assertRegistered(workflow().replace(
    '          skills/status-report/status-report.conformance.test.mjs',
    '          # skills/status-report/status-report.conformance.test.mjs',
  )));
});

test('disabled jobs and steps cannot claim registered test execution', () => {
  assert.throws(() => assertRegistered(workflow().replace('  validate:\n', '  validate:\n    if: false\n')));
  assert.throws(() => assertRegistered(workflow().replace(
    '      - name: Run validator and conformance tests\n',
    '      - name: Run validator and conformance tests\n        if: false\n',
  )));
});

test('paths in a second shell command do not count as runner arguments', () => {
  const source = workflow()
    .replace('          skills/status-report/status-report.conformance.test.mjs\n', '')
    .replace('          skills/status-report/_atoms/concise-report/concise-report.test.mjs\n', '')
    .replace('          node scripts/run-registered-tests.mjs\n',
      '          node scripts/run-registered-tests.mjs && echo skills/status-report/status-report.conformance.test.mjs skills/status-report/_atoms/concise-report/concise-report.test.mjs\n');
  assert.throws(() => assertRegistered(source), /only direct registered-test arguments/);
});
