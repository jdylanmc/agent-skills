import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { transact } from '../scripts/state.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
function store(t) {
  const base = path.join(root, '.test-sandbox');
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(path.join(base, 'pm-state-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'board.json');
}
const config = {
  id: 'activation-a', repository: 'forge/org/repo', commonDir: '/repo/.git',
  cwd: '/repo/worktree', projectId: 'project-a', workspaceId: 'workspace-a',
  humanOrigin: 'human-conversation/decision', anchor: 'selected-epic',
  setupEvidence: 'setup/readback', authority: 'human/recurring-grant',
  capabilities: 'runtime/access-evidence', mapping: 'runtime/verified-binding',
  retirement: 'runtime/no-workspace-archive', merge: 'human',
};

test('heartbeat activation requires explicit consent and an actual bound PM agent; unknown modes fail closed', t => {
  for (const change of [
    { wakeupMode: 'unknown' },
    { wakeupMode: 'heartbeat', pmAgentId: 'pm-agent' },
    { wakeupMode: 'heartbeat', wakeupConsent: 'human/choice' },
    { wakeupMode: 'fresh', pmAgentId: 'pm-agent', wakeupConsent: 'human/choice' },
  ]) {
    assert.throws(() => transact(store(t), { op: 'init', config: { ...config, ...change } }),
      /wakeup|consent|PM agent/i);
  }
  const filename = store(t);
  const heartbeat = { ...config, wakeupMode: 'heartbeat', pmAgentId: 'pm-agent', wakeupConsent: 'human/choice' };
  assert.equal(transact(filename, { op: 'init', config: heartbeat }).state.pm.config.wakeupMode, 'heartbeat');
  assert.equal(transact(filename, { op: 'init', config: heartbeat }).status, 'existing');
  assert.throws(() => transact(filename, { op: 'init', config }), /different/);
});

test('initialization preserves one repository activation and defaults to six delivery slots', t => {
  const filename = store(t);
  const result = transact(filename, { op: 'init', config });
  assert.equal(result.status, 'initialized');
  assert.equal(result.state.pm.config.capacity, 6);
  assert.equal(result.state.pm.mode, 'paused');
  assert.equal(JSON.parse(readFileSync(filename)).pm.config.repository, 'forge/org/repo');
  assert.equal(transact(filename, { op: 'init', config }).status, 'existing');
  assert.throws(() => transact(filename, { op: 'init', config: { ...config, id: 'other' } }), /different/);
});

function reserve(filename, lease, key, kind = 'delivery', coverage = [key]) {
  return owned(filename, lease, { op: 'reserve', worker: { key, kind, coverage, packet: `packets/${key}` } });
}

test('six delivery reservations include unconfirmed launches and survive successive ticks', t => {
  const filename = enabled(t);
  let lease = claim(filename).state.pm.lease;
  for (let i = 0; i < 6; i++) reserve(filename, lease, `ticket-${i}`);
  assert.equal(reserve(filename, lease, 'ticket-0').status, 'reused');
  assert.throws(() => reserve(filename, lease, 'overlap', 'delivery', ['ticket-0']), /coverage/);
  owned(filename, lease, { op: 'release', result: 'pass/one', duties: 'six pending launch receipts' });
  lease = claim(filename, 'next').state.pm.lease;
  assert.throws(() => reserve(filename, lease, 'ticket-6'), /capacity/);
  reserve(filename, lease, 'research', 'research');
});

test('Discovery conversation reservation persists while waiting for alignment, separately per repository', t => {
  const filename = enabled(t);
  let lease = claim(filename).state.pm.lease;
  reserve(filename, lease, 'discovery', 'discovery');
  owned(filename, lease, { op: 'record', key: 'discovery/wait', status: 'blocked', evidence: 'human/alignment-pending' });
  owned(filename, lease, { op: 'release', result: 'pass/wait', duties: 'keep human conversation' });
  lease = claim(filename, 'next').state.pm.lease;
  assert.throws(() => reserve(filename, lease, 'interviewer-2', 'discovery'), /Discovery/);
  const other = store(t);
  const otherConfig = { ...config, repository: 'forge/org/another-repo',
    commonDir: '/other/.git', cwd: '/other/worktree', projectId: 'other-project', workspaceId: 'other-workspace' };
  transact(other, { op: 'init', config: otherConfig });
  transact(other, { op: 'resume', human: 'other/repo', schedule: {
    id: 'other-schedule', cron: '* * * * *', cwd: otherConfig.cwd, projectId: otherConfig.projectId,
    workspaceId: otherConfig.workspaceId, enabled: true, evidence: 'readback', observation: 'actual',
  } });
  assert.equal(reserve(other, claim(other).state.pm.lease, 'other-discovery', 'discovery').status, 'reserved');
});

test('cancelled or idle observations do not free capacity; accepted live reconciliation does', t => {
  const filename = enabled(t);
  const lease = claim(filename).state.pm.lease;
  reserve(filename, lease, 'work');
  owned(filename, lease, { op: 'bind', key: 'work', agentId: 'agent-a', evidence: 'worker/first-observation' });
  assert.throws(() => owned(filename, lease, { op: 'bind', key: 'work', agentId: 'agent-b', evidence: 'new' }), /bound/);
  owned(filename, lease, { op: 'record', key: 'work/status', status: 'observed', evidence: 'runtime/cancelled' });
  assert.throws(() => owned(filename, lease, { op: 'settle', key: 'work', result: 'partial' }), /live/);
  assert.equal(transact(filename, { op: 'inspect' }).state.pm.workers[0].settled, false);
  owned(filename, lease, { op: 'settle', key: 'work', noLiveWriters: true, noUntransferredDuties: true,
    evidence: 'runtime/children-and-partial-work-reconciled', result: 'artifacts/complete',
    acceptance: 'receiver/accepted' });
  const state = owned(filename, lease, { op: 'archive', key: 'work', evidence: 'runtime/verified-agent-archived' }).state;
  assert.equal(state.pm.workers[0].settled, true);
  assert.equal(state.pm.workers[0].return.result, 'artifacts/complete');
  assert.equal(state.pm.workers[0].archive, 'runtime/verified-agent-archived');
});

test('unsettled agents cannot be archived and human-waiting Discovery cannot be settled', t => {
  const filename = enabled(t);
  const lease = claim(filename).state.pm.lease;
  reserve(filename, lease, 'discovery', 'discovery');
  assert.throws(() => owned(filename, lease, { op: 'archive', key: 'discovery', evidence: 'idle' }), /settled/);
  assert.throws(() => owned(filename, lease, { op: 'settle', key: 'discovery',
    noLiveWriters: true, noUntransferredDuties: true, result: 'recap', acceptance: 'received', evidence: 'idle' }), /Discovery/);
});

test('pending operations survive releases; accepted results need actual receiver evidence', t => {
  const filename = enabled(t);
  const lease = claim(filename).state.pm.lease;
  owned(filename, lease, { op: 'record', key: 'episode/1', status: 'pending', evidence: 'request/uncertain' });
  assert.throws(() => owned(filename, lease, { op: 'record', key: 'episode/1', status: 'accepted', evidence: 'sent' }), /receiver/);
  owned(filename, lease, { op: 'release', result: 'pass/pending', duties: 'reconcile episode/1; do not retry' });
  assert.deepEqual(transact(filename, { op: 'inspect' }).state.pm.pending, [
    { key: 'episode/1', status: 'pending', evidence: 'request/uncertain' },
  ]);
});

function enabled(t) {
  const filename = store(t);
  transact(filename, { op: 'init', config });
  transact(filename, { op: 'resume', human: 'decision/resume', schedule: {
    id: 'schedule-a', cron: '* * * * *', cwd: config.cwd,
    projectId: config.projectId, workspaceId: config.workspaceId,
    enabled: true, evidence: 'schedule/readback', observation: 'actual/first-observation',
  } });
  return filename;
}
function claim(filename, owner = 'run-a') {
  return transact(filename, { op: 'claim', owner, reconciliation: 'live/repo-owner-reconciled' });
}
function owned(filename, lease, request) {
  return transact(filename, { ...request, owner: lease.owner, token: lease.token });
}

const heartbeatConfig = { ...config, wakeupMode: 'heartbeat',
  wakeupConsent: 'human/explicit-same-agent-choice', pmAgentId: 'pm-agent' };
const heartbeatJob = { id: 'heartbeat-a', kind: 'heartbeat', targetAgentId: 'pm-agent',
  cron: '* * * * *', cwd: config.cwd, projectId: config.projectId, workspaceId: config.workspaceId,
  enabled: true, settings: 'approved/exact-prompt-timezone-lifetime-settings',
  evidence: 'heartbeat/stored-readback', observation: 'actual/initial-observation' };
function heartbeatEnabled(t) {
  const filename = store(t);
  transact(filename, { op: 'init', config: heartbeatConfig });
  transact(filename, { op: 'resume', human: 'human/activate', schedule: heartbeatJob });
  return filename;
}

test('heartbeat readback must prove job kind, bound target, cadence and exact existing workspace', t => {
  const filename = store(t);
  transact(filename, { op: 'init', config: heartbeatConfig });
  for (const change of [
    { kind: undefined }, { kind: 'schedule' }, { targetAgentId: 'bootstrap-agent' },
    { targetAgentId: undefined }, { cron: '*/2 * * * *' }, { cwd: '/other' },
    { projectId: 'other' }, { workspaceId: 'other' }, { enabled: false }, { settings: '' },
  ]) {
    assert.throws(() => transact(filename, { op: 'resume', human: 'human/activate',
      schedule: { ...heartbeatJob, ...change } }), /binding|settings/);
  }
  assert.equal(transact(filename, { op: 'inspect' }).state.pm.mode, 'paused');
  const fresh = enabled(t);
  assert.throws(() => transact(fresh, { op: 'resume', human: 'human/unapproved-fallback',
    schedule: { ...heartbeatJob, id: 'schedule-a' } }), /binding/);
});

test('same heartbeat PM agent owns multiple fenced passes without replacing agents or durable lanes', t => {
  const filename = heartbeatEnabled(t);
  assert.throws(() => claim(filename, 'fresh-or-bootstrap-agent'), /bound PM agent/);
  const first = claim(filename, 'pm-agent').state.pm.lease;
  reserve(filename, first, 'delivery');
  reserve(filename, first, 'discovery', 'discovery');
  owned(filename, first, { op: 'bind', key: 'delivery', agentId: 'delivery-agent', evidence: 'actual/worker' });
  owned(filename, first, { op: 'bind', key: 'discovery', agentId: 'discovery-agent', evidence: 'actual/conversation' });
  assert.equal(claim(filename, 'pm-agent').status, 'busy');
  owned(filename, first, { op: 'release', result: 'pass/one', duties: 'idle for own heartbeat; retain workers' });
  const second = claim(filename, 'pm-agent').state.pm.lease;
  assert.notEqual(second.token, first.token);
  assert.equal(second.owner, first.owner);
  assert.throws(() => reserve(filename, first, 'stale'), /lease/);
  assert.equal(reserve(filename, second, 'delivery').status, 'reused');
  assert.equal(reserve(filename, second, 'discovery', 'discovery').status, 'reused');
  const pm = owned(filename, second, { op: 'release', result: 'pass/two', duties: 'same ongoing wakeup duty' }).state.pm;
  assert.deepEqual(pm.workers.map(worker => worker.agentId), ['delivery-agent', 'discovery-agent']);
  assert.deepEqual(pm.runs.map(run => run.owner), ['pm-agent', 'pm-agent']);
  assert.equal(pm.schedule.id, 'heartbeat-a');
  assert.equal(pm.lease, null);
});

test('persisted forged heartbeat target or lease owner fails closed', t => {
  for (const forge of [
    state => { state.pm.schedule.targetAgentId = 'reviewer'; },
    state => { state.pm.lease.owner = 'fresh-agent'; },
    state => { state.pm.config.wakeupMode = 'unknown'; },
  ]) {
    const filename = heartbeatEnabled(t);
    claim(filename, 'pm-agent');
    const state = JSON.parse(readFileSync(filename));
    forge(state);
    writeFileSync(filename, JSON.stringify(state));
    assert.throws(() => transact(filename, { op: 'inspect' }), /binding|PM agent|wakeup/);
  }
});

const replacement = { oldId: 'heartbeat-a', human: 'human/explicit-recreate',
  absence: 'runtime/complete-old-owned-job-absence', reconciliation: 'live/children-scope-settings-target-preserved' };

test('heartbeat pause or stop gates before deletion and reconciled human recreation preserves custody and fencing', t => {
  for (const op of ['pause', 'stop']) {
    const filename = heartbeatEnabled(t);
    const oldLease = claim(filename, 'pm-agent').state.pm.lease;
    reserve(filename, oldLease, 'delivery');
    reserve(filename, oldLease, 'discovery', 'discovery');
    owned(filename, oldLease, { op: 'record', key: 'uncertain', status: 'pending', evidence: 'issued/before-pause' });
    const prior = transact(filename, { op, human: `human/${op}`, disposition: 'retain owned children' }).state.pm;
    assert.equal(claim(filename, 'pm-agent').status, op === 'pause' ? 'paused' : 'stopped');
    assert.throws(() => reserve(filename, oldLease, 'new'), /not enabled/);
    const request = { op: 'resume', human: 'human/resume', replacement,
      schedule: { ...heartbeatJob, id: 'heartbeat-b', observation: 'actual/resume-observation' } };
    assert.throws(() => transact(filename, request), /lease/);
    owned(filename, oldLease, { op: 'release', result: 'pass/paused', duties: 'retain workers; idle until human resumes' });
    const resumed = transact(filename, request).state.pm;
    assert.equal(resumed.mode, 'enabled');
    assert.deepEqual(resumed.config, prior.config);
    assert.deepEqual(resumed.workers, prior.workers);
    assert.deepEqual(resumed.pending, prior.pending);
    assert.deepEqual(resumed.wakeupHistory, [{ job: heartbeatJob, replacement }]);
    const newLease = claim(filename, 'pm-agent').state.pm.lease;
    assert.notEqual(newLease.token, oldLease.token);
    assert.throws(() => reserve(filename, oldLease, 'stale'), /lease/);
    assert.equal(reserve(filename, newLease, 'delivery').status, 'reused');
  }
});

test('heartbeat replacement rejects unproved absence, human consent, wrong old ID, settings changes and tick resume', t => {
  const filename = heartbeatEnabled(t);
  const request = { op: 'resume', human: 'human/resume', replacement,
    schedule: { ...heartbeatJob, id: 'heartbeat-b' } };
  assert.throws(() => transact(filename, request), /paused|stopped/);
  transact(filename, { op: 'pause', human: 'human/pause', disposition: 'retain children' });
  for (const change of [
    { replacement: undefined }, { human: '' }, { replacement: { ...replacement, human: '' } },
    { replacement: { ...replacement, absence: '' } }, { replacement: { ...replacement, reconciliation: '' } },
    { replacement: { ...replacement, oldId: 'someone-elses-heartbeat' } },
    { schedule: { ...heartbeatJob, id: 'heartbeat-b', settings: 'changed/settings' } },
    { schedule: { ...heartbeatJob, id: 'heartbeat-b', targetAgentId: 'new-agent' } },
    { schedule: heartbeatJob },
  ]) {
    assert.throws(() => transact(filename, { ...request, ...change }),
      /replacement|human|absence|reconciliation|settings|binding/);
    assert.equal(transact(filename, { op: 'inspect' }).state.pm.mode, 'paused');
  }
  assert.throws(() => transact(filename, { op: 'resume', human: 'human', schedule: heartbeatJob }), /replacement/);
  const fresh = enabled(t);
  const schedule = transact(fresh, { op: 'inspect' }).state.pm.schedule;
  transact(fresh, { op: 'pause', human: 'human/pause', disposition: 'retain' });
  assert.throws(() => transact(fresh, { ...request, replacement: { ...replacement, oldId: 'schedule-a' },
    schedule: { ...schedule, id: 'schedule-b' } }), /Different schedule/);
  assert.equal(transact(fresh, { op: 'resume', human: 'human/resume', schedule }).status, 'enabled');
});

test('explicit fresh mode retains distinct run owners and rejects a forged job kind without fallback', t => {
  const filename = store(t);
  transact(filename, { op: 'init', config: { ...config, wakeupMode: 'fresh', wakeupConsent: 'human/fresh-choice' } });
  const schedule = { ...heartbeatJob, id: 'schedule-a', kind: 'schedule', targetAgentId: undefined };
  for (const kind of ['unknown', 'heartbeat']) {
    assert.throws(() => transact(filename, { op: 'resume', human: 'human', schedule: { ...schedule, kind } }), /binding/);
  }
  transact(filename, { op: 'resume', human: 'human', schedule });
  const first = claim(filename, 'fresh-a').state.pm.lease;
  owned(filename, first, { op: 'release', result: 'first/receipt', duties: 'accepted terminal fresh parent' });
  assert.equal(claim(filename, 'fresh-b').status, 'claimed');
});

test('heartbeat recovery fences a stuck pass before human recreation without resetting its pending work', t => {
  const filename = heartbeatEnabled(t);
  const lease = claim(filename, 'pm-agent').state.pm.lease;
  reserve(filename, lease, 'unfinished');
  transact(filename, { op: 'stop', human: 'human/stop', disposition: 'retain unfinished child' });
  transact(filename, { op: 'recover', token: lease.token, human: 'human/recover',
    fencing: 'runtime/old-turn-cannot-act', reconciliation: 'child-and-partial-work-retained' });
  const state = transact(filename, { op: 'resume', human: 'human/resume', replacement,
    schedule: { ...heartbeatJob, id: 'heartbeat-b' } }).state.pm;
  assert.equal(state.workers[0].key, 'unfinished');
  assert.equal(state.workers[0].settled, false);
  assert.equal(state.runs[0].token, lease.token);
  const next = claim(filename, 'pm-agent').state.pm.lease;
  assert.notEqual(next.token, lease.token);
  assert.throws(() => owned(filename, lease, { op: 'release', result: 'stale', duties: 'none' }), /lease/);
});

test('busy passes cannot overlap and released tokens cannot write again', t => {
  const filename = enabled(t);
  const lease = claim(filename).state.pm.lease;
  assert.equal(claim(filename, 'run-b').status, 'busy');
  owned(filename, lease, { op: 'release', result: 'receipt/a', duties: 'none; accepted results preserved' });
  assert.equal(claim(filename, 'run-b').status, 'claimed');
  assert.throws(() => owned(filename, lease, { op: 'release', result: 'old', duties: 'none' }), /lease/);
});

test('separate CLI processes compete for the same atomic repository claim', async t => {
  const filename = enabled(t);
  const script = fileURLToPath(new URL('../scripts/state.mjs', import.meta.url));
  function run(owner) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, filename, JSON.stringify({
        op: 'claim', owner, reconciliation: 'live/reconciled',
      })]);
      let output = '';
      let errors = '';
      child.stdout.on('data', data => output += data);
      child.stderr.on('data', data => errors += data);
      child.on('error', reject);
      child.on('close', code => resolve(code === 0 ? JSON.parse(output).status : errors));
    });
  }
  const results = await Promise.all([run('run-a'), run('run-b')]);
  assert.equal(results.filter(result => result === 'claimed').length, 1);
  assert.ok(results.some(result => result === 'busy' || result.includes('EEXIST')));
});

