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
const AVAILABLE = ['code', 'domain', 'pragmatic', 'data', 'testing'];

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

test('the canonical manifest supplies every identifier the governing map needs', () => {
  const available = manifestIds(MANIFEST);
  assert.ok(available.length >= 5);
  for (const [type, governance] of Object.entries(GOVERNANCE)) {
    for (const entry of [...governance.primary, ...governance.conditional]) {
      assert.ok(
        available.includes(entry.id),
        `${type} names ${entry.id}, which the manifest does not declare`,
      );
    }
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
