// Explicit opt-in only: no repository tool access or remote publication.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDKWorkers } from './role-doctrine.mjs';
import { atomicJSON } from '../fleet-state/fleet-state.mjs';
import { loadSDK, resolveRuntime } from './role-doctrine.runtime.mjs';

const live = process.argv[2] === '--live';
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
  const workers = new SDKWorkers({ runtimeDirectory: cache, timeoutMs: 60000, releaseMs: 2000 });
  const startedAt = Date.now();
  let ownership;
  const handle = workers.launch({ smoke: true, role: 'review', slot: 0, cwd: directory,
    configDirectory: directory, doctrine: [], timeoutMs: 30000 }, (pid, owner) => {
    ownership = owner;
    atomicJSON(path.join(directory, 'owner.json'), { pid, ownership: owner });
  });
  const result = await handle.done;
  const receipt = { sdkVersion: runtime.sdkVersion, cache: runtime.directory, elapsedMs: Date.now() - startedAt,
    released: result.released, idle: result.idle ?? false, runtime: result.runtime ?? {},
    error: result.error ?? null, responses: result.result ? 1 : 0, toolsExposed: 0,
    releaseMechanism: ownership?.kind };
  atomicJSON(path.join(directory, 'result.json'), receipt);
  console.log(JSON.stringify(receipt));
  if (!result.released || !result.idle || result.error || result.result?.evidence !== 'BENCH_SMOKE_OK') {
    throw new Error(`smoke failed or inconclusive; evidence: ${directory}; no alternative authentication attempted`);
  }
}
