import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { BenchController, formatStatus } from './_molecules/bench-control/bench-control.mjs';
import { Store, readJSON } from './_atoms/fleet-state/fleet-state.mjs';
import { admit, digest, reviewedBasis, setCandidate, recordReview, publicationIsCurrent, publishedWorkUnchanged } from './_atoms/bench-epoch/bench-epoch.mjs';
import { contextSource, prepareWork } from './_atoms/bench-epoch/bench-epoch.intake.mjs';
import { fileTools } from './_atoms/role-doctrine/role-doctrine.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const work = (id, dependsOn = []) => ({ id, title: id, requirements: `Implement ${id}`, dependsOn,
  paths: ['src'], validation: [['node', '--test']] });
class Workers {
  packets = [];
  pending = new Map();
  active = 0;
  max = 0;
  launch(packet, persistPid) {
    this.packets.push(packet);
    this.active++; this.max = Math.max(this.max, this.active);
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const finish = (outcome) => {
      if (!this.pending.has(packet.context)) return;
      this.pending.delete(packet.context); this.active--; resolve(outcome);
    };
    this.pending.set(packet.context, { packet, finish });
    persistPid(900000000 + this.packets.length);
    return { done, cancel: async () => finish({ released: true, error: 'cancelled' }) };
  }
  complete(context, override = {}) {
    const item = this.pending.get(context);
    const result = item.packet.role === 'review'
      ? { basis: item.packet.basis, verdict: 'signoff', evidence: 'Read src; requirement and successful test evidence agree', findings: [] }
      : { status: 'implemented', evidence: 'Implemented src and tests', findings: [] };
    item.finish({ released: true, idle: true, result, reads: [{ path: 'src/file', sha256: 'a'.repeat(64) }], ...override });
  }
  completeAll() { for (const context of [...this.pending.keys()]) this.complete(context); }
}
class Provider {
  prs = new Map(); observations = new Map(); creates = 0; updates = 0; commits = 0; maintenance = 0;
  async preflight() {}
  branch(issue) { return `bench/run/${issue.work.id}`; }
  async prepare(issue, assignment) { if (issue.maintenance && assignment.role === 'implement') this.maintenance++; return root; }
  async inspectReview() {}
  async cleanup() {}
  async validate() { return { commit: digest(++this.commits).slice(0, 40),
    validation: [{ exitCode: 0, observedAt: '2026-01-01T00:00:00Z', digest: 'test-output' }] }; }
  async find(issue) { return this.prs.get(issue.work.id) ?? null; }
  publicationMatches(issue, pr) { return publicationIsCurrent(issue) && pr.headRefOid === issue.candidate.commit; }
  async publish(issue) {
    this.guard(issue);
    let pr = this.prs.get(issue.work.id);
    if (pr) this.updates++;
    else { this.creates++; pr = { number: this.creates, url: `https://github.com/owner/repo/pull/${this.creates}`, state: 'OPEN' }; }
    pr = { ...pr, headRefOid: issue.candidate.commit };
    this.prs.set(issue.work.id, pr);
    return pr;
  }
  async observe(issue) {
    const value = this.observations.get(issue.work.id);
    if (value instanceof Error) throw value;
    return value ?? { ...issue.pr, observedAt: '2026-01-02T00:00:00Z', readiness: 'ready', failed: false, stale: false };
  }
  async failureEvidence(issue, observation) {
    return { status: 'available', head: observation.headRefOid, errors: [], checks: [],
      jobs: [{ runId: 1, attempt: 1, jobId: 1, head: observation.headRefOid, excerpt: 'Synthetic hosted-only failure: missing platform-specific build input' }] };
  }
}
async function setup(t, overrides = {}) {
  const directory = path.join(root, '..', '..', '.test-sandbox', `bench-sdk-controller-${randomUUID()}`);
  const store = new Store(directory);
  const config = { run: 'run', checkout: root, repository: 'owner/repo', base: 'main', lifetimeMs: 100000,
    runtimeDirectory: path.resolve(root, '../../.skill-log/bench-sdk-runtime'),
    maxAssignments: 100, models: { implement: 'impl', review: 'reviewer' }, doctrine: { implement: ['code'], review: ['testing'] }, ...overrides };
  const workers = new Workers(), provider = new Provider(), reports = [];
  let now = 1000000;
  const params = { config, store, provider, workers, clock: () => now, ownershipReleased: async () => true,
    doctrine: (ids) => ids.map((id) => ({ id, sha256: digest(id), text: `FULL DOCTRINE ${id}` })), report: (r) => reports.push(r) };
  const controller = new BenchController(params);
  await controller.initialize();
  t.after(() => { store.release(); fs.rmSync(directory, { recursive: true, force: true }); });
  const tick = async () => { await Promise.resolve(); await controller.tick(); };
  const cycle = async () => { workers.completeAll(); await tick(); };
  return { controller, store, workers, provider, reports, tick, cycle, params, advance: (ms) => { now += ms; } };
}
test('five reusable slots deliver more than five generations with fresh sessions and distinct-slot quorum', async (t) => {
  const h = await setup(t);
  for (let n = 0; n < 8; n++) admit(h.controller.state, work(`issue-${n}`));
  await h.tick();
  assert.equal(h.workers.active, 5);
  for (let n = 0; n < 30 && h.provider.creates < 8; n++) await h.cycle();
  assert.equal(h.provider.creates, 8);
  assert.ok(h.workers.packets.length >= 32);
  assert.equal(h.workers.max, 5);
  assert.equal(new Set(h.workers.packets.map((p) => p.context)).size, h.workers.packets.length);
  for (const issue of h.controller.state.issues) {
    assert.equal(issue.phase, 'published');
    assert.equal(new Set(issue.votes.map((v) => v.slot)).size, 3);
    assert.ok(issue.votes.every((v) => v.context !== issue.authorContext && v.basis === reviewedBasis(issue)));
  }
  assert.ok(h.reports.length);
});
test('incremental admission preserves active work; corrections wait for all issue readers and invalidate only that issue', async (t) => {
  const h = await setup(t);
  admit(h.controller.state, work('a'));
  await h.tick(); await h.cycle();
  const review = [...h.workers.pending.values()][0];
  const before = h.controller.issue('a').candidate;
  h.store.send({ type: 'enqueue', work: work('b') });
  await h.tick();
  assert.deepEqual(h.controller.issue('a').candidate, before);
  h.workers.complete(review.packet.context, { result: { basis: review.packet.basis, verdict: 'correction',
    evidence: 'Found requirement gap', findings: ['Fix src boundary'] } });
  await h.tick();
  assert.equal(h.controller.issue('a').phase, 'correction');
  assert.equal(h.workers.packets.filter((p) => p.issue === 'a' && p.role === 'implement').length, 1);
  await h.cycle();
  assert.equal(h.workers.packets.filter((p) => p.issue === 'a' && p.role === 'implement').length, 2);
  for (let n = 0; n < 12; n++) await h.cycle();
  assert.equal(h.provider.creates, 2);
});
test('arbitrary/partial/failed review output cannot publish', async (t) => {
  for (const outcome of [{ result: 'LGTM' }, { result: {} }, { error: 'session failed' }, { idle: false }, { reads: [] }]) {
    const h = await setup(t, { slots: 1, quorum: 1 });
    admit(h.controller.state, work('a'));
    await h.tick(); await h.cycle();
    h.workers.complete([...h.workers.pending.keys()][0], outcome);
    await h.tick();
    assert.equal(h.provider.creates, 0);
    assert.equal(h.controller.issue('a').phase, 'blocked');
  }
});
test('cancelled and stale completions do not mutate or publish, and stop cancels all owners', async (t) => {
  const h = await setup(t);
  admit(h.controller.state, work('a'));
  await h.tick();
  const assignment = structuredClone(h.controller.state.slots[0]);
  h.store.send({ type: 'cancel', issue: 'a' });
  await h.tick(); await h.tick();
  h.controller.completed.push({ assignment, outcome: { released: true, idle: true,
    result: { status: 'implemented', evidence: 'stale', findings: [] } } });
  await h.tick();
  assert.equal(h.controller.issue('a').phase, 'cancelled');
  assert.equal(h.provider.creates, 0);
  admit(h.controller.state, work('b'));
  await h.tick();
  h.store.send({ type: 'stop' });
  await h.tick();
  assert.equal(h.workers.active, 0);
  assert.equal(h.controller.state.status, 'stopped');
  assert.ok(h.controller.state.slots.every((s) => s === null));
});
test('uncertain release keeps capacity reserved and refuses excess workers', async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1 });
  admit(h.controller.state, work('a')); admit(h.controller.state, work('b'));
  await h.tick();
  h.workers.complete([...h.workers.pending.keys()][0], { released: false, error: 'hung ownership' });
  await h.tick();
  assert.equal(h.controller.state.status, 'uncertain');
  assert.ok(h.controller.state.slots[0]);
  assert.equal(h.workers.packets.length, 1);
});
test('restart reconciles a remotely created PR after lost acknowledgment; no duplicate creation', async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1 });
  admit(h.controller.state, work('a'));
  await h.tick(); await h.cycle();
  const publish = h.provider.publish.bind(h.provider);
  h.provider.publish = async (issue) => { await publish(issue); throw new Error('crash after create'); };
  await h.cycle();
  assert.equal(h.controller.issue('a').publication.pending, true);
  h.store.release();
  const next = new BenchController(h.params);
  await next.initialize(true);
  assert.equal(next.issue('a').phase, 'published');
  assert.equal(next.issue('a').pr.number, 1);
  assert.equal(h.provider.creates, 1);
  assert.equal(next.state.createdAt, h.controller.state.createdAt);
});
test('restart replays missing publication/evidence updates without discarding current quorum', async (t) => {
  for (const createdBeforeFailure of [false, true]) {
    const h = await setup(t, { slots: 1, quorum: 1 });
    admit(h.controller.state, work('a')); await h.tick(); await h.cycle();
    const publish = h.provider.publish.bind(h.provider);
    h.provider.publish = async (issue) => {
      if (createdBeforeFailure) await publish(issue);
      throw new Error('publication interrupted');
    };
    await h.cycle();
    h.provider.publicationMatches = () => false;
    h.provider.publish = publish;
    h.store.release();
    const next = new BenchController(h.params);
    await next.initialize(true);
    assert.equal(next.issue('a').phase, 'review');
    assert.equal(next.issue('a').votes.length, 1);
    await next.tick();
    assert.equal(next.issue('a').phase, 'published');
    assert.equal(h.provider.creates, 1);
    assert.equal(h.workers.packets.length, 2);
  }
});
test('same-pool Shepherd orders deduplicate, update the same PR and retain timestamped readiness', async (t) => {
  const h = await setup(t, { pollMs: 1 });
  admit(h.controller.state, work('a'));
  await h.tick();
  for (let n = 0; n < 4; n++) await h.cycle();
  const pr = h.controller.issue('a').pr;
  h.provider.observations.set('a', { ...pr, observedAt: '2026-02-01T00:00:00Z', readiness: 'not-ready', failed: true, stale: true });
  h.advance(10); await h.tick();
  assert.equal(h.provider.maintenance, 1);
  h.advance(10); await h.tick();
  assert.equal(h.provider.maintenance, 1);
  h.provider.observations.set('a', new Error('offline'));
  h.advance(10); await h.tick();
  assert.equal(h.controller.snapshot().work[0].observation.observedAt, '2026-02-01T00:00:00Z');
  for (let n = 0; n < 4; n++) await h.cycle();
  assert.equal(h.provider.creates, 1);
  assert.equal(h.provider.updates, 1);
  assert.equal(h.controller.issue('a').pr.number, pr.number);
  assert.equal(h.controller.snapshot().work[0].observation.observedAt, '2026-02-01T00:00:00Z');
  assert.equal(h.controller.snapshot().work[0].readiness, 'unknown');
  assert.ok(h.workers.max <= 5);
});
test('human merge unblocks dependent tasks, closure does not; periodic reports and lifetime bounds persist', async (t) => {
  const h = await setup(t, { pollMs: 1, reportMs: 1 });
  admit(h.controller.state, work('a'));
  admit(h.controller.state, work('b', ['a']));
  await h.tick();
  for (let n = 0; n < 4; n++) await h.cycle();
  assert.equal(h.controller.issue('b').phase, 'queued');
  const pr = h.controller.issue('a').pr;
  h.provider.observations.set('a', { ...pr, state: 'MERGED', readiness: 'ready', observedAt: '2026-01-01T00:00:00Z' });
  h.advance(10); await h.tick();
  assert.equal(h.controller.issue('a').phase, 'merged');
  assert.equal(h.controller.issue('b').phase, 'implementing');
  assert.ok(h.reports.length >= 2);
  h.advance(100001); await h.tick();
  assert.equal(h.controller.state.status, 'exhausted');
});
test('controller lock, command receipts and missing launch identity fail closed on restart', async (t) => {
  const h = await setup(t);
  assert.throws(() => new Store(h.store.directory).acquire(true), /ownership/);
  const id = h.store.send({ type: 'enqueue', work: work('a') });
  await h.tick();
  assert.equal(readJSON(h.store.file).commands[id].status, 'accepted');
  h.controller.state.slots[0] = { ...h.controller.state.slots[0], stage: 'spawning', pid: undefined };
  h.controller.save();
  h.store.release();
  const next = new BenchController(h.params);
  await assert.rejects(next.initialize(true), /termination uncertain/);
  assert.equal(next.state.status, 'uncertain');
});
test('executable enqueue/status/pause/stop entry points persist operator commands without starting agents', async (t) => {
  const h = await setup(t);
  const file = path.join(h.store.directory, 'work.json');
  fs.writeFileSync(file, JSON.stringify(work('cli-task')));
  const cli = (...args) => JSON.parse(execFileSync(process.execPath,
    [path.join(root, '_molecules/bench-control/bench-control.mjs'), ...args], { encoding: 'utf8' }));
  const enqueue = cli('enqueue', h.store.directory, file);
  assert.ok(enqueue.queuedCommand);
  await h.tick();
  const status = cli('status', h.store.directory, '--json');
  assert.equal(status.controllerAlive, true);
  assert.equal(status.work[0].id, 'cli-task');
  assert.equal(status.commandReceipts[enqueue.queuedCommand].status, 'accepted');
  cli('pause', h.store.directory); await h.tick();
  assert.equal(h.controller.state.status, 'paused');
  cli('stop', h.store.directory); await h.tick();
  assert.equal(h.controller.state.status, 'stopped');
});
test('pause drains bounded assignments without publication and resumption stays within the generation budget', async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1, maxAssignments: 2 });
  admit(h.controller.state, work('a')); await h.tick();
  h.store.send({ type: 'pause' }); await h.tick();
  await h.cycle();
  assert.equal(h.provider.creates, 0);
  assert.equal(h.workers.active, 0);
  assert.equal(h.controller.state.status, 'paused');
  h.store.send({ type: 'resume' }); await h.tick();
  await h.cycle();
  assert.equal(h.workers.packets.length, 2);
  assert.equal(h.controller.state.status, 'exhausted');
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function eventually(predicate, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= until) throw new Error('controller did not service the expected event before the test deadline');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('controller reports and admits work while validation is pending without new workers or invented observations', async (t) => {
  const h = await setup(t, { reportMs: 50, pollMs: 10000000 });
  const a = admit(h.controller.state, work('a'));
  const b = admit(h.controller.state, work('b'));
  b.phase = 'published';
  b.pr = { number: 9, url: 'https://github.com/owner/repo/pull/9', headRefOid: 'b'.repeat(40) };
  b.candidate = { commit: 'b'.repeat(40), validation: [] };
  b.observation = { headRefOid: b.pr.headRefOid, readiness: 'ready',
    observedAt: new Date(h.params.clock() - 1000).toISOString() };
  const prior = structuredClone(b);
  const gate = deferred(), entered = deferred();
  const validate = h.provider.validate.bind(h.provider);
  h.provider.validate = async (...args) => { entered.resolve(); await gate.promise; return validate(...args); };
  await h.tick();
  h.workers.completeAll();
  const pending = h.controller.responsive(h.tick());
  try {
    await entered.promise;
    await assert.rejects(h.controller.tick(), /already pending/);
    const initialReports = h.reports.length;
    h.advance(100);
    await eventually(() => h.reports.length > initialReports && h.reports.at(-1).activity?.name === 'validation');
    const admission = h.store.send({ type: 'enqueue', work: work('c') });
    h.advance(100);
    await eventually(() => h.controller.state.commands[admission]?.status === 'accepted');
    assert.equal(h.controller.issue('c').phase, 'queued');
    assert.equal(h.workers.packets.length, 1);
    assert.equal(h.workers.active, 0);
    assert.equal(h.controller.state.slots.filter(Boolean).length, 1);
    assert.equal(a.candidate, null);
    assert.deepEqual(b, prior);
    const report = h.reports.at(-1);
    assert.equal(report.work.find((i) => i.id === 'b').observation.observedAt, prior.observation.observedAt);
    const human = formatStatus(report);
    assert.match(human, /Awaiting validation for a/);
    assert.ok(human.includes(`observed ${prior.observation.observedAt}`));
    assert.ok(!human.startsWith('{') && human.length < 1500);
    assert.equal(readJSON(path.join(h.store.lock, 'owner.json')).pid, process.pid);
    const stop = h.store.send({ type: 'stop' });
    await eventually(() => h.controller.state.commands[stop]?.status === 'accepted');
    assert.equal(h.controller.state.status, 'stopped');
    assert.equal(h.controller.snapshot().draining, true);
  } finally { gate.resolve(); await pending; }
  assert.equal(h.provider.creates, 0);
  assert.equal(h.controller.state.slots.filter(Boolean).length, 0);
});

