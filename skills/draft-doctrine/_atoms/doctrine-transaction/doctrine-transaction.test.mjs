import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DoctrineTransactionError,
  applyDoctrineChange,
  prepareDoctrineChange,
  sha256,
} from './doctrine-transaction.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');
const EXISTING = '# Existing Doctrine\n\n## 1. Position\n\n- Keep behavior explicit.\n';

function workspace(t) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX_ROOT, 'draft-doctrine-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'doctrine'));
  fs.writeFileSync(path.join(root, 'doctrine', 'existing.doctrine.md'), EXISTING);
  fs.writeFileSync(path.join(root, 'doctrine', 'manifest.md'), manifest([
    { id: 'existing', path: 'existing.doctrine.md', sha256: digest(EXISTING) },
  ]));
  fs.writeFileSync(path.join(root, 'NOTICE.md'), 'Existing notices.\n');
  return root;
}

function digest(value) {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function manifest(entries) {
  return `---
schema-version: 1
doctrine:
${entries.map((entry) => `  - id: ${entry.id}
    path: ${entry.path}
    sha256: ${entry.sha256}`).join('\n')}
---

# Doctrine Manifest

Strict fixture.
`;
}

function input(root, overrides = {}) {
  const rawPosition = 'Engineers should explain irreversible choices and their evidence.';
  return {
    repositoryRoot: root,
    operation: 'create',
    targetId: 'decisions',
    rawPosition,
    candidateText: '# Decision Doctrine\n\n## 1. Evidence\n\n- Explain irreversible choices and cite evidence.\n',
    relevantDoctrineIds: ['existing'],
    provenance: { kind: 'original' },
    promptCoachEvidence: {
      status: 'Reviewed',
      rawPromptDigest: sha256(rawPosition),
      reportDigest: digest('coaching report'),
      humanDecision: 'accepted',
      acceptedEffects: ['Clarified that evidence must be cited.'],
    },
    overlapFindings: [],
    ...overrides,
  };
}

function approval(prepared, overrides = {}) {
  return {
    approvalId: prepared.approval.id,
    grant: prepared.approval.grant,
    operation: prepared.operation,
    targetId: prepared.targetId,
    targetPath: prepared.targetPath,
    candidateDigest: prepared.candidate.digest,
    priorDoctrineDigest: prepared.prior.doctrineDigest,
    priorDoctrineRevision: prepared.prior.doctrineRevision,
    priorManifestDigest: prepared.prior.manifestDigest,
    priorManifestRevision: prepared.prior.manifestRevision,
    ...overrides,
  };
}

function noticeApproval(prepared, overrides = {}) {
  return {
    approvalId: prepared.noticeApproval.id,
    grant: prepared.noticeApproval.grant,
    noticeDigest: prepared.notice.digest,
    priorNoticeDigest: prepared.prior.noticeDigest,
    priorNoticeRevision: prepared.prior.noticeRevision,
    ...overrides,
  };
}

function adaptedProvenance(overrides = {}) {
  return {
    kind: 'adapted',
    verification: {
      sourceLocator: 'https://example.test/source',
      sourceRevisionOrDigest: 'source-revision-123',
      author: 'Example Author',
      licenseIdentifier: 'MIT',
      licenseTextBasis: 'MIT license text in the pinned source revision',
      verifierIdentity: 'reviewer-record-1',
      verifierRole: 'human license reviewer',
      verifiedAt: new Date().toISOString(),
      compatibilityDecision: 'compatible',
      attributionRequired: true,
      ...overrides,
    },
  };
}

const COMPLETE_NOTICE = 'Existing notices.\n\nAdapted from Example Author under MIT; source: https://example.test/source.\n';

test('create prepares exact UTF-8 bytes and writes only doctrine plus manifest after exact approval', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(input(root));
  assert.equal(prepared.status, 'needs-approval');
  assert.equal(Buffer.from(prepared.candidate.bytesBase64, 'base64').toString('utf8'), prepared.candidate.text);
  assert.equal(prepared.candidate.digest, digest(prepared.candidate.text));
  assert.deepEqual(prepared.relevantDoctrine.map(({ id }) => id), ['existing']);
  assert.equal(fs.existsSync(path.join(root, 'doctrine', 'decisions.doctrine.md')), false);

  const result = applyDoctrineChange({ repositoryRoot: root, prepared, approval: approval(prepared) });
  assert.equal(result.status, 'approved-and-written');
  assert.deepEqual(result.changedPaths, ['doctrine/decisions.doctrine.md', 'doctrine/manifest.md']);
  assert.equal(fs.readFileSync(path.join(root, 'doctrine', 'decisions.doctrine.md'), 'utf8'), prepared.candidate.text);
  assert.equal(result.rereadVerification[0].sha256, prepared.candidate.digest);
});

