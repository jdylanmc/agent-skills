import test from 'node:test';
import assert from 'node:assert/strict';
import { admit, normalizeWork, reviewedBasis, setCandidate, recordReview, hasQuorum, dependenciesReady,
  isWorkPath, authorizedWorkPath } from './bench-epoch.mjs';

const work = (id) => ({ id, title: id, requirements: 'Required behavior', paths: ['src'], validation: [['node', '--test']] });
const candidate = (n) => ({ commit: String(n).repeat(40), validation: [{ exitCode: 0, digest: 'output', observedAt: '2026-01-01T00:00:00Z' }] });
function review(issue, slot, context = `review-${slot}`) {
  const basis = reviewedBasis(issue);
  return [{ slot, context, basis, doctrine: [], filesRead: [{ path: 'src/file', sha256: 'a'.repeat(64) }] },
    { basis, verdict: 'signoff', evidence: 'src file satisfies requirement and recorded test passed', findings: [] }];
}
test('three distinct slots, not recycled contexts, sign the current candidate', () => {
  const issue = admit({ issues: [] }, work('one'));
  setCandidate(issue, candidate(1), 'author');
  recordReview(issue, ...review(issue, 0));
  assert.throws(() => recordReview(issue, ...review(issue, 0, 'recycled')), /duplicate/);
  assert.throws(() => recordReview(issue, ...review(issue, 1, 'author')), /ineligible/);
  assert.throws(() => recordReview(issue, ...review(issue, 1, 'review-0')), /duplicate/);
  assert.equal(hasQuorum(issue, 3), false);
  recordReview(issue, ...review(issue, 1));
  recordReview(issue, ...review(issue, 2));
  assert.equal(hasQuorum(issue, 3), true);
  const prior = review(issue, 3);
  setCandidate(issue, candidate(2), 'new-author');
  assert.equal(hasQuorum(issue, 3), false);
  assert.equal(issue.votes.length, 0);
  assert.throws(() => recordReview(issue, ...prior), /stale/);
});
test('unrelated admissions and changes preserve existing progress', () => {
  const state = { issues: [] };
  const a = admit(state, work('a'));
  setCandidate(a, candidate(1), 'author-a');
  recordReview(a, ...review(a, 0));
  const before = structuredClone(a);
  const b = admit(state, work('b'));
  setCandidate(b, candidate(2), 'author-b');
  assert.deepEqual(a, before);
  assert.equal(admit(state, work('a')), a);
  assert.throws(() => admit(state, { ...work('a'), requirements: 'changed' }), /different/);
});
test('review text, partial packets, contradictory signoffs and failed tests never pass', () => {
  const issue = admit({ issues: [] }, work('one'));
  assert.throws(() => setCandidate(issue, { ...candidate(1), validation: [{ exitCode: 1 }] }, 'author'));
  setCandidate(issue, candidate(1), 'author');
  const [assignment, result] = review(issue, 1);
  for (const invalid of ['looks good', {}, { ...result, evidence: '' }, { ...result, findings: ['broken'] }]) {
    assert.throws(() => recordReview(issue, assignment, invalid));
    assert.equal(hasQuorum(issue, 1), false);
  }
  recordReview(issue, assignment, { ...result, verdict: 'correction', findings: ['fix the off-by-one in src'] });
  assert.equal(issue.phase, 'correction');
  assert.equal(issue.votes.length, 0);
});
test('dependency gates need observed human merge; missing, closed and cycles do not pass', () => {
  const state = { issues: [] };
  const a = admit(state, { ...work('a'), dependsOn: ['b'] });
  assert.equal(dependenciesReady(state, a), false);
  assert.throws(() => admit(state, { ...work('b'), dependsOn: ['a'] }), /cycle/);
  const b = admit(state, work('b'));
  b.phase = 'closed'; assert.equal(dependenciesReady(state, a), false);
  b.phase = 'merged'; assert.equal(dependenciesReady(state, a), true);
  for (const paths of [['../escape'], ['/etc'], ['src/../../outside'], ['.git'], ['src/.env'], ['src\\file']]) {
    assert.throws(() => normalizeWork({ ...work('c'), paths }));
  }
});
test('explicit legitimate dot paths are eligible without authorizing parents or unrelated siblings', () => {
  const paths = ['.github/workflows', '.gitignore', '.gitattributes', '.editorconfig', '.config/project'];
  assert.deepEqual(normalizeWork({ ...work('ci'), paths }).paths, paths);
  assert.equal(authorizedWorkPath('.github/workflows/ci.yml', paths), true);
  assert.equal(authorizedWorkPath('.github/workflows/.settings.yml', paths), true);
  assert.equal(authorizedWorkPath('.github/workflows/secrets.yml', paths), true);
  assert.equal(authorizedWorkPath('.gitignore', paths), true);
  assert.equal(authorizedWorkPath('.github/ISSUE_TEMPLATE/bug.yml', paths), false);
  assert.equal(authorizedWorkPath('.github', paths), false);
  assert.equal(authorizedWorkPath('.github-other/workflows/ci.yml', paths), false);
  assert.equal(isWorkPath('src/credentials.ts'), true);
  assert.equal(isWorkPath('src/secrets.test.mjs'), true);
  assert.equal(isWorkPath('src/credentials/service.ts'), true);
});
test('traversal, Git/control state, credential locations and platform aliases remain ineligible', () => {
  for (const value of [
    '.', '..', '../outside', './.github', 'src/../.git/config', 'src//file', '/etc/passwd', 'C:outside',
    '.github\\workflows\\ci.yml', '.github/workflows/ci.yml:stream', '.git./config', '.git /config', 'src/NUL.txt',
    'src/CONIN$', 'src/COM¹',
    '.git', '.GIT/config', '.github/.git/state.json', '.bench/state.json', '.skill-log/state.json',
    '.copilot/session-state/session.json', '.user/instructions.md', '.ship-with-squadron/state.json',
    '.env', '.env.production', '.github/.env', '.ssh/id_rsa', '.aws/credentials', '.azure/accessTokens.json',
    '.config/gh/hosts.yml', '.npmrc', '.git-credentials', '.secrets/key', 'config/.secrets.json', 'config/id_ed25519',
  ]) {
    assert.equal(isWorkPath(value), false, value);
    assert.throws(() => normalizeWork({ ...work('denied'), paths: [value] }), undefined, value);
  }
});
