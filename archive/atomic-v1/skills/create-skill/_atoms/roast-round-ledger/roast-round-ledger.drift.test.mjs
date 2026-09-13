import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  DUCKED_PRIORITIES,
  MANDATORY_PRIORITIES,
  PRIORITIES,
} from './roast-round-ledger.mjs';

const CONTRACT = new URL('../../../roast/_atoms/roast-contract/roast-contract.md', import.meta.url);

test('the ledger recognises exactly the priorities the Roast finding schema permits', () => {
  const document = fs.readFileSync(CONTRACT, 'utf8');
  const declaration = /Priority is ([\s\S]+?); Confidence is/.exec(document);
  assert.ok(declaration, 'the Roast contract must declare its finding priorities');
  const priorities = [...declaration[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  assert.deepEqual([...PRIORITIES].sort(), [...priorities].sort());
});

test('the canonical Roast contract preserves confidence and evidence-bearing finding fields', () => {
  const document = fs.readFileSync(CONTRACT, 'utf8');
  const declaration = /Confidence is ([\s\S]+?)\./.exec(document);
  assert.ok(declaration, 'the Roast contract must declare finding confidence');
  const confidence = [...declaration[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  assert.deepEqual(confidence, ['High', 'Medium', 'Low']);
  const finding = /## Findings\n([\s\S]+?)\n## Coverage/.exec(document);
  assert.ok(finding, 'the canonical report must show its finding fields');
  const fields = [...finding[1].matchAll(/^- ([^:\n]+):/gm)].map((match) => match[1]);
  assert.deepEqual(fields, [
    'Priority', 'Confidence', 'Location', 'Evidence', 'Consequence',
    'Standard', 'Recommendation', 'Validation',
  ]);
});

test('the caller resolves Must fix mandatorily and ducks every remaining priority', () => {
  assert.deepEqual(MANDATORY_PRIORITIES, ['Must fix']);
  assert.deepEqual([...DUCKED_PRIORITIES].sort(),
    PRIORITIES.filter((priority) => !MANDATORY_PRIORITIES.includes(priority)).sort());
});