test('stale ownership never expires and only explicit fenced recovery releases it', t => {
  const filename = enabled(t);
  const lease = claim(filename).state.pm.lease;
  assert.equal(claim(filename, 'tomorrow').status, 'busy');
  assert.throws(() => transact(filename, { op: 'recover', token: lease.token }), /human/);
  transact(filename, { op: 'recover', token: lease.token, human: 'decision/recover',
    fencing: 'runtime/old-owner-confirmed-stopped', reconciliation: 'children/partial-work-transferred' });
  assert.throws(() => owned(filename, lease, { op: 'release', result: 'late', duties: 'none' }), /lease/);
  assert.equal(claim(filename, 'next').status, 'claimed');
});

test('human pause and stop block new claims without releasing existing custody', t => {
  const filename = enabled(t);
  const lease = claim(filename).state.pm.lease;
  for (const op of ['pause', 'stop']) {
    transact(filename, { op, human: `decision/${op}`, disposition: 'workers retain scoped custody' });
    assert.equal(claim(filename, 'next').status, op === 'pause' ? 'paused' : 'stopped');
    assert.equal(transact(filename, { op: 'inspect' }).state.pm.lease.token, lease.token);
  }
  assert.throws(() => transact(filename, { op: 'resume' }), /human/);
  owned(filename, lease, { op: 'release', result: 'preserved/partial', duties: 'existing owners retained' });
});

