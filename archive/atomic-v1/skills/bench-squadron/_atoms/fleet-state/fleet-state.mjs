import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { alive } from './fleet-state.process.mjs';

export function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const pending = `${file}.${randomUUID()}.pending`;
  const fd = fs.openSync(pending, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(pending, file);
  if (process.platform !== 'win32') {
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  }
}
export const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
export function processAlive(pid, group = false) {
  return alive(pid, group);
}

export class Store {
  constructor(directory) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    // Machine state must not be redirected through symlinks.
    if (fs.realpathSync(this.directory) !== this.directory) throw new Error('state directory must be canonical, not a symlink');
    this.file = path.join(this.directory, 'state.json');
    this.lock = path.join(this.directory, 'controller.lock');
  }
  acquire(recover = false) {
    try { fs.mkdirSync(this.lock, { mode: 0o700 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const recovery = path.join(this.directory, 'recovery.lock');
      if (!recover) throw new Error('controller ownership is live or uncertain; do not remove its lock');
      fs.mkdirSync(recovery, { mode: 0o700 });
      try {
        const ownerFile = path.join(this.lock, 'owner.json');
        if (!fs.existsSync(ownerFile) || processAlive(readJSON(ownerFile).pid)) {
          throw new Error('controller ownership is live or uncertain; do not remove its lock');
        }
        fs.rmSync(this.lock, { recursive: true });
        fs.mkdirSync(this.lock, { mode: 0o700 });
      } finally {
        fs.rmSync(recovery, { recursive: true });
      }
    }
    this.token = randomUUID();
    atomicJSON(path.join(this.lock, 'owner.json'), { pid: process.pid, token: this.token });
  }
  load() { return fs.existsSync(this.file) ? readJSON(this.file) : null; }
  save(state) {
    if (readJSON(path.join(this.lock, 'owner.json')).token !== this.token) throw new Error('lost controller ownership');
    atomicJSON(this.file, state);
  }
  release() {
    if (this.token && readJSON(path.join(this.lock, 'owner.json')).token === this.token) {
      fs.rmSync(this.lock, { recursive: true });
    }
    this.token = null;
  }
  send(command, { id = randomUUID(), timeoutMs = 2000 } = {}) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(id) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000) throw new Error('invalid submission identity or bounded lock wait');
    const lock = path.join(this.directory, 'inbox-publish.lock');
    const deadline = Date.now() + timeoutMs;
    while (true) {
      try { fs.mkdirSync(lock, { mode: 0o700 }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const ownerFile = path.join(lock, 'owner.json');
        const recovery = path.join(this.directory, 'inbox-recovery.lock');
        let publisher;
        try { publisher = readJSON(ownerFile); }
        catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
        if (publisher && !processAlive(publisher.pid)) {
          let acquired = false;
          try {
            fs.mkdirSync(recovery); acquired = true;
            if (fs.existsSync(ownerFile) && !processAlive(readJSON(ownerFile).pid)) fs.rmSync(lock, { recursive: true });
          } catch (failure) { if (failure.code !== 'EEXIST' && failure.code !== 'ENOENT') throw failure; }
          finally { if (acquired) fs.rmdirSync(recovery); }
        }
        if (Date.now() >= deadline) throw new Error('inbox publication lock busy or interrupted; submission not acknowledged; inspect publisher ownership before retry');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try {
      atomicJSON(path.join(lock, 'owner.json'), { pid: process.pid, id });
      const cursor = path.join(this.directory, 'inbox-sequence.json');
      const sequence = (fs.existsSync(cursor) ? readJSON(cursor).sequence : 0) + 1;
      if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('invalid or exhausted inbox sequence');
      // Reserve durably before publication. Failures may leave a gap, never reuse an order number.
      atomicJSON(cursor, { sequence });
      atomicJSON(path.join(this.directory, 'inbox', `${String(sequence).padStart(16, '0')}-${id}.json`),
        { ...command, id, sequence });
      return id;
    } finally { fs.rmSync(lock, { recursive: true }); }
  }
  commands() {
    const inbox = path.join(this.directory, 'inbox');
    if (!fs.existsSync(inbox)) return [];
    const entries = fs.readdirSync(inbox).filter((f) => f.endsWith('.json'))
      .map((f) => ({ file: path.join(inbox, f), command: readJSON(path.join(inbox, f)) }));
    const seen = new Set();
    for (const { command } of entries) {
      if (!Number.isSafeInteger(command.sequence) || command.sequence < 1 || seen.has(command.sequence)) {
        throw new Error('unsequenced or ambiguous inbox publication; operator reconciliation required');
      }
      seen.add(command.sequence);
    }
    return entries.sort((a, b) => a.command.sequence - b.command.sequence);
  }
}