test('pause and pause/resume fence a pending provider sequence before any subsequent command', async (t) => {
  for (const resume of [false, true]) {
    const h = await setup(t, { slots: 1, quorum: 1, reportMs: 50 });
    admit(h.controller.state, work('a'));
    const gate = deferred(), entered = deferred();
    const forbidden = path.join(h.store.directory, 'forbidden-next-command');
    h.provider.validate = async () => {
      entered.resolve(); await gate.promise;
      await h.controller.command([process.execPath, '-e', 'require("node:fs").writeFileSync(process.argv[1],"bad")', forbidden],
        { cwd: h.store.directory, timeoutMs: 5000 });
      throw new Error('the interrupted sequence must never get here');
    };
    await h.tick(); h.workers.completeAll();
    const pending = h.controller.responsive(h.tick());
    try {
      await entered.promise;
      const pause = h.store.send({ type: 'pause' });
      await eventually(() => h.controller.state.commands[pause]?.status === 'accepted');
      assert.equal(h.controller.state.status, 'paused');
      if (resume) {
        const command = h.store.send({ type: 'resume' });
        await eventually(() => h.controller.state.commands[command]?.status === 'accepted');
        assert.equal(h.controller.state.status, 'running');
      }
      assert.equal(h.controller.snapshot().activity.interrupted, true);
      assert.equal(h.controller.snapshot().draining, true);
      assert.equal(h.workers.packets.length, 1);
    } finally { gate.resolve(); await pending; }
    assert.equal(fs.existsSync(forbidden), false);
    assert.equal(h.controller.issue('a').candidate, null);
    assert.equal(h.provider.creates, 0);
  }
});

