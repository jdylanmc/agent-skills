import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GitHubDelivery, command } from './atomic-proposal.mjs';
import { normalizeWork } from '../bench-epoch/bench-epoch.mjs';
import { fileTools } from '../role-doctrine/role-doctrine.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const config = { run: 'run', repository: 'owner/repo', checkout: root, base: 'main', commandMs: 3000 };
const issue = () => ({ work: { id: 'one', title: 'Title', requirements: 'Requirement', paths: ['src'],
  validation: [[process.execPath, '-e', 'process.stdout.write("verified")']] },
candidate: { commit: 'a'.repeat(40), validation: [] }, publication: { id: 'publication-id', basis: 'basis' }, votes: [] });
function directory(t) {
  const dir = path.join(root, '..', '..', '.test-sandbox', `bench-sdk-git-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('real argv publication creates one PR, validates readback, and reconciles acknowledgment loss', async () => {
  const calls = [];
  let pr = null, loseAcknowledgment = true;
  const adapter = new GitHubDelivery(config, root, async (argv) => {
    calls.push(argv);
    if (argv[0] === 'git') {
      if (argv.includes('rev-parse')) return 'a'.repeat(40);
      return '';
    }
    if (argv.includes('list')) return JSON.stringify(pr ? [pr] : []);
    if (argv.includes('create')) {
      pr = { number: 7, url: 'https://github.com/owner/repo/pull/7', state: 'OPEN',
        headRefName: 'bench/run/one', baseRefName: 'main', headRefOid: 'a'.repeat(40),
        body: argv[argv.indexOf('--body') + 1] };
      if (loseAcknowledgment) { loseAcknowledgment = false; throw new Error('connection lost after create'); }
    }
    if (argv.includes('edit')) pr.body = argv[argv.indexOf('--body') + 1];
    return '';
  });
  test('preflight uses official gh repo view positional identity, not unsupported --repo', async () => {
    let observed;
    const adapter = new GitHubDelivery(config, root, async (argv) => {
      if (argv.includes('--show-toplevel')) return root;
      if (argv.includes('get-url')) return ['git', 'github.com:owner/repo.git'].join('@');
      observed = argv;
      return JSON.stringify({ nameWithOwner: 'owner/repo' });
    });
    await adapter.preflight();
    assert.deepEqual(observed, ['gh', 'repo', 'view', 'owner/repo', '--json', 'nameWithOwner']);
  });
  const item = issue();
  await assert.rejects(adapter.publish(item), /connection lost/);
  assert.equal((await adapter.find(item)).number, 7);
  pr.body = `Human note\n${pr.body}\nHuman footer`;
  assert.equal((await adapter.publish(item)).number, 7);
  assert.ok(pr.body.startsWith('Human note\n') && pr.body.endsWith('\nHuman footer'));
  assert.equal(calls.filter((c) => c[0] === 'gh' && c.includes('create')).length, 1);
  const create = calls.find((c) => c.includes('create'));
  assert.deepEqual(create.slice(0, 7), ['gh', 'pr', 'create', '--head', 'bench/run/one', '--base', 'main']);
  assert.deepEqual(create.slice(-2), ['--repo', 'owner/repo']);
  assert.ok(calls.every((c) => !c.some((s) => /--force|--merge|--approve/.test(s))));
  pr.state = 'CLOSED';
  const count = calls.filter((c) => c.includes('push')).length;
  assert.equal((await adapter.publish(item)).state, 'CLOSED');
  assert.equal(calls.filter((c) => c.includes('push')).length, count);
  pr.body = 'An unrelated pull request';
  await assert.rejects(adapter.find(item), /lacks this run publication identity/);
});
test('provider readback mismatch and stop guard prevent false success/new publication', async () => {
  const item = issue();
  const adapter = new GitHubDelivery(config, root, async (argv) =>
    argv.includes('list') ? '[]' : argv.includes('rev-parse') ? 'b'.repeat(40) : '');
  await assert.rejects(adapter.publish(item), /candidate changed/);
  let mutations = 0;
  adapter.run = async (argv) => {
    if (argv.includes('push') || argv.includes('create')) mutations++;
    return argv.includes('list') ? '[]' : argv.includes('rev-parse') ? 'a'.repeat(40) : '';
  };
  adapter.guard = () => { throw new Error('stopped'); };
  await assert.rejects(adapter.publish(item), /stopped/);
  assert.equal(mutations, 0);
});
test('CI observation preserves exact provider fields and classifies unknown/pending/failure/stale', async () => {
  let value = { state: 'OPEN', mergeStateStatus: 'CLEAN', statusCheckRollup: [] };
  const adapter = new GitHubDelivery(config, root, async () => JSON.stringify(value));
  const item = { ...issue(), pr: { number: 4 } };
  assert.equal((await adapter.observe(item)).readiness, 'unknown');
  value.statusCheckRollup = [{ status: 'IN_PROGRESS', conclusion: null }];
  assert.equal((await adapter.observe(item)).readiness, 'unknown');
  value.statusCheckRollup = [{ status: 'COMPLETED', conclusion: 'FAILURE' }];
  assert.equal((await adapter.observe(item)).failed, true);
  value.statusCheckRollup = [{ status: 'COMPLETED', conclusion: 'SUCCESS' }];
  const ready = await adapter.observe(item);
  assert.equal(ready.readiness, 'ready');
  assert.ok(Number.isFinite(Date.parse(ready.observedAt)));
  value.mergeStateStatus = 'BEHIND';
  assert.equal((await adapter.observe(item)).stale, true);
});
test('real Git validation seals tested tree, rejects out-of-scope and test-mutated candidates', { skip: process.platform === 'win32' }, async (t) => {
  const cwd = directory(t);
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
  git('init', '-q'); git('config', 'user.name', 'Bench Test'); git('config', 'user.email', 'test-identity');
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.writeFileSync(path.join(cwd, 'src/file.txt'), 'initial');
  git('add', '.'); git('commit', '-qm', 'initial');
  const adapter = new GitHubDelivery(config, cwd);
  const item = issue();
  fs.writeFileSync(path.join(cwd, 'src/file.txt'), 'changed');
  const candidate = await adapter.validate(item, { cwd });
  assert.equal(candidate.commit, git('rev-parse', 'HEAD'));
  assert.equal(candidate.validation[0].exitCode, 0);
  assert.equal(git('status', '--porcelain'), '');
  fs.writeFileSync(path.join(cwd, 'outside.txt'), 'out of scope');
  await assert.rejects(adapter.validate(item, { cwd }), /outside/);
  fs.unlinkSync(path.join(cwd, 'outside.txt'));
  item.work.validation = [[process.execPath, '-e', 'require("fs").writeFileSync("src/file.txt","mutated")']];
  await assert.rejects(adapter.validate(item, { cwd }), /mutated the candidate/);
});
test('argv process seam runs locally and a bounded timeout is failure', { skip: process.platform === 'win32' }, async () => {
  assert.equal(await command([process.execPath, '-e', 'process.stdout.write("ok")']), 'ok');
  await assert.rejects(command([process.execPath, '-e', 'setInterval(()=>{},1000)'], { timeoutMs: 20 }), /timeout/);
});
test('real Git worktrees isolate review and integrate a newer base without rewriting branch history', { skip: process.platform === 'win32' }, async (t) => {
  const dir = directory(t), source = path.join(dir, 'source'), upstream = path.join(dir, 'upstream.git');
  fs.mkdirSync(source);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
  git(source, 'init', '-q', '-b', 'main');
  git(source, 'config', 'user.name', 'Bench Test'); git(source, 'config', 'user.email', 'test-identity');
  fs.mkdirSync(path.join(source, 'src'));
  fs.writeFileSync(path.join(source, 'src/file.txt'), 'base');
  git(source, 'add', '.'); git(source, 'commit', '-qm', 'base');
  git(dir, 'init', '--bare', '-q', upstream);
  git(source, 'remote', 'add', 'origin', upstream); git(source, 'push', '-q', 'origin', 'main');
  const adapter = new GitHubDelivery({ ...config, checkout: source }, path.join(dir, 'state'));
  const item = issue();
  const cwd = await adapter.prepare(item, { role: 'implement', context: 'writer' });
  fs.writeFileSync(path.join(cwd, 'src/file.txt'), 'feature');
  item.candidate = await adapter.validate(item, { cwd });
  const original = item.candidate.commit;
  const review = { role: 'review', context: 'fresh-review' };
  review.cwd = await adapter.prepare(item, review);
  assert.notEqual(review.cwd, cwd);
  await adapter.inspectReview(item, review);
  await adapter.cleanup(review);
  fs.writeFileSync(path.join(source, 'src/base-addition.txt'), 'new base');
  git(source, 'add', '.'); git(source, 'commit', '-qm', 'base update'); git(source, 'push', '-q', 'origin', 'main');
  item.maintenance = true;
  await adapter.prepare(item, { role: 'implement', context: 'maintainer' });
  assert.equal(fs.readFileSync(path.join(cwd, 'src/base-addition.txt'), 'utf8'), 'new base');
  git(cwd, 'merge-base', '--is-ancestor', original, 'HEAD');
  const updated = await adapter.validate(item, { cwd });
  assert.notEqual(updated.commit, original);
});
test('Windows owned command preserves native argv quoting without a shell', {
  skip: process.platform !== 'win32', timeout: 90000,
}, async () => {
  let owner;
  const args = ['with spaces', 'quote"and\\tail\\', 'snowman-☃'];
  const result = await command([process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args],
    { timeoutMs: 60000, onSpawn: (pid, ownership) => { assert.equal(ownership.pid, pid); owner = ownership; } });
  assert.deepEqual(JSON.parse(result), args);
  assert.equal(owner.kind, 'windows-job');
});
test('authorized dotfile changes pass file tools and real Git validation while protected descendants cannot be staged', {
  skip: process.platform === 'win32',
}, async (t) => {
  const cwd = directory(t);
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
  git('init', '-q'); git('config', 'user.name', 'Bench Test'); git('config', 'user.email', 'test-identity');
  fs.writeFileSync(path.join(cwd, 'seed.txt'), 'baseline');
  git('add', '.'); git('commit', '-qm', 'baseline');
  const item = issue();
  item.work = normalizeWork({ ...item.work, paths: ['.github', '.gitignore'] });
  const tools = Object.fromEntries(fileTools({ cwd, role: 'implement', work: item.work })
    .map((tool) => [tool.name, tool.handler]));
  tools.bench_write({ path: '.gitignore', content: 'build/\n' });
  tools.bench_write({ path: '.github/workflows/ci.yml', content: 'name: CI\n' });
  const adapter = new GitHubDelivery(config, cwd);
  const candidate = await adapter.validate(item, { cwd });
  assert.equal(candidate.commit, git('rev-parse', 'HEAD'));
  assert.equal(git('show', 'HEAD:.gitignore'), 'build/');
  assert.equal(git('show', 'HEAD:.github/workflows/ci.yml'), 'name: CI');
  fs.writeFileSync(path.join(cwd, '.github/.env'), 'synthetic fixture only');
  await assert.rejects(adapter.validate(item, { cwd }), /outside the authorized paths/);
  assert.equal(git('diff', '--cached', '--name-only'), '');
  assert.equal(git('rev-parse', 'HEAD'), candidate.commit);
});
