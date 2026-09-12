import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { BenchController, formatStatus } from './_molecules/bench-control/bench-control.mjs';
import { Store, readJSON } from './_atoms/fleet-state/fleet-state.mjs';
import { admit, digest, reviewedBasis } from './_atoms/bench-epoch/bench-epoch.mjs';
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
  publicationMatches(issue, pr) { return pr.headRefOid === issue.candidate.commit; }
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
}
async function setup(t, overrides = {}) {
  const directory = path.join(root, '..', '..', '.test-sandbox', `bench-sdk-controller-${randomUUID()}`);
  const store = new Store(directory);
  const config = { run: 'run', checkout: root, repository: 'owner/repo', base: 'main', lifetimeMs: 100000,
    runtimeDirectory: path.resolve(root, '../../.skill-log/bench-sdk-runtime'),
    maxAssignments: 100, models: { implement: 'impl', review: 'reviewer' }, doctrine: { implement: ['code'], review: ['testing'] }, ...overrides };
  const workers = new Workers(), provider = new Provider(), reports = [];
  let now = 1000000;
  const params = { config, store, provider, workers, clock: () => now,
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
