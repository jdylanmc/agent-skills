#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { admit, identifier, reviewedBasis, setCandidate, recordReview, recordImplementationResult, reviseRequirements,
  hasQuorum, dependenciesReady, digest } from '../../_atoms/bench-epoch/bench-epoch.mjs';
import { Store, readJSON, atomicJSON, processAlive } from '../../_atoms/fleet-state/fleet-state.mjs';
import { GitHubDelivery, command as runCommand } from '../../_atoms/atomic-proposal/atomic-proposal.mjs';
import { SDKWorkers, loadDoctrine } from '../../_atoms/role-doctrine/role-doctrine.mjs';
import { runtimeDirectory, loadSDK } from '../../_atoms/role-doctrine/role-doctrine.runtime.mjs';
import { ownerReleased } from '../../_atoms/fleet-state/fleet-state.process.mjs';

export function configuration(input) {
  const config = { slots: 5, quorum: 3, assignmentMs: 600000, commandMs: 120000,
    reportMs: 60000, pollMs: 60000, maxIssueAttempts: 6, ...input };
  identifier(config.run);
  if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository ?? '') ||
    !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(config.base ?? '')) throw new Error('provide a GitHub owner/repo and base branch');
  if (!Number.isSafeInteger(config.slots) || config.slots < 1 || config.slots > 32 ||
    !Number.isSafeInteger(config.quorum) || config.quorum < 1 || config.quorum > config.slots) throw new Error('invalid capacity or quorum');
  for (const key of ['lifetimeMs', 'maxAssignments', 'assignmentMs', 'commandMs', 'reportMs', 'pollMs', 'maxIssueAttempts']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`positive finite ${key} required`);
  }
  for (const role of ['implement', 'review']) {
    if (typeof config.models?.[role] !== 'string' || !config.models[role].trim() ||
      !Array.isArray(config.doctrine?.[role]) || !config.doctrine[role].length) throw new Error(`explicit model and doctrine for ${role} required`);
  }
  if (!path.isAbsolute(config.checkout ?? '')) throw new Error('checkout must be absolute');
  runtimeDirectory(config.runtimeDirectory);
  return config;
}

function readiness(issue) {
  if (issue.phase !== 'published' || issue.observationError ||
    !issue.observation || issue.observation.headRefOid !== issue.pr?.headRefOid) return 'unknown';
  return issue.observation.readiness;
}
function observation(issue) {
  if (!issue.observation) return null;
  return Object.fromEntries(['observedAt', 'readiness', 'state', 'headRefOid', 'failed', 'stale', 'ciEvidence']
    .filter((key) => issue.observation[key] !== undefined).map((key) => [key, issue.observation[key]]));
}

class ControlInterrupted extends Error {}

export function formatStatus(snapshot) {
  const counts = snapshot.counts ?? {};
  const status = snapshot.status ?? snapshot.persistedStatus;
  const lines = [
    `Bench controller ${snapshot.run ?? '(not started)'} — ${status}${snapshot.draining ? ' (draining)' : ''} — ${snapshot.at ?? snapshot.controllerObservedAt ?? ''}`,
    `Slots ${snapshot.active?.length ?? 0}/${snapshot.capacity ?? '?'} reserved; assignments ${snapshot.generations ?? 0}. ` +
      Object.entries(counts).map(([phase, count]) => `${phase}: ${count}`).join(', '),
  ];
  if (snapshot.controllerAlive === false) lines.push('Controller not observed alive; stored observations are not current execution proof.');
  if (snapshot.activity) lines.push(`Awaiting ${snapshot.activity.name}${snapshot.activity.issue ? ` for ${snapshot.activity.issue}` : ''} since ${new Date(snapshot.activity.startedAt).toISOString()}${snapshot.activity.interrupted ? ' (interrupted; draining)' : ''}.`);
  for (const item of (snapshot.work ?? []).slice(0, 8)) {
    lines.push(`- ${item.id}: ${item.phase}; ${item.readiness ?? 'unknown'}` +
      `${item.observation?.observedAt ? ` (observed ${item.observation.observedAt})` : ' (not observed)'}` +
      `${item.pr ? `; ${item.pr}` : ''}${item.error ? `; ${String(item.error).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, 240)}` : ''}`);
  }
  const omitted = (snapshot.omitted ?? 0) + Math.max(0, (snapshot.work?.length ?? 0) - 8);
  if (omitted) lines.push(`${omitted} more items; use status --json for machine details.`);
  return lines.join('\n');
}

