import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Source-checkout maintenance only. The released skills CLI remains the installer.
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, '.agents/skills/setup');
const write = process.argv.slice(2).includes('--write');
if (process.argv.slice(2).some(arg => arg !== '--write')) {
  throw new Error('Usage: node scripts/sync-pack-resources.mjs [--write]');
}

const copies = [
  'LICENSE',
  'provenance/skills-lock.json',
  ...readdirSync(path.join(root, 'licenses')).sort().map(name => `licenses/${name}`),
];
const resources = new Map(copies.map(name => [name, readFileSync(path.join(root, name))]));
// Keep the entire canonical notice, changing only source-checkout link destinations.
resources.set('NOTICE.md', Buffer.from(readFileSync(path.join(root, 'NOTICE.md'), 'utf8')
  .replaceAll('./.agents/skills/setup/COMMIT-STYLE.md', './COMMIT-STYLE.md')
  .replaceAll('./archive/atomic-v1/NOTICE.md',
    'https://github.com/jdylanmc/agent-skills/blob/main/archive/atomic-v1/NOTICE.md')));

let mismatches = 0;
for (const [name, content] of resources) {
  const target = path.join(destination, name);
  if (write) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  } else {
    let actual;
    try { actual = readFileSync(target); } catch { /* Report missing bundled resource below. */ }
    if (!actual?.equals(content)) {
      console.error(`Bundled resource missing or stale: ${name}`);
      mismatches++;
    }
  }
}
if (mismatches) {
  console.error('Run node scripts/sync-pack-resources.mjs --write and review the copies.');
  process.exitCode = 1;
} else {
  console.log(`${resources.size} bundled resources ${write ? 'synchronized' : 'verified'}.`);
}