test('unknown or malformed persisted state fails closed without discarding the owner board', t => {
  const filename = enabled(t);
  const state = JSON.parse(readFileSync(filename));
  state.pm.workers = [{ key: 'unknown-live-owner', settled: 'yes' }];
  writeFileSync(filename, JSON.stringify(state));
  assert.throws(() => claim(filename), /Invalid/);
  assert.equal(JSON.parse(readFileSync(filename)).pm.workers[0].key, 'unknown-live-owner');
});

test('missing capability evidence and automated merge modes block initialization', t => {
  for (const field of ['humanOrigin', 'setupEvidence', 'capabilities', 'mapping', 'retirement']) {
    const filename = store(t);
    assert.throws(() => transact(filename, { op: 'init', config: { ...config, [field]: '' } }), new RegExp(field));
  }
  assert.throws(() => transact(store(t), { op: 'init', config: { ...config, merge: 'automatic' } }), /unsupported/);
  assert.throws(() => transact(store(t), { op: 'init', config: { ...config, capacity: 0 } }), /capacity/);
});

test('resume rejects wrong cadence, mapping, observed state and replacement schedule identity', t => {
  const filename = enabled(t);
  const schedule = transact(filename, { op: 'inspect' }).state.pm.schedule;
  for (const change of [{ cron: '*/5 * * * *' }, { workspaceId: 'other' }, { enabled: false }]) {
    assert.throws(() => transact(filename, { op: 'resume', human: 'human', schedule: { ...schedule, ...change } }), /binding/);
  }
  assert.throws(() => transact(filename, { op: 'resume', human: 'human', schedule: { ...schedule, id: 'new' } }), /Different schedule/);
});

