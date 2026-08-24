/**
 * Seam tests for the artifact-profile atom.
 *
 * The point of this atom is that the agent, prompt, and skill roasts share one
 * authored contract, one authored failure reference, and one authored lens
 * reference. These tests hold that property mechanically: a field added to one
 * profile and not the others fails here, and a placeholder used in a shared
 * document with no matching field fails here.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ARTIFACT_TYPES,
  ArtifactProfileError,
  PROFILES,
  PROFILE_FIELDS,
  placeholdersIn,
  profileFor,
  render,
  renderField,
  run as runProfile,
} from './artifact-profile.mjs';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');

/** Repository-local scratch space; `.test-sandbox/` is git-ignored. */
function workspace(t, prefix = 'artifact-profile-') {
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

const SHARED_DOCUMENTS = [
  'roast/_atoms/roast-contract/roast-contract.md',
  'roast/_atoms/roast-failure-recovery/roast-failure-recovery.md',
  'roast/_atoms/roast-trusted-lenses/roast-trusted-lenses.md',
];

function readShared(relativePath) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, 'skills', relativePath), 'utf8');
}

test('every declared artifact type carries every declared field', () => {
  assert.deepEqual(ARTIFACT_TYPES, ['agent', 'prompt', 'skill']);
  for (const type of ARTIFACT_TYPES) {
    const profile = profileFor(type);
    const missing = PROFILE_FIELDS.filter((field) => !(field in profile));
    assert.deepEqual(missing, [], `${type} is missing field(s): ${missing.join(', ')}`);
    const extra = Object.keys(profile).filter((field) => !PROFILE_FIELDS.includes(field));
    assert.deepEqual(extra, [], `${type} declares undeclared field(s): ${extra.join(', ')}`);
  }
});

test('code is deliberately not an artifact profile', () => {
  assert.equal(PROFILES.code, undefined);
  assert.throws(() => profileFor('code'), (error) => {
    assert.ok(error instanceof ArtifactProfileError);
    assert.equal(error.code, 'unknown_artifact_type');
    return true;
  });
});

test('every placeholder in a shared document is a declared profile field', () => {
  for (const document of SHARED_DOCUMENTS) {
    const used = placeholdersIn(readShared(document));
    assert.ok(used.length > 0, `${document} declares no placeholder, so it is not shared material`);
    const undeclared = used.filter((field) => !PROFILE_FIELDS.includes(field));
    assert.deepEqual(undeclared, [], `${document} uses undeclared field(s): ${undeclared.join(', ')}`);
  }
});

test('every shared document resolves completely for every artifact type', () => {
  for (const document of SHARED_DOCUMENTS) {
    const template = readShared(document);
    for (const type of ARTIFACT_TYPES) {
      const resolved = render(template, type);
      assert.equal(
        placeholdersIn(resolved).length,
        0,
        `${document} still has an unresolved placeholder for ${type}`,
      );
    }
  }
});

test('the resolved contract carries the artifact type into the envelope check', () => {
  const template = readShared('roast/_atoms/roast-contract/roast-contract.md');
  for (const type of ARTIFACT_TYPES) {
    assert.match(render(template, type), new RegExp('`Artifact type` is `' + type + '`'));
  }
});

test('the resolved failure reference states each type-specific status meaning', () => {
  const template = readShared('roast/_atoms/roast-failure-recovery/roast-failure-recovery.md');
  assert.match(render(template, 'agent'), /The agent file or a linked prompt changed/);
  assert.match(render(template, 'prompt'), /the retained supplied text changed or was lost/);
  assert.match(render(template, 'skill'), /The package changed between staging and synthesis/);
});

