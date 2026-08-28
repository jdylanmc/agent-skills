/**
 * Seam tests for the spec-authority-screen atom.
 *
 * The property worth holding: a report that inverts the nano authority is
 * rejected, a report that respects it passes, and the checker cannot be
 * satisfied by handing it a record with nothing to check against.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALIGNMENT_TERMS,
  CONFLICT_TERMS,
  DEFECT_CATEGORIES,
  FULL_TERMS,
  NANO_TERMS,
  NEGATION_TERMS,
  SpecAuthorityScreenError,
  manifestLines,
  run as runScreen,
  screenSpecReport,
} from './spec-authority-screen.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');
const DOCUMENT = fs.readFileSync(path.join(UNIT_ROOT, 'spec-authority-screen.md'), 'utf8');

/** Repository-local scratch space; `.test-sandbox/` is git-ignored. */
function workspace(t) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'spec-authority-screen-'));
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

function pairRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    status: 'Paired',
    blocking: false,
    authority: { layer: 'nano', locator: 'specs/checkout.nano.md' },
    specId: 'SPEC-CHECKOUT',
    files: {
      nano: { layer: 'nano', locator: 'specs/checkout.nano.md', status: 'Present' },
      full: { layer: 'full', locator: 'specs/checkout.full.md', status: 'Present' },
    },
    criteria: [{ id: 'AC-1', line: 12, text: 'A basket stays reserved for fifteen minutes.' }],
    ...overrides,
  };
}

function report({ manifest, findings } = {}) {
  return [
    '# Artifact Roast Envelope',
    '',
    '## Evidence Manifest',
    '',
    manifest ??
      '- specs/checkout.nano.md, sha256 aaa, revision 1, Evidence status: Staged\n- specs/checkout.full.md, sha256 bbb, revision 1, Evidence status: Staged',
    '',
    '## Must Fix',
    '',
    findings ?? 'none',
    '',
    'END ARTIFACT ROAST ENVELOPE',
  ].join('\n');
}

function roastDocument(findings) {
  return ['# Artifact Roast', '', '## Must Fix', '', findings, '', 'END ARTIFACT ROASTER REPORT'].join(
    '\n',
  );
}

function finding(fields = {}) {
  const merged = {
    Priority: 'Must fix',
    Confidence: 'High',
    Location: 'specs/checkout.full.md:L20',
    Evidence: 'The section states a requirement.',
    Consequence: 'A reader treats context as authority.',
    Recommendation: 'Move the requirement into the nano specification, or mark the passage as context.',
    Validation: 'Re-run the pair resolver and confirm no untraced requirement remains.',
    ...fields,
  };
  return [
    '### SPEC-001',
    ...Object.entries(merged).map(([label, value]) => `- ${label}: ${value}`),
  ].join('\n');
}

function categories(result) {
  return result.defects.map((entry) => entry.category);
}

/**
 * The `report()` helper produces an envelope, which is the phase that carries a
 * `## Evidence Manifest`. `--phase` is required by the atom contract, so these
 * seams name it explicitly through this wrapper; the roast phase and the
 * refusal on a missing or unknown phase are exercised in their own tests below.
 */
function screen(reportText, record, options = {}) {
  return screenSpecReport(reportText, record, { phase: 'envelope', ...options });
}

test('a report that respects the authority is valid', () => {
  const result = screen(report({ findings: finding() }), pairRecord());

  assert.equal(result.status, 'Valid');
  assert.deepEqual(result.defects, []);
  assert.equal(result.authorityLocator, 'specs/checkout.nano.md');
  assert.equal(result.entriesScanned, 1);
});

test('a report with no findings at all is valid', () => {
  const result = screen(report(), pairRecord());

  assert.equal(result.status, 'Valid');
  assert.equal(result.entriesScanned, 0);
  assert.equal(result.criterionCitations, 0);
});

test('bringing the nano specification into line with the full one is rejected', () => {
  // The failure this atom exists for. It reads as helpful advice and changes
  // an approved artifact so that an unapproved one becomes right.
  const result = screen(
    report({
      findings: finding({
        Location: 'specs/checkout.nano.md:L12',
        Recommendation: 'Update the nano specification to match the full specification.',
      }),
    }),
    pairRecord(),
  );

  assert.equal(result.status, 'Invalid');
  assert.deepEqual(categories(result), ['Inverted authority']);
  assert.match(result.defects[0].message, /the full artifact is what changes/);
});