test('update binds prior doctrine and manifest revisions and presents exact diff plus complete result', (t) => {
  const root = workspace(t);
  const next = `${EXISTING}\n- Record the review decision.\n`;
  const prepared = prepareDoctrineChange(input(root, {
    operation: 'update',
    targetId: 'existing',
    relevantDoctrineIds: [],
    candidateText: next,
  }));
  assert.equal(prepared.prior.doctrineDigest, digest(EXISTING));
  assert.match(prepared.candidate.diff, /Record the review decision/);
  assert.equal(prepared.candidate.completeResult, next);
  const result = applyDoctrineChange({ repositoryRoot: root, prepared, approval: approval(prepared) });
  assert.equal(result.status, 'approved-and-written');
  assert.equal(fs.readFileSync(path.join(root, 'doctrine', 'existing.doctrine.md'), 'utf8'), next);
});

test('corrected candidate invalidates approval for the prior candidate', (t) => {
  const root = workspace(t);
  const first = prepareDoctrineChange(input(root));
  const corrected = prepareDoctrineChange(input(root, { candidateText: `${input(root).candidateText}\n` }));
  const result = applyDoctrineChange({ repositoryRoot: root, prepared: corrected, approval: approval(first) });
  assert.equal(result.status, 'cancelled');
  assert.equal(fs.existsSync(path.join(root, 'doctrine', 'decisions.doctrine.md')), false);
});

test('rejection, unrelated reply, silence, and missing approval never write', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(input(root));
  for (const rejected of [null, { reply: 'looks good' }, { grant: 'reject' }]) {
    assert.equal(applyDoctrineChange({ repositoryRoot: root, prepared, approval: rejected }).status, 'cancelled');
  }
  assert.equal(fs.existsSync(path.join(root, 'doctrine', 'decisions.doctrine.md')), false);
});

test('stale update refuses changed prior bytes even when the old approval is exact', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(input(root, {
    operation: 'update',
    targetId: 'existing',
    relevantDoctrineIds: [],
  }));
  fs.writeFileSync(path.join(root, 'doctrine', 'existing.doctrine.md'), `${EXISTING}new human work\n`);
  const result = applyDoctrineChange({ repositoryRoot: root, prepared, approval: approval(prepared) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'stale-state');
});

test('malformed manifest fails closed before candidate preparation', (t) => {
  const root = workspace(t);
  fs.writeFileSync(path.join(root, 'doctrine', 'manifest.md'), fs.readFileSync(path.join(root, 'doctrine', 'manifest.md'), 'utf8').replace('doctrine:', 'doctrine:\nunknown: true'));
  assert.throws(() => prepareDoctrineChange(input(root)), (error) =>
    error instanceof DoctrineTransactionError && error.code === 'invalid-manifest');
});

test('digest mismatch in any declared doctrine prevents selective use', (t) => {
  const root = workspace(t);
  fs.writeFileSync(path.join(root, 'doctrine', 'existing.doctrine.md'), `${EXISTING}drift`);
  assert.throws(() => prepareDoctrineChange(input(root)), (error) => error.code === 'digest_drift');
});

test('adapted source preserves provenance and requires separately approved NOTICE bytes', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(input(root, {
    provenance: adaptedProvenance(),
    noticeText: COMPLETE_NOTICE,
  }));
  assert.equal(prepared.provenance.verification.author, 'Example Author');
  assert.equal(
    applyDoctrineChange({ repositoryRoot: root, prepared, approval: approval(prepared) }).status,
    'cancelled',
  );
  const result = applyDoctrineChange({
    repositoryRoot: root,
    prepared,
    approval: approval(prepared),
    noticeApproval: noticeApproval(prepared),
  });
  assert.equal(result.status, 'approved-and-written');
  assert.ok(result.changedPaths.includes('NOTICE.md'));
});

