// Explicit opt-in only: no repository tool access or remote publication.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SDKWorkers } from './role-doctrine.mjs';
import { atomicJSON } from '../fleet-state/fleet-state.mjs';
import { loadSDK, resolveRuntime, assertRuntimeEnvironment } from './role-doctrine.runtime.mjs';

const skillsRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function prepareFileSmoke(value) {
  if (!value || !path.isAbsolute(value)) throw new Error('file smoke requires an absolute fresh state directory');
  const directory = path.resolve(value);
  if (directory.startsWith(skillsRoot)) throw new Error('smoke state must be outside the installed skills tree');
  if (fs.lstatSync(directory, { throwIfNoEntry: false })) {
    throw new Error('file smoke requires a fresh directory; existing files, directories and links are never reused');
  }
  const parent = path.dirname(directory);
  if (fs.realpathSync.native(parent) !== parent) throw new Error('file smoke requires an existing canonical parent directory');
  // Exclusive mkdir is the admission point. Nothing in a prior run is written.
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.mkdirSync(path.join(directory, 'fixture'), { mode: 0o700 });
  const input = `bench-synthetic-${randomUUID()}`;
  fs.writeFileSync(path.join(directory, 'fixture/input.txt'), input, { flag: 'wx', mode: 0o600 });
  return { directory, input };
}

async function main(args) {
  const files = args[0] === '--live-files';
  const metadata = args[0] === '--models';
  const live = files || metadata || args[0] === '--live';
  const cache = args[live ? 1 : 0];
  assertRuntimeEnvironment();
  const fixture = files ? prepareFileSmoke(args[2]) : null;
  const runtime = resolveRuntime(cache);
  const { CopilotClient, RuntimeConnection } = await loadSDK(cache);
  if (!live) {
    new CopilotClient({ mode: 'empty', baseDirectory: path.join(runtime.directory, 'import-only'),
      connection: RuntimeConnection.forStdio() });
    console.log(`SDK ${runtime.sdkVersion} import/constructor/API OK from ${runtime.directory}. No runtime/model call.`);
    return;
  }
  const directory = fixture?.directory ?? args[2];
  if (!directory || !path.isAbsolute(directory)) throw new Error('usage: smoke --live ABSOLUTE_CACHE ABSOLUTE_STATE_DIRECTORY');
  if (directory.startsWith(skillsRoot)) throw new Error('smoke state must be outside the installed skills tree');
  if (!files) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const workers = new SDKWorkers({ runtimeDirectory: cache, timeoutMs: 60000, releaseMs: 2000 });
  const startedAt = Date.now();
  let ownership;
  const handle = workers.launch({ smoke: files ? 'files' : true, inspectModels: metadata, role: files ? 'implement' : 'review', slot: 0, cwd: directory,
    work: files ? { paths: ['fixture/input.txt', 'fixture/output.txt'] } : undefined,
    configDirectory: path.join(directory, 'sdk'), doctrine: [], timeoutMs: 30000 }, (pid, owner) => {
    ownership = owner;
    atomicJSON(path.join(directory, 'owner.json'), { pid, ownership: owner });
  });
  const result = await handle.done;
  const receipt = { sdkVersion: runtime.sdkVersion, cache: runtime.directory, elapsedMs: Date.now() - startedAt,
    released: result.released, idle: result.idle ?? false, runtime: result.runtime ?? {},
    error: result.error ?? null, responses: metadata ? 0 : result.result ? 1 : 0, toolsExposed: files ? 4 : 0,
    releaseMechanism: ownership?.kind };
  if (files) {
    const expected = `${fixture.input}\nBENCH_TOOL_OK`;
    const output = path.join(directory, 'fixture/output.txt');
    const expectedHash = createHash('sha256').update(expected).digest('hex');
    receipt.fileRoundtrip = fs.existsSync(output) && fs.readFileSync(output, 'utf8') === expected &&
      fs.readFileSync(path.join(directory, 'fixture/input.txt'), 'utf8') === fixture.input;
    receipt.expectedHash = expectedHash;
    receipt.hostReads = result.reads ?? [];
    receipt.readbackObserved = receipt.hostReads.some((read) => read.path === 'fixture/output.txt' && read.sha256 === expectedHash);
  }
  atomicJSON(path.join(directory, 'result.json'), receipt);
  console.log(JSON.stringify(receipt));
  if (!result.released || result.error || (metadata ? result.result?.status !== 'models' :
    !result.idle || result.result?.evidence !== (files ? 'BENCH_TOOL_OK' : 'BENCH_SMOKE_OK')) ||
    files && (!receipt.fileRoundtrip || !receipt.readbackObserved)) {
    throw new Error(`smoke failed or inconclusive; evidence: ${directory}; no alternative authentication attempted`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
