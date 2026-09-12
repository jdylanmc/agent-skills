import fs from 'node:fs';
import path from 'node:path';
import { digest, authorizedWorkPath } from '../bench-epoch/bench-epoch.mjs';
import { spawnOwned, ownerReleased, terminateOwned } from '../fleet-state/fleet-state.process.mjs';

export async function command(argv, { cwd, timeoutMs = 120000, env = process.env, onSpawn = () => {}, ownershipDirectory,
  tailOutput = false, outputLimit = 1000000 } = {}) {
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > 1000000) throw new Error('invalid bounded output limit');
  return new Promise((resolve, reject) => {
    const { child, owner } = spawnOwned(argv, { cwd, env, timeoutMs, ownershipDirectory, stdio: ['ignore', 'pipe', 'pipe'] });
    let spawnError;
    try { if (child.pid) onSpawn(child.pid, owner); }
    catch (error) {
      spawnError = error;
      void terminateOwned(owner, 2000, child).then((released) => reject(Object.assign(error, { uncertainTermination: !released })));
    }
    let output = '', overflow = false, timedOut = false;
    const collect = (data) => {
      const next = output + data.toString();
      if (next.length > outputLimit) overflow = true;
      output = tailOutput ? next.slice(-outputLimit) : next.slice(0, outputLimit);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateOwned(owner, 2000, child).then((released) => {
        if (!released) reject(Object.assign(new Error(`uncertain command termination: owned process ${child.pid}: ${output.slice(-8000)}`), { uncertainTermination: true }));
      });
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', async (code) => {
      clearTimeout(timer);
      const released = await ownerReleased(owner, true) || await terminateOwned(owner, 100, child);
      if (!released) { reject(Object.assign(new Error(`uncertain command termination: owned process ${child.pid}: ${output.slice(-8000)}`), { uncertainTermination: true })); return; }
      if (spawnError) { reject(spawnError); return; }
      if (timedOut || overflow && !tailOutput || code !== 0) {
        reject(new Error(`${argv[0]} failed (${timedOut ? 'timeout' : overflow ? 'output limit' : code}): ${output.slice(-8000)}`));
      } else resolve(`${tailOutput && overflow ? '[bounded tail; earlier output omitted]\n' : ''}${output.trim()}`);
    });
  });
}