test('reports and stop receipts continue while a real owned command drains; the next effect is blocked', { timeout: 90000 }, async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1, reportMs: 50, commandMs: 60000 });
  admit(h.controller.state, work('a'));
  const started = path.join(h.store.directory, 'command-started');
  const release = path.join(h.store.directory, 'command-release');
  const forbidden = path.join(h.store.directory, 'forbidden-after-drain');
  const program = 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],"started");' +
    'const timer=setInterval(()=>{if(fs.existsSync(process.argv[2])){clearInterval(timer);process.stdout.write("drained");}},10);';
  h.provider.validate = async () => {
    await h.controller.command([process.execPath, '-e', program, started, release],
      { cwd: h.store.directory, timeoutMs: 60000 });
    await h.controller.command([process.execPath, '-e', 'require("node:fs").writeFileSync(process.argv[1],"bad")', forbidden],
      { cwd: h.store.directory, timeoutMs: 60000 });
    throw new Error('a stopped provider must not finish');
  };
  await h.tick(); h.workers.completeAll();
  const pending = h.controller.responsive(h.tick());
  try {
    await eventually(() => fs.existsSync(started), process.platform === 'win32' ? 45000 : 5000);
    const before = h.reports.length;
    h.advance(100);
    await eventually(() => h.reports.length > before);
    const pid = h.controller.state.operation.pid;
    const stop = h.store.send({ type: 'stop' });
    await eventually(() => h.controller.state.commands[stop]?.status === 'accepted');
    assert.equal(h.controller.state.operation.pid, pid);
    assert.equal(h.controller.snapshot().draining, true);
    assert.equal(h.workers.packets.length, 1);
    assert.equal(fs.existsSync(forbidden), false);
  } finally {
    fs.writeFileSync(release, 'release');
    await pending;
  }
  assert.equal(h.controller.state.status, 'stopped');
  assert.equal(h.controller.state.operation, null);
  assert.equal(h.controller.state.slots.filter(Boolean).length, 0);
  assert.equal(fs.existsSync(forbidden), false);
  assert.equal(h.provider.creates, 0);
});

