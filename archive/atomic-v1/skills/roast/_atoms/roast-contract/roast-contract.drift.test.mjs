import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  ACCEPTED_FINDING_SECTIONS, EXEMPT_FINDING_SECTIONS, ROAST_FINDING_FIELDS,
  parseFindings, validateFindingSchema, validateRoastReport,
} from './roast-contract.mjs';

const contract = fs.readFileSync(new URL('./roast-contract.md', import.meta.url), 'utf8');
const sample = contract.match(/```markdown\n(# Roast\n[\s\S]*?)\n```/)?.[1];

test('the canonical final report example passes the checker it documents', () => {
  assert.ok(sample, 'contract must contain its complete final report example');
  const result = validateRoastReport(sample);
  assert.equal(result.status, 'Valid', JSON.stringify(result.defects));
  assert.equal(result.reviewStatus, 'Partial');
  assert.equal(result.findings, 1);
  assert.deepEqual(parseFindings(sample).findings[0].order, ROAST_FINDING_FIELDS);
});

test('emitted findings are checked rather than lost when a heading changes', () => {
  for (const heading of [...ACCEPTED_FINDING_SECTIONS, 'Invented Heading']) {
    const source = sample.replace('## Findings', `## ${heading}`).replace(/^- Recommendation:.*\n/m, '');
    const result = validateFindingSchema(source);
    assert.equal(result.status, 'Invalid', heading);
    assert.ok(result.findings + result.unrecognised > 0, heading);
  }
  assert.deepEqual(ACCEPTED_FINDING_SECTIONS.filter((section) => EXEMPT_FINDING_SECTIONS.includes(section)), []);
});

test('canonical guidance distinguishes formatting, evidence, and approval', () => {
  assert.match(contract, /Intermediate reviewer\s+prose has no mandatory grammar/);
  assert.match(contract, /Needs clarification cannot become\s+Complete merely because presentation was repaired/);
  assert.match(contract, /Every displayed finding field is required and non-empty, with no exception/);
  assert.match(contract, /Structural success is never semantic correctness or\s+human approval/);
  assert.match(contract, /stdin/);
  assert.match(contract, /validateRoastReport\(reportString/);
  assert.match(contract, /humor belongs outside\s+findings/);
  assert.doesNotMatch(contract, /\{\{[A-Za-z]+\}\}/);
});
