import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const input = createInterface({ input: process.stdin });
let started = false;
input.on('line', (line) => {
  const packet = JSON.parse(line);
  if (packet.cancel || started) return; // The hung fixture deliberately ignores graceful cancellation.
  started = true;
  if (packet.mode === 'complete') {
    process.stdout.write(`${JSON.stringify({ idle: true })}\n`);
    process.stdout.write(`${JSON.stringify({ result: { status: 'implemented', evidence: 'fixture complete', findings: [] } })}\n`);
    input.close(); process.stdin.destroy();
    return;
  }
  const childProgram = `
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(process.argv[1], JSON.stringify({ root: Number(process.argv[2]), child: process.pid, grandchild: grandchild.pid }));
    setInterval(() => {}, 1000);
  `;
  spawn(process.execPath, ['-e', childProgram, packet.pidFile, String(process.pid)], { stdio: 'ignore' }).unref();
  if (packet.mode === 'root-exits') {
    const timer = setInterval(() => {
      if (fs.existsSync(packet.pidFile)) { clearInterval(timer); input.close(); process.stdin.destroy(); }
    }, 20);
  }
});