test('status is concise human text by default and explicitly supports machine JSON', async (t) => {
  const h = await setup(t);
  admit(h.controller.state, work('human-status'));
  h.controller.save();
  const cli = (...args) => execFileSync(process.execPath,
    [path.join(root, '_molecules/bench-control/bench-control.mjs'), 'status', h.store.directory, ...args], { encoding: 'utf8' });
  const human = cli();
  assert.match(human, /Bench controller run/);
  assert.match(human, /human-status: queued/);
  assert.ok(!human.trimStart().startsWith('{'));
  const machine = JSON.parse(cli('--json'));
  assert.equal(machine.work[0].id, 'human-status');
  assert.equal(machine.controllerAlive, true);
});

test('pause during pending publication preserves quorum and reconciles the same PR on authorized resume', async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1, reportMs: 50 });
  admit(h.controller.state, work('a'));
  await h.tick(); await h.cycle();
  const publish = h.provider.publish.bind(h.provider);
  const gate = deferred(), entered = deferred();
  h.provider.publish = async (issue) => {
    const pr = await publish(issue);
    entered.resolve(); await gate.promise;
    return pr;
  };
  h.workers.completeAll();
  const pending = h.controller.responsive(h.tick());
  let votes;
  try {
    await entered.promise;
    votes = structuredClone(h.controller.issue('a').votes);
    const pause = h.store.send({ type: 'pause' });
    await eventually(() => h.controller.state.commands[pause]?.status === 'accepted');
    assert.equal(h.controller.state.activity.name, 'publication');
    assert.equal(h.controller.issue('a').publication.pending, true);
    assert.equal(h.controller.issue('a').pr, null);
    assert.equal(h.controller.snapshot().work[0].readiness, 'unknown');
  } finally { gate.resolve(); await pending; }
  assert.deepEqual(h.controller.issue('a').votes, votes);
  assert.equal(h.controller.issue('a').phase, 'review');
  h.provider.publish = publish;
  h.store.send({ type: 'resume' });
  await h.tick();
  assert.equal(h.controller.issue('a').phase, 'published');
  assert.equal(h.controller.issue('a').pr.number, 1);
  assert.equal(h.provider.creates, 1);
  assert.equal(h.workers.packets.length, 2);
});

test('external-head fence survives late maintenance results, restart and generic retry', async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1, pollMs: 1 });
  admit(h.controller.state, work('a'));
  await h.tick(); await h.cycle(); await h.cycle();
  const issue = h.controller.issue('a'), candidate = structuredClone(issue.candidate);
  h.provider.observations.set('a', { ...issue.pr, failed: true, stale: false, readiness: 'not-ready', observedAt: '2026-01-03T00:00:00Z' });
  h.advance(10); await h.tick();
  const assignment = structuredClone(h.controller.state.slots[0]);
  assert.equal(assignment.role, 'implement');
  h.provider.observations.set('a', { ...issue.pr, headRefOid: 'f'.repeat(40), failed: false, readiness: 'unknown', observedAt: '2026-01-04T00:00:00Z' });
  h.advance(10); await h.tick();
  assert.equal(issue.phase, 'blocked');
  assert.equal(issue.reconciliation.required, true);
  const commits = h.provider.commits;
  h.controller.completed.push({ assignment, outcome: { released: true, idle: true,
    result: { status: 'implemented', evidence: 'late stale implementation', findings: [] } } });
  await h.tick();
  assert.equal(h.provider.commits, commits);
  assert.deepEqual(issue.candidate, candidate);
  assert.equal(h.provider.creates, 1);
  assert.equal(h.provider.updates, 0);
  h.controller.state.slots[0] = assignment; // Persisted released assignment at an interruption.
  h.controller.save(); h.store.release();
  const next = new BenchController(h.params);
  await next.initialize(true);
  assert.equal(next.issue('a').phase, 'blocked');
  assert.deepEqual(next.issue('a').candidate, candidate);
  const retry = h.store.send({ type: 'retry', issue: 'a' });
  await next.tick();
  assert.equal(next.state.commands[retry].status, 'rejected');
  assert.match(next.state.commands[retry].error, /reconciliation/);
  assert.equal(next.issue('a').phase, 'blocked');
});

