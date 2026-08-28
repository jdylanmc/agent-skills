/**
 * Deterministic tests for report intake.
 *
 * These pin the behaviour the seam between `post-mortem` and `reinforce-skill`
 * is worth having at all: an approved report grounds one skill's change, its
 * lineage survives into something a reviewer can follow, several
 * recommendations reconcile into one request rather than several runs, and the
 * human-guidance path still needs no report and no approval receipt.
 *
 * The cases where a report is trying to be something it is not - a tampered
 * digest, a foreign approval, a report that approves itself - live beside this
 * file in `report-intake.adversarial.test.mjs`.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  APPROVAL_GRANT,
  DIRECTIVES,
  IntakeError,
  REPORT_SCHEMA,
  REFUSALS,
  admitReport,
  checkApproval,
  groundingFromGuidance,
  reportDigest,
  selectSingleReport,
} from './report-intake.mjs';
import {
  INTAKE_CLI,
  admit,
  approvalFor,
  reportText,
  withFixtureDirectory,
} from './report-intake.fixtures.mjs';

test('an approved report is admitted, and only its target skill enters scope', () => {
  const admitted = admit();

  assert.equal(admitted.status, 'admitted');
  assert.deepEqual(admitted.refusals, []);
  assert.equal(admitted.target, 'changelog');
  assert.deepEqual(admitted.applicable.map((entry) => entry.id), ['R-1', 'R-2']);
  assert.deepEqual(admitted.excluded, [
    { id: 'R-3', target_skill: 'roast', reason: 'targets-another-skill' },
  ]);
});

test('the recommendation for another skill is reported and applied to nothing', () => {
  const admitted = admit();
  const serialized = JSON.stringify(admitted.change_request);

  assert.ok(!serialized.includes('R-3'), 'a foreign recommendation never reaches the change request');
  assert.ok(
    !serialized.includes('surface a missing intent'),
    "another skill's proposed change never reaches this run's grounding",
  );
  assert.equal(admitted.excluded[0].id, 'R-3', 'it is still reported, not dropped in silence');
});

test('lineage runs from the report digest to the recommendations it authorized', () => {
  const report = reportText();
  const admitted = admit({ report });

  assert.equal(admitted.lineage.report_sha256, reportDigest(report));
  assert.equal(admitted.report.sha256, reportDigest(report));
  assert.equal(admitted.lineage.schema, REPORT_SCHEMA);
  assert.equal(admitted.lineage.target_skill, 'changelog');
  assert.deepEqual(admitted.lineage.approval_receipt, {
    grant: APPROVAL_GRANT,
    report_sha256: reportDigest(report),
    target_skill: 'changelog',
  });
  assert.deepEqual(admitted.lineage.applied_recommendation_ids, ['R-1', 'R-2']);
  assert.deepEqual(admitted.lineage.evidence_anchors, ['U1', 'T3']);
  assert.deepEqual(
    admitted.lineage.quarantined_untrusted_directives,
    ['A2'],
    "the record's quarantined anchors are carried forward, not acted upon",
  );
});

test('applicable recommendations reconcile into one bounded change request', () => {
  const { change_request: request } = admit();

  assert.equal(request.source, 'post-mortem-report');
  assert.equal(request.target, 'changelog');
  assert.equal(request.untrusted, true);
  assert.deepEqual(request.recommendation_ids, ['R-1', 'R-2']);
  assert.deepEqual(request.changes.map((change) => change.directive), ['revise', 'add']);
  assert.deepEqual(request.changes.map((change) => change.source_ref), [
    'skill_improvements[0]',
    'candidate_lessons[0]',
  ]);
  assert.deepEqual(request.evidence_anchors, ['U1', 'T3']);
  assert.deepEqual(request.validation.map((entry) => entry.candidate), ['VR-1', 'VR-2']);
  for (const requirement of request.validation) {
    assert.equal(requirement.human_approval_required, true);
  }
});

test('a report that proposes nothing for this skill is admitted and grounds no change', () => {
  const admitted = admit({ report: reportText({ recommendations: [] }) });

  assert.equal(admitted.status, 'admitted', 'zero recommendations is a valid report, not a refusal');
  assert.deepEqual(admitted.applicable, []);
  assert.deepEqual(admitted.change_request.changes, []);
  assert.deepEqual(admitted.change_request.evidence_anchors, []);
});

test('a report whose recommendations name other skills is admitted for the one it names', () => {
  const admitted = admit({ target: 'roast' });

  assert.equal(admitted.status, 'admitted');
  assert.deepEqual(admitted.applicable.map((entry) => entry.id), ['R-3']);
  assert.deepEqual(admitted.excluded.map((entry) => entry.id), ['R-1', 'R-2']);
});

test('human guidance needs no report, no approval, and no synthetic record', () => {
  const guidance = 'the degraded changelog path should say which reason applied';
  const request = groundingFromGuidance({ target: 'changelog', guidance });

  assert.equal(request.source, 'human-guidance');
  assert.equal(request.target, 'changelog');
  assert.equal(request.report_sha256, null);
  assert.deepEqual(request.recommendation_ids, []);
  assert.deepEqual(request.evidence_anchors, []);
  assert.deepEqual(request.validation, []);
  assert.equal(
    request.changes[0].statement,
    guidance,
    "the operator's words go in exactly as the operator wrote them",
  );
});

test('the two grounding shapes are the same shape, so there is one workflow below', () => {
  const fromReport = admit().change_request;
  const fromGuidance = groundingFromGuidance({ target: 'changelog', guidance: 'tighten the output' });

  assert.deepEqual(Object.keys(fromReport).sort(), Object.keys(fromGuidance).sort());
  for (const change of [...fromReport.changes, ...fromGuidance.changes]) {
    assert.deepEqual(
      Object.keys(change).sort(),
      ['directive', 'evidence', 'id', 'source_ref', 'statement', 'surface'],
    );
  }
});

test('guidance for no skill, or with no words, is refused rather than guessed at', () => {
  assert.throws(
    () => groundingFromGuidance({ target: '_base', guidance: 'do a thing' }),
    (error) => error instanceof IntakeError && error.code === REFUSALS.invalidTarget,
  );
  assert.throws(
    () => groundingFromGuidance({ target: 'changelog', guidance: '   ' }),
    (error) => error instanceof IntakeError && error.code === REFUSALS.missingReport,
  );
});

test('exactly one report grounds a run', () => {
  const report = reportText();
  assert.equal(selectSingleReport([report]), report);
  assert.throws(() => selectSingleReport([]), (error) => error.code === REFUSALS.missingReport);
  assert.throws(
    () => selectSingleReport([report, report]),
    (error) => error.code === REFUSALS.ambiguousReport,
  );
});

test('an approval is checked field by field, never interpreted', () => {
  const report = reportText();
  const digest = reportDigest(report);

  assert.deepEqual(checkApproval(approvalFor(report), { digest, target: 'changelog' }), []);
  assert.deepEqual(
    checkApproval(null, { digest, target: 'changelog' }).map((entry) => entry.code),
    [REFUSALS.unapprovedReport],
  );
  assert.deepEqual(
    checkApproval({ ...approvalFor(report), reason: 'looked fine' }, { digest, target: 'changelog' })
      .map((entry) => entry.code),
    [REFUSALS.malformedApproval],
    'an unknown field is refused rather than ignored',
  );
});

test('a refusal carries every reason at once, not the first one found', () => {
  const refused = admitReport({
    report: reportText(),
    approval: { grant: 'sure', report_sha256: 'not-the-digest', target_skill: 'roast' },
    target: 'changelog',
  });

  assert.equal(refused.status, 'refused');
  assert.deepEqual(
    [...new Set(refused.refusals.map((entry) => entry.code))].sort(),
    [REFUSALS.digestMismatch, REFUSALS.targetMismatch, REFUSALS.unapprovedReport].sort(),
  );
});

test('the directive vocabulary is fixed', () => {
  assert.deepEqual(DIRECTIVES, ['add', 'revise', 'remove']);
});

test('the command line exits 0 on admission, 2 on refusal, and 1 on a usage error', () => {
  withFixtureDirectory((root) => {
    const report = reportText();
    const reportPath = path.join(root, 'report.json');
    const approvalPath = path.join(root, 'approval.json');
    fs.writeFileSync(reportPath, report);
    fs.writeFileSync(approvalPath, JSON.stringify(approvalFor(report)));

    const admitted = spawnSync(
      process.execPath,
      [INTAKE_CLI, '--report', reportPath, '--target', 'changelog', '--approval', approvalPath],
      { encoding: 'utf8' },
    );
    assert.equal(admitted.status, 0);
    const parsed = JSON.parse(admitted.stdout);
    assert.equal(parsed.status, 'admitted');
    assert.deepEqual(parsed.lineage.applied_recommendation_ids, ['R-1', 'R-2']);

    const unapproved = spawnSync(
      process.execPath,
      [INTAKE_CLI, '--report', reportPath, '--target', 'changelog'],
      { encoding: 'utf8' },
    );
    assert.equal(unapproved.status, 2, 'a refusal is never a success-shaped exit');
    assert.match(unapproved.stdout, /"unapproved_report"/);

    const missingTarget = spawnSync(
      process.execPath,
      [INTAKE_CLI, '--report', reportPath],
      { encoding: 'utf8' },
    );
    assert.equal(missingTarget.status, 1);
    assert.match(missingTarget.stderr, /--target is required/);

    const probe = spawnSync(process.execPath, [INTAKE_CLI, '--probe'], { encoding: 'utf8' });
    assert.equal(probe.status, 0);
    assert.match(probe.stdout, /report-intake: available/);
  });
});

test('a report named on the command line but absent is refused, not skipped', () => {
  withFixtureDirectory((root) => {
    const approvalPath = path.join(root, 'approval.json');
    fs.writeFileSync(approvalPath, JSON.stringify(approvalFor(reportText())));

    const absent = spawnSync(
      process.execPath,
      [
        INTAKE_CLI,
        '--report', path.join(root, 'no-such-report.json'),
        '--target', 'changelog',
        '--approval', approvalPath,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(absent.status, 2);
    assert.match(absent.stdout, /"unreadable_report"/);
    assert.match(absent.stdout, /"change_request": null/);
  });
});

test('two reports on the command line are ambiguous, never resolved by picking one', () => {
  withFixtureDirectory((root) => {
    const report = reportText();
    const first = path.join(root, 'first.json');
    const second = path.join(root, 'second.json');
    const approvalPath = path.join(root, 'approval.json');
    fs.writeFileSync(first, report);
    fs.writeFileSync(second, report);
    fs.writeFileSync(approvalPath, JSON.stringify(approvalFor(report)));

    const ambiguous = spawnSync(
      process.execPath,
      [
        INTAKE_CLI,
        '--report', first,
        '--report', second,
        '--target', 'changelog',
        '--approval', approvalPath,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(ambiguous.status, 2);
    assert.match(ambiguous.stdout, /"ambiguous_report"/);
  });
});

test('one run reinforces one skill: --target is given once', () => {
  withFixtureDirectory((root) => {
    const reportPath = path.join(root, 'report.json');
    fs.writeFileSync(reportPath, reportText());

    const twoTargets = spawnSync(
      process.execPath,
      [INTAKE_CLI, '--report', reportPath, '--target', 'changelog', '--target', 'roast'],
      { encoding: 'utf8' },
    );
    assert.equal(twoTargets.status, 1);
    assert.match(twoTargets.stderr, /a run reinforces one skill/);
  });
});
