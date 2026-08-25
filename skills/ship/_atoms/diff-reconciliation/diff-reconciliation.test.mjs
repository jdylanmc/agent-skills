/**
 * Adversarial tests for the ship diff reconciler.
 *
 * These are written to BREAK the reconciler, not to demonstrate it. The
 * failures they hunt for are the ones this repository has actually made: a
 * change that nobody disclosed riding along inside a file that was legitimately
 * being edited, and a reported finding quietly becoming permission to act.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { METADATA_UNIT, mayContinue, parseUnifiedDiff, reconcile } from './diff-reconciliation.mjs';

const DIFF_TWO_HUNKS = `diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -10,6 +10,7 @@ function start() {
   boot();
+  telemetry();
 }
@@ -40,3 +41,4 @@ function stop() {
   halt();
+  flush();
 }
`;

const IN_SCOPE = [{ id: 'L1', classification: 'in-scope' }];

test('a fully claimed diff reconciles', () => {
  const result = reconcile({
    ledger: IN_SCOPE,
    diff: DIFF_TWO_HUNKS,
    mapping: [
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 1, entryId: 'L1' },
    ],
  });

  assert.equal(result.verdict, 'reconciled');
  assert.deepEqual(result.undisclosed, []);
  assert.ok(mayContinue(result));
});

test('claiming one hunk does not vouch for the rest of the same file', () => {
  // THE central case. File-level coverage would wave this through, and this is
  // exactly how the adjacent one-line fix rides along in a file already being
  // edited legitimately.
  const result = reconcile({
    ledger: IN_SCOPE,
    diff: DIFF_TWO_HUNKS,
    mapping: [{ file: 'src/app.js', hunkIndex: 0, entryId: 'L1' }],
  });

  assert.equal(result.verdict, 'undisclosed-change');
  assert.deepEqual(result.undisclosed, [
    { file: 'src/app.js', hunkIndex: 1, reason: 'no ledger entry claims this hunk' },
  ]);
  assert.ok(!mayContinue(result));
});

test('an adjacent finding cannot authorize a hunk', () => {
  // Reporting a finding must never become permission to act on it. If an
  // `adjacent` entry could claim a hunk, the scope boundary would be advisory.
  const result = reconcile({
    ledger: [
      { id: 'L1', classification: 'in-scope' },
      { id: 'A1', classification: 'adjacent' },
    ],
    diff: DIFF_TWO_HUNKS,
    mapping: [
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 1, entryId: 'A1' },
    ],
  });

  assert.equal(result.verdict, 'undisclosed-change');
  assert.equal(result.undisclosed.length, 1);
  assert.match(result.undisclosed[0].reason, /unauthorized classification: A1 \(adjacent\)/);
});

test('an out-of-scope or blocking-defect entry cannot authorize a hunk either', () => {
  for (const classification of ['out-of-scope', 'blocking-defect']) {
    const result = reconcile({
      ledger: [{ id: 'X1', classification }],
      diff: DIFF_TWO_HUNKS,
      mapping: [
        { file: 'src/app.js', hunkIndex: 0, entryId: 'X1' },
        { file: 'src/app.js', hunkIndex: 1, entryId: 'X1' },
      ],
    });
    assert.equal(result.verdict, 'undisclosed-change', `${classification} must not authorize`);
  }
});

test('an enabling entry does authorize, because the operator confirmed it', () => {
  const result = reconcile({
    ledger: [{ id: 'E1', classification: 'enabling' }],
    diff: DIFF_TWO_HUNKS,
    mapping: [
      { file: 'src/app.js', hunkIndex: 0, entryId: 'E1' },
      { file: 'src/app.js', hunkIndex: 1, entryId: 'E1' },
    ],
  });

  assert.equal(result.verdict, 'reconciled');
});

test('two entries claiming one hunk is ambiguous, not resolved by picking one', () => {
  const result = reconcile({
    ledger: [
      { id: 'L1', classification: 'in-scope' },
      { id: 'L2', classification: 'in-scope' },
    ],
    diff: DIFF_TWO_HUNKS,
    mapping: [
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L2' },
      { file: 'src/app.js', hunkIndex: 1, entryId: 'L1' },
    ],
  });

  assert.equal(result.verdict, 'ambiguous-mapping');
  assert.deepEqual(result.ambiguous, [
    { file: 'src/app.js', hunkIndex: 0, entryIds: ['L1', 'L2'] },
  ]);
  assert.ok(!mayContinue(result));
});

test('the same entry claiming one hunk twice is still exactly one entry', () => {
  const result = reconcile({
    ledger: IN_SCOPE,
    diff: DIFF_TWO_HUNKS,
    mapping: [
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 1, entryId: 'L1' },
    ],
  });

  assert.equal(result.verdict, 'reconciled');
});

test('a claim on an entry that is not in the ledger is undisclosed', () => {
  // Inventing an identifier must not be a way to launder a change through.
  const result = reconcile({
    ledger: IN_SCOPE,
    diff: DIFF_TWO_HUNKS,
    mapping: [
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 1, entryId: 'L9' },
    ],
  });

  assert.equal(result.verdict, 'undisclosed-change');
  assert.match(result.undisclosed[0].reason, /unknown ledger entry: L9/);
});

test('a claim against a hunk the diff does not contain is reported as phantom', () => {
  const result = reconcile({
    ledger: IN_SCOPE,
    diff: DIFF_TWO_HUNKS,
    mapping: [
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 1, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 7, entryId: 'L1' },
    ],
  });

  assert.equal(result.verdict, 'undisclosed-change');
  assert.equal(result.phantom.length, 1);
  assert.match(result.phantom[0].reason, /no such hunk/);
});

test('two ledger entries sharing an identifier make uniqueness unverifiable', () => {
  const result = reconcile({
    ledger: [
      { id: 'L1', classification: 'in-scope' },
      { id: 'L1', classification: 'adjacent' },
    ],
    diff: DIFF_TWO_HUNKS,
    mapping: [
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 1, entryId: 'L1' },
    ],
  });

  assert.equal(result.verdict, 'undisclosed-change');
  assert.deepEqual(result.duplicateEntryIds, ['L1']);
});

test('an undisclosed change is never masked by a lesser verdict computed alongside it', () => {
  const result = reconcile({
    ledger: [
      { id: 'L1', classification: 'in-scope' },
      { id: 'L2', classification: 'in-scope' },
      { id: 'L3', classification: 'in-scope' },
    ],
    diff: DIFF_TWO_HUNKS,
    // hunk 0 doubly claimed (ambiguous), hunk 1 unclaimed (undisclosed),
    // L3 never used (unfulfilled). Worst must win.
    mapping: [
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L2' },
    ],
  });

  assert.equal(result.verdict, 'undisclosed-change');
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.unfulfilled.length, 1);
  assert.ok(!mayContinue(result));
});

test('a confirmed entry with no hunk is reported but does not stop the run', () => {
  const result = reconcile({
    ledger: [
      { id: 'L1', classification: 'in-scope' },
      { id: 'L2', classification: 'in-scope' },
    ],
    diff: DIFF_TWO_HUNKS,
    mapping: [
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 1, entryId: 'L1' },
    ],
  });

  assert.equal(result.verdict, 'unfulfilled-entry');
  assert.deepEqual(result.unfulfilled, [{ entryId: 'L2', classification: 'in-scope' }]);
  assert.ok(mayContinue(result), 'a smaller diff than planned is the safe direction');
});

test('an adjacent entry with no hunk is not unfulfilled, because it was never to be done', () => {
  const result = reconcile({
    ledger: [
      { id: 'L1', classification: 'in-scope' },
      { id: 'A1', classification: 'adjacent' },
    ],
    diff: DIFF_TWO_HUNKS,
    mapping: [
      { file: 'src/app.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'src/app.js', hunkIndex: 1, entryId: 'L1' },
    ],
  });

  assert.equal(result.verdict, 'reconciled');
  assert.deepEqual(result.unfulfilled, []);
});

test('an empty diff against an empty ledger reconciles', () => {
  const result = reconcile({ ledger: [], diff: '', mapping: [] });
  assert.equal(result.verdict, 'reconciled');
});

test('a binary change is addressable and cannot pass through unclaimed', () => {
  const binary = `diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
Binary files a/logo.png and b/logo.png differ
`;

  const unclaimed = reconcile({ ledger: IN_SCOPE, diff: binary, mapping: [] });
  assert.equal(unclaimed.verdict, 'undisclosed-change');
  assert.deepEqual(unclaimed.undisclosed, [
    {
      file: 'logo.png',
      hunkIndex: METADATA_UNIT,
      change: 'binary',
      reason: 'no ledger entry claims this file-metadata change',
    },
  ]);

  const claimed = reconcile({
    ledger: IN_SCOPE,
    diff: binary,
    mapping: [{ file: 'logo.png', hunkIndex: METADATA_UNIT, entryId: 'L1' }],
  });
  assert.equal(claimed.verdict, 'reconciled');
});

test('a change with no hunks at all is still addressable, whichever kind it is', () => {
  // THE blind spot this exists to close. Every one of these is a real change
  // to the repository, and every one of them carries no `@@` line, so a
  // reconciler that walks hunks alone sees an empty diff and reconciles.
  const cases = [
    {
      label: 'rename',
      change: 'rename',
      file: 'moved.txt',
      previousFile: 'move-me.txt',
      diff: `diff --git a/move-me.txt b/moved.txt
similarity index 100%
rename from move-me.txt
rename to moved.txt
`,
    },
    {
      label: 'copy',
      change: 'copy',
      file: 'copy.txt',
      previousFile: 'keep.txt',
      diff: `diff --git a/keep.txt b/copy.txt
similarity index 100%
copy from keep.txt
copy to copy.txt
`,
    },
    {
      label: 'mode change',
      change: 'mode-change',
      file: 'script.sh',
      diff: `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
`,
    },
    {
      label: 'empty file added',
      change: 'add',
      file: 'another.txt',
      diff: `diff --git a/another.txt b/another.txt
new file mode 100644
index 0000000..e69de29
`,
    },
    {
      label: 'empty file deleted',
      change: 'delete',
      file: 'gone.txt',
      diff: `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index e69de29..0000000
`,
    },
  ];

  for (const { label, change, file, previousFile, diff } of cases) {
    const unclaimed = reconcile({ ledger: IN_SCOPE, diff, mapping: [] });
    assert.equal(unclaimed.verdict, 'undisclosed-change', `${label} must not reconcile unclaimed`);
    assert.ok(!mayContinue(unclaimed), `${label} must stop the run`);

    const expected = {
      file,
      hunkIndex: METADATA_UNIT,
      change,
      reason: 'no ledger entry claims this file-metadata change',
    };
    if (previousFile !== undefined) expected.previousFile = previousFile;
    assert.deepEqual(unclaimed.undisclosed, [expected], `${label} must name what changed`);

    const claimed = reconcile({
      ledger: IN_SCOPE,
      diff,
      mapping: [{ file, hunkIndex: METADATA_UNIT, entryId: 'L1' }],
    });
    assert.equal(claimed.verdict, 'reconciled', `${label} must be claimable`);
  }
});

test('a rename carrying edits is two units, because one claim cannot vouch for both', () => {
  // Claiming the edit must not silently authorize the move. They are separate
  // changes and a ledger entry describing one says nothing about the other.
  const diff = `diff --git a/old/name.js b/new/name.js
similarity index 90%
rename from old/name.js
rename to new/name.js
--- a/old/name.js
+++ b/new/name.js
@@ -1,2 +1,3 @@
 x
+y
`;

  const editOnly = reconcile({
    ledger: IN_SCOPE,
    diff,
    mapping: [{ file: 'new/name.js', hunkIndex: 0, entryId: 'L1' }],
  });
  assert.equal(editOnly.verdict, 'undisclosed-change');
  assert.deepEqual(editOnly.undisclosed, [
    {
      file: 'new/name.js',
      hunkIndex: METADATA_UNIT,
      change: 'rename',
      previousFile: 'old/name.js',
      reason: 'no ledger entry claims this file-metadata change',
    },
  ]);

  const both = reconcile({
    ledger: IN_SCOPE,
    diff,
    mapping: [
      { file: 'new/name.js', hunkIndex: 0, entryId: 'L1' },
      { file: 'new/name.js', hunkIndex: METADATA_UNIT, entryId: 'L1' },
    ],
  });
  assert.equal(both.verdict, 'reconciled');
});

test('an ordinary edit gains no metadata unit, so a claim per hunk still reconciles', () => {
  // The fail-closed rule must not tax every normal file with a second claim.
  const files = parseUnifiedDiff(DIFF_TWO_HUNKS);
  assert.deepEqual(files[0].hunks.map((unit) => unit.index), [0, 1]);
});

test('an unrecognized hunkless header fails closed rather than vanishing', () => {
  // A truncated or unfamiliar header must not become an empty diff. Reporting
  // `unknown` keeps an unparsed change visible and stops the run.
  const result = reconcile({
    ledger: IN_SCOPE,
    diff: 'diff --git a/mystery.txt b/mystery.txt\n',
    mapping: [],
  });

  assert.equal(result.verdict, 'undisclosed-change');
  assert.equal(result.undisclosed[0].change, 'unknown');
});

test('several metadata changes on one file are reported together, deterministically', () => {
  const files = parseUnifiedDiff(`diff --git a/old.sh b/new.sh
old mode 100644
new mode 100755
similarity index 100%
rename from old.sh
rename to new.sh
`);

  assert.equal(files[0].hunks.length, 1);
  assert.equal(files[0].hunks[0].change, 'rename+mode-change');
});

test('the parser indexes hunks per file, so identical indexes in two files are distinct', () => {
  const twoFiles = `diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -1,2 +1,3 @@
 x
+y
diff --git a/b.js b/b.js
--- a/b.js
+++ b/b.js
@@ -1,2 +1,3 @@
 p
+q
`;

  const files = parseUnifiedDiff(twoFiles);
  assert.deepEqual(files.map((f) => f.file), ['a.js', 'b.js']);
  assert.equal(files[0].hunks[0].index, 0);
  assert.equal(files[1].hunks[0].index, 0);

  // Claiming a.js hunk 0 must not also satisfy b.js hunk 0.
  const result = reconcile({
    ledger: IN_SCOPE,
    diff: twoFiles,
    mapping: [{ file: 'a.js', hunkIndex: 0, entryId: 'L1' }],
  });
  assert.equal(result.verdict, 'undisclosed-change');
  assert.deepEqual(result.undisclosed, [
    { file: 'b.js', hunkIndex: 0, reason: 'no ledger entry claims this hunk' },
  ]);
});

test('a single-line hunk header without counts still parses as one hunk', () => {
  const files = parseUnifiedDiff(`diff --git a/x.txt b/x.txt
--- a/x.txt
+++ b/x.txt
@@ -1 +1 @@
-a
+b
`);

  assert.equal(files[0].hunks.length, 1);
  assert.equal(files[0].hunks[0].oldLines, 1);
  assert.equal(files[0].hunks[0].newLines, 1);
});

test('a renamed file is addressed by its new path', () => {
  const files = parseUnifiedDiff(`diff --git a/old/name.js b/new/name.js
similarity index 90%
rename from old/name.js
rename to new/name.js
--- a/old/name.js
+++ b/new/name.js
@@ -1,2 +1,3 @@
 x
+y
`);

  assert.deepEqual(files.map((f) => f.file), ['new/name.js']);
});

test('a diff body line that looks like a hunk header is not counted as one', () => {
  // A patch that adds a line beginning with `@@` — for example a test fixture
  // containing a diff — must not inflate the hunk count, because an inflated
  // count would create phantom hunks nobody can claim.
  const files = parseUnifiedDiff(`diff --git a/fixture.txt b/fixture.txt
--- a/fixture.txt
+++ b/fixture.txt
@@ -1,2 +1,3 @@
 keep
+@@ -9,9 +9,9 @@ not a real header
`);

  assert.equal(files[0].hunks.length, 1);
});

test('malformed input is rejected rather than silently reconciling', () => {
  assert.throws(() => parseUnifiedDiff(null), TypeError);
  assert.throws(() => reconcile({ ledger: null, diff: '', mapping: [] }), TypeError);
  assert.throws(() => reconcile({ ledger: [], diff: '', mapping: null }), TypeError);
  assert.throws(
    () => reconcile({ ledger: [{ classification: 'in-scope' }], diff: '', mapping: [] }),
    TypeError,
  );

  // A pre-parsed file with nothing to claim would remove a change from the
  // reconciliation without saying so.
  assert.throws(
    () => reconcile({ ledger: [], diff: [{ file: 'ghost.txt', hunks: [] }], mapping: [] }),
    TypeError,
  );
});