test('adapted source can create an absent NOTICE only with exact fresh separate approval', (t) => {
  const root = workspace(t);
  fs.unlinkSync(path.join(root, 'NOTICE.md'));
  const noticeText = 'Adapted from Example Author under MIT; source: https://example.test/source.\n';
  const prepared = prepareDoctrineChange(input(root, {
    provenance: adaptedProvenance(),
    noticeText,
  }));

  assert.equal(prepared.prior.noticeDigest, null);
  assert.equal(prepared.prior.noticeRevision, null);
  assert.equal(prepared.approval.binding.priorNoticeDigest, null);
  assert.equal(prepared.approval.binding.priorNoticeRevision, null);
  assert.equal(prepared.identities.notice.exists, false);
  assert.equal(prepared.preview.entries[0].relativePath, 'NOTICE.md');
  assert.equal(prepared.preview.entries[0].action, 'create');
  assert.equal(prepared.preview.entries[0].existingSha256, null);

  const rejected = applyDoctrineChange({
    repositoryRoot: root,
    prepared,
    approval: approval(prepared),
    noticeApproval: noticeApproval(prepared, { grant: 'reject' }),
  });
  assert.equal(rejected.status, 'cancelled');
  assert.equal(fs.existsSync(path.join(root, 'NOTICE.md')), false);

  fs.writeFileSync(path.join(root, 'NOTICE.md'), 'Concurrent notice.\n');
  const stale = applyDoctrineChange({
    repositoryRoot: root,
    prepared,
    approval: approval(prepared),
    noticeApproval: noticeApproval(prepared),
  });
  assert.equal(stale.status, 'blocked');
  assert.equal(stale.code, 'stale-prepared');
  assert.equal(fs.readFileSync(path.join(root, 'NOTICE.md'), 'utf8'), 'Concurrent notice.\n');
  assert.equal(fs.existsSync(path.join(root, 'doctrine', 'decisions.doctrine.md')), false);

  fs.unlinkSync(path.join(root, 'NOTICE.md'));
  const fresh = prepareDoctrineChange(input(root, {
    provenance: adaptedProvenance(),
    noticeText,
  }));
  const result = applyDoctrineChange({
    repositoryRoot: root,
    prepared: fresh,
    approval: approval(fresh),
    noticeApproval: noticeApproval(fresh),
  });
  assert.equal(result.status, 'approved-and-written');
  assert.equal(fs.readFileSync(path.join(root, 'NOTICE.md'), 'utf8'), noticeText);
  assert.ok(result.changedPaths.includes('NOTICE.md'));
  assert.equal(
    result.persistence.readback.find((item) => item.relativePath === 'NOTICE.md')?.change,
    'created',
  );
});

test('unknown licensing and missing attribution fail closed without inventing obligations', (t) => {
  const root = workspace(t);
  const adapted = adaptedProvenance({ compatibilityDecision: 'needs-human-decision' });
  assert.throws(() => prepareDoctrineChange(input(root, { provenance: adapted })), (error) =>
    error.code === 'license-unresolved' && error.status === 'needs-decision');
  assert.throws(() => prepareDoctrineChange(input(root, {
    provenance: adaptedProvenance(),
  })), (error) => error.code === 'attribution-required');
});

test('required NOTICE must be complete, non-whitespace, and contain provenance attribution fields', (t) => {
  const root = workspace(t);
  for (const noticeText of [
    '',
    '   \n',
    'Example Author MIT\n',
    'MIT https://example.test/source\n',
    'Example Author https://example.test/source\n',
  ]) {
    assert.throws(
      () => prepareDoctrineChange(input(root, { provenance: adaptedProvenance(), noticeText })),
      (error) => error.code === 'attribution-required' || error.code === 'needs-input',
    );
  }
  assert.equal(
    prepareDoctrineChange(input(root, {
      provenance: adaptedProvenance(),
      noticeText: COMPLETE_NOTICE,
    })).status,
    'needs-approval',
  );
});

test('adapted provenance is closed, complete, human-decided, and fresh', (t) => {
  const root = workspace(t);
  assert.throws(() => prepareDoctrineChange(input(root, {
    provenance: adaptedProvenance({ verifiedAt: '2020-01-01T00:00:00.000Z' }),
    noticeText: 'Notice.\n',
  })), (error) => error.code === 'stale-provenance' && error.status === 'needs-decision');
  assert.throws(() => prepareDoctrineChange(input(root, {
    provenance: { ...adaptedProvenance(), invented: true },
    noticeText: 'Notice.\n',
  })), (error) => error.code === 'invalid-provenance');
  const missing = adaptedProvenance();
  delete missing.verification.verifierRole;
  assert.throws(() => prepareDoctrineChange(input(root, {
    provenance: missing,
    noticeText: 'Notice.\n',
  })), (error) => error.code === 'needs-input');
});

