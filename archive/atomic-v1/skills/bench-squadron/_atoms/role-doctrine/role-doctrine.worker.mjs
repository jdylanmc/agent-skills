import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { executeSession } from './role-doctrine.mjs';
import { loadSDK, assertRuntimeEnvironment } from './role-doctrine.runtime.mjs';

let client, session, closing = false, accepted = false;
let input;
function emit(event) {
  if (process.connected) process.send(event);
  else if (process.platform === 'win32') process.stdout.write(`${JSON.stringify(event)}\n`);
}
async function stop() {
  if (closing) return;
  closing = true;
  try {
    if (session) await session.abort();
    const errors = client ? await client.stop() : [];
    if (errors.length) throw new Error(errors.map((e) => e.message).join('; '));
    process.exitCode = 0;
  } catch { process.exitCode = 1; }
  finally {
    if (process.connected) process.disconnect();
    if (input) { input.close(); process.stdin.destroy(); }
  }
}
process.on('disconnect', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
async function receive(packet) {
  if (packet.cancel) { await stop(); return; }
  if (accepted || closing) return;
  accepted = true;
  try {
    const { CopilotClient, RuntimeConnection } = await loadSDK(packet.runtimeDirectory);
    if (closing) return;
    assertRuntimeEnvironment();
    fs.mkdirSync(packet.configDirectory, { recursive: true, mode: 0o700 });
    client = new CopilotClient({ mode: 'empty', connection: RuntimeConnection.forStdio(),
      baseDirectory: packet.configDirectory, workingDirectory: packet.cwd, logLevel: 'error', useLoggedInUser: true });
    const result = await executeSession(client, packet, { emit,
      acceptSession: (created) => { session = created; }, cancelled: () => closing });
    emit({ result });
  } catch (error) { emit({ error: error.message }); }
  finally { await stop(); }
}
if (process.platform === 'win32') {
  input = createInterface({ input: process.stdin });
  input.on('line', (line) => { try { void receive(JSON.parse(line)); } catch { void stop(); } });
  process.stdin.on('end', () => { void stop(); });
} else process.on('message', receive);