test('bringing the nano locator into line with the full locator is rejected in both phases', () => {
  const findings = finding({
    Location: 'specs/checkout.nano.md:L12',
    Recommendation: 'Update specs/checkout.nano.md to match specs/checkout.full.md.',
  });

  const envelope = screen(report({ findings }), pairRecord());
  const roast = screenSpecReport(roastDocument(findings), pairRecord(), { phase: 'roast' });

  assert.deepEqual(categories(envelope), ['Inverted authority']);
  assert.deepEqual(categories(roast), ['Inverted authority']);
});

test('bringing the full specification into line with the nano one is clean', () => {
  const result = screen(
    report({
      findings: finding({
        Recommendation: 'Align the full specification with the nano specification, which is authority.',
      }),
    }),
    pairRecord(),
  );

  assert.equal(result.status, 'Valid');
});

test('recommending a change to the nano specification on its own merits is clean', () => {
  // The screen objects to the direction of an alignment, never to touching the
  // nano artifact. An ambiguous criterion should be rewritten.
  const result = screen(
    report({
      findings: finding({
        Location: 'specs/checkout.nano.md:L12',
        Recommendation: 'Rewrite AC-1 so the reservation window is stated as an observable duration.',
      }),
    }),
    pairRecord(),
  );

  assert.equal(result.status, 'Valid');
  assert.equal(result.criterionCitations, 1);
});

test('an entry resting on a layer disagreement must name the authority', () => {
  // An entry rests on a disagreement when it names a conflict term and both
  // layers. It is unattributed when it carries no `Authority` field, and clean
  // when the field names the nano locator.
  const unattributed = screen(
    report({
      findings: finding({
        Evidence: 'The full specification contradicts the nano specification on the reservation window.',
        Recommendation: 'Delete the contradicting passage.',
      }),
    }),
    pairRecord(),
  );
  assert.deepEqual(categories(unattributed), ['Unattributed authority']);

  const attributed = screen(
    report({
      findings: finding({
        Evidence: 'The full specification contradicts the nano specification on the reservation window.',
        Authority: 'specs/checkout.nano.md',
        Recommendation: 'Delete the contradicting passage.',
      }),
    }),
    pairRecord(),
  );
  assert.equal(attributed.status, 'Valid');
  assert.equal(attributed.authorityEntries, 1);
});

test('an Authority field naming the full locator is an inversion (Finding 1)', () => {
  // The guard the two-phase design was moved onto. Prose is clean; only the
  // field is wrong. No-op'ing the Authority guard leaves this passing, which is
  // exactly the mutation this test kills.
  const result = screen(
    report({
      findings: finding({
        Authority: 'specs/checkout.full.md',
        Recommendation: 'Delete the contradicting passage.',
      }),
    }),
    pairRecord(),
  );

  assert.deepEqual(categories(result), ['Inverted authority']);
  assert.match(result.defects[0].message, /specs\/checkout\.full\.md/);
});

test('an Authority field naming both locators attributes nothing and inverts (Finding 2)', () => {
  const result = screen(
    report({
      findings: finding({
        Authority: 'specs/checkout.full.md and specs/checkout.nano.md',
        Recommendation: 'Delete the contradicting passage.',
      }),
    }),
    pairRecord(),
  );

  assert.deepEqual(categories(result), ['Inverted authority']);
});

test('an Authority field that only contains the nano locator as a longer token inverts (Finding 4)', () => {
  // `checkout.nano.md.bak` contains the nano locator as a substring but is not
  // it. `namesLocator → return true` makes this pass; this test kills it.
  const result = screen(
    report({
      findings: finding({
        Authority: 'specs/checkout.nano.md.bak',
        Recommendation: 'Delete the contradicting passage.',
      }),
    }),
    pairRecord(),
  );

  assert.deepEqual(categories(result), ['Inverted authority']);
});

test('an Authority field must normalize to exactly the nano locator', () => {
  for (const Authority of [
    'specs/checkout.nano.md and docs/source.md',
    'specs/checkout.nano.md extra text',
    '[Nano](specs/checkout.nano.md) and docs/source.md',
  ]) {
    const result = screen(
      report({
        findings: finding({
          Authority,
          Recommendation: 'Delete the contradicting passage.',
        }),
      }),
      pairRecord(),
    );
    assert.deepEqual(categories(result), ['Inverted authority']);
  }

  for (const Authority of [
    'specs/checkout.nano.md',
    '`specs/checkout.nano.md`',
    '[Nano authority](specs/checkout.nano.md)',
  ]) {
    const result = screen(
      report({
        findings: finding({
          Evidence: 'The full specification contradicts the nano specification on the window.',
          Authority,
          Recommendation: 'Delete the contradicting passage.',
        }),
      }),
      pairRecord(),
    );
    assert.equal(result.status, 'Valid');
  }
});