test('paused old owners preserve returns but cannot reserve new work', t => {
  const filename = enabled(t);
  const lease = claim(filename).state.pm.lease;
  transact(filename, { op: 'pause', human: 'pause/decision', disposition: 'keep existing workers' });
  assert.throws(() => reserve(filename, lease, 'new'), /not enabled/);
  assert.equal(owned(filename, lease, { op: 'record', key: 'return', status: 'accepted',
    evidence: 'artifact', receiver: 'actual/receiver' }).status, 'recorded');
});

test('existing board fields survive and abandoned transaction artifacts never trigger takeover', t => {
  const filename = store(t);
  writeFileSync(filename, JSON.stringify({ objectiveStart: 'original-clock', recovery: { episode: 'one' } }));
  transact(filename, { op: 'init', config });
  assert.deepEqual(transact(filename, { op: 'inspect' }).state.recovery, { episode: 'one' });
  mkdirSync(`${filename}.write-lock`);
  assert.throws(() => transact(filename, { op: 'init', config }), /EEXIST/);
  rmSync(`${filename}.write-lock`, { recursive: true });
  writeFileSync(`${filename}.next`, 'preserved-partial-state');
  assert.throws(() => transact(filename, { op: 'init', config }), /EEXIST/);
  assert.equal(readFileSync(`${filename}.next`, 'utf8'), 'preserved-partial-state');
  assert.equal(transact(filename, { op: 'inspect' }).state.objectiveStart, 'original-clock');
});