test('strict manifest rejects id/path mismatch, duplicate paths, and portable collisions', (t) => {
  const cases = [
    [
      { id: 'existing', path: 'other.doctrine.md', sha256: digest(EXISTING) },
    ],
    [
      { id: 'existing', path: 'existing.doctrine.md', sha256: digest(EXISTING) },
      { id: 'other', path: 'existing.doctrine.md', sha256: digest(EXISTING) },
    ],
    [
      { id: 'existing', path: 'existing.doctrine.md', sha256: digest(EXISTING) },
      { id: 'Existing', path: 'Existing.doctrine.md', sha256: digest(EXISTING) },
    ],
  ];
  for (const entries of cases) {
    const root = workspace(t);
    fs.writeFileSync(path.join(root, 'doctrine', 'manifest.md'), manifest(entries));
    assert.throws(() => prepareDoctrineChange(input(root)), (error) => error.code === 'invalid-manifest');
  }
});

test('overlap and contradiction remain evidence reports with no autonomous resolution', (t) => {
  const root = workspace(t);
  const findings = [
    {
      kind: 'overlap',
      doctrineId: 'existing',
      evidence: { locator: '## 1. Position', quote: 'Keep behavior explicit.' },
      candidatePosition: 'Both require explicit evidence.',
      confidence: 'high',
      disposition: 'unresolved',
    },
    {
      kind: 'contradiction',
      doctrineId: 'existing',
      evidence: { locator: '## 1. Position', quote: 'Keep behavior explicit.' },
      candidatePosition: 'Candidate narrows the existing rule.',
      confidence: 'medium',
      disposition: 'unresolved',
    },
  ];
  const prepared = prepareDoctrineChange(input(root, { overlapFindings: findings }));
  assert.deepEqual(prepared.overlapFindings, findings);
  assert.throws(() => prepareDoctrineChange(input(root, {
    overlapFindings: [{ ...findings[0], winner: 'candidate' }],
  })), (error) => error.code === 'invalid-finding');
  assert.throws(() => prepareDoctrineChange(input(root, {
    overlapFindings: [{ ...findings[0], doctrineId: 'not-selected' }],
  })), (error) => error.code === 'invalid-finding');
  assert.throws(() => prepareDoctrineChange(input(root, {
    overlapFindings: [{ ...findings[0], evidence: { ...findings[0].evidence, quote: 'not in doctrine' } }],
  })), (error) => error.code === 'invalid-finding');
});

test('Prompt Coach must bind exactly to the raw prompt and human disposition', (t) => {
  const root = workspace(t);
  assert.throws(() => prepareDoctrineChange(input(root, { promptCoachEvidence: null })), (error) =>
    error.code === 'prompt-coach-required');
  assert.throws(() => prepareDoctrineChange(input(root, {
    promptCoachEvidence: { ...input(root).promptCoachEvidence, rawPromptDigest: digest('different') },
  })), (error) => error.code === 'prompt-coach-mismatch');
});

test('create collisions and symbolic-link targets fail closed', (t) => {
  const root = workspace(t);
  fs.writeFileSync(path.join(root, 'doctrine', 'DECISIONS.doctrine.md'), 'collision');
  assert.throws(() => prepareDoctrineChange(input(root)), (error) => error.code === 'target-collision');
  fs.unlinkSync(path.join(root, 'doctrine', 'DECISIONS.doctrine.md'));
  try {
    fs.symlinkSync(path.join(root, 'NOTICE.md'), path.join(root, 'doctrine', 'decisions.doctrine.md'));
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('symlinks require elevation');
    throw error;
  }
  assert.throws(() => prepareDoctrineChange(input(root)), (error) => error.code === 'target-collision');
});

test('path replacement before the mutating write is caught as stale state', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(input(root));
  const manifestPath = path.join(root, 'doctrine', 'manifest.md');
  const displacedManifestPath = `${manifestPath}.approved`;
  const manifestBytes = fs.readFileSync(manifestPath);
  t.after(() => fs.rmSync(displacedManifestPath, { force: true }));
  const result = applyDoctrineChange(
    { repositoryRoot: root, prepared, approval: approval(prepared) },
    {
      beforeWrite: () => {
        fs.renameSync(manifestPath, displacedManifestPath);
        fs.writeFileSync(manifestPath, manifestBytes);
      },
    },
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'stale-state');
  assert.deepEqual(result.changedPaths, []);
  assert.deepEqual(fs.readFileSync(manifestPath), manifestBytes);
  assert.deepEqual(fs.readFileSync(displacedManifestPath), manifestBytes);
  assert.equal(fs.readFileSync(path.join(root, 'doctrine', 'existing.doctrine.md'), 'utf8'), EXISTING);
  assert.equal(fs.readFileSync(path.join(root, 'NOTICE.md'), 'utf8'), 'Existing notices.\n');
  assert.equal(fs.existsSync(path.join(root, 'doctrine', 'decisions.doctrine.md')), false);
});