test('a manifest line naming only a look-alike of the sibling is missing evidence (Finding 4)', () => {
  const result = screen(
    report({
      manifest:
        '- specs/checkout.nano.md.bak, sha256 aaa, revision 1, Evidence status: Staged\n- specs/checkout.full.md, sha256 bbb, revision 1, Evidence status: Staged',
    }),
    pairRecord(),
  );

  assert.deepEqual(categories(result), ['Missing pair evidence']);
  assert.match(result.defects[0].message, /specs\/checkout\.nano\.md/);
});

test('a negation opening a clause is skipped but a trailing one does not suppress (Finding 3)', () => {
  const skipped = screen(
    report({
      findings: finding({
        Location: 'specs/checkout.nano.md:L12',
        Recommendation: 'Do not update the nano specification to match the full specification.',
      }),
    }),
    pairRecord(),
  );
  assert.equal(skipped.status, 'Valid');

  const never = screen(
    report({
      findings: finding({
        Location: 'specs/checkout.nano.md:L12',
        Recommendation: 'Never update the nano specification to match the full specification.',
      }),
    }),
    pairRecord(),
  );
  assert.equal(never.status, 'Valid');

  const trailing = screen(
    report({
      findings: finding({
        Location: 'specs/checkout.nano.md:L12',
        Recommendation:
          'Update the nano specification to match the full specification, rather than leaving the drift in place.',
      }),
    }),
    pairRecord(),
  );
  assert.deepEqual(categories(trailing), ['Inverted authority']);
});

test('a contrast opener suppresses only the contrast span, not the following directive', () => {
  const result = screen(
    report({
      findings: finding({
        Authority: 'specs/checkout.nano.md',
        Location: 'specs/checkout.nano.md:L12',
        Recommendation:
          'Instead of leaving the drift, update the nano specification to match the full specification.',
      }),
    }),
    pairRecord(),
  );

  assert.deepEqual(categories(result), ['Inverted authority']);
});

test('a disagreement naming only the full layer still demands an authority (Finding 5)', () => {
  // The coverage 173c527 removed: an entry that rests on a conflict and names
  // the context layer must attribute an authority even when it never names the
  // nano layer by that word. No-op'ing the Unattributed guard kills this.
  const result = screen(
    report({
      findings: finding({
        Evidence: 'The full specification contradicts the stated reservation window.',
        Recommendation: 'Delete the contradicting passage.',
      }),
    }),
    pairRecord(),
  );

  assert.deepEqual(categories(result), ['Unattributed authority']);
});

test('a lowercase criterion citation is matched like its uppercase form (Finding 9)', () => {
  const result = screen(
    report({ findings: finding({ Evidence: 'The section elaborates ac-9.' }) }),
    pairRecord(),
  );

  assert.deepEqual(categories(result), ['Undeclared criterion citation']);
  assert.match(result.defects[0].message, /AC-9/);
});

test('citing an identifier the staged pair does not declare is rejected', () => {
  const result = screen(
    report({ findings: finding({ Evidence: 'The section elaborates AC-9.' }) }),
    pairRecord(),
  );

  assert.deepEqual(categories(result), ['Undeclared criterion citation']);
  assert.match(result.defects[0].message, /AC-9/);
});

test('a sibling missing from the manifest, or missing its status, is rejected', () => {
  const omitted = screen(
    report({ manifest: '- specs/checkout.nano.md, sha256 aaa, revision 1' }),
    pairRecord(),
  );
  assert.deepEqual(categories(omitted), ['Missing pair evidence']);
  assert.match(omitted.defects[0].message, /specs\/checkout\.full\.md/);

  const record = pairRecord({
    status: 'Incomplete pair',
    files: {
      nano: { layer: 'nano', locator: 'specs/checkout.nano.md', status: 'Present' },
      full: { layer: 'full', locator: 'specs/checkout.full.md', status: 'Missing' },
    },
  });
  const statusless = screen(
    report({
      manifest:
        '- specs/checkout.nano.md, sha256 aaa, revision 1\n- specs/checkout.full.md, sha256 none, revision none',
    }),
    record,
  );
  assert.deepEqual(categories(statusless), ['Missing pair evidence']);
  assert.match(statusless.defects[0].message, /without its Missing status/);

  const stated = screen(
    report({
      manifest:
        '- specs/checkout.nano.md, sha256 aaa, revision 1\n- specs/checkout.full.md, Evidence status: Missing',
    }),
    record,
  );
  assert.equal(stated.status, 'Valid');
});