test('external-head block during validation cannot be overwritten by the awaiting continuation', async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1 });
  const issue = admit(h.controller.state, work('a'));
  const gate = deferred(), entered = deferred();
  const validate = h.provider.validate.bind(h.provider);
  h.provider.validate = async (...args) => { entered.resolve(); await gate.promise; return validate(...args); };
  await h.tick(); h.workers.completeAll();
  const pending = h.controller.responsive(h.tick());
  try {
    await entered.promise;
    h.controller.blockExternalHead(issue, { headRefOid: 'f'.repeat(40), observedAt: '2026-01-04T00:00:00Z' });
  } finally { gate.resolve(); await pending; }
  assert.equal(issue.phase, 'blocked');
  assert.equal(issue.reconciliation.required, true);
  assert.equal(issue.candidate, null);
  assert.equal(h.provider.creates, 0);
});

test('deliberate implementation/review blockers surface their questions in periodic, plain and JSON status', async (t) => {
  for (const role of ['implement', 'review']) {
    const h = await setup(t, { slots: 1, quorum: 1 });
    admit(h.controller.state, work('a'));
    await h.tick();
    if (role === 'review') await h.cycle();
    const pending = [...h.workers.pending.values()][0];
    const question = 'Which supported release branch and platform should this requirement target?';
    h.workers.complete(pending.packet.context, { reads: [], result: role === 'review'
      ? { basis: pending.packet.basis, verdict: 'blocked', evidence: 'The supplied requirements omit a material scope decision.', findings: [question] }
      : { status: 'blocked', evidence: 'The supplied requirements omit a material scope decision.', findings: [question] } });
    await h.tick();
    assert.equal(h.controller.issue('a').phase, 'blocked');
    assert.ok(formatStatus(h.reports.at(-1)).includes(question));
    const entry = path.join(root, '_molecules/bench-control/bench-control.mjs');
    const plain = execFileSync(process.execPath, [entry, 'status', h.store.directory], { encoding: 'utf8' });
    const json = JSON.parse(execFileSync(process.execPath, [entry, 'status', h.store.directory, '--json'], { encoding: 'utf8' }));
    assert.ok(plain.includes(question));
    assert.deepEqual(json.work[0].findings, [question]);
    assert.match(json.work[0].blockerEvidence, /material scope/);
    assert.equal(h.provider.creates, 0);
  }
});

test('inbox ordering is submission sequence, not lexical command identity', async (t) => {
  const h = await setup(t);
  const pause = h.store.send({ type: 'pause' }, { id: 'zz-pause' });
  const resume = h.store.send({ type: 'resume' }, { id: 'aa-resume' });
  h.store.send({ type: 'enqueue', work: work('ordered') }, { id: 'zz-enqueue' });
  h.store.send({ type: 'cancel', issue: 'ordered' }, { id: 'aa-cancel' });
  await h.tick();
  assert.equal(h.controller.state.status, 'running');
  assert.equal(h.controller.issue('ordered').phase, 'cancelled');
  assert.ok(h.controller.state.commands[pause].sequence < h.controller.state.commands[resume].sequence);
  assert.equal(h.workers.packets.length, 0);
});

test('concurrent inbox publishers have durable unique order across restart and failed publication', async (t) => {
  const h = await setup(t);
  const module = new URL('./_atoms/fleet-state/fleet-state.mjs', import.meta.url).href;
  const writer = 'const {Store}=await import(process.argv[1]); const store=new Store(process.argv[2]); console.log(store.send({type:"pause"}));';
  await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', writer, module, h.store.directory],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.on('data', (data) => { error += data; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(error || `publisher exit ${code}`)));
  })));
  const entries = h.store.commands();
  assert.deepEqual(entries.map((e) => e.command.sequence), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(entries.map((e) => e.command.id)).size, 6);
  for (const { file } of entries) fs.unlinkSync(file);
  const restarted = new Store(h.store.directory);
  restarted.send({ type: 'resume' });
  assert.equal(restarted.commands()[0].command.sequence, 7);
  fs.unlinkSync(restarted.commands()[0].file);
  fs.rmdirSync(path.join(h.store.directory, 'inbox'));
  fs.writeFileSync(path.join(h.store.directory, 'inbox'), 'obstruct publication');
  assert.throws(() => restarted.send({ type: 'pause' }), /EEXIST|ENOTDIR/);
  fs.unlinkSync(path.join(h.store.directory, 'inbox'));
  restarted.send({ type: 'pause' });
  assert.equal(restarted.commands()[0].command.sequence, 9, 'failed reservation must not be recycled');
});
test('dead publisher recovery preserves the reserved sequence; unknown publisher identity is not queued success', async (t) => {
  const h = await setup(t);
  const dead = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
  assert.equal(dead.status, 0);
  const lock = path.join(h.store.directory, 'inbox-publish.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: dead.pid, id: 'interrupted' }));
  fs.writeFileSync(path.join(h.store.directory, 'inbox-sequence.json'), JSON.stringify({ sequence: 40 }));
  new Store(h.store.directory).send({ type: 'pause' });
  assert.equal(h.store.commands()[0].command.sequence, 41);
  fs.mkdirSync(lock);
  assert.throws(() => h.store.send({ type: 'stop' }, { timeoutMs: 20 }), /not acknowledged/);
  assert.equal(h.store.commands().length, 1);
  fs.rmdirSync(lock);
});

test('an observed hosted-only failure reaches the worker, but an unchanged candidate cannot republish or requeue itself', async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1, pollMs: 1 });
  admit(h.controller.state, work('a'));
  await h.tick(); await h.cycle(); await h.cycle();
  const issue = h.controller.issue('a');
  const published = structuredClone(issue.candidate);
  h.provider.observations.set('a', { ...issue.pr, failed: true, stale: false, readiness: 'not-ready', observedAt: '2026-01-03T00:00:00Z' });
  h.advance(10); await h.tick();
  assert.match(h.workers.packets.at(-1).observation.ciEvidence.jobs[0].excerpt, /hosted-only failure/);
  h.provider.validate = async () => structuredClone(published);
  await h.cycle();
  assert.equal(issue.phase, 'blocked');
  assert.match(issue.error, /unchanged head/);
  const generations = h.workers.packets.length;
  for (let n = 0; n < 4; n++) { h.advance(10); await h.tick(); }
  assert.equal(h.workers.packets.length, generations);
  assert.equal(h.provider.creates, 1);
  assert.equal(h.provider.updates, 0);
});

