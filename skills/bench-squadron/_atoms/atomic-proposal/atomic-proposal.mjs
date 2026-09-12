import fs from 'node:fs';
import path from 'node:path';
import { digest, authorizedWorkPath } from '../bench-epoch/bench-epoch.mjs';
import { spawnOwned, ownerReleased, terminateOwned } from '../fleet-state/fleet-state.process.mjs';

export async function command(argv, { cwd, timeoutMs = 120000, env = process.env, onSpawn = () => {}, ownershipDirectory } = {}) {
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
      if (output.length < 1000000) output += data.toString();
      else overflow = true;
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
      if (timedOut || overflow || code !== 0) {
        reject(new Error(`${argv[0]} failed (${timedOut ? 'timeout' : overflow ? 'output limit' : code}): ${output.slice(-8000)}`));
      } else resolve(output.trim());
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
}