export class BenchController {
  constructor({ config, store, provider, workers, clock = Date.now, doctrine = loadDoctrine,
    report = (snapshot) => console.log(formatStatus(snapshot)), ownershipReleased = ownerReleased }) {
    this.config = configuration(config);
    this.store = store;
    this.provider = provider;
    this.workers = workers;
    this.clock = clock;
    this.doctrine = doctrine;
    this.report = report;
    this.ownershipReleased = ownershipReleased;
    this.handles = new Map();
    this.completed = [];
    this.cancelling = new Set();
    this.controlErrors = [];
    this.checkedMaintenance = new Set();
    this.provider.guard = (issue) => this.guard(issue);
  }
  save() { this.store.save(this.state); }
  async initialize(recover = false) {
    this.store.acquire(recover);
    this.state = this.store.load() ?? { version: 1, config: this.config, createdAt: this.clock(),
      status: 'running', issues: [], slots: Array(this.config.slots).fill(null), generations: 0,
      commands: {}, lastReport: 0, lastPoll: 0 };
    if (this.state.version !== 1 || digest(this.state.config) !== digest(this.config)) throw new Error('persisted run/config mismatch; do not change a running contract');
    if (this.state.operation) {
      if (!this.state.operation.pid || !await this.ownershipReleased(this.state.operation.ownership ??
        { kind: 'posix-group', pid: this.state.operation.pid })) {
        this.state.status = 'uncertain'; this.save();
        throw new Error('prior provider/validation process termination is uncertain');
      }
      this.state.operation = null;
    }
    for (let slot = 0; slot < this.state.slots.length; slot++) {
      const owner = this.state.slots[slot];
      if (!owner) continue;
      if (owner.stage === 'spawning' && !owner.pid || owner.pid &&
        !await this.ownershipReleased(owner.ownership ?? { kind: 'posix-group', pid: owner.pid })) {
        this.state.status = 'uncertain';
        this.save();
        throw new Error(`slot ${slot} termination uncertain; owned tree ${owner.ownership?.job ?? owner.pid ?? 'unknown'} must be resolved before restart`);
      }
      const issue = this.issue(owner.issue);
      if (issue && !['cancelled', 'merged', 'closed', 'blocked'].includes(issue.phase) && !issue.reconciliation?.required) {
        issue.phase = owner.role === 'review' && issue.candidate ? 'review' : 'correction';
        issue.findings.push('Prior assignment interrupted; inspect current files and reconstruct missing evidence.');
      }
      this.state.slots[slot] = null;
    }
    this.state.controlEpoch ??= 0;
    this.state.activity = null;
    this.state.status = 'running';
    this.servicing = true;
    this.save();
    try { await this.prepareProvider(); }
    catch (error) { if (!(error instanceof ControlInterrupted)) throw error; }
  }
  async prepareProvider() {
    await this.providerOperation('provider preflight', null, () => this.provider.preflight());
    for (const issue of this.state.issues.filter((i) => i.publication?.pending && !i.reconciliation?.required && !i.blockerEvidence &&
      !['merged', 'closed', 'cancelled'].includes(i.phase))) {
      const pr = await this.providerOperation('publication reconciliation', issue, () => this.provider.find(issue));
      if (pr) {
        if (pr.state !== 'OPEN' || this.provider.publicationMatches(issue, pr)) this.published(issue, pr);
        else if ([issue.candidate?.commit, issue.pr?.headRefOid].includes(pr.headRefOid)) {
          issue.phase = 'review';
          issue.error = 'Pending publication needs branch/evidence update; retain quorum and reconcile the same PR';
        } else {
          this.blockExternalHead(issue, { ...pr, observedAt: new Date(this.clock()).toISOString() });
        }
      } else issue.phase = 'review';
    }
    this.prepared = true;
    this.save();
  }
  issue(id) { return this.state.issues.find((i) => i.work.id === id); }
  async providerOperation(name, issue, action) {
    if (this.state.activity) throw new Error('another provider operation is still pending');
    this.guard(issue);
    const activity = { name, issue: issue?.work.id ?? null, issueEpoch: issue?.epoch,
      controlEpoch: this.state.controlEpoch, startedAt: this.clock() };
    this.state.activity = activity;
    this.save();
    try {
      const result = await action();
      this.guard(issue);
      return result;
    } finally { this.state.activity = null; this.save(); }
  }
  async responsive(operation) {
    let settled = false, failure, pulseFailure, value;
    const completion = Promise.resolve(operation).then(
      (result) => { value = result; settled = true; },
      (error) => { failure = error; settled = true; });
    // Pump only control/report work; never start a second delivery cycle.
    while (!settled) {
      if (this.servicing && !pulseFailure) {
        try { this.pulse(); }
        catch (error) {
          pulseFailure = error;
          this.state.status = 'stopped'; this.state.controlEpoch++;
        }
      }
      let timer;
      await Promise.race([completion, new Promise((resolve) => { timer = setTimeout(resolve, 250); })]);
      clearTimeout(timer);
    }
    if (pulseFailure || failure) throw pulseFailure ?? failure;
    return value;
  }
  pulse() {
    this.commands();
    let changed = false;
    if (this.clock() >= this.state.createdAt + this.config.lifetimeMs &&
      !['exhausted', 'uncertain'].includes(this.state.status)) {
      this.state.status = 'exhausted'; this.state.controlEpoch++; changed = true;
    }
    for (const error of this.controlErrors.splice(0)) {
      this.state.status = 'uncertain'; this.state.controlError = error; changed = true;
    }
    for (const { assignment, outcome } of this.completed) {
      const owner = this.state.slots[assignment.slot];
      if (!outcome.released && owner?.context === assignment.context && owner.stage !== 'uncertain') {
        owner.stage = 'uncertain'; owner.error = outcome.error || 'release unproven';
        this.state.status = 'uncertain'; this.state.controlEpoch++; changed = true;
      }
    }
    if (['stopped', 'exhausted', 'uncertain'].includes(this.state.status)) {
      for (const [context, handle] of this.handles) {
        if (!this.cancelling.has(context)) {
          this.cancelling.add(context);
          Promise.resolve(handle.cancel()).catch((error) => this.controlErrors.push(error.message));
        }
      }
    }
    if (this.emit() || changed) this.save();
  }
  async command(argv, options) {
    this.guard();
    if (this.state.operation) throw new Error('another provider/validation process still owns its operation');
    this.state.operation = { stage: 'spawning', command: argv[0], digest: digest(argv), at: this.clock() };
    this.save();
    try {
      const remaining = this.state.createdAt + this.config.lifetimeMs - this.clock();
      const result = await runCommand(argv, { ...options, ownershipDirectory: path.join(this.store.directory, 'processes'),
        timeoutMs: Math.max(1, Math.min(options.timeoutMs, remaining)), onSpawn: (pid, ownership) => {
        this.state.operation.pid = pid; this.state.operation.ownership = ownership;
        this.state.operation.stage = 'executing'; this.save();
      } });
      this.state.operation = null; this.save();
      return result;
    } catch (error) {
      if (error.uncertainTermination) {
        this.state.status = 'uncertain';
        this.state.operation.error = error.message;
      } else this.state.operation = null;
      this.save();
      throw error;
    }
  }
  guard(issue = this.state.activity?.issue ? this.issue(this.state.activity.issue) : undefined) {
    if (this.state.status !== 'running' || this.clock() >= this.state.createdAt + this.config.lifetimeMs ||
      this.state.activity && this.state.activity.controlEpoch !== this.state.controlEpoch ||
      issue && this.state.activity?.issue === issue.work.id && this.state.activity.issueEpoch !== issue.epoch ||
      issue && ['cancelled', 'merged', 'closed'].includes(issue.phase) ||
      this.store.commands().some(({ command }) => ['stop', 'pause'].includes(command.type) ||
        command.type === 'cancel' && command.issue === issue?.work.id)) {
      throw new ControlInterrupted('run control interrupted this operation; no subsequent side effects');
    }
  }
  commands() {
    for (const { file, command } of this.store.commands()) {
      if (!Object.hasOwn(this.state.commands, command.id)) {
        try {
          if (command.type === 'enqueue') admit(this.state, command.work);
          else if (command.type === 'pause' && ['running', 'paused'].includes(this.state.status)) {
            if (this.state.status !== 'paused') this.state.controlEpoch++;
            this.state.status = 'paused';
          }
          else if (command.type === 'resume' && this.state.status === 'paused') this.state.status = 'running';
          else if (command.type === 'stop') {
            this.state.controlEpoch++;
            if (this.state.status !== 'uncertain') this.state.status = 'stopped';
          }
          else if (command.type === 'cancel') {
            const issue = this.issue(command.issue);
            if (!issue || ['merged', 'closed'].includes(issue.phase)) throw new Error('issue not cancellable');
            issue.phase = 'cancelled'; issue.epoch++; issue.votes = [];
            for (const owner of this.state.slots.filter((s) => s?.issue === issue.work.id)) {
              void this.handles.get(owner.context)?.cancel();
            }
          } else if (command.type === 'retry') {
            const issue = this.issue(command.issue);
            if (!issue || issue.phase !== 'blocked' || this.state.slots.some((s) => s?.issue === command.issue)) throw new Error('retry requires a blocked unowned issue');
            if (issue.reconciliation?.required) throw new Error('External PR drift requires an explicit operator reconciliation/takeover decision; generic retry cannot accept it. Cancel Bench ownership to handle this PR outside Bench.');
            issue.phase = issue.candidate ? 'correction' : 'queued';
            if (issue.pr) issue.maintenance = true;
            issue.error = null;
          } else if (command.type === 'revise') {
            const issue = this.issue(command.issue);
            if (!issue || this.state.slots.some((slot) => slot?.issue === command.issue) ||
              this.state.activity?.issue === command.issue) throw new Error('requirements revision requires unowned work');
            reviseRequirements(issue, command.requirements, command.expectedRequirementsHash);
          } else throw new Error('unknown or inapplicable operator command');
          this.state.commands[command.id] = { status: 'accepted', sequence: command.sequence, at: this.clock() };
        } catch (error) {
          this.state.commands[command.id] = { status: 'rejected', sequence: command.sequence, error: error.message, at: this.clock() };
        }
        this.save();
      }
      fs.unlinkSync(file);
    }
  }
  async tick() {
    if (this.processing) throw new Error('a controller work cycle is already pending');
    this.processing = true;
    try {
      this.pulse();
      try { await this.workCycle(); }
      catch (error) { if (!(error instanceof ControlInterrupted)) throw error; }
      this.emit();
      this.save();
    } finally { this.processing = false; }
  }
  async workCycle() {
    this.checkedMaintenance.clear();
    for (const event of this.completed.splice(0)) await this.finish(event);
    if (['stopped', 'exhausted', 'uncertain'].includes(this.state.status)) {
      await this.cancelAll();
      this.emit(true);
      return;
    }
    if (this.state.status === 'running') {
      if (!this.prepared) await this.prepareProvider();
      if (this.clock() - this.state.lastPoll >= this.config.pollMs) await this.monitor();
      for (const issue of this.state.issues) {
        if (this.state.status !== 'running') break;
        if (hasQuorum(issue, this.config.quorum) && !this.state.slots.some((s) => s?.issue === issue.work.id)) {
          await this.publish(issue);
        }
      }
      for (let slot = 0; slot < this.config.slots; slot++) {
        if (this.state.status !== 'running') break;
        if (this.state.slots[slot]) continue;
        const next = this.next(slot);
        if (next) await this.dispatch(next.issue, slot, next.role);
      }
      if (this.state.generations >= this.config.maxAssignments && !this.state.slots.some(Boolean) &&
        this.state.issues.some((i) => ['queued', 'review', 'correction'].includes(i.phase))) {
        this.state.status = 'exhausted';
      }
    }
  }
  next(slot) {
    if (this.state.generations >= this.config.maxAssignments) return null;
    for (const issue of this.state.issues) {
      if (!dependenciesReady(this.state, issue)) continue;
      const active = this.state.slots.filter((s) => s?.issue === issue.work.id);
      if (['queued', 'correction'].includes(issue.phase) && active.length === 0) {
        if (issue.attempts >= this.config.maxIssueAttempts) {
          issue.phase = 'blocked'; issue.error = 'issue attempt limit exhausted'; continue;
        }
        return { issue, role: 'implement' };
      }
      if (issue.phase === 'review' && !active.some((s) => s.role !== 'review') &&
        !issue.votes.some((v) => v.slot === slot) && !active.some((s) => s.slot === slot) &&
        issue.votes.length + active.length < this.config.quorum) return { issue, role: 'review' };
    }
    return null;
  }
  async dispatch(issue, slot, role) {
    if (issue.reconciliation?.required || issue.phase === 'blocked') throw new ControlInterrupted('issue is durably blocked');
    this.guard(issue);
    if (role === 'implement' && issue.maintenance && !this.checkedMaintenance.has(issue.work.id) &&
      !await this.assessMaintenance(issue)) { this.save(); return; }
    const selected = this.doctrine(this.config.doctrine[role]);
    const assignment = { context: randomUUID(), slot, issue: issue.work.id, role,
      basis: reviewedBasis(issue), epoch: issue.epoch, model: this.config.models[role],
      doctrine: selected.map(({ id, sha256 }) => ({ id, sha256 })), stage: 'preparing', startedAt: this.clock() };
    this.state.slots[slot] = assignment;
    this.state.generations++;
    if (role === 'implement') { issue.attempts++; issue.phase = 'implementing'; }
    this.save();
    try {
      assignment.cwd = await this.providerOperation('worktree preparation', issue, () => this.provider.prepare(issue, assignment));
      this.guard(issue);
      assignment.stage = 'spawning';
      this.save();
      const packet = { ...assignment, doctrine: selected, work: issue.work, candidate: issue.candidate,
        findings: issue.findings, observation: issue.observation, maintenance: issue.maintenance,
        timeoutMs: Math.max(1, Math.min(this.config.assignmentMs, this.state.createdAt + this.config.lifetimeMs - this.clock())),
        configDirectory: path.join(this.store.directory, 'sdk', assignment.context) };
      const handle = this.workers.launch(packet, (pid, ownership) => {
        assignment.pid = pid; assignment.ownership = ownership; assignment.stage = 'dispatched'; this.save();
      });
      this.handles.set(assignment.context, handle);
      handle.done.then((outcome) => this.completed.push({ assignment, outcome }),
        (error) => this.completed.push({ assignment, outcome: { released: false, error: error.message } }));
    } catch (error) {
      if (assignment.pid || assignment.stage === 'spawning') {
        this.state.status = 'uncertain'; assignment.error = error.message;
      } else {
        this.state.slots[slot] = null;
        if (!['cancelled', 'merged', 'closed'].includes(issue.phase) && !issue.reconciliation?.required) {
          issue.phase = error instanceof ControlInterrupted ? role === 'review' ? 'review' : 'correction' : 'blocked';
          issue.error = error.message;
        }
      }
      this.save();
    }
  }
  async finish({ assignment, outcome }) {
    const owner = this.state.slots[assignment.slot];
    if (owner?.context !== assignment.context) return;
    if (!outcome.released) {
      owner.stage = 'uncertain'; owner.error = outcome.error || 'release unproven';
      this.state.status = 'uncertain'; this.save(); return;
    }
    this.handles.delete(assignment.context);
    this.cancelling.delete(assignment.context);
    const issue = this.issue(assignment.issue);
    try {
      if (!issue || ['cancelled', 'merged', 'closed', 'blocked'].includes(issue.phase) || issue.reconciliation?.required ||
        assignment.epoch !== issue.epoch || this.state.status !== 'running') return;
      if (outcome.error || !outcome.idle) {
        issue.phase = 'blocked'; issue.error = outcome.error || 'no SDK idle observation'; return;
      }
      if (assignment.role === 'review') {
        if (issue.phase !== 'review') return;
        await this.providerOperation('review inspection', issue, () => this.provider.inspectReview(issue, assignment));
        assignment.filesRead = outcome.reads;
        recordReview(issue, assignment, outcome.result);
      } else {
        if (!recordImplementationResult(issue, outcome.result)) return;
        owner.stage = 'validating'; this.save();
        const candidate = await this.providerOperation('validation', issue, () => this.provider.validate(issue, assignment));
        this.guard(issue);
        if (issue.maintenance && candidate.commit === issue.pr?.headRefOid) {
          const current = await this.providerOperation('maintenance verification', issue, () => this.provider.observe(issue));
          issue.observation = current;
          if (current.headRefOid !== issue.pr.headRefOid) this.blockExternalHead(issue, current);
          else if (current.readiness === 'ready' && !current.failed && !current.stale) {
            issue.phase = 'published'; issue.maintenance = false; issue.error = null;
          } else {
            issue.phase = 'blocked';
            issue.error = 'Maintenance produced an unchanged head with unresolved hosted readiness. No repush, empty commit or automatic rerun was performed. Operator must investigate current CI or explicitly authorize a rerun outside Bench.';
            issue.findings = [issue.error];
          }
          return;
        }
        setCandidate(issue, candidate, assignment.context);
      }
    } catch (error) {
      if (error.externalHead) this.blockExternalHead(issue, { headRefOid: error.externalHead, observedAt: new Date(this.clock()).toISOString() });
      if (!['cancelled', 'merged', 'closed'].includes(issue.phase) && !issue.reconciliation?.required) {
        issue.phase = assignment.role === 'review' ? error instanceof ControlInterrupted ? 'review' : 'blocked' : 'correction';
        issue.error = error.message;
        issue.findings.push(error.message);
      }
    } finally {
      try { await this.providerOperation('worktree cleanup', issue, () => this.provider.cleanup(assignment)); }
      catch (error) { if (issue) issue.cleanupError = error.message; }
      if (this.state.operation) {
        owner.stage = 'uncertain'; this.state.status = 'uncertain';
      } else this.state.slots[assignment.slot] = null;
      // Paused/stopped deliveries need fresh validation/review on explicit resumption.
      if (issue?.phase === 'implementing') issue.phase = 'correction';
      this.save();
    }
  }
  published(issue, pr) {
    issue.pr = Object.fromEntries(['number', 'url', 'state', 'headRefOid', 'headRefName', 'baseRefName']
      .filter((key) => pr[key] !== undefined).map((key) => [key, pr[key]]));
    issue.phase = pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'published';
    issue.publication.pending = false;
    issue.maintenance = false;
    issue.error = null;
    issue.publishedAt = new Date(this.clock()).toISOString();
  }
  async publish(issue) {
    try {
      if (issue.reconciliation?.required) return;
      this.guard(issue);
      issue.publication = { id: issue.publication?.id ?? randomUUID(), pending: true,
        branch: this.provider.branch(issue), basis: reviewedBasis(issue),
        commit: issue.candidate.commit, attemptedAt: this.clock() };
      this.save();
      const pr = await this.providerOperation('publication', issue, () => this.provider.publish(issue));
      this.published(issue, pr);
    } catch (error) {
      if (error.externalHead) this.blockExternalHead(issue, { headRefOid: error.externalHead, observedAt: new Date(this.clock()).toISOString() });
      if (!['cancelled', 'merged', 'closed'].includes(issue.phase) && !issue.reconciliation?.required) {
        issue.phase = error instanceof ControlInterrupted ? 'review' : 'blocked';
        issue.error = `publication pending/failed: ${error.message}; next authorized attempt reconciles the recorded branch`;
      }
    }
    this.save();
  }
  async monitor() {
    this.state.lastPoll = this.clock();
    for (const issue of this.state.issues.filter((i) => i.pr && !['merged', 'closed', 'cancelled'].includes(i.phase))) {
      if (this.state.status !== 'running') break;
      try {
        const observation = await this.providerOperation('PR observation', issue, () => this.provider.observe(issue));
        issue.observation = observation;
        issue.observationError = null;
        if (observation.state === 'MERGED' || observation.state === 'CLOSED') {
          issue.phase = observation.state.toLowerCase();
          issue.epoch++; issue.votes = []; issue.maintenance = false;
          for (const owner of this.state.slots.filter((s) => s?.issue === issue.work.id)) {
            void this.handles.get(owner.context)?.cancel();
          }
        } else if (observation.headRefOid &&
          ![issue.pr.headRefOid ?? issue.candidate?.commit, issue.publication?.pending ? issue.candidate?.commit : null].includes(observation.headRefOid)) {
          this.blockExternalHead(issue, observation);
        } else if ((observation.failed || observation.stale) && issue.phase === 'published' && !issue.maintenance) {
          if (await this.assessMaintenance(issue, observation)) {
            issue.maintenance = true; issue.phase = 'correction'; issue.epoch++; issue.votes = [];
            issue.findings = [observation.failed ? 'Shepherd: fix the hosted failure using the attached current-head CI evidence.' : 'Shepherd: integrate the observed stale base without rewriting the PR.'];
          }
        }
      } catch (error) {
        // Preserve the last successful observation and its timestamp, never refresh old readiness.
        issue.observationError = { at: new Date(this.clock()).toISOString(), message: error.message };
      }
    }
    this.save();
  }
  blockExternalHead(issue, observation) {
    if (!issue.reconciliation?.required) {
      issue.epoch++; issue.votes = [];
      issue.reconciliation = { required: true, reason: 'external-head', expectedHead: issue.pr?.headRefOid,
        observedHead: observation.headRefOid, observedAt: observation.observedAt };
    }
    issue.phase = 'blocked';
    issue.error = 'PR head changed outside Bench. Operator must reconcile/take over this PR explicitly; generic retry cannot accept drift.';
    issue.findings = [issue.error];
    for (const owner of this.state.slots.filter((slot) => slot?.issue === issue.work.id)) {
      const handle = this.handles.get(owner.context);
      if (handle) Promise.resolve(handle.cancel()).catch((error) => this.controlErrors.push(error.message));
    }
  }
  async assessMaintenance(issue, supplied) {
    const current = supplied ?? await this.providerOperation('maintenance observation', issue, () => this.provider.observe(issue));
    issue.observation = current;
    if (current.state === 'MERGED' || current.state === 'CLOSED') {
      issue.phase = current.state.toLowerCase(); issue.epoch++; issue.votes = []; issue.maintenance = false;
      return false;
    }
    if (current.headRefOid !== issue.pr?.headRefOid) { this.blockExternalHead(issue, current); return false; }
    if (!current.failed && !current.stale) {
      issue.phase = current.readiness === 'ready' ? 'published' : 'blocked';
      issue.maintenance = false;
      issue.error = current.readiness === 'ready' ? null : 'Hosted readiness is not established; wait for current CI evidence before retrying maintenance.';
      if (issue.error) issue.findings = [issue.error];
      return false;
    }
    if (current.failed) {
      const evidence = await this.providerOperation('CI failure evidence', issue, () => this.provider.failureEvidence(issue, current));
      current.ciEvidence = evidence;
      if (evidence.currentHead && evidence.currentHead !== current.headRefOid) {
        this.blockExternalHead(issue, { ...current, headRefOid: evidence.currentHead }); return false;
      }
      if (evidence.status !== 'available' || evidence.head !== current.headRefOid) {
        issue.phase = 'blocked';
        issue.error = 'Current-head hosted failure diagnostics are missing or stale; operator must resolve access/current attempt before maintenance.';
        issue.findings = [issue.error, ...(evidence.errors ?? [])];
        return false;
      }
    }
    this.checkedMaintenance.add(issue.work.id);
    return true;
  }
  async cancelAll() {
    await Promise.all([...this.handles.values()].map((h) => h.cancel()));
    for (const event of this.completed.splice(0)) await this.finish(event);
    if (this.state.slots.some(Boolean) || this.state.operation) this.state.status = 'uncertain';
    this.save();
  }
  snapshot() {
    const counts = {};
    for (const issue of this.state.issues) counts[issue.phase] = (counts[issue.phase] ?? 0) + 1;
    const priority = (i) => ['blocked', 'implementing', 'correction', 'review'].includes(i.phase) ? 0 : 1;
    const visible = [...this.state.issues].sort((a, b) => priority(a) - priority(b)).slice(0, 25);
    const activity = this.state.activity ? { ...this.state.activity,
      interrupted: this.state.activity.controlEpoch !== this.state.controlEpoch ||
        !!this.state.activity.issue && this.issue(this.state.activity.issue)?.epoch !== this.state.activity.issueEpoch } : null;
    return { run: this.config.run, status: this.state.status, at: new Date(this.clock()).toISOString(),
      generations: this.state.generations, capacity: this.config.slots, counts, omitted: this.state.issues.length - visible.length,
      activity,
      draining: (this.state.status !== 'running' || activity?.interrupted === true) &&
        (this.state.slots.some(Boolean) || !!this.state.operation || !!activity),
      active: this.state.slots.filter(Boolean).map(({ slot, issue, context, stage, startedAt }) => ({ slot, issue, context, stage, startedAt })),
      work: visible.map((i) => ({ id: i.work.id, phase: i.phase, maintenance: i.maintenance,
        votes: i.votes.length, quorum: this.config.quorum, pr: i.pr?.url ?? null,
        readiness: readiness(i),
        dependencyGate: dependenciesReady(this.state, i), error: i.error ?? null,
        findings: [...i.findings], blockerEvidence: i.blockerEvidence ?? null, reconciliation: i.reconciliation ?? null,
        requirementsHash: digest(i.work.requirements),
        observation: observation(i), observationError: i.observationError ?? null })) };
  }
  emit(force = false) {
    const material = digest([this.state.status, this.state.issues.filter((i) => i.phase === 'blocked')
      .map((i) => [i.work.id, i.error, i.findings])]);
    if (force || material !== this.state.lastMaterial || this.clock() - this.state.lastReport >= this.config.reportMs) {
      this.state.lastMaterial = material;
      this.state.lastReport = this.clock();
      const snapshot = this.snapshot();
      atomicJSON(path.join(this.store.directory, 'status.json'), snapshot);
      this.report(snapshot);
      return true;
    }
    return false;
  }
}

