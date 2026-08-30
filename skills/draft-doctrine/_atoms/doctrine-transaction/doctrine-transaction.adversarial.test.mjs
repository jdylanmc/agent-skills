import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { applyDoctrineChange, prepareDoctrineChange, sha256 } from './doctrine-transaction.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SANDBOX = path.join(ROOT, '.test-sandbox');
const DOCTRINE = '# Existing\n\n## 1. Rule\n\n- Keep authority explicit.\n';

function digest(value) {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function workspace(t) {
  fs.mkdirSync(SANDBOX, { recursive: true });
  const root = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX, 'draft-doctrine-hostile-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'doctrine'));
  fs.writeFileSync(path.join(root, 'doctrine', 'existing.doctrine.md'), DOCTRINE);
  fs.writeFileSync(path.join(root, 'doctrine', 'manifest.md'), `---
schema-version: 1
doctrine:
  - id: existing
    path: existing.doctrine.md
    sha256: ${digest(DOCTRINE)}
---

# Doctrine Manifest
`);
  fs.writeFileSync(path.join(root, 'NOTICE.md'), 'Notice.\n');
  return root;
}

function request(root, overrides = {}) {
  const rawPosition = 'A human position that remains the only policy authority.';
  return {
    repositoryRoot: root,
    operation: 'create',
    targetId: 'authority',
    rawPosition,
    candidateText: '# Authority\n\n## 1. Rule\n\n- Human approval is required.\n',
    relevantDoctrineIds: ['existing'],
    provenance: { kind: 'original' },
    promptCoachEvidence: {
      status: 'Reviewed',
      rawPromptDigest: sha256(rawPosition),
      reportDigest: digest('report'),
      humanDecision: 'rejected',
      acceptedEffects: [],
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

function adaptedProvenance() {
  return {
    kind: 'adapted',
    verification: {
      sourceLocator: 'https://example.test/source',
      sourceRevisionOrDigest: 'revision-123',
      author: 'Author',
      licenseIdentifier: 'MIT',
      licenseTextBasis: 'MIT text in pinned revision',
      verifierIdentity: 'human@example.test',
      verifierRole: 'human license reviewer',
      verifiedAt: new Date().toISOString(),
      compatibilityDecision: 'compatible',
      attributionRequired: true,
    },
  };
}

const COMPLETE_NOTICE = 'Notice.\n\nAdapted from Author under MIT; source: https://example.test/source.\n';

test('a hard-linked doctrine trust root is refused', (t) => {
  const root = workspace(t);
  fs.linkSync(
    path.join(root, 'doctrine', 'existing.doctrine.md'),
    path.join(root, 'doctrine', 'alias.doctrine.md'),
  );
  assert.throws(() => prepareDoctrineChange(request(root)), (error) => error.code === 'hard-link-collision');
});

test('a manifest path escape is malformed and never resolved', (t) => {
  const root = workspace(t);
  const manifestPath = path.join(root, 'doctrine', 'manifest.md');
  fs.writeFileSync(manifestPath, fs.readFileSync(manifestPath, 'utf8').replace('existing.doctrine.md', '../NOTICE.md'));
  assert.throws(() => prepareDoctrineChange(request(root)), (error) => error.code === 'invalid-manifest');
});

test('tampering with serialized preview bytes after approval is stale, not written', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(request(root));
  const serialized = JSON.parse(JSON.stringify(prepared));
  serialized.preview.entries[0].content = '# injected candidate\n';
  const result = applyDoctrineChange({
    repositoryRoot: root,
    prepared: serialized,
    approval: approval(prepared),
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'stale-prepared');
  assert.equal(fs.existsSync(path.join(root, 'doctrine', 'authority.doctrine.md')), false);
});

test('approval for the right digest but wrong target is not approval', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(request(root));
  const result = applyDoctrineChange({
    repositoryRoot: root,
    prepared,
    approval: approval(prepared, { targetId: 'different' }),
  });
  assert.equal(result.status, 'cancelled');
  const extraField = applyDoctrineChange({
    repositoryRoot: root,
    prepared,
    approval: approval(prepared, { comment: 'approve anyway' }),
  });
  assert.equal(extraField.status, 'cancelled');
});

test('NOTICE changing after separate approval invalidates the whole transaction', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(request(root, {
    provenance: adaptedProvenance(),
    noticeText: COMPLETE_NOTICE,
  }));
  fs.writeFileSync(path.join(root, 'NOTICE.md'), 'Concurrent human notice.\n');
  const result = applyDoctrineChange({
    repositoryRoot: root,
    prepared,
    approval: approval(prepared),
    noticeApproval: {
      approvalId: prepared.noticeApproval.id,
      grant: prepared.noticeApproval.grant,
      noticeDigest: prepared.notice.digest,
      priorNoticeDigest: prepared.prior.noticeDigest,
      priorNoticeRevision: prepared.prior.noticeRevision,
    },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'stale-prepared');
  assert.equal(fs.existsSync(path.join(root, 'doctrine', 'authority.doctrine.md')), false);
});

test('every serialized prepared surface is recomputed before approval or persistence', (t) => {
    const mutations = [
      ['status', (p) => { p.status = 'approved-and-written'; }],
      ['operation', (p) => { p.operation = 'update'; }],
      ['target id', (p) => { p.targetId = 'tampered'; }],
      ['target path', (p) => { p.targetPath = 'doctrine/tampered.doctrine.md'; }],
      ['rawPosition', (p) => { p.rawPosition += ' tampered'; }],
      ['candidate.text', (p) => { p.candidate.text += 'tampered'; }],
      ['candidate.bytesBase64', (p) => { p.candidate.bytesBase64 = Buffer.from('tampered').toString('base64'); }],
      ['candidate.byteLength', (p) => { p.candidate.byteLength += 1; }],
      ['candidate.digest', (p) => { p.candidate.digest = '0'.repeat(64); }],
      ['candidate.completeResult', (p) => { p.candidate.completeResult += 'tampered'; }],
      ['nextManifest.text', (p) => { p.nextManifest.text += 'tampered'; }],
      ['nextManifest.digest', (p) => { p.nextManifest.digest = '0'.repeat(64); }],
      ['artifact order', (p) => { p.artifactOrder.reverse(); }],
      ['preview content', (p) => { p.preview.entries[0].content += 'tampered'; }],
      ['preview digest', (p) => { p.preview.entries[0].sha256 = '0'.repeat(64); }],
      ['preview id', (p) => { p.preview.previewId = '0'.repeat(64); }],
      ['preview order', (p) => { p.preview.entries.reverse(); p.preview.safety.reverse(); }],
      ['preview action', (p) => { p.preview.entries[0].action = 'overwrite'; }],
      ['preview existing digest', (p) => { p.preview.entries[0].existingSha256 = '0'.repeat(64); }],
      ['preview safety', (p) => { p.preview.safety[0].safe = false; }],
      ['binding', (p) => { p.approval.binding.targetId = 'tampered'; }],
      ['approval id', (p) => { p.approval.id = '0'.repeat(64); }],
      ['approval grant', (p) => { p.approval.grant = 'tampered'; }],
      ['prior manifest digest', (p) => { p.prior.manifestDigest = '0'.repeat(64); }],
      ['manifest identity', (p) => { p.identities.manifest.ino = '0'; }],
      ['target identity', (p) => { p.identities.target.exists = true; }],
      ['relevant doctrine text', (p) => { p.relevantDoctrine[0].text += 'tampered'; }],
      ['relevant doctrine digest', (p) => { p.relevantDoctrine[0].sha256 = '0'.repeat(64); }],
      ['relevant doctrine identity', (p) => { p.identities.relevantDoctrine.existing.ino = '0'; }],
      ['provenance', (p) => { p.provenance.extra = true; }],
      ['prompt coach', (p) => { p.promptCoach.reportDigest = '0'.repeat(64); }],
      ['overlap findings', (p) => { p.overlapFindings.push({}); }],
    ];
    for (const [label, mutate] of mutations) {
      const root = workspace(t);
      const original = prepareDoctrineChange(request(root));
      const tampered = JSON.parse(JSON.stringify(original));
      mutate(tampered);
      const result = applyDoctrineChange({ repositoryRoot: root, prepared: tampered, approval: approval(original) });
      assert.equal(result.status, 'blocked', label);
      assert.equal(fs.existsSync(path.join(root, 'doctrine', 'authority.doctrine.md')), false, label);
    }
});

test('update diff is recomputed rather than trusted', (t) => {
  const root = workspace(t);
  const original = prepareDoctrineChange(request(root, {
    operation: 'update',
    targetId: 'existing',
    relevantDoctrineIds: [],
    candidateText: `${DOCTRINE}\n- Add one rule.\n`,
  }));
  const tampered = JSON.parse(JSON.stringify(original));
  tampered.candidate.diff += 'injected';
  const result = applyDoctrineChange({ repositoryRoot: root, prepared: tampered, approval: approval(original) });
  assert.equal(result.status, 'blocked');
  assert.equal(fs.readFileSync(path.join(root, 'doctrine', 'existing.doctrine.md'), 'utf8'), DOCTRINE);
});

test('NOTICE text, digest, preview, provenance, and notice approval identities are one binding', (t) => {
    const mutations = [
      (p) => { p.notice.text += 'tampered'; },
      (p) => { p.notice.digest = '0'.repeat(64); },
      (p) => { p.noticeApproval.id = '0'.repeat(64); },
      (p) => { p.preview.entries[0].content += 'tampered'; },
      (p) => { p.approval.binding.notice.digest = '0'.repeat(64); },
      (p) => { p.provenance.verification.sourceRevisionOrDigest = 'changed'; },
    ];
    for (const mutate of mutations) {
      const root = workspace(t);
      const original = prepareDoctrineChange(request(root, {
        provenance: adaptedProvenance(),
        noticeText: COMPLETE_NOTICE,
      }));
      const tampered = JSON.parse(JSON.stringify(original));
      mutate(tampered);
      const result = applyDoctrineChange({
        repositoryRoot: root,
        prepared: tampered,
        approval: approval(original),
        noticeApproval: {
          approvalId: original.noticeApproval.id,
          grant: original.noticeApproval.grant,
          noticeDigest: original.notice.digest,
          priorNoticeDigest: original.prior.noticeDigest,
          priorNoticeRevision: original.prior.noticeRevision,
        },
      });
      assert.equal(result.status, 'blocked');
      assert.equal(fs.existsSync(path.join(root, 'doctrine', 'authority.doctrine.md')), false);
    }
});

test('a claimed successful write with a mismatched reread digest is blocked', (t) => {
  const root = workspace(t);
  const prepared = prepareDoctrineChange(request(root));
  const result = applyDoctrineChange(
    { repositoryRoot: root, prepared, approval: approval(prepared) },
    {
      applyPreview: () => ({
        status: 'configured',
        written: true,
        readback: prepared.preview.entries.map((entry, index) => ({
          relativePath: entry.relativePath,
          sha256: index === 0 ? '0'.repeat(64) : entry.sha256,
          change: 'overwritten',
        })),
      }),
    },
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'reread-mismatch');
});