test('symlinked doctrine directory and repository/doctrine ancestor replacement races are refused', (t) => {
  {
    const root = workspace(t);
    const moved = `${root}-doctrine`;
    fs.renameSync(path.join(root, 'doctrine'), moved);
    fs.symlinkSync(moved, path.join(root, 'doctrine'), 'dir');
    t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
    assert.throws(() => prepareDoctrineChange(input(root)), (error) => error.code === 'unsafe-path');
  }
  for (const replaced of ['doctrine', 'repositoryRoot']) {
    const root = workspace(t);
    let moved;
    assert.throws(
      () => prepareDoctrineChange(input(root), {
        race: ({ phase, label }) => {
          if (phase !== 'after-ancestor-check-before-open' || label !== 'doctrine/manifest.md' || moved) return;
          if (replaced === 'doctrine') {
            moved = `${root}-moved-doctrine`;
            fs.renameSync(path.join(root, 'doctrine'), moved);
            fs.symlinkSync(moved, path.join(root, 'doctrine'), 'dir');
          } else {
            moved = `${root}-moved-root`;
            fs.renameSync(root, moved);
            fs.symlinkSync(moved, root, 'dir');
          }
        },
      }),
      (error) => error.code === 'unsafe-path',
      replaced,
    );
    t.after(() => moved && fs.rmSync(moved, { recursive: true, force: true }));
  }
});

test('changed relevant doctrine blocks before persistence even if its manifest is rehashed', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(input(root));
  const changed = `${EXISTING}concurrent doctrine edit\n`;
  fs.writeFileSync(path.join(root, 'doctrine', 'existing.doctrine.md'), changed);
  fs.writeFileSync(path.join(root, 'doctrine', 'manifest.md'), manifest([
    { id: 'existing', path: 'existing.doctrine.md', sha256: digest(changed) },
  ]));
  const result = applyDoctrineChange({ repositoryRoot: root, prepared, approval: approval(prepared) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'stale-prepared');
  assert.equal(fs.existsSync(path.join(root, 'doctrine', 'decisions.doctrine.md')), false);
});

test('relevant non-target doctrine is an immutable write-gate guard at the mutation boundary', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(input(root));
  assert.deepEqual(prepared.artifactOrder, [
    'doctrine/decisions.doctrine.md',
    'doctrine/existing.doctrine.md',
    'doctrine/manifest.md',
  ]);
  const result = applyDoctrineChange(
    { repositoryRoot: root, prepared, approval: approval(prepared) },
    {
      writeGateOptions: {
        fault: ({ phase, relativePath }) => {
          if (phase === 'before-mutation' && relativePath === 'doctrine/decisions.doctrine.md') {
            fs.writeFileSync(path.join(root, 'doctrine', 'existing.doctrine.md'), `${EXISTING}raced\n`);
          }
        },
      },
    },
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'stale-preview');
  assert.equal(fs.existsSync(path.join(root, 'doctrine', 'decisions.doctrine.md')), false);
  assert.equal(fs.readFileSync(path.join(root, 'doctrine', 'manifest.md'), 'utf8').includes('decisions'), false);
});

