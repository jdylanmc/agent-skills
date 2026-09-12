// Explicit opt-in only: no repository tool access or remote publication.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SDKWorkers } from './role-doctrine.mjs';
import { atomicJSON } from '../fleet-state/fleet-state.mjs';
import { loadSDK, resolveRuntime } from './role-doctrine.runtime.mjs';

const files = process.argv[2] === '--live-files';
const metadata = process.argv[2] === '--models';
const live = files || metadata || process.argv[2] === '--live';
const cache = process.argv[live ? 3 : 2];
const runtime = resolveRuntime(cache);
const { CopilotClient, RuntimeConnection } = await loadSDK(cache);
if (!live) {
  new CopilotClient({ mode: 'empty', baseDirectory: path.join(runtime.directory, 'import-only'),
    connection: RuntimeConnection.forStdio() });
  console.log(`SDK ${runtime.sdkVersion} import/constructor/API OK from ${runtime.directory}. No runtime/model call.`);
} else {
  const directory = process.argv[4];
  if (!directory || !path.isAbsolute(directory)) throw new Error('usage: smoke --live ABSOLUTE_CACHE ABSOLUTE_STATE_DIRECTORY');
  if (directory.startsWith(fileURLToPath(new URL('../../../', import.meta.url)))) throw new Error('smoke state must be outside the installed skills tree');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const input = `bench-synthetic-${randomUUID()}`;
  if (files) {
    fs.mkdirSync(path.join(directory, 'fixture'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'fixture/input.txt'), input);
    if (fs.existsSync(path.join(directory, 'fixture/output.txt'))) throw new Error('use a fresh synthetic smoke directory');
  }
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
    const expected = `${input}\nBENCH_TOOL_OK`;
    const output = path.join(directory, 'fixture/output.txt');
    const expectedHash = createHash('sha256').update(expected).digest('hex');
    receipt.fileRoundtrip = fs.existsSync(output) && fs.readFileSync(output, 'utf8') === expected &&
      fs.readFileSync(path.join(directory, 'fixture/input.txt'), 'utf8') === input;
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