test('missing or stale hosted evidence blocks maintenance without consuming a worker', async (t) => {
  for (const status of ['unavailable', 'stale']) {
    const h = await setup(t, { slots: 1, quorum: 1, pollMs: 1 });
    admit(h.controller.state, work('a')); await h.tick(); await h.cycle(); await h.cycle();
    const issue = h.controller.issue('a');
    h.provider.observations.set('a', { ...issue.pr, failed: true, readiness: 'not-ready', observedAt: '2026-01-03T00:00:00Z' });
    h.provider.failureEvidence = async () => ({ status, head: issue.pr.headRefOid, errors: ['Current attempt log is inaccessible'] });
    h.advance(10); await h.tick();
    assert.equal(issue.phase, 'blocked');
    assert.equal(h.workers.packets.length, 2);
    assert.ok(h.controller.snapshot().work[0].findings.includes('Current attempt log is inaccessible'));
  }
});

test('invoking-agent preparation handles pasted dependent tasks and later additions with bounded read-only context', async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1 });
  const pasted = ['Fix the settings parser.', 'After the parser task merges, update the consuming UI.'];
  const guidance = contextSource('fixture:AGENTS.md', 'fixture-revision-1, full relevant section', 'Repository convention: preserve compatibility; edit only the authorized src paths.');
  const design = contextSource('fixture:docs/design.md', 'fixture-revision-1, lines 10-14', 'Design: the parser returns structured errors and never throws for user input.');
  // This is the invoking agent's faithful transcription, not JSON demanded from the human.
  const a = prepareWork({ ...work('parser'), requirements: pasted[0] }, [guidance, design]);
  const b = prepareWork({ ...work('ui', ['parser']), requirements: pasted[1] }, [guidance, design]);
  assert.equal(h.store.commands().length, 0, 'preparation itself cannot claim authority or enqueue');
  h.store.send({ type: 'enqueue', work: a }); h.store.send({ type: 'enqueue', work: b });
  await h.tick();
  assert.equal(h.controller.issue('ui').phase, 'queued');
  await h.cycle();
  for (const packet of h.workers.packets) {
    assert.ok(packet.work.requirements.includes(guidance.text));
    assert.ok(packet.work.requirements.includes(design.text));
    assert.ok(packet.work.requirements.includes(design.sha256));
    assert.deepEqual(packet.work.paths, ['src']);
    const write = fileTools({ ...packet, cwd: h.store.directory, role: 'implement' }).find((tool) => tool.name === 'bench_write');
    assert.throws(() => write.handler({ path: 'AGENTS.md', content: 'not authorized' }), /outside assignment/);
    assert.throws(() => write.handler({ path: 'docs/design.md', content: 'not authorized' }), /outside assignment/);
  }
  const prior = structuredClone(h.controller.issue('parser'));
  h.store.send({ type: 'enqueue', work: prepareWork({ ...work('later'), requirements: 'Also add the agreed standalone parser example.' }, [guidance]) });
  h.controller.commands();
  assert.deepEqual(h.controller.issue('parser'), prior);
  assert.equal(h.controller.issue('later').phase, 'queued');
});

test('explicit context rebinding changes only affected requirements/reviews and rejects stale or active revisions', async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1 });
  const a = admit(h.controller.state, prepareWork(work('a'), [contextSource('fixture:AGENTS.md', 'r1', 'Use the old error shape.')]));
  const b = admit(h.controller.state, work('b'));
  for (const item of [a, b]) {
    setCandidate(item, { commit: 'a'.repeat(40), validation: [{ exitCode: 0, observedAt: 'fixture-time', digest: 'fixture-tests' }] }, `author-${item.work.id}`);
    const basis = reviewedBasis(item);
    recordReview(item, { slot: 0, context: `reviewer-${item.work.id}`, basis, doctrine: [],
      filesRead: [{ path: 'src/file', sha256: 'a'.repeat(64) }] },
    { basis, verdict: 'signoff', evidence: 'Synthetic current-candidate review', findings: [] });
  }
  const untouched = structuredClone(b);
  const oldHash = digest(a.work.requirements), oldEpoch = a.epoch;
  const revised = prepareWork(work('a'), [contextSource('fixture:AGENTS.md', 'r2', 'Use the newly approved structured error shape.')]);
  const id = h.store.send({ type: 'revise', issue: 'a', requirements: revised.requirements, expectedRequirementsHash: oldHash });
  h.controller.commands();
  assert.equal(h.controller.state.commands[id].status, 'accepted');
  assert.ok(a.epoch > oldEpoch);
  assert.deepEqual(a.votes, []);
  assert.deepEqual(a.work.paths, ['src']);
  assert.deepEqual(b, untouched);
  assert.ok(a.work.requirements.includes('r2'));
  const stale = h.store.send({ type: 'revise', issue: 'a', requirements: revised.requirements, expectedRequirementsHash: oldHash });
  h.controller.commands();
  assert.equal(h.controller.state.commands[stale].status, 'rejected');
  await h.tick();
  const active = h.store.send({ type: 'revise', issue: 'a', requirements: 'No silent edits', expectedRequirementsHash: digest(a.work.requirements) });
  h.controller.commands();
  assert.equal(h.controller.state.commands[active].status, 'rejected');
  assert.throws(() => prepareWork(work('bad'), [{ ...contextSource('fixture:AGENTS.md', 'r1', 'original'), text: 'unverified replacement' }]), /digest mismatch/);
  assert.throws(() => prepareWork({ ...work('bad'), requirements: undefined }), /faithfully supplied/);
});

async function initialPublication(h) {
  admit(h.controller.state, work('a'));
  await h.tick(); await h.cycle(); await h.cycle();
}
async function freshThreeSlotReview(h, controller = h.controller) {
  const step = async () => { await Promise.resolve(); await controller.tick(); };
  h.workers.completeAll();
  await step();
  const reviewers = [...h.workers.pending.values()].filter((value) => value.packet.issue === 'a' && value.packet.role === 'review');
  assert.equal(reviewers.length, 3);
  for (const reviewer of reviewers.slice(0, 2)) {
    h.workers.complete(reviewer.packet.context);
    await step();
    assert.notEqual(controller.issue('a').phase, 'published');
    assert.equal(controller.issue('a').deliveryPending, true);
  }
  h.workers.complete(reviewers[2].packet.context);
  await step();
  assert.equal(controller.issue('a').phase, 'published');
  assert.equal(controller.issue('a').deliveryPending, false);
  assert.equal(new Set(controller.issue('a').votes.map((vote) => vote.slot)).size, 3);
}