test('hard stops preserve NOTICE-doctrine-manifest safety ordering without claiming rollback', (t) => {
  const boundaries = [
    ['before-notice', 'before-mutation', 'NOTICE.md'],
    ['after-notice', 'after-mutation', 'NOTICE.md'],
    ['after-doctrine', 'after-mutation', 'doctrine/existing.doctrine.md'],
    ['after-manifest', 'after-mutation', 'doctrine/manifest.md'],
    ['after-full-readback', 'after-readback-complete', null],
  ];
  for (const [name, phase, relativePath] of boundaries) {
    const root = workspace(t);
    const next = `${EXISTING}\n- Adapted policy.\n`;
    const payloadPath = path.join(root, `${name}.json`);
    fs.writeFileSync(payloadPath, JSON.stringify({
      request: input(root, {
        operation: 'update',
        targetId: 'existing',
        relevantDoctrineIds: [],
        candidateText: next,
        provenance: adaptedProvenance(),
        noticeText: COMPLETE_NOTICE,
      }),
      phase,
      relativePath,
    }));
    const runnerPath = path.join(root, `${name}.mjs`);
    fs.writeFileSync(runnerPath, `
      import fs from 'node:fs';
      import { applyDoctrineChange, prepareDoctrineChange } from ${JSON.stringify(pathToFileURL(path.join(UNIT_ROOT, 'doctrine-transaction.mjs')).href)};
      const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
      const prepared = prepareDoctrineChange(payload.request);
      const approval = {
        approvalId: prepared.approval.id, grant: prepared.approval.grant,
        operation: prepared.operation, targetId: prepared.targetId, targetPath: prepared.targetPath,
        candidateDigest: prepared.candidate.digest,
        priorDoctrineDigest: prepared.prior.doctrineDigest, priorDoctrineRevision: prepared.prior.doctrineRevision,
        priorManifestDigest: prepared.prior.manifestDigest, priorManifestRevision: prepared.prior.manifestRevision,
      };
      const noticeApproval = {
        approvalId: prepared.noticeApproval.id, grant: prepared.noticeApproval.grant,
        noticeDigest: prepared.notice.digest, priorNoticeDigest: prepared.prior.noticeDigest,
        priorNoticeRevision: prepared.prior.noticeRevision,
      };
      applyDoctrineChange({ repositoryRoot: payload.request.repositoryRoot, prepared, approval, noticeApproval }, {
        writeGateOptions: { fault: ({ phase, relativePath }) => {
          if (phase === payload.phase && (payload.relativePath === null || relativePath === payload.relativePath)) {
            process.kill(process.pid, 'SIGKILL');
          }
        } },
      });
    `);
    const child = spawnSync(process.execPath, [runnerPath, payloadPath], { encoding: 'utf8' });
    if (process.platform === 'win32') {
      assert.equal(child.signal, null, `${name}: ${child.stderr}`);
      assert.ok(Number.isInteger(child.status) && child.status !== 0, `${name}: ${child.stderr}`);
    } else {
      assert.equal(child.signal, 'SIGKILL', `${name}: ${child.stderr}`);
    }
    const notice = fs.readFileSync(path.join(root, 'NOTICE.md'), 'utf8');
    const doctrine = fs.readFileSync(path.join(root, 'doctrine', 'existing.doctrine.md'), 'utf8');
    const manifestText = fs.readFileSync(path.join(root, 'doctrine', 'manifest.md'), 'utf8');
    if (name === 'before-notice') {
      assert.equal(notice, 'Existing notices.\n');
      assert.equal(doctrine, EXISTING);
    } else {
      assert.equal(notice, COMPLETE_NOTICE);
    }
    if (name === 'after-notice') assert.equal(doctrine, EXISTING);
    if (name === 'after-doctrine') {
      assert.equal(doctrine, next);
      assert.equal(manifestText.includes(digest(next)), false);
      assert.throws(() => prepareDoctrineChange(input(root)), (error) => error.code === 'digest_drift');
    }
    if (name === 'after-manifest' || name === 'after-full-readback') {
      assert.equal(doctrine, next);
      assert.equal(manifestText.includes(digest(next)), true);
      assert.equal(notice, COMPLETE_NOTICE);
    }
  }
});

test('caught fault after a real mutation rolls back, and rollback fault residue blocks next preparation', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(input(root));
  const result = applyDoctrineChange(
    { repositoryRoot: root, prepared, approval: approval(prepared) },
    {
      writeGateOptions: {
        fault: ({ phase, relativePath }) => {
          if (phase === 'after-mutation' && relativePath === 'doctrine/manifest.md') throw new Error('caught boundary fault');
          if (phase === 'during-rollback' && relativePath === 'doctrine/decisions.doctrine.md') throw new Error('rollback fault');
        },
      },
    },
  );
  assert.equal(result.status, 'blocked');
  assert.match(result.persistence.detail, /caught boundary fault/);
  assert.ok(result.persistence.rollbackRemaining.some((item) => item.relativePath === 'doctrine/decisions.doctrine.md'));
  assert.equal(fs.existsSync(path.join(root, 'doctrine', 'decisions.doctrine.md')), true);
  assert.throws(() => prepareDoctrineChange(input(root)), (error) => error.code === 'target-collision');
});

test('cancellation can occur before or after preparation without persistence', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(input(root));
  const result = applyDoctrineChange({ repositoryRoot: root, prepared, approval: { cancelled: true } });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(result.changedPaths, []);
});
