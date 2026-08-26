import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const flat = (relative) => read(relative).replace(/\s+/g, ' ');

test('spec is routable from confirmed Discovery and refuses adjacent jobs', () => {
  const skill = read('skills/spec/SKILL.md');
  assert.match(skill, /name: spec/);
  assert.match(skill, /disable-model-invocation: false/);
  assert.match(skill, /user-invocable: true/);
  assert.match(skill, /Markdown artifact or tracker issue/);
  for (const refusal of ['choose architecture', 'author Gherkin', 'create tickets', 'mutate trackers', 'implement']) {
    assert.match(skill, new RegExp(refusal, 'i'));
  }
});

test('durable workflow artifacts stay under docs agent', () => {
  const intent = flat('skills/spec/intent.md');
  const skill = flat('skills/spec/SKILL.md');
  assert.match(intent, /docs\/agent\/discovery/);
  assert.match(intent, /docs\/agent\/specs/);
  assert.match(intent, /durable workspace/);
  assert.match(skill, /docs\/agent\/specs\/<slug>\.nano\.md/);
  assert.match(skill, /docs\/agent\/specs\/<slug>\.full\.md/);
});

test('nano authority and full supporting context cannot silently trade places', () => {
  const skill = flat('skills/spec/SKILL.md');
  const pair = flat('skills/spec/_atoms/spec-pair/spec-pair.md');
  assert.match(skill, /nano document is settled product intent/);
  assert.match(skill, /full document never wins/);
  assert.match(pair, /Every bullet under Product Requirements and Product Decisions contains one authority marker/);
  assert.match(pair, /Every nano acceptance-criteria identifier appears in Traceability/);
});

test('one-pass Roast stays separate from Ship remediation and human approval', () => {
  const skill = flat('skills/spec/SKILL.md');
  const intent = flat('skills/spec/intent.md');
  assert.match(skill, /Invoke `roast` once/);
  assert.match(skill, /outer delivery workflow may apply repairs/);
  assert.match(intent, /A roast is one read-only review pass/);
  assert.match(intent, /delivery workflow owns any repeated roast, repair, and re-roast loop/);
  assert.match(skill, /Silence and unrelated replies are not approval/);
});

test('composition is local-first and includes the required chronicler', () => {
  const skill = read('skills/spec/SKILL.md');
  const molecule = read('skills/spec/_molecules/product-specification/product-specification.md');
  assert.match(skill, /_base\/_molecules\/chronicler\/chronicler\.md/);
  for (const atom of ['discovery-source', 'product-requirements', 'spec-outcome', 'spec-pair']) {
    assert.match(molecule, new RegExp(`spec/_atoms/${atom}/${atom}\\.md`));
  }
});

test('human-confirmed intent is present and treated as the source', () => {
  const intent = read('skills/spec/intent.md');
  assert.match(intent, /^# Intent: spec/);
  assert.match(intent, /tracker issue/);
  assert.match(intent, /product requirements documents/i);
  assert.match(intent, /The nano document is intentionally smaller/);
});