test('state helper rejects board symlinks rather than replacing their targets', t => {
  const filename = store(t);
  const target = `${filename}.target`;
  writeFileSync(target, '{}');
  symlinkSync(target, filename);
  assert.throws(() => transact(filename, { op: 'init', config }), /regular file/);
  assert.equal(readFileSync(target, 'utf8'), '{}');
});

test('updated operation outcomes preserve pending evidence and do not retain stale receiver claims', t => {
  const filename = enabled(t);
  const lease = claim(filename).state.pm.lease;
  owned(filename, lease, { op: 'record', key: 'episode/1', status: 'pending', evidence: 'uncertain/create' });
  owned(filename, lease, { op: 'record', key: 'episode/1', status: 'accepted',
    evidence: 'actual/readback', receiver: 'owner/observed' });
  const record = owned(filename, lease, { op: 'record', key: 'episode/1', status: 'blocked',
    evidence: 'new/target-invalidates-return' }).state.pm.pending[0];
  assert.equal(record.receiver, undefined);
  assert.deepEqual(record.history, [
    { status: 'pending', evidence: 'uncertain/create' },
    { status: 'accepted', evidence: 'actual/readback', receiver: 'owner/observed' },
  ]);
});

test('CLI failures produce no success envelope and leave the board unchanged', t => {
  const filename = enabled(t);
  const before = readFileSync(filename, 'utf8');
  const script = fileURLToPath(new URL('../scripts/state.mjs', import.meta.url));
  for (const request of ['{', '{"op":"unsupported"}']) {
    const child = spawnSync(process.execPath, [script, filename, request], { encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.ok(child.stderr.trim());
    assert.equal(readFileSync(filename, 'utf8'), before);
  }
});