test('lost create acknowledgment followed by revise/restart recognizes the same PR without completing revised work', async (t) => {
  const h = await setup(t, { slots: 3, quorum: 3 });
  const publish = h.provider.publish.bind(h.provider);
  h.provider.publish = async (issue) => { await publish(issue); throw new Error('create acknowledgment lost'); };
  await initialPublication(h);
  const item = h.controller.issue('a'), oldCandidate = structuredClone(item.candidate);
  assert.equal(item.publication.pending, true);
  assert.equal(item.pr, null);
  h.store.send({ type: 'revise', issue: 'a', expectedRequirementsHash: digest(item.work.requirements),
    requirements: 'Revised requirement needs new implementation and verification.' });
  h.controller.commands();
  h.store.release();
  h.provider.publish = publish;
  const restarted = new BenchController(h.params);
  await restarted.initialize(true);
  assert.equal(restarted.issue('a').pr.number, 1);
  assert.equal(restarted.issue('a').phase, 'correction');
  assert.equal(restarted.issue('a').deliveryPending, true);
  assert.deepEqual(restarted.issue('a').candidate, oldCandidate);
  assert.deepEqual(restarted.issue('a').votes, []);
  assert.equal(h.provider.creates, 1);
  await restarted.tick();
  assert.equal(h.workers.packets.at(-1).role, 'implement');
  assert.match(h.workers.packets.at(-1).work.requirements, /Revised requirement/);
  await freshThreeSlotReview(h, restarted);
  assert.notEqual(restarted.issue('a').candidate.commit, oldCandidate.commit);
  assert.equal(restarted.issue('a').pr.number, 1);
  assert.equal(h.provider.creates, 1);
  assert.equal(h.provider.updates, 1);
  assert.equal(restarted.issue('a').delivery.workDigest, digest(restarted.issue('a').work));
});

test('a valid blocker and generic retry cannot use the old green PR to satisfy revised requirements', async (t) => {
  const h = await setup(t, { slots: 3, quorum: 3 });
  await initialPublication(h);
  const item = h.controller.issue('a');
  h.store.send({ type: 'revise', issue: 'a', expectedRequirementsHash: digest(item.work.requirements),
    requirements: 'New approved behavior that the old PR does not establish.' });
  await h.tick();
  const context = [...h.workers.pending.keys()][0];
  h.workers.complete(context, { result: { status: 'blocked', evidence: 'Need the agreed target detail.',
    findings: ['Which behavior variant is intended?'] } });
  await h.tick();
  assert.equal(item.phase, 'blocked');
  h.store.send({ type: 'retry', issue: 'a' });
  await h.tick();
  assert.equal(item.phase, 'implementing');
  assert.equal(item.maintenance, false);
  assert.equal(item.deliveryPending, true);
  assert.equal(h.provider.updates, 0);
  await freshThreeSlotReview(h);
  assert.equal(item.pr.number, 1);
  assert.equal(h.provider.creates, 1);
  assert.equal(h.provider.updates, 1);
});

test('an unpublished changed candidate cannot be discarded by green maintenance with unchanged requirements', async (t) => {
  const h = await setup(t, { slots: 3, quorum: 3 });
  await initialPublication(h);
  const item = h.controller.issue('a'), requirements = item.work.requirements;
  const changed = { ...structuredClone(item.candidate), commit: 'c'.repeat(40) };
  setCandidate(item, changed, 'candidate-author');
  item.phase = 'blocked';
  item.error = 'Candidate correction needs another attempt.';
  h.provider.validate = async () => structuredClone(changed);
  h.store.send({ type: 'retry', issue: 'a' });
  await h.tick();
  assert.equal(item.work.requirements, requirements);
  assert.equal(item.maintenance, false);
  assert.equal(item.phase, 'implementing');
  assert.equal(publishedWorkUnchanged(item), false);
  await freshThreeSlotReview(h);
  assert.equal(item.pr.headRefOid, changed.commit);
  assert.equal(h.provider.creates, 1);
  assert.equal(h.provider.updates, 1);
});

test('pending publication of a changed candidate keeps its current quorum while the old PR is green', async (t) => {
  const h = await setup(t, { slots: 3, quorum: 3 });
  await initialPublication(h);
  const item = h.controller.issue('a'), oldHead = item.pr.headRefOid;
  const changed = { ...structuredClone(item.candidate), commit: 'c'.repeat(40) };
  setCandidate(item, changed, 'changed-author');
  const publish = h.provider.publish.bind(h.provider);
  h.provider.publish = async () => { throw new Error('update interrupted before push'); };
  await h.tick(); await h.cycle();
  assert.equal(item.publication.pending, true);
  assert.equal(item.pr.headRefOid, oldHead);
  assert.equal(item.votes.length, 3);
  h.store.release(); h.provider.publish = publish;
  const restarted = new BenchController(h.params);
  await restarted.initialize(true);
  assert.equal(restarted.issue('a').candidate.commit, changed.commit);
  assert.equal(restarted.issue('a').pr.headRefOid, oldHead);
  assert.equal(restarted.issue('a').phase, 'review');
  assert.equal(restarted.issue('a').deliveryPending, true);
  const generations = h.workers.packets.length;
  await restarted.tick();
  assert.equal(restarted.issue('a').pr.number, 1);
  assert.equal(restarted.issue('a').pr.headRefOid, changed.commit);
  assert.equal(h.workers.packets.length, generations);
  assert.equal(h.provider.creates, 1);
  assert.equal(h.provider.updates, 1);
});

test('genuinely unchanged maintenance retains its green fastpaths before dispatch and after validation', async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1, pollMs: 1 });
  await initialPublication(h);
  const item = h.controller.issue('a');
  item.phase = 'blocked'; item.maintenance = true;
  h.store.send({ type: 'retry', issue: 'a' });
  await h.tick();
  assert.equal(item.phase, 'published');
  assert.equal(h.workers.packets.length, 2);
  h.provider.observations.set('a', { ...item.pr, failed: true, stale: false,
    readiness: 'not-ready', observedAt: new Date(h.params.clock()).toISOString() });
  h.advance(10); await h.tick();
  const original = structuredClone(item.candidate);
  h.provider.validate = async () => structuredClone(original);
  h.provider.observations.set('a', { ...item.pr, failed: false, stale: false,
    readiness: 'ready', observedAt: new Date(h.params.clock()).toISOString() });
  await h.cycle();
  assert.equal(item.phase, 'published');
  assert.equal(item.deliveryPending, false);
  assert.equal(h.workers.packets.length, 3);
  assert.equal(h.provider.updates, 0);
});