async function main(args) {
  const [operation, directory, input] = args;
  if (!operation || !directory) throw new Error('usage: bench-control.mjs start STATE CONFIG | enqueue STATE WORK | status STATE | stop|pause|resume STATE | cancel|retry STATE ID');
  const store = new Store(directory);
  if (operation === 'status') {
    const state = store.load();
    const owner = fs.existsSync(path.join(store.lock, 'owner.json')) ? readJSON(path.join(store.lock, 'owner.json')) : null;
    const counts = {};
    for (const issue of state?.issues ?? []) counts[issue.phase] = (counts[issue.phase] ?? 0) + 1;
    const activity = state?.activity ? { ...state.activity, interrupted: state.activity.controlEpoch !== state.controlEpoch ||
      !!state.activity.issue && state.issues.find((i) => i.work.id === state.activity.issue)?.epoch !== state.activity.issueEpoch } : null;
    const snapshot = { run: state?.config.run, persistedStatus: state?.status ?? 'not-started',
      controllerObservedAt: new Date().toISOString(), controllerAlive: owner ? processAlive(owner.pid) : false,
      capacity: state?.config.slots, counts, activity,
      draining: (state?.status !== 'running' || activity?.interrupted === true) &&
        !!(state?.operation || activity || state?.slots.some(Boolean)),
      generations: state?.generations ?? 0, active: state?.slots.filter(Boolean) ?? [],
      work: state?.issues.map((i) => ({ id: i.work.id, phase: i.phase, pr: i.pr?.url ?? null,
        readiness: readiness(i),
        observation: observation(i), observationError: i.observationError, error: i.error,
        findings: i.findings, blockerEvidence: i.blockerEvidence, reconciliation: i.reconciliation,
        requirementsHash: digest(i.work.requirements) })) ?? [],
      commandReceipts: Object.fromEntries(Object.entries(state?.commands ?? {}).slice(-20)) };
    console.log(args.includes('--json') ? JSON.stringify(snapshot, null, 2) : formatStatus(snapshot));
    return;
  }
  if (operation !== 'start') {
    if (!['enqueue', 'stop', 'pause', 'resume', 'cancel', 'retry', 'revise'].includes(operation)) throw new Error('unknown operation');
    const command = { type: operation };
    if (operation === 'enqueue') command.work = readJSON(input);
    if (operation === 'revise') {
      const revision = readJSON(input);
      command.issue = identifier(revision.issue);
      command.requirements = revision.requirements;
      command.expectedRequirementsHash = revision.expectedRequirementsHash;
    }
    if (['cancel', 'retry'].includes(operation)) command.issue = identifier(input);
    console.log(JSON.stringify({ queuedCommand: store.send(command), note: 'accepted/rejected receipt appears in persisted state after the controller handles it' }));
    return;
  }
  const config = configuration(readJSON(input));
  const checkout = fs.realpathSync(config.checkout);
  const skillsRoot = fileURLToPath(new URL('../../../', import.meta.url));
  if (store.directory === checkout || store.directory.startsWith(`${checkout}${path.sep}`) ||
    store.directory.startsWith(skillsRoot)) {
    throw new Error('state/worktrees must be outside the delivery checkout and installed skills tree');
  }
  const controller = new BenchController({ config, store,
    provider: new GitHubDelivery(config, store.directory),
    report: (snapshot) => console.log(args.includes('--json') ? JSON.stringify(snapshot) : formatStatus(snapshot)),
    workers: new SDKWorkers({ timeoutMs: config.assignmentMs, runtimeDirectory: config.runtimeDirectory }) });
  controller.provider.run = (argv, options) => controller.command(argv, options);
  const signal = () => { store.send({ type: 'stop' }); };
  process.on('SIGINT', signal); process.on('SIGTERM', signal);
  try {
    await loadSDK(config.runtimeDirectory);
    await controller.responsive(controller.initialize(args.includes('--recover')));
    while (true) {
      await controller.responsive(controller.tick());
      if (['stopped', 'exhausted', 'uncertain'].includes(controller.state.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (controller.state.status !== 'stopped') process.exitCode = 1;
  } catch (error) {
    if (controller.state) {
      controller.state.status = 'stopped'; controller.state.controlEpoch++;
      await controller.responsive(controller.cancelAll()); controller.emit(true);
    }
    throw error;
  } finally { store.release(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
