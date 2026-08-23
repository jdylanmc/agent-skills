/**
 * Drift guard between the ledger's priority vocabulary and the document that
 * owns it.
 *
 * `PRIORITIES` in `roast-round-ledger.mjs` is a hardcoded list of labels that
 * `skills/roast/_atoms/roast-contract/roast-contract.md` defines. This
 * repository has already shipped that exact shape of defect once: the finding
 * checker's recognised heading list omitted the heading its own lens emitted,
 * so it reported `Valid` with zero findings on a report full of violations,
 * behind a fully green suite.
 *
 * The failure mode here would be quieter still. If the roast contract gained or
 * renamed a priority, the ledger would refuse every finding carrying it with
 * `unknown_priority` — which fails closed, and is the right direction — but the
 * remediation loop would be unable to process a real roast at all. If instead a
 * priority moved between the mandatory and the ducked lane, the ledger would
 * happily route a `Must fix` finding to the rubber duck.
 *
 * So the list is not hand-synced. This suite derives it from the contract's own
 * Severity Mapping table and Accepted Finding Schema, and fails the build when
 * the two disagree.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DUCKED_PRIORITIES,
  MANDATORY_PRIORITIES,
  PRIORITIES,
} from './roast-round-ledger.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const CONTRACT = 'skills/roast/_atoms/roast-contract/roast-contract.md';

function read(relativePath) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, ...relativePath.split('/')), 'utf8');
}

/**
 * The right-hand column of the contract's `## Severity Mapping` table, minus
 * the row that maps a lens label to a non-finding disposition.
 */
function prioritiesFromSeverityMapping(document) {
  const section = /^## Severity Mapping$/m.exec(document);
  assert.ok(section, `${CONTRACT} no longer declares a Severity Mapping section`);
  const body = document.slice(section.index + section[0].length).split(/^## /m)[0];

  const mapped = [];
  for (const line of body.split('\n')) {
    const row = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/.exec(line);
    if (!row) {
      continue;
    }
    const [, lensLabel, roastSeverity] = row;
    if (lensLabel === 'Lens label' || /^-+$/.test(lensLabel.replace(/\s/g, ''))) {
      continue;
    }
    if (/Report under/i.test(roastSeverity)) {
      continue;
    }
    mapped.push(roastSeverity);
  }
  assert.ok(mapped.length >= 3, 'the severity mapping table produced too few rows to be trusted');
  return mapped;
}

/** The `Priority:` alternatives in the contract's Accepted Finding Schema. */
function prioritiesFromFindingSchema(document) {
  const line = /^- Priority: (.+)$/m.exec(document);
  assert.ok(line, `${CONTRACT} no longer declares a Priority line in its finding schema`);
  return line[1].split('|').map((value) => value.trim());
}

test('the ledger recognises exactly the priorities the roast contract maps', () => {
  const document = read(CONTRACT);
  const mapped = prioritiesFromSeverityMapping(document);
  assert.deepEqual(
    [...PRIORITIES].sort(),
    [...new Set(mapped)].sort(),
    'the roast contract changed its severity mapping; update PRIORITIES and the routing lanes deliberately',
  );
});

test('the ledger recognises exactly the priorities the finding schema permits', () => {
  assert.deepEqual([...PRIORITIES].sort(), [...prioritiesFromFindingSchema(read(CONTRACT))].sort());
});

test('the mandatory lane holds exactly the contract severity mapped from Blocker', () => {
  const document = read(CONTRACT);
  const blocker = /^\|\s*Blocker\s*\|\s*([^|]+?)\s*\|\s*$/m.exec(document);
  assert.ok(blocker, 'the contract no longer maps a Blocker lens label');
  assert.deepEqual(
    MANDATORY_PRIORITIES,
    [blocker[1]],
    'the priority a blocker maps to is resolved mandatorily and is never ducked',
  );
});

test('the ducked lane holds every remaining contract priority', () => {
  const document = read(CONTRACT);
  const remaining = prioritiesFromSeverityMapping(document).filter(
    (priority) => !MANDATORY_PRIORITIES.includes(priority),
  );
  assert.deepEqual([...DUCKED_PRIORITIES].sort(), [...new Set(remaining)].sort());
});

test('the contract still states that severity is a category and not a gate', () => {
  const document = read(CONTRACT);
  assert.match(document, /is a severity category and nothing more/);
  assert.match(document, /It is not a gate/);
});
