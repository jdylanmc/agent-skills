import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { command } from '../atomic-proposal/atomic-proposal.mjs';
import { atomicJSON, readJSON } from '../fleet-state/fleet-state.mjs';

const source = fileURLToPath(new URL('../../', import.meta.url));
const skills = path.dirname(source.replace(/[\\/]$/, ''));
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ownerName = 'bench-runtime.json';

export function assertRuntimeEnvironment(environment = process.env) {
  if (environment.COPILOT_CLI_PATH !== undefined && environment.COPILOT_CLI_PATH !== '') {
    throw new Error('COPILOT_CLI_PATH is set. Bench requires the pinned SDK-managed platform runtime; remove the override explicitly before starting Bench. No alternate runtime was invoked.');
  }
}

export function runtimeDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('runtimeDirectory must be an explicit absolute machine-local cache path');
  const directory = path.resolve(value);
  if (directory === skills || directory.startsWith(`${skills}${path.sep}`)) {
    throw new Error('SDK dependencies must be outside the installed skills tree');
  }
  if (fs.existsSync(directory) && fs.realpathSync(directory) !== directory) throw new Error('runtimeDirectory must not traverse symlinks');
  return directory;
}

function provenance() {
  const manifest = readJSON(path.join(source, 'package.json'));
  return { kind: 'bench-squadron-runtime', manifestSha256: sha(path.join(source, 'package.json')),
    lockSha256: sha(path.join(source, 'package-lock.json')), sdkVersion: manifest.dependencies['@github/copilot-sdk'] };
}

export async function setupRuntime(value, { run = command, npm = process.env.npm_execpath } = {}) {
  const directory = runtimeDirectory(value);
  if (!npm || !path.isAbsolute(npm) || !fs.existsSync(npm)) {
    throw new Error('Run setup through npm: npm run setup -- /absolute/machine-local/cache');
  }
  if (fs.existsSync(directory) && fs.readdirSync(directory).length &&
    (!fs.existsSync(path.join(directory, ownerName)) || readJSON(path.join(directory, ownerName)).kind !== 'bench-squadron-runtime')) {
    throw new Error('refusing to install into an unrelated nonempty cache directory');
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  runtimeDirectory(directory);
  const lock = path.join(directory, 'setup.lock');
  fs.mkdirSync(lock, { mode: 0o700 });
  try {
    const receipt = { ...provenance(), ready: false };
    atomicJSON(path.join(directory, ownerName), receipt);
    for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(source, file), path.join(directory, file));
    await run([process.execPath, npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: directory, ownershipDirectory: path.join(directory, 'processes'), timeoutMs: 120000 });
    if (sha(path.join(directory, 'package-lock.json')) !== receipt.lockSha256 ||
      readJSON(path.join(directory, 'node_modules/@github/copilot-sdk/package.json')).version !== receipt.sdkVersion) {
      throw new Error('installed dependency provenance does not match the checked-in lock');
    }
    atomicJSON(path.join(directory, ownerName), { ...receipt, ready: true });
    return { runtimeDirectory: directory, sdkVersion: receipt.sdkVersion, lockSha256: receipt.lockSha256 };
  } finally { fs.rmdirSync(lock); }
}

export function resolveRuntime(value) {
  assertRuntimeEnvironment();
  const directory = runtimeDirectory(value);
  const expected = provenance();
  const failure = () => new Error(`SDK cache missing, incomplete or stale. Run npm run setup -- ${JSON.stringify(directory)} from ${source}`);
  try {
    const receipt = readJSON(path.join(directory, ownerName));
    if (fs.existsSync(path.join(directory, 'setup.lock')) || !receipt.ready ||
      Object.keys(expected).some((key) => receipt[key] !== expected[key]) ||
      sha(path.join(directory, 'package.json')) !== expected.manifestSha256 ||
      sha(path.join(directory, 'package-lock.json')) !== expected.lockSha256) throw failure();
    const resolve = createRequire(path.join(directory, 'package.json')).resolve;
    const entry = fs.realpathSync(resolve('@github/copilot-sdk'));
    if (!entry.startsWith(`${directory}${path.sep}node_modules${path.sep}`) ||
      readJSON(path.join(directory, 'node_modules/@github/copilot-sdk/package.json')).version !== expected.sdkVersion) throw failure();
    return { directory, entry, ...expected };
  } catch { throw failure(); }
}

export async function loadSDK(directory) {
  const resolved = resolveRuntime(directory);
  // The package's supported require export resolves its CJS entry. Dynamic import
  // uses that entry and its own adjacent dependencies, never NODE_PATH.
  const imported = await import(pathToFileURL(resolved.entry).href);
  const sdk = imported.CopilotClient && imported.RuntimeConnection ? imported : imported.default;
  if (typeof sdk?.CopilotClient !== 'function' || typeof sdk?.RuntimeConnection?.forStdio !== 'function') {
    throw new Error('installed SDK exports do not match the pinned API');
  }
  return sdk;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, directory] = process.argv.slice(2);
  (async () => {
    if (operation === 'setup') console.log(JSON.stringify(await setupRuntime(directory)));
    else if (operation === 'inspect') console.log(JSON.stringify(resolveRuntime(directory)));
    else throw new Error('usage: role-doctrine.runtime.mjs setup|inspect ABSOLUTE_CACHE_DIRECTORY');
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