test('a quoted inversion inside a fenced block is evidence, not a defect', () => {
  const quoted = [
    '# Artifact Roast Envelope',
    '',
    '## Evidence Manifest',
    '',
    '- specs/checkout.nano.md, sha256 aaa, revision 1, Evidence status: Staged',
    '- specs/checkout.full.md, sha256 bbb, revision 1, Evidence status: Staged',
    '',
    '## Must Fix',
    '',
    '````text',
    '- Recommendation: Update the nano specification to match the full specification.',
    '- Evidence: AC-9 is cited here.',
    '````',
    '',
    'none',
    '',
    'END ARTIFACT ROAST ENVELOPE',
  ].join('\n');

  const result = screen(quoted, pairRecord());

  assert.equal(result.status, 'Valid');
  assert.equal(result.entriesScanned, 0);
});

test('a record with nothing to check against refuses instead of passing', () => {
  for (const [override, pattern] of [
    [{ authority: { layer: 'full', locator: 'specs/checkout.full.md' } }, /nano layer as the authority/],
    [{ criteria: undefined }, /declares no criteria list/],
    [
      {
        files: {
          nano: { layer: 'nano', locator: '', status: 'Present' },
          full: { layer: 'full', locator: 'specs/checkout.full.md', status: 'Present' },
        },
      },
      /carries no nano locator/,
    ],
    [{ schemaVersion: 2 }, /unknown spec pair record schema/],
    [{ status: 'Fine' }, /unknown pair status/],
  ]) {
    assert.throws(() => screen(report(), pairRecord(override)), (error) => {
      assert.ok(error instanceof SpecAuthorityScreenError);
      assert.equal(error.code, 'unstaged_pair');
      assert.match(error.message, pattern);
      return true;
    });
  }
});

test('the manifest reader stops at the next heading and skips fenced content', () => {
  const lines = manifestLines(
    [
      '## Evidence Manifest',
      '',
      '- one',
      '```text',
      '- quoted',
      '```',
      '- two',
      '',
      '## Council Roster',
      '',
      '- three',
    ].join('\n'),
  );

  assert.deepEqual(lines, ['- one', '- two']);
});

test('the command line screens, rejects, refuses, and probes with stable exit codes', (t) => {
  const root = workspace(t);
  const pairPath = path.join(root, 'pair.json');
  fs.writeFileSync(pairPath, JSON.stringify(pairRecord()));

  const cleanPath = path.join(root, 'clean.md');
  fs.writeFileSync(cleanPath, report({ findings: finding() }));
  const clean = captureStreams();
  assert.equal(runScreen(['--report', cleanPath, '--pair', pairPath, '--phase', 'envelope'], clean), 0);
  assert.equal(JSON.parse(clean.output()).status, 'Valid');

  const invertedPath = path.join(root, 'inverted.md');
  fs.writeFileSync(
    invertedPath,
    report({
      findings: finding({
        Recommendation: 'Change the nano specification so it is consistent with the full specification.',
      }),
    }),
  );
  const inverted = captureStreams();
  assert.equal(runScreen(['--report', invertedPath, '--pair', pairPath, '--phase', 'envelope'], inverted), 2);
  assert.equal(JSON.parse(inverted.output()).defects[0].category, 'Inverted authority');

  const relative = captureStreams();
  assert.equal(runScreen(['--report', 'clean.md', '--pair', pairPath, '--phase', 'envelope'], relative), 1);
  assert.match(relative.errors(), /unsafe_path/);

  const missingFlag = captureStreams();
  assert.equal(runScreen(['--report', cleanPath], missingFlag), 1);
  assert.match(missingFlag.errors(), /missing required argument for --pair/);

  const missingPhase = captureStreams();
  assert.equal(runScreen(['--report', cleanPath, '--pair', pairPath], missingPhase), 1);
  assert.match(missingPhase.errors(), /missing required argument for --phase/);

  const unknownPhase = captureStreams();
  assert.equal(
    runScreen(['--report', cleanPath, '--pair', pairPath, '--phase', 'nope'], unknownPhase),
    1,
  );
  assert.match(unknownPhase.errors(), /--phase must be one of/);

  const unknownFlag = captureStreams();
  assert.equal(runScreen(['--nope', 'x'], unknownFlag), 1);
  assert.match(unknownFlag.errors(), /unknown argument: --nope/);

  const notJson = path.join(root, 'pair.txt');
  fs.writeFileSync(notJson, 'not json');
  const invalidRecord = captureStreams();
  assert.equal(runScreen(['--report', cleanPath, '--pair', notJson, '--phase', 'envelope'], invalidRecord), 1);
  assert.match(invalidRecord.errors(), /invalid_record/);

  const probe = captureStreams();
  assert.equal(runScreen(['--probe'], probe), 0);
  assert.match(probe.output(), /spec-authority-screen: available/);
});