export class GitHubDelivery {
  constructor(config, directory, run = command, guard = () => {}) {
    this.config = config;
    this.directory = directory;
    this.run = run;
    this.guard = guard;
  }
  git(cwd, ...args) {
    const hooks = path.join(this.directory, 'disabled-hooks');
    if (fs.existsSync(hooks) && fs.readdirSync(hooks).length) throw new Error('disabled hook directory must remain empty');
    return this.run(['git', '-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgsign=false', ...args],
      { cwd, timeoutMs: this.config.commandMs });
  }
  gh(...args) {
    return this.run(['gh', ...args, '--repo', this.config.repository], { cwd: this.config.checkout,
      timeoutMs: this.config.commandMs, env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
  }
  api(endpoint) {
    return this.run(['gh', 'api', `repos/${this.config.repository}/${endpoint}`, '--method', 'GET'],
      { cwd: this.config.checkout, timeoutMs: this.config.commandMs, env: { ...process.env, GH_PROMPT_DISABLED: '1' } })
      .then((text) => JSON.parse(text));
  }
  branch(issue) { return `bench/${this.config.run}/${issue.work.id}`; }
  worktree(issue) { return path.join(this.directory, 'worktrees', issue.work.id); }
  async preflight() {
    const root = await this.git(this.config.checkout, 'rev-parse', '--show-toplevel');
    if (fs.realpathSync(root) !== fs.realpathSync(this.config.checkout)) throw new Error('checkout must be the repository root');
    const remote = await this.git(root, 'remote', 'get-url', 'origin');
    const identity = remote.replace(/^git@github\.com:/, '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (identity !== this.config.repository) throw new Error('origin does not match the authorized GitHub repository');
    const result = JSON.parse(await this.run(['gh', 'repo', 'view', this.config.repository, '--json', 'nameWithOwner'],
      { cwd: root, timeoutMs: this.config.commandMs, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }));
    if (result.nameWithOwner.toLowerCase() !== this.config.repository.toLowerCase()) throw new Error('GitHub identity mismatch');
  }
  async prepare(issue, assignment) {
    this.guard(issue);
    const cwd = this.worktree(issue);
    if (assignment.role === 'review') {
      const snapshot = path.join(this.directory, 'reviews', assignment.context);
      fs.mkdirSync(path.dirname(snapshot), { recursive: true });
      await this.git(this.config.checkout, 'worktree', 'add', '--detach', snapshot, issue.candidate.commit);
      return snapshot;
    }
    await this.git(this.config.checkout, 'fetch', '--no-tags', 'origin', this.config.base);
    this.guard(issue);
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(path.dirname(cwd), { recursive: true });
      const branches = await this.git(this.config.checkout, 'branch', '--list', this.branch(issue));
      if (branches) await this.git(this.config.checkout, 'worktree', 'add', cwd, this.branch(issue));
      else await this.git(this.config.checkout, 'worktree', 'add', '-b', this.branch(issue), cwd, `origin/${this.config.base}`);
    }
    if (issue.maintenance) {
      // Fast-forward-safe publication: integrate the base without rewriting an existing PR.
      try { await this.git(cwd, 'merge', '--no-edit', `origin/${this.config.base}`); }
      catch (error) {
        const conflicts = await this.git(cwd, 'diff', '--name-only', '--diff-filter=U');
        if (!conflicts) throw error;
      }
    }
    return cwd;
  }
  async inspectReview(issue, assignment) {
    const head = await this.git(assignment.cwd, 'rev-parse', 'HEAD');
    const changes = await this.git(assignment.cwd, 'status', '--porcelain');
    if (head !== issue.candidate.commit || changes) throw new Error('review snapshot changed');
  }
  async cleanup(assignment) {
    if (assignment.role === 'review' && assignment.cwd) {
      await this.git(this.config.checkout, 'worktree', 'remove', assignment.cwd);
    }
  }
  async validate(issue, assignment) {
    const cwd = assignment.cwd;
    const changed = [
      ...(await this.git(cwd, 'diff', '--name-only', '-z', 'HEAD')).split('\0'),
      ...(await this.git(cwd, 'ls-files', '--others', '--exclude-standard', '-z')).split('\0'),
    ].filter(Boolean);
    if (changed.some((file) => !authorizedWorkPath(file, issue.work.paths))) {
      throw new Error('candidate changed files outside the authorized paths');
    }
    await this.git(cwd, 'add', '--all');
    const testedTree = await this.git(cwd, 'write-tree');
    const testedHead = await this.git(cwd, 'rev-parse', 'HEAD');
    const validation = [];
    for (const argv of issue.work.validation) {
      this.guard(issue);
      const output = await this.run(argv, { cwd, timeoutMs: this.config.commandMs });
      validation.push({ argv, exitCode: 0, digest: digest(output), observedAt: new Date().toISOString() });
    }
    // Tests are authorized executable code, not a sandbox. Still bind their final tree.
    const after = [...(await this.git(cwd, 'diff', '--name-only', '-z', 'HEAD')).split('\0'),
      ...(await this.git(cwd, 'ls-files', '--others', '--exclude-standard', '-z')).split('\0')].filter(Boolean);
    if (after.some((file) => !authorizedWorkPath(file, issue.work.paths))) {
      throw new Error('validation changed files outside the authorized paths');
    }
    await this.git(cwd, 'add', '--all');
    if (testedTree !== await this.git(cwd, 'write-tree') || testedHead !== await this.git(cwd, 'rev-parse', 'HEAD')) {
      throw new Error('validation mutated the candidate; rerun against the final tree');
    }
    const status = await this.git(cwd, 'status', '--porcelain');
    const mergeHead = fs.existsSync(path.join(await this.git(cwd, 'rev-parse', '--absolute-git-dir'), 'MERGE_HEAD'));
    if (status || mergeHead) await this.git(cwd, 'commit', '-m', `Bench: ${issue.work.title}`);
    const commit = await this.git(cwd, 'rev-parse', 'HEAD');
    if (await this.git(cwd, 'status', '--porcelain')) throw new Error('candidate checkout is not clean');
    return { commit, validation };
  }
  async find(issue) {
    const rows = JSON.parse(await this.gh('pr', 'list', '--state', 'all', '--head', this.branch(issue),
      '--json', 'number,url,state,headRefName,headRefOid,baseRefName,body'));
    const matching = rows.filter((pr) => pr.headRefName === this.branch(issue) && pr.baseRefName === this.config.base);
    if (matching.length > 1) throw new Error('multiple PRs match publication identity');
    if (matching[0] && (!issue.publication?.id ||
      !matching[0].body?.includes(`<!-- bench-publication:${issue.publication.id} -->`) ||
      !matching[0].body?.includes(`<!-- /bench-publication:${issue.publication.id} -->`))) {
      throw new Error('existing PR lacks this run publication identity; do not adopt or replace it');
    }
    return matching[0] ?? null;
  }
  publicationMatches(issue, pr) {
    return pr.headRefOid === issue.candidate?.commit &&
      pr.body?.includes(`Candidate: ${issue.candidate.commit}\nBasis: ${issue.publication.basis}\n`);
  }
  async publish(issue) {
    // The controller persists branch + basis before entering this transaction.
    let pr = await this.find(issue);
    if (pr && pr.state !== 'OPEN') return pr;
    if (pr && issue.pr && ![issue.pr.headRefOid, issue.publication?.pending ? issue.candidate.commit : null].includes(pr.headRefOid)) {
      throw Object.assign(new Error('External PR head changed before publication'), { externalHead: pr.headRefOid });
    }
    const head = await this.git(this.worktree(issue), 'rev-parse', 'HEAD');
    if (head !== issue.candidate.commit || await this.git(this.worktree(issue), 'status', '--porcelain')) {
      throw new Error('publication candidate changed after review');
    }
    this.guard(issue);
    await this.git(this.worktree(issue), 'push', 'origin', `${head}:refs/heads/${this.branch(issue)}`);
    const start = `<!-- bench-publication:${issue.publication.id} -->`;
    const end = `<!-- /bench-publication:${issue.publication.id} -->`;
    const evidence = `${start}\nBench work ${issue.work.id}\n\n${issue.work.requirements}\n\n` +
      `Candidate: ${head}\nBasis: ${issue.publication.basis}\n` +
      `Validation: ${JSON.stringify(issue.candidate.validation)}\n` +
      `Distinct-slot reviews: ${JSON.stringify(issue.votes)}\n\nHuman approval and merge required.\n${end}`;
    this.guard(issue);
    if (!pr) {
      await this.gh('pr', 'create', '--head', this.branch(issue), '--base', this.config.base,
        '--title', issue.work.title, '--body', evidence);
    } else {
      const beginning = pr.body.indexOf(start), ending = pr.body.indexOf(end, beginning);
      if (ending < beginning) throw new Error('publication evidence block is malformed');
      const body = pr.body.slice(0, beginning) + evidence + pr.body.slice(ending + end.length);
      await this.gh('pr', 'edit', String(pr.number), '--body', body);
    }
    pr = await this.find(issue);
    if (!pr || (pr.state === 'OPEN' && (pr.headRefOid !== head || !pr.body.includes(evidence)))) {
      throw new Error('publication readback missing or mismatched; reconcile before retry');
    }
    return pr;
  }
  async observe(issue) {
    const pr = JSON.parse(await this.gh('pr', 'view', String(issue.pr.number), '--json',
      'number,url,state,headRefOid,mergeStateStatus,statusCheckRollup'));
    const checks = pr.statusCheckRollup ?? [];
    const failed = checks.some((c) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(c.conclusion ?? c.state));
    const pending = checks.some((c) => c.status ? c.status !== 'COMPLETED' : c.state === 'PENDING');
    const stale = pr.mergeStateStatus === 'BEHIND' || pr.mergeStateStatus === 'DIRTY';
    return { ...pr, observedAt: new Date().toISOString(), failed, stale,
      readiness: failed || stale ? 'not-ready' : pending || pr.mergeStateStatus !== 'CLEAN' || !checks.length ? 'unknown' : 'ready' };
  }
  async failureEvidence(issue, observation) {
    const head = observation.headRefOid;
    const evidence = { head, observedAt: new Date().toISOString(), status: 'unavailable', checks: [], jobs: [], errors: [],
      limits: { checks: 3, runs: 2, jobs: 3, annotationsPerCheck: 10, charactersPerJob: 12000 } };
    const failure = (value) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']
      .includes(String(value ?? '').toUpperCase());
    const number = (value) => Number.isSafeInteger(value) && value > 0;
    try {
      if (!/^[a-f0-9]{40,64}$/.test(head ?? '')) throw new Error('current PR head is missing');
      const response = await this.api(`commits/${head}/check-runs?filter=latest&per_page=30`);
      const checks = (response.check_runs ?? []).filter((check) => check.head_sha === head && failure(check.conclusion)).slice(0, 3);
      if (!checks.length) throw new Error('no accessible failed check-run evidence for this head; external status URLs are not fetched');
      for (const check of checks) {
        if (!number(check.id)) throw new Error('invalid check identity');
        const annotations = await this.api(`check-runs/${check.id}/annotations?per_page=10`);
        evidence.checks.push({ id: check.id, suite: check.check_suite?.id, name: check.name, head,
          completedAt: check.completed_at, source: `GitHub check-run ${check.id}`,
          excerpt: [check.output?.summary ?? '', check.output?.text ?? '',
            ...annotations.map((a) => `${a.path ?? ''}:${a.start_line ?? ''} ${a.message ?? ''}`)].join('\n').slice(0, 6000) });
        const current = await this.api(`check-runs/${check.id}`);
        if (current.head_sha !== head || current.completed_at !== check.completed_at || !failure(current.conclusion)) {
          evidence.status = 'stale'; throw new Error('check changed during diagnostic retrieval');
        }
      }
      const actionChecks = checks.filter((check) => check.app?.slug === 'github-actions');
      const runs = actionChecks.length ? await this.api(`actions/runs?head_sha=${head}&per_page=5`) : { workflow_runs: [] };
      const selected = (runs.workflow_runs ?? []).filter((run) => run.head_sha === head && failure(run.conclusion) && number(run.check_suite_id) &&
        actionChecks.some((check) => check.check_suite?.id === run.check_suite_id)).slice(0, 2);
      for (const run of selected) {
        if (!number(run.id) || !number(run.run_attempt)) throw new Error('invalid run/attempt identity');
        const response = await this.api(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=10`);
        const jobs = (response.jobs ?? []).filter((job) => failure(job.conclusion)).slice(0, 3 - evidence.jobs.length);
        for (const job of jobs) {
          if (!number(job.id) || job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== head) {
            throw new Error('stale or mismatched failed-job provenance');
          }
          const excerpt = await this.run(['gh', 'run', 'view', String(run.id), '--attempt', String(run.run_attempt),
            '--job', String(job.id), '--log-failed', '--repo', this.config.repository],
          { cwd: this.config.checkout, timeoutMs: this.config.commandMs, tailOutput: true, outputLimit: 12000,
            env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
          if (!excerpt.trim()) throw new Error('failed job log is empty or inaccessible');
          evidence.jobs.push({ runId: run.id, attempt: run.run_attempt, jobId: job.id, name: job.name,
            head, checkSuite: run.check_suite_id, source: `GitHub Actions run ${run.id} attempt ${run.run_attempt} job ${job.id}`, excerpt });
        }
        const current = await this.api(`actions/runs/${run.id}`);
        if (current.head_sha !== head || current.run_attempt !== run.run_attempt || !failure(current.conclusion)) {
          evidence.status = 'stale'; throw new Error('run/attempt changed during diagnostic retrieval');
        }
      }
      if (checks.some((check) => check.app?.slug === 'github-actions') && !evidence.jobs.length) {
        throw new Error('current GitHub Actions failure has no accessible matching failed-job log');
      }
      const current = JSON.parse(await this.gh('pr', 'view', String(issue.pr.number), '--json', 'headRefOid,state'));
      if (current.headRefOid !== head || current.state !== 'OPEN') {
        evidence.status = 'stale'; evidence.currentHead = current.headRefOid;
        throw new Error('PR head/state changed during diagnostic retrieval');
      }
      if (!evidence.jobs.length && !evidence.checks.some((check) => check.excerpt.trim())) throw new Error('no actionable check output or annotations');
      evidence.status = 'available';
    } catch (error) { evidence.errors.push(String(error.message).slice(0, 1500)); }
    return evidence;
  }
}
