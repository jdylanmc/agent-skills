/**
 * Seam tests for the doctrine-select atom.
 *
 * These cover the contract a consumer depends on: a governing map that selects
 * only what applies, a caller override that beats inference, reasoning that
 * accounts for every doctrine skipped, and refusal in place of a default.
 * Hostile input lives in the adversarial suite beside this one.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ARTIFACT_TYPES,
  GOVERNANCE,
  manifestIds,
  run as runSelect,
  selectDoctrine,
} from './doctrine-select.mjs';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const MANIFEST = path.join(REPOSITORY_ROOT, 'doctrine', 'manifest.md');
const AVAILABLE = manifestIds(MANIFEST);
const FOCUSED_DOCTRINES = [
  'boundaries',
  'data-processing',
  'distributed-data',
  'test-seams',
  'integration-testing',
  'solid',
  'laziness',
];

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

function ids(result) {
  return result.selection.map((entry) => entry.id);
}

test('every focused doctrine has a selective governance route and every governance id exists', () => {
  const available = manifestIds(MANIFEST);
  const routed = new Set();
  const primary = new Set();
  for (const [type, governance] of Object.entries(GOVERNANCE)) {
    for (const entry of governance.primary) {
      primary.add(entry.id);
    }
    for (const entry of [...governance.primary, ...governance.conditional]) {
      routed.add(entry.id);
      assert.ok(
        available.includes(entry.id),
        `${type} names ${entry.id}, which the manifest does not declare`,
      );
    }
  }
  for (const id of FOCUSED_DOCTRINES) {
    assert.ok(routed.has(id), `${id} has no governance route`);
    assert.ok(!primary.has(id), `${id} must remain evidence-triggered, not primary`);
  }
});

test('every artifact type selects its declared primary doctrine and nothing else by default', () => {
  const expected = {
    agent: ['code', 'pragmatic'],
    prompt: ['pragmatic', 'code'],
    skill: ['pragmatic', 'code'],
    spec: ['pragmatic', 'code'],
    code: ['code', 'pragmatic'],
  };
  assert.deepEqual(ARTIFACT_TYPES, Object.keys(expected));
  for (const [type, primary] of Object.entries(expected)) {
    const result = selectDoctrine({ artifactType: type, availableIds: AVAILABLE });
    assert.equal(result.status, 'Selected');
    assert.equal(result.source, 'inferred');
    assert.deepEqual(ids(result), primary);
    assert.ok(result.selection.every((entry) => entry.role === 'primary'));
  }
});

test('a conditional doctrine is selected only when its trigger was observed', () => {
  const without = selectDoctrine({ artifactType: 'skill', availableIds: AVAILABLE });
  assert.ok(!ids(without).includes('testing'));

  const with_ = selectDoctrine({
    artifactType: 'skill',
    triggers: ['validation'],
    availableIds: AVAILABLE,
  });
  assert.ok(ids(with_).includes('testing'));
  const testing = with_.selection.find((entry) => entry.id === 'testing');
  assert.equal(testing.role, 'conditional');
  assert.equal(testing.trigger, 'validation');
  assert.ok(testing.reason.length > 0);
});

test('each focused doctrine is selected only by its evidence trigger', () => {
  const routes = {
    'bounded-context-meaning': 'boundaries',
    'replay-order-time': 'data-processing',
    'distributed-coordination': 'distributed-data',
    'test-doubles': 'test-seams',
    'real-boundary-fidelity': 'integration-testing',
    'object-design': 'solid',
    'implementation-economy': 'laziness',
    'durable-authority': 'documentation',
    automation: 'machine',
    'causal-debugging': 'debugging',
  };
  const without = selectDoctrine({ artifactType: 'code', availableIds: AVAILABLE });
  for (const id of Object.values(routes)) {
    assert.ok(!ids(without).includes(id), `${id} loaded without evidence`);
  }
  for (const [trigger, id] of Object.entries(routes)) {
    const result = selectDoctrine({
      artifactType: 'code',
      triggers: [trigger],
      availableIds: AVAILABLE,
    });
    assert.ok(ids(result).includes(id), `${trigger} did not route to ${id}`);
    const selected = result.selection.find((entry) => entry.id === id);
    assert.equal(selected.role, 'conditional');
    assert.equal(selected.trigger, trigger);
    assert.ok(selected.reason.length > 0);
  }
});

test('reasoning accounts for every doctrine skipped, not only those selected', () => {
  const result = selectDoctrine({
    artifactType: 'agent',
    triggers: ['data-contract'],
    availableIds: AVAILABLE,
  });
  const reasoning = result.reasoning.join('\n');
  assert.match(reasoning, /Selected data: its trigger data-contract was observed/);
  assert.match(reasoning, /Skipped domain: its trigger domain-model was not observed/);
  assert.match(reasoning, /merely because it is available/);

  const selected = new Set(ids(result));
  const expectedSkipped = AVAILABLE.filter((id) => !selected.has(id));
  const actualSkipped = result.reasoning
    .filter((entry) => entry.startsWith('Skipped '))
    .map((entry) => /^Skipped ([a-z0-9-]+):/.exec(entry)?.[1]);
  assert.deepEqual(actualSkipped, expectedSkipped);
  assert.match(
    reasoning,
    /Skipped documentation: artifact type agent declares no governance route for it\./,
  );
});

test('an unrecognised trigger is reported rather than silently dropped', () => {
  const result = selectDoctrine({
    artifactType: 'prompt',
    triggers: ['validation'],
    availableIds: AVAILABLE,
  });
  assert.deepEqual(ids(result), ['pragmatic', 'code']);
  assert.match(result.reasoning.join('\n'), /Ignored trigger validation/);
});

test('an explicit caller selection overrides inference and says so', () => {
  const result = selectDoctrine({
    artifactType: 'skill',
    explicitSelection: ['testing'],
    availableIds: AVAILABLE,
  });
  assert.equal(result.status, 'Selected');
  assert.equal(result.source, 'caller-override');
  assert.deepEqual(ids(result), ['testing']);
  assert.equal(result.selection[0].role, 'explicit');
  assert.match(result.reasoning.join('\n'), /overrides inference/);
  assert.match(result.reasoning.join('\n'), /inferred selection for skill was not used/);
  assert.deepEqual(
    result.reasoning
      .filter((entry) => entry.startsWith('Skipped '))
      .map((entry) => /^Skipped ([a-z0-9-]+):/.exec(entry)?.[1]),
    AVAILABLE.filter((id) => id !== 'testing'),
  );
});

test('a missing artifact type refuses instead of choosing a default doctrine', () => {
  const result = selectDoctrine({ availableIds: AVAILABLE });
  assert.equal(result.status, 'Refused');
  assert.equal(result.category, 'Ambiguous artifact type');
  assert.equal(result.selection, undefined);
});

test('an ungoverned artifact type refuses and names the declared types', () => {
  const result = selectDoctrine({ artifactType: 'spreadsheet', availableIds: AVAILABLE });
  assert.equal(result.status, 'Refused');
  assert.equal(result.category, 'No governing doctrine');
  assert.match(result.detail, /agent, prompt, skill, spec, code/);
});

test('an identifier the manifest does not declare refuses', () => {
  const explicit = selectDoctrine({
    artifactType: 'skill',
    explicitSelection: ['invented'],
    availableIds: AVAILABLE,
  });
  assert.equal(explicit.status, 'Refused');
  assert.equal(explicit.category, 'Unknown doctrine identifier');

  const inferred = selectDoctrine({ artifactType: 'skill', availableIds: ['testing'] });
  assert.equal(inferred.status, 'Refused');
  assert.equal(inferred.category, 'Unknown doctrine identifier');
});

test('selectors are exactly what the evaluation atom accepts', () => {
  const result = selectDoctrine({
    artifactType: 'code',
    triggers: ['validation'],
    availableIds: AVAILABLE,
  });
  assert.deepEqual(result.selectors, ['--select code', '--select pragmatic', '--select testing']);
});

test('the command line selects, refuses, and probes with stable exit codes', () => {
  const selected = captureStreams();
  assert.equal(runSelect(['--manifest', MANIFEST, '--type', 'agent'], selected), 0);
  assert.deepEqual(ids(JSON.parse(selected.output())), ['code', 'pragmatic']);

  const refused = captureStreams();
  assert.equal(runSelect(['--manifest', MANIFEST, '--type', 'poem'], refused), 2);
  assert.equal(JSON.parse(refused.output()).category, 'No governing doctrine');

  const usage = captureStreams();
  assert.equal(runSelect(['--type', 'agent'], usage), 1);
  assert.match(usage.errors(), /usage/);

  const probe = captureStreams();
  assert.equal(runSelect(['--probe'], probe), 0);
  assert.match(probe.output(), /doctrine-select: available/);
});

test('the atom opens no doctrine file, only the manifest', () => {
  const opened = [];
  const realReadFileSync = fs.readFileSync;
  fs.readFileSync = (target, ...rest) => {
    opened.push(String(target));
    return realReadFileSync(target, ...rest);
  };
  try {
    const streams = captureStreams();
    assert.equal(runSelect(['--manifest', MANIFEST, '--type', 'skill', '--trigger', 'validation'], streams), 0);
  } finally {
    fs.readFileSync = realReadFileSync;
  }
  assert.deepEqual(opened, [MANIFEST]);
  assert.ok(!opened.some((target) => target.endsWith('.doctrine.md')));
});
