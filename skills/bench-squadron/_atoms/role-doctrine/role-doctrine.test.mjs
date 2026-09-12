import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { loadDoctrine, fileTools, sessionOptions, executeSession, SDKWorkers } from './role-doctrine.mjs';
import { processAlive } from '../fleet-state/fleet-state.mjs';
import { setupRuntime, resolveRuntime, loadSDK, runtimeDirectory } from './role-doctrine.runtime.mjs';
import { ownerReleased, terminateOwned } from '../fleet-state/fleet-state.process.mjs';
import { normalizeWork } from '../bench-epoch/bench-epoch.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
function directory(t, cleanup = true) {
  const dir = path.join(root, '..', '..', '.test-sandbox', `bench-sdk-files-${randomUUID()}`);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  if (cleanup) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('full canonical doctrine sources and exact model identity enter every fresh session packet', () => {
  const doctrine = loadDoctrine(['code', 'testing']);
  assert.equal(doctrine.length, 2);
  assert.ok(doctrine.every((d) => d.text.length > 100 && d.sha256.length === 64));
  const options = sessionOptions({ role: 'review', slot: 2, model: 'operator-model', cwd: root,
    work: { paths: ['src'] }, doctrine });
  for (const d of doctrine) assert.ok(options.systemMessage.content.includes(d.text));
  assert.equal(options.model, 'operator-model');
  assert.deepEqual(options.excludedTools, ['builtin:*', 'mcp:*']);
  assert.equal(options.onPermissionRequest({ kind: 'shell' }).kind, 'reject');
  assert.equal(options.enableConfigDiscovery, false);
  assert.ok(options.availableTools.every((n) => n.startsWith('custom:bench_')));
  assert.throws(() => loadDoctrine(['unknown-doctrine']), /not in manifest/);
});
test('SDK seam creates genuinely fresh sessions and binds real idle events separately from returned messages', async () => {
  const sessions = [], events = [];
  const client = {
    start: async () => {},
    listModels: async () => [{ id: 'selected' }],
    createSession: async (options) => {
      const handlers = new Map();
      const session = { options, on: (name, handler) => handlers.set(name, handler),
        sendAndWait: async (options, timeout) => {
          assert.deepEqual(Object.keys(options), ['prompt']);
          assert.equal(typeof options.prompt, 'string');
          assert.ok(options.prompt.includes('requirement')); assert.equal(timeout, 1000);
          handlers.get('session.idle')();
          return { data: { content: '{"status":"implemented","evidence":"file changed","findings":[]}' } };
        } };
      sessions.push(session);
      return session;
    },
    resumeSession: () => assert.fail('must never resume'),
  };
  const packet = { role: 'implement', model: 'selected', slot: 0, cwd: root, timeoutMs: 1000,
    doctrine: loadDoctrine(['code']), work: { requirements: 'requirement', paths: ['src'] } };
  await executeSession(client, packet, { emit: (e) => events.push(e) });
  await executeSession(client, { ...packet, slot: 1 }, { emit: (e) => events.push(e) });
  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0], sessions[1]);
  assert.equal(events.filter((e) => e.idle).length, 2);
  assert.equal(sessions[0].options.onPermissionRequest({ kind: 'shell' }).kind, 'reject');
  await assert.rejects(executeSession(client, { ...packet, model: 'not-available' }, { emit() {} }), /not advertised/);
  assert.equal(sessions.length, 2);
});
test('SDK cancellation before creation prevents a late new owner', async () => {
  const client = { start: async () => {}, createSession: () => assert.fail('cancelled creation') };
  await assert.rejects(executeSession(client, {}, { emit() {}, cancelled: () => true }), /cancelled/);
});
test('smoke selects only a returned advertised model and exposes zero tools', async () => {
  let selected, calls = 0;
  const events = [];
  const client = { start: async () => {}, getAuthStatus: async () => ({ isAuthenticated: true }),
    listModels: async () => [{ id: 'runtime-choice' }],
    createSession: async (options) => {
      selected = options.model;
      assert.deepEqual(options.availableTools, []);
      assert.deepEqual(options.tools, []);
      assert.equal(options.onPermissionRequest({ kind: 'shell' }).kind, 'reject');
      return { on() {}, sendAndWait: async (options) => {
        assert.deepEqual(Object.keys(options), ['prompt']); assert.equal(typeof options.prompt, 'string');
        calls++;
        return { data: { content: '{"evidence":"BENCH_SMOKE_OK"}' } };
      } };
    } };
  await executeSession(client, { smoke: true, role: 'review', slot: 0, doctrine: [], timeoutMs: 100 },
    { emit: (event) => events.push(event) });
  assert.equal(selected, 'runtime-choice');
  assert.equal(calls, 1);
  assert.deepEqual(events.find((event) => event.advertisedModels).advertisedModels, ['runtime-choice']);
});
test('missing auth stops smoke before model selection or any response', async () => {
  const client = { start: async () => {}, getAuthStatus: async () => ({ isAuthenticated: false }),
    listModels: () => assert.fail('must not select a model without existing auth') };
  await assert.rejects(executeSession(client, { smoke: true }, { emit() {} }), /no alternative authentication/);
});
test('setup installs only pinned source manifests into an explicit external cache and resolves exports there', async (t) => {
  const parent = directory(t);
  const cache = path.join(parent, 'runtime');
  const npm = path.join(parent, 'npm-cli.cjs');
  fs.writeFileSync(npm, '// deterministic npm process fixture');
  let calls = 0;
  const receipt = await setupRuntime(cache, { npm, run: async (argv, options) => {
    calls++;
    assert.deepEqual(argv, [process.execPath, npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    assert.equal(options.cwd, cache);
    assert.equal(fs.readFileSync(path.join(cache, 'package-lock.json'), 'utf8'),
      fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const sdk = path.join(cache, 'node_modules/@github/copilot-sdk');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ version: '1.0.13', exports: './index.cjs' }));
    fs.writeFileSync(path.join(sdk, 'index.cjs'), 'module.exports = { CopilotClient: class {}, RuntimeConnection: { forStdio() {} } };');
  } });
  assert.equal(calls, 1);
  assert.equal(receipt.sdkVersion, '1.0.13');
  assert.ok(resolveRuntime(cache).entry.startsWith(path.join(cache, 'node_modules')));
  assert.equal(typeof (await loadSDK(cache)).CopilotClient, 'function');
  fs.appendFileSync(path.join(cache, 'package-lock.json'), ' ');
  assert.throws(() => resolveRuntime(cache), /missing, incomplete or stale/);
});
test('cache admission rejects source-tree installs, unrelated directories and missing setup without fallback', async (t) => {
  const parent = directory(t);
  assert.throws(() => runtimeDirectory(path.join(root, 'cache')), /outside the installed skills tree/);
  assert.throws(() => resolveRuntime(path.join(parent, 'missing')), /npm run setup/);
  fs.writeFileSync(path.join(parent, 'unrelated.txt'), 'preserve');
  await assert.rejects(setupRuntime(parent, { npm: process.execPath, run: () => assert.fail('must not install') }), /unrelated nonempty/);
  assert.equal(fs.readFileSync(path.join(parent, 'unrelated.txt'), 'utf8'), 'preserve');
});
test('review has read/list only; writer paths cannot escape via traversal or links', (t) => {
  const cwd = directory(t);
  const packet = { cwd, role: 'implement', work: { paths: ['src'] } };
  const observed = [];
  const writer = fileTools(packet, (read) => observed.push(read));
  const write = writer.find((tool) => tool.name === 'bench_write').handler;
  const read = writer.find((tool) => tool.name === 'bench_read').handler;
  write({ path: 'src/file.txt', content: 'hello' });
  assert.equal(read({ path: 'src/file.txt' }), 'hello');
  assert.equal(observed[0].path, 'src/file.txt');
  assert.equal(observed[0].sha256.length, 64);
  for (const name of ['../outside', 'src/../../outside', '.git/config', 'src/.env', '/etc/passwd']) {
    assert.throws(() => write({ path: name, content: 'denied' }));
  }
  if (process.platform !== 'win32') {
    fs.symlinkSync(cwd, path.join(cwd, 'src', 'link'));
    assert.throws(() => read({ path: 'src/link/src/file.txt' }), /symlink/);
    fs.linkSync(path.join(cwd, 'src/file.txt'), path.join(cwd, 'src/hard.txt'));
    assert.throws(() => write({ path: 'src/hard.txt', content: 'denied' }), /hard-linked/);
  }
  assert.deepEqual(fileTools({ ...packet, role: 'review' }).map((tool) => tool.name), ['bench_read', 'bench_list']);
});
test('authorized workflow and ignore-file repair works through the actual constrained file tools', (t) => {
  const cwd = directory(t);
  const work = normalizeWork({ id: 'ci', title: 'Repair CI', requirements: 'Repair only the agreed files.',
    paths: ['.github/workflows', '.gitignore'], validation: [['node', '--test']] });
  const tools = Object.fromEntries(fileTools({ cwd, role: 'implement', work }).map((tool) => [tool.name, tool.handler]));
  tools.bench_write({ path: '.github/workflows/ci.yml', content: 'name: CI\n' });
  tools.bench_write({ path: '.github/workflows/.settings.yml', content: 'enabled: true\n' });
  tools.bench_write({ path: '.gitignore', content: 'build/\n' });
  assert.equal(tools.bench_read({ path: '.github/workflows/ci.yml' }), 'name: CI\n');
  assert.equal(tools.bench_read({ path: '.gitignore' }), 'build/\n');
  assert.deepEqual(tools.bench_list({ path: '.github/workflows' }).map((entry) => entry.name).sort(),
    ['.settings.yml', 'ci.yml']);
  assert.throws(() => tools.bench_list({ path: '.' }), /outside assignment/);
  assert.throws(() => tools.bench_list({ path: '.github' }), /outside assignment/);
  assert.throws(() => tools.bench_write({ path: '.github/other.yml', content: 'denied' }), /outside assignment/);
  tools.bench_delete({ path: '.github/workflows/.settings.yml' });
  assert.equal(fs.existsSync(path.join(cwd, '.github/workflows/.settings.yml')), false);
  const reviewer = Object.fromEntries(fileTools({ cwd, role: 'review', work }).map((tool) => [tool.name, tool.handler]));
  assert.equal(reviewer.bench_read({ path: '.gitignore' }), 'build/\n');
  assert.deepEqual(Object.keys(reviewer), ['bench_read', 'bench_list']);
});
test('broad authorized dot directories still cannot expose state or credentials, including directory listings', (t) => {
  const cwd = directory(t);
  const work = { paths: ['.github', '.config', 'src'] };
  fs.mkdirSync(path.join(cwd, '.github'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.github/.env'), 'synthetic fixture, not a credential');
  fs.writeFileSync(path.join(cwd, '.github/.gitignore'), 'cache/\n');
  const tools = Object.fromEntries(fileTools({ cwd, role: 'implement', work }).map((tool) => [tool.name, tool.handler]));
  assert.deepEqual(tools.bench_list({ path: '.github' }).map((entry) => entry.name), ['.gitignore']);
  for (const value of ['../outside', '.git/config', '.github/.git/state.json', '.github/.bench/state.json',
    '.github/.skill-log/log.json', '.github/.copilot/session-state/session.json', '.github/.env',
    '.github/.ssh/id_rsa', '.config/gh/hosts.yml', 'src/.secrets.json', 'src/.npmrc']) {
    assert.throws(() => tools.bench_read({ path: value }), undefined, value);
    assert.throws(() => tools.bench_write({ path: value, content: 'denied' }), undefined, value);
    assert.throws(() => tools.bench_delete({ path: value }), undefined, value);
  }
  assert.equal(fs.readFileSync(path.join(cwd, '.github/.env'), 'utf8'), 'synthetic fixture, not a credential');
});
test('authorized dot paths cannot follow directory links or hard-linked files outside their prefix', (t) => {
  const cwd = directory(t);
  fs.mkdirSync(path.join(cwd, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'outside'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'outside/fixture.yml'), 'outside synthetic fixture');
  fs.symlinkSync(path.join(cwd, 'outside'), path.join(cwd, '.github/workflows/link'),
    process.platform === 'win32' ? 'junction' : 'dir');
  fs.linkSync(path.join(cwd, 'outside/fixture.yml'), path.join(cwd, '.github/workflows/hard.yml'));
  const tools = Object.fromEntries(fileTools({ cwd, role: 'implement', work: { paths: ['.github/workflows'] } })
    .map((tool) => [tool.name, tool.handler]));
  for (const name of ['.github/workflows/link/fixture.yml', '.github/workflows/hard.yml']) {
    assert.throws(() => tools.bench_read({ path: name }), /symlink|hard-linked/);
    assert.throws(() => tools.bench_write({ path: name, content: 'denied' }), /symlink|hard-linked/);
    assert.throws(() => tools.bench_delete({ path: name }), /symlink|hard-linked/);
  }
  assert.deepEqual(tools.bench_list({ path: '.github/workflows' }), []);
  assert.equal(fs.readFileSync(path.join(cwd, 'outside/fixture.yml'), 'utf8'), 'outside synthetic fixture');
});
test('dangling dot-path symlinks cannot turn a scoped write into an out-of-scope file creation', {
  skip: process.platform === 'win32',
}, (t) => {
  const cwd = directory(t);
  fs.mkdirSync(path.join(cwd, '.github/workflows'), { recursive: true });
  const outside = path.join(cwd, 'outside-missing.yml');
  fs.symlinkSync(outside, path.join(cwd, '.github/workflows/dangling.yml'));
  const write = fileTools({ cwd, role: 'implement', work: { paths: ['.github/workflows'] } })
    .find((tool) => tool.name === 'bench_write').handler;
  assert.throws(() => write({ path: '.github/workflows/dangling.yml', content: 'denied' }), /symlink/);
  assert.equal(fs.existsSync(outside), false);
});
test('real child-process double proves idle/result and process-group release before reuse', { skip: process.platform === 'win32' }, async () => {
  const workers = new SDKWorkers({ timeoutMs: 3000, releaseMs: 50,
    worker: new URL('./role-doctrine.fixture.mjs', import.meta.url) });
  let saved;
  const handle = workers.launch({ mode: 'complete' }, (pid) => { saved = pid; });
  const result = await handle.done;
  assert.equal(saved, handle.pid);
  assert.equal(result.released, true);
  assert.equal(result.idle, true);
  assert.equal(processAlive(handle.pid, true), false);
});
test('hung worker cancellation is bounded and kills its actual process group', { skip: process.platform === 'win32' }, async () => {
  const workers = new SDKWorkers({ timeoutMs: 150, releaseMs: 50,
    worker: new URL('./role-doctrine.fixture.mjs', import.meta.url) });
  const handle = workers.launch({ mode: 'hang' }, () => {});
  const result = await handle.done;
  assert.equal(result.released, true);
  assert.match(result.error, /cancelled|deadline/);
  assert.equal(processAlive(handle.pid, true), false);
});

const windowsOnly = { skip: process.platform !== 'win32', timeout: 90000 };
async function waitForFile(file) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`actual Windows fixture did not become ready: ${file}`);
}
function windowsWorkers() {
  return new SDKWorkers({ timeoutMs: 60000, releaseMs: 1000,
    worker: new URL('./role-doctrine.windows.fixture.mjs', import.meta.url) });
}
function cleanupWindows(t, handle, directory) {
  t.after(async () => {
    await handle.cancel();
    if (!(await handle.done).released) throw new Error(`Windows cleanup uncertain; ownership evidence retained at ${directory}`);
    fs.rmSync(directory, { recursive: true, force: true });
  });
}
test('Windows native job observes actual normal child exit before releasing a slot', windowsOnly, async (t) => {
  const configDirectory = directory(t, false);
  let persisted;
  const handle = windowsWorkers().launch({ mode: 'complete', configDirectory }, (pid, owner) => {
    persisted = JSON.parse(JSON.stringify(owner));
    assert.equal(owner.pid, pid);
  });
  cleanupWindows(t, handle, configDirectory);
  const outcome = await handle.done;
  assert.equal(outcome.error, null);
  assert.equal(outcome.idle, true);
  assert.equal(outcome.released, true);
  assert.equal(persisted.kind, 'windows-job');
  assert.equal(await ownerReleased(persisted), true);
});
test('Windows forced cancellation drains actual child and grandchild, not just the root PID', windowsOnly, async (t) => {
  const configDirectory = directory(t, false), pidFile = path.join(configDirectory, 'pids.json');
  const handle = windowsWorkers().launch({ mode: 'hang', configDirectory, pidFile }, () => {});
  cleanupWindows(t, handle, configDirectory);
  const pids = await waitForFile(pidFile);
  for (const pid of Object.values(pids)) assert.equal(processAlive(pid), true);
  const restored = JSON.parse(JSON.stringify(handle.owner));
  assert.equal(await ownerReleased(restored), false);
  await handle.cancel();
  const outcome = await handle.done;
  assert.equal(outcome.released, true);
  assert.match(outcome.error, /cancelled/);
  for (const pid of Object.values(pids)) assert.equal(processAlive(pid), false);
  assert.equal(await ownerReleased(restored), true);
});
test('Windows root exit cannot leave a live descendant tree behind', windowsOnly, async (t) => {
  const configDirectory = directory(t, false), pidFile = path.join(configDirectory, 'pids.json');
  const handle = windowsWorkers().launch({ mode: 'root-exits', configDirectory, pidFile }, () => {});
  cleanupWindows(t, handle, configDirectory);
  const pids = await waitForFile(pidFile);
  const outcome = await handle.done;
  assert.equal(outcome.released, true);
  assert.equal(outcome.idle, false); // A process exit is not SDK completion.
  for (const pid of Object.values(pids)) assert.equal(processAlive(pid), false);
});
test('Windows stale PID ownership never kills an unrelated live process and uncertainty blocks release', windowsOnly, async (t) => {
  const configDirectory = directory(t, false);
  const handle = windowsWorkers().launch({ mode: 'complete', configDirectory }, () => {});
  cleanupWindows(t, handle, configDirectory);
  assert.equal((await handle.done).released, true);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(async () => {
    const exit = once(unrelated, 'exit');
    unrelated.kill();
    await exit;
  });
  const stale = { ...handle.owner, pid: unrelated.pid };
  assert.equal(await terminateOwned(stale, 100), false);
  assert.equal(processAlive(unrelated.pid), true);
  const spec = JSON.parse(fs.readFileSync(handle.owner.spec, 'utf8'));
  fs.writeFileSync(handle.owner.receipt, JSON.stringify({ job: spec.job, stage: 'uncertain' }));
  assert.equal(await ownerReleased(handle.owner, true), false);
});
