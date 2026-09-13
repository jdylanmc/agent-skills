import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const host = fileURLToPath(new URL('./fleet-state.windows.ps1', import.meta.url));
const defaultRoot = fileURLToPath(new URL('../../../../.skill-log/bench-processes/', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function alive(pid, group = false) {
  if (!Number.isSafeInteger(pid) || pid < 2) return true;
  if (group && process.platform === 'win32') return true; // A PID cannot attest a Windows tree.
  try { process.kill(group ? -pid : pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
function powershell() {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
}
function executable(name, env) {
  const directories = path.isAbsolute(name) ? [''] : (env.PATH ?? env.Path ?? '').split(path.delimiter);
  for (const directory of directories) {
    const base = path.resolve(directory, name);
    for (const suffix of path.extname(base) ? [''] : ['.exe', '.com', '.cmd']) {
      if (fs.existsSync(base + suffix)) return base + suffix;
    }
  }
  throw new Error(`Executable not found: ${name}`);
}
function windowsArgv(argv, env) {
  const binary = executable(argv[0], env);
  if (['npm', 'npm.cmd'].includes(path.basename(binary).toLowerCase())) {
    const cli = env.npm_execpath ?? path.join(path.dirname(binary), 'node_modules/npm/bin/npm-cli.js');
    if (!fs.existsSync(cli)) throw new Error('Use an explicit node/npm-cli.js argv for this npm installation');
    return [process.execPath, cli, ...argv.slice(1)];
  }
  if (!/\.(exe|com)$/i.test(binary)) throw new Error('Windows validation requires a native executable or node script, not a shell batch file');
  return [binary, ...argv.slice(1)];
}
export function spawnOwned(argv, options = {}) {
  if (process.platform !== 'win32') {
    const child = spawn(argv[0], argv.slice(1), { ...options, detached: true });
    return { child, owner: { kind: 'posix-group', pid: child.pid } };
  }
  const directory = path.join(options.ownershipDirectory ?? defaultRoot, randomUUID());
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const env = { ...(options.env ?? process.env), TEMP: directory, TMP: directory };
  const [binary, ...args] = windowsArgv(argv, env);
  const spec = path.join(directory, 'owner.json');
  const owner = { kind: 'windows-job', job: `Local\\Bench-${randomUUID()}`, spec,
    receipt: path.join(directory, 'receipt.json') };
  fs.writeFileSync(spec, JSON.stringify({ job: owner.job, receipt: owner.receipt,
    executable: binary, arguments: args, cwd: options.cwd ?? process.cwd(),
    deadlineMs: Date.now() + Math.min(options.timeoutMs ?? 600000, 2147483647), parentPid: process.pid,
    cancelled: path.join(directory, 'cancelled') }), { mode: 0o600 });
  const child = spawn(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', host, '-Operation', 'run', '-Spec', spec],
    { cwd: options.cwd, env, windowsHide: true, stdio: options.stdio ?? ['pipe', 'pipe', 'pipe'] });
  owner.pid = child.pid;
  return { child, owner };
}
async function inspect(owner, terminate = false) {
  if (owner?.kind !== 'windows-job' || !/^Local\\Bench-[0-9a-f-]{36}$/.test(owner.job ?? '')) throw new Error('missing Windows ownership identity');
  const spec = JSON.parse(fs.readFileSync(owner.spec, 'utf8'));
  if (spec.job !== owner.job || spec.receipt !== owner.receipt) throw new Error('Windows ownership receipt changed');
  const receipt = fs.existsSync(owner.receipt) ? JSON.parse(fs.readFileSync(owner.receipt, 'utf8')) : null;
  if (receipt?.stage === 'unowned') {
    throw new Error('refusing to control a job identity owned by another launch');
  }
  if (terminate) {
    fs.writeFileSync(path.join(path.dirname(owner.spec), 'cancelled'), owner.job);
    if (!receipt || receipt.job !== owner.job || !['assigned', 'released', 'failed-released'].includes(receipt.stage)) {
      throw new Error('Windows job assignment has not been proven; cancellation is pending, not termination');
    }
  }
  const output = await new Promise((resolve, reject) => {
    execFile(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', host,
      '-Operation', 'probe', '-Spec', owner.spec], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { ...process.env, TEMP: path.dirname(owner.spec), TMP: path.dirname(owner.spec) },
    }, (error, stdout) => { if (error) reject(error); else resolve(stdout); });
  });
  return JSON.parse(output.trim()).active;
}
export async function ownerReleased(owner, hostExited = false) {
  if (!owner) return false;
  if (owner.kind === 'posix-group') return !alive(owner.pid, true);
  if (process.platform !== 'win32') return false;
  try {
    if (fs.existsSync(owner.receipt) && JSON.parse(fs.readFileSync(owner.receipt, 'utf8')).stage === 'uncertain') return false;
    const active = await inspect(owner);
    return (active === -1 || active === 0) && (hostExited || !alive(owner.pid));
  } catch { return false; }
}
export async function terminateOwned(owner, graceMs = 2000, child) {
  if (owner?.kind === 'posix-group') {
    if (process.platform === 'win32') return false;
    if (!alive(owner.pid, true)) return true;
    try { process.kill(-owner.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') return false; }
    await sleep(graceMs);
    if (alive(owner.pid, true)) {
      try { process.kill(-owner.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') return false; }
      await sleep(graceMs);
    }
    return !alive(owner.pid, true);
  }
  if (process.platform !== 'win32') return false;
  try { await inspect(owner, true); } catch { return false; }
  const deadline = Date.now() + Math.max(graceMs, 1000);
  while (child && child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(25);
  if (child && child.exitCode === null && child.signalCode === null && fs.existsSync(owner.receipt)) {
    try {
      const receipt = JSON.parse(fs.readFileSync(owner.receipt, 'utf8'));
      if (receipt.job === owner.job && ['assigned', 'released', 'failed-released'].includes(receipt.stage)) {
        // ChildProcess retains the native handle of this live launch. Unlike a
        // persisted PID, it cannot redirect termination after PID reuse.
        child.kill('SIGKILL');
        const until = Date.now() + Math.max(graceMs, 1000);
        while (child.exitCode === null && child.signalCode === null && Date.now() < until) await sleep(25);
      }
    } catch { return false; }
  }
  // Never terminate by a persisted PID: it may now name an unrelated process.
  return ownerReleased(owner, child ? child.exitCode !== null || child.signalCode !== null : false);
}