test('retirement of an old PR retains outstanding revised work instead of merging the new requirement implicitly', async (t) => {
  const h = await setup(t, { slots: 1, quorum: 1, pollMs: 1 });
  await initialPublication(h);
  const item = h.controller.issue('a');
  h.store.send({ type: 'revise', issue: 'a', expectedRequirementsHash: digest(item.work.requirements), requirements: 'New pending scope' });
  h.controller.commands();
  h.provider.observations.set('a', { ...item.pr, state: 'MERGED', readiness: 'ready', observedAt: new Date(h.params.clock()).toISOString() });
  h.advance(10); await h.tick();
  assert.equal(item.phase, 'blocked');
  assert.equal(item.deliveryPending, true);
  assert.equal(item.pr.number, 1);
  assert.equal(item.pr.state, 'MERGED');
  assert.equal(item.reconciliation.reason, 'retired-pr-pending-work');
  assert.equal(h.provider.creates, 1);
});

async function publishedRetryWithUnrelatedOwner(t) {
  const h = await setup(t, { slots: 2, quorum: 1, pollMs: 10000000 });
  await initialPublication(h);
  const item = h.controller.issue('a');
  item.observation = { ...item.pr, failed: true, readiness: 'not-ready', observedAt: new Date(h.params.clock() - 1000).toISOString() };
  item.phase = 'blocked'; item.maintenance = true; item.error = 'Prior maintenance assessment failed.';
  admit(h.controller.state, work('b'));
  await h.tick();
  assert.equal(h.workers.active, 1);
  return h;
}

test('ordinary observation and diagnostic read rejections block only their issue before reservation and recover on retry', async (t) => {
  for (const failure of ['observation', 'diagnostics']) {
    const h = await publishedRetryWithUnrelatedOwner(t);
    const item = h.controller.issue('a'), previous = structuredClone(item.observation);
    const generations = h.controller.state.generations, attempts = item.attempts;
    const observe = h.provider.observe.bind(h.provider);
    const evidence = h.provider.failureEvidence.bind(h.provider);
    h.provider.observe = async (issue) => {
      if (issue.work.id === 'a') {
        if (failure === 'observation') throw new Error('observation read rejected');
        return { ...item.pr, failed: true, readiness: 'not-ready', observedAt: new Date(h.params.clock()).toISOString() };
      }
      return observe(issue);
    };
    h.provider.failureEvidence = async () => { throw new Error('diagnostic read rejected'); };
    h.advance(50);
    h.store.send({ type: 'retry', issue: 'a' });
    await h.tick();
    assert.equal(h.controller.state.status, 'running');
    assert.equal(item.phase, 'blocked');
    assert.deepEqual(item.observation, previous);
    assert.match(item.error, /read rejected/);
    assert.equal(item.observationError.at, new Date(h.params.clock()).toISOString());
    assert.equal(h.controller.state.generations, generations);
    assert.equal(item.attempts, attempts);
    assert.equal(h.workers.active, 1);
    assert.equal(h.controller.state.slots.filter(Boolean)[0].issue, 'b');
    h.provider.observe = failure === 'observation' ? observe : async () => ({
      ...item.pr, failed: true, readiness: 'not-ready', observedAt: new Date(h.params.clock()).toISOString(),
    });
    h.provider.failureEvidence = evidence;
    h.store.send({ type: 'retry', issue: 'a' });
    await h.tick();
    assert.equal(item.phase, failure === 'observation' ? 'published' : 'implementing');
    assert.equal(item.observationError, null);
    assert.equal(item.error, null);
    assert.equal(h.workers.active, failure === 'observation' ? 1 : 2);
    assert.equal(h.controller.state.generations, generations + (failure === 'observation' ? 0 : 1));
  }
});

test('maintenance read error containment preserves pause, stop, cancel and pause/resume generation fences', async (t) => {
  for (const failure of ['observation', 'diagnostics']) for (const control of ['pause', 'stop', 'cancel', 'pause-resume']) {
    const h = await publishedRetryWithUnrelatedOwner(t);
    const item = h.controller.issue('a'), previous = structuredClone(item.observation);
    const gate = deferred(), entered = deferred();
    const reject = async () => { entered.resolve(); await gate.promise; throw new Error('late ordinary read rejection'); };
    h.provider.observe = failure === 'observation' ? reject : async () => ({
      ...item.pr, failed: true, readiness: 'not-ready', observedAt: new Date(h.params.clock()).toISOString(),
    });
    if (failure === 'diagnostics') h.provider.failureEvidence = reject;
    const generations = h.controller.state.generations, attempts = item.attempts;
    h.store.send({ type: 'retry', issue: 'a' });
    const pending = h.controller.responsive(h.tick());
    try {
      await entered.promise;
      const id = h.store.send({ type: control === 'pause-resume' ? 'pause' : control, issue: 'a' });
      await eventually(() => h.controller.state.commands[id]?.status === 'accepted');
      if (control === 'pause-resume') {
        const resume = h.store.send({ type: 'resume' });
        await eventually(() => h.controller.state.commands[resume]?.status === 'accepted');
      }
    } finally { gate.resolve(); await pending; }
    assert.equal(item.phase, control === 'cancel' ? 'cancelled' : 'correction');
    assert.deepEqual(item.observation, previous);
    assert.equal(item.error, null);
    assert.equal(item.attempts, attempts);
    assert.equal(h.controller.state.generations, generations);
    assert.equal(h.workers.active, control === 'stop' ? 0 : 1);
    assert.equal(h.controller.state.status, control === 'stop' ? 'stopped' : control === 'pause' ? 'paused' : 'running');
  }
});

test('uncertain maintenance process termination remains global uncertainty, not an ordinary issue read failure', async (t) => {
  const h = await publishedRetryWithUnrelatedOwner(t);
  const item = h.controller.issue('a'), previous = structuredClone(item.observation);
  h.provider.observe = async () => {
    h.controller.state.operation = { pid: 900000001, stage: 'uncertain', command: 'synthetic-owned-read' };
    throw Object.assign(new Error('owned process release unproven'), { uncertainTermination: true });
  };
  const attempts = item.attempts, generations = h.controller.state.generations;
  h.store.send({ type: 'retry', issue: 'a' });
  await assert.rejects(h.tick(), /release unproven/);
  assert.equal(h.controller.state.status, 'uncertain');
  assert.deepEqual(item.observation, previous);
  assert.equal(item.phase, 'correction');
  assert.equal(item.attempts, attempts);
  assert.equal(h.controller.state.generations, generations);
  await h.controller.cancelAll();
  assert.equal(h.controller.state.status, 'uncertain');
  assert.equal(h.controller.state.operation.stage, 'uncertain');
});