test('the roast phase re-screens authority and criteria without a manifest', () => {
  // The final roast carries no `## Evidence Manifest`, so the manifest check is
  // skipped, but synthesis can introduce an inversion the envelope did not
  // carry, so authority direction is checked again here.
  const roastDocument = (findings) =>
    ['# Artifact Roast', '', '## Must Fix', '', findings, '', 'END ARTIFACT ROASTER REPORT'].join(
      '\n',
    );

  const clean = screenSpecReport(roastDocument(finding()), pairRecord(), { phase: 'roast' });
  assert.equal(clean.status, 'Valid');
  assert.equal(clean.phase, 'roast');
  assert.equal(clean.manifestLines, 0);

  const inverted = screenSpecReport(
    roastDocument(
      finding({
        Location: 'specs/checkout.nano.md:L12',
        Recommendation: 'Update the nano specification to match the full specification.',
      }),
    ),
    pairRecord(),
    { phase: 'roast' },
  );
  assert.deepEqual(categories(inverted), ['Inverted authority']);
});

test('a missing or unknown phase refuses rather than screening with nothing to check', () => {
  for (const options of [{}, { phase: 'manifest' }, { phase: '' }]) {
    assert.throws(() => screenSpecReport(report(), pairRecord(), options), (error) => {
      assert.ok(error instanceof SpecAuthorityScreenError);
      assert.equal(error.code, 'usage');
      assert.match(error.message, /phase must be one of/);
      return true;
    });
  }
});

/**
 * The vocabulary lives in two places on purpose: the document owns it for a
 * reader, and the screen holds it so it never parses Markdown at run time.
 */

function bulletsUnder(heading) {
  const section = DOCUMENT.split(new RegExp(`^${heading}\\s*$`, 'm'))[1];
  assert.ok(section, `spec-authority-screen.md no longer carries ${heading}`);
  const body = section.split(/^#{1,6} /m)[0];
  return [...body.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
}

test('the documented vocabulary and the screen vocabulary match in both directions', () => {
  const documented = [...DOCUMENT.matchAll(/^\| `?([A-Z][a-z]+(?: [a-z]+)+)`? \|/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(documented.sort(), [...DEFECT_CATEGORIES].sort());

  assert.deepEqual(bulletsUnder('### Authority terms').sort(), [...NANO_TERMS].sort());
  assert.deepEqual(bulletsUnder('### Context terms').sort(), [...FULL_TERMS].sort());
  assert.deepEqual(bulletsUnder('### Alignment terms').sort(), [...ALIGNMENT_TERMS].sort());
  assert.deepEqual(bulletsUnder('### Conflict terms').sort(), [...CONFLICT_TERMS].sort());
  assert.deepEqual(bulletsUnder('### Negation terms').sort(), [...NEGATION_TERMS].sort());
});

test('every documented defect category is reachable from some report', () => {
  assert.equal(new Set(DEFECT_CATEGORIES).size, DEFECT_CATEGORIES.length);
  const cases = new Map([
    [
      'Missing pair evidence',
      () => screen(report({ manifest: '- specs/checkout.nano.md, Evidence status: Staged' }), pairRecord()),
    ],
    [
      'Inverted authority',
      () =>
        screen(
          report({
            findings: finding({
              Location: 'specs/checkout.nano.md:L12',
              Recommendation: 'Update the nano specification to match the full specification.',
            }),
          }),
          pairRecord(),
        ),
    ],
    [
      'Unattributed authority',
      () =>
        screen(
          report({
            findings: finding({
              Evidence: 'The full specification contradicts the reservation window.',
              Recommendation: 'Delete the contradiction.',
            }),
          }),
          pairRecord(),
        ),
    ],
    [
      'Undeclared criterion citation',
      () => screen(report({ findings: finding({ Evidence: 'The section cites AC-999.' }) }), pairRecord()),
    ],
  ]);
  assert.deepEqual([...cases.keys()].sort(), [...DEFECT_CATEGORIES].sort());
  for (const [category, build] of cases) {
    const result = build();
    assert.ok(categories(result).includes(category), `${category} was not emitted`);
  }
});