test('only the prompt profile contributes the supplied-text section and its envelope rule', () => {
  const contract = readShared('roast/_atoms/roast-contract/roast-contract.md');
  assert.match(render(contract, 'prompt'), /## Supplied Prompt Text/);
  assert.match(render(contract, 'prompt'), /No section contains the full supplied prompt body/);
  for (const type of ['agent', 'skill']) {
    assert.doesNotMatch(render(contract, type), /## Supplied Prompt Text/);
    assert.doesNotMatch(render(contract, type), /full supplied prompt body/);
  }
});

test('each type resolves both of its mandatory roasters with their identifiers', () => {
  const expected = {
    agent: ['prompt-coach-roaster', 'agent-contract-roaster'],
    prompt: ['prompt-coach-roaster', 'responsible-ai-roaster'],
    skill: ['skill-reviewer-roaster', 'contract-safety-roaster'],
  };
  for (const [type, ids] of Object.entries(expected)) {
    const rendered = renderField(profileFor(type), 'mandatoryRoasters');
    for (const id of ids) {
      assert.match(rendered, new RegExp('Roaster ID `' + id + '`'));
    }
    assert.match(rendered, /^### 1\. /m);
    assert.match(rendered, /^### 2\. /m);
  }
});

test('each type declares exactly five ordered dynamic specialists', () => {
  for (const type of ARTIFACT_TYPES) {
    const profile = profileFor(type);
    assert.equal(profile.dynamicSpecialists.length, 5);
    assert.match(renderField(profile, 'dynamicSpecialists'), /^5\. \*\*Simplified Technical English/m);
  }
});

test('an undeclared placeholder refuses instead of resolving to nothing', () => {
  // The refusal is the point. A silent empty substitution would drop a whole
  // section from a contract and still look like a valid document, which is how
  // the three original copies diverged without anyone noticing.
  assert.throws(() => render('before {{notAField}} after', 'agent'), (error) => {
    assert.ok(error instanceof ArtifactProfileError);
    assert.equal(error.code, 'unknown_field');
    assert.match(error.message, /undeclared profile field\(s\): notAField/);
    return true;
  });

  // Nothing partial is returned alongside the refusal.
  let output = 'untouched';
  try {
    output = render('kept {{artifactNoun}} then {{notAField}}', 'agent');
  } catch {
    // expected
  }
  assert.equal(output, 'untouched');
});

test('no declared profile field is orphaned from every shared document', () => {
  // The reverse of the placeholder check. A field declared for all three types
  // but used nowhere is dead weight that still has to be kept in sync, and it
  // reads as coverage while parameterising nothing.
  const used = new Set();
  for (const document of SHARED_DOCUMENTS) {
    for (const field of placeholdersIn(readShared(document))) {
      used.add(field);
    }
  }
  const orphaned = PROFILE_FIELDS.filter((field) => !used.has(field));
  assert.deepEqual(
    orphaned,
    [],
    `declared but used by no shared document: ${orphaned.join(', ')}`,
  );
});

test('an unknown field refuses rather than returning undefined', () => {
  assert.throws(() => renderField(profileFor('agent'), 'nope'), (error) => {
    assert.equal(error.code, 'unknown_field');
    return true;
  });
});

test('the command line renders one field, one template, and the whole profile', (t) => {
  const single = captureStreams();
  assert.equal(runProfile(['--type', 'skill', '--field', 'artifactNoun'], single), 0);
  assert.equal(single.output().trim(), 'skill package');

  const whole = captureStreams();
  assert.equal(runProfile(['--type', 'prompt'], whole), 0);
  assert.equal(JSON.parse(whole.output()).type, 'prompt');

  const root = workspace(t);
  const template = path.join(root, 'template.md');
  fs.writeFileSync(template, 'noun: {{artifactNoun}}\n');
  const rendered = captureStreams();
  assert.equal(runProfile(['--type', 'agent', '--render', template], rendered), 0);
  assert.equal(rendered.output(), 'noun: agent definition\n');
});

test('the command line refuses a relative render path and an unknown type', (t) => {
  const relative = captureStreams();
  assert.equal(runProfile(['--type', 'agent', '--render', 'template.md'], relative), 1);
  assert.match(relative.errors(), /unsafe_path/);

  const unknown = captureStreams();
  assert.equal(runProfile(['--type', 'code'], unknown), 1);
  assert.match(unknown.errors(), /unknown_artifact_type/);

  const root = workspace(t);
  const directory = path.join(root, 'directory');
  fs.mkdirSync(directory);
  const notAFile = captureStreams();
  assert.equal(runProfile(['--type', 'agent', '--render', directory], notAFile), 1);
  assert.match(notAFile.errors(), /unsafe_path/);
});

test('probe reports availability without any input', () => {
  const streams = captureStreams();
  assert.equal(runProfile(['--probe'], streams), 0);
  assert.match(streams.output(), /artifact-profile: available/);
});
