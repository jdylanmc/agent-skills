import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const installSource = process.env.SKILLS_PACK_SOURCE ?? root;
const expected = [
  'automate-this', 'breakdown-tickets', 'caveman', 'changelog', 'chart-a-course', 'conflicts',
  'discovery', 'doctrine', 'domain-modeling', 'eli5', 'evolve-architecture',
  'handoff', 'interrogate', 'joe-mode', 'migration', 'patch', 'poc', 'refactor',
  'research', 'retro', 'roast', 'scout', 'setup', 'shepherd', 'ship', 'specify',
  'squadron', 'status-report', 'synthesize', 'tdd', 'triage', 'verify', 'wait-what',
];
const originalNames = expected.filter(name => name !== 'chart-a-course');

// Frozen from the approved pre-distribution base c01ac0b4b9d20a11ea10952714ccddd188b590b7.
// Changes require explicit human authorization, not automatic fixture regeneration.
function digestFiles(filenames, select = bytes => bytes) {
  const hash = createHash('sha256');
  for (const filename of filenames.sort()) {
    hash.update(`${filename}\0`);
    hash.update(select(readFileSync(path.join(root, filename))));
    hash.update('\0');
  }
  return hash.digest('hex');
}

test('protected human intents and complete doctrine sources remain byte-preserved', () => {
  const sources = files(path.join(root, '.agents/skills'))
    .map(filename => path.relative(root, filename).split(path.sep).join('/'))
    .filter(filename => filename.endsWith('/intent.md') || filename.includes('/doctrines/'))
    .filter(filename => filename !== '.agents/skills/chart-a-course/intent.md')
    // Only Shepherd intent was authorized for the adaptive/recovery extension.
    .filter(filename => filename !== '.agents/skills/shepherd/intent.md');
  sources.push('intent.md');
  assert.equal(sources.length, 36);
  assert.equal(digestFiles(sources), 'b005d1f5bd7956854c85f2c10f157c6c46f53e0f296a734fea8e0a8eb52354ff');
});

test('specifically authorized Shepherd intent remains pinned to the extension', () => {
  const intent = readFileSync(path.join(root, '.agents/skills/shepherd/intent.md'));
  assert.equal(createHash('sha256').update(intent).digest('hex'),
    '57e4a3bbf91ef2bb561d5067228791b92a1212e700390870a17cb7c01ed06344');
});

test('all original entrypoint metadata, including invocation flags, is preserved', () => {
  const sources = originalNames.map(name => `.agents/skills/${name}/SKILL.md`);
  assert.equal(digestFiles(sources, bytes => bytes.toString().split('---\n')[1]),
    '905838679a8cc014523fe647d1e2d25c39db8c3105a921ceca247bce48e77ed2');
});

test('import provenance bytes survive outside active installer state', () => {
  assert.ok(!existsSync(path.join(root, 'skills-lock.json')), 'authored packages must not be filtered as imports');
  assert.equal(createHash('sha256').update(readFileSync(path.join(root, 'provenance/skills-lock.json'))).digest('hex'),
    '1f7e9dd337cc35decefe0994e25e45e4dd47ecda96d5fa1bf5967518c3ce7651');
});

test('original repository and upstream license bytes remain intact', () => {
  const sources = files(path.join(root, 'licenses'))
    .map(filename => path.relative(root, filename).split(path.sep).join('/'));
  sources.push('LICENSE');
  assert.equal(digestFiles(sources), '48afabe4dc4874b94cd72f6bca7cffc8d31a6aeb84102af0ad91244d8f123636');
});

function files(directory) {
  return readdirSync(directory).sort().flatMap(name => {
    const filename = path.join(directory, name);
    const stat = lstatSync(filename);
    assert.ok(!stat.isSymbolicLink(), `copy pack must not contain symlinks: ${filename}`);
    return stat.isDirectory() ? files(filename) : [filename];
  });
}

function snapshot(directory) {
  return Object.fromEntries(files(directory).map(filename => [
    path.relative(directory, filename),
    createHash('sha256').update(readFileSync(filename)).digest('hex'),
  ]));
}

function markdownLinks(text) {
  // Fenced examples describe consumer files, not dependencies of this package.
  let fence;
  const prose = text.split('\n').filter(line => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return false;
    }
    return !fence;
  }).join('\n');
  return [
    ...prose.matchAll(/\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^)]*)?\)/g),
    ...prose.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm),
  ].map(match => match[1]);
}

function assertPortable(directory) {
  for (const filename of files(directory).filter(filename => filename.endsWith('.md'))) {
    for (const link of markdownLinks(readFileSync(filename, 'utf8'))) {
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue;
      const target = path.resolve(path.dirname(filename), decodeURIComponent(link.split('#')[0]));
      const relative = path.relative(directory, target);
      assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
        `${filename}: dependency escapes installed pack: ${link}`);
      assert.ok(existsSync(target), `${filename}: missing installed dependency: ${link}`);
    }
  }
}

function assertLifecycleSupport(directory) {
  const contracts = [
    'squadron/LIFECYCLE.md', 'squadron/LIFECYCLE-SCENARIOS.md',
    'ship/WORKSPACE.md', 'ship/DELIVERY.md',
    'shepherd/OBSERVATION.md', 'shepherd/RECOVERY.md', 'shepherd/SCENARIOS.md',
  ].map(name => path.join(directory, name));
  for (const contract of contracts) assert.ok(readFileSync(contract).length > 0, contract);

  for (const entry of [
    'squadron/SKILL.md', 'ship/SKILL.md', 'ship/WORKER.md',
    'joe-mode/SKILL.md', 'joe-mode/RUNTIME.md', 'shepherd/SKILL.md',
    'handoff/SKILL.md', 'patch/SKILL.md', 'refactor/SKILL.md', 'setup/INVOCATION.md',
  ]) {
    const pending = [path.join(directory, entry)];
    const visited = new Set();
    while (pending.length) {
      const filename = pending.pop();
      if (visited.has(filename)) continue;
      visited.add(filename);
      for (const link of markdownLinks(readFileSync(filename, 'utf8'))) {
        if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue;
        const target = path.resolve(path.dirname(filename), decodeURIComponent(link.split('#')[0]));
        if (target.endsWith('.md')) pending.push(target);
      }
    }
    for (const contract of contracts) {
      assert.ok(visited.has(contract), `${entry}: unreachable supporting contract ${contract}`);
    }
  }
}

test('lifecycle guidance and review scenarios are reachable through local package links', () => {
  assertLifecycleSupport(path.join(root, '.agents/skills'));
});

test('Chart-a-course is a portable, human- and model-invocable local package', () => {
  const directory = path.join(root, '.agents/skills');
  const skill = readFileSync(path.join(directory, 'chart-a-course/SKILL.md'), 'utf8');
  const metadata = skill.split('---\n')[1];
  assert.equal(createHash('sha256').update(metadata).digest('hex'),
    '7d74b4658ddec3e58897117555d7303b6aa612927648284ce7501d67dc930426');
  assert.match(metadata, /^name: chart-a-course$/m);
  assert.match(metadata, /^disable-model-invocation: false$/m);
  assert.match(metadata, /^user-invocable: true$/m);
  assert.ok(readFileSync(path.join(directory, 'chart-a-course/intent.md')).length > 0);
  assertPortable(directory);
});

test('released CLI copy-installs exactly the complete active pack', { timeout: 180_000 }, async t => {
  assert.ok(installSource.trim(), 'SKILLS_PACK_SOURCE must not be empty');
  const sandbox = path.join(root, '.test-sandbox');
  mkdirSync(sandbox, { recursive: true });
  const consumer = mkdtempSync(path.join(sandbox, 'pack-'));
  try {
    const home = path.join(consumer, '.test-home');
    mkdirSync(home);
    const install = () => execFileSync(process.execPath, [
      path.join(root, 'node_modules/skills/bin/cli.mjs'), 'add', installSource,
      '--skill', '*', '--agent', 'github-copilot', '--copy', '-y',
    ], {
      cwd: consumer,
      env: {
        ...process.env, DISABLE_TELEMETRY: '1', HOME: home, USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, 'config'), XDG_STATE_HOME: path.join(home, 'state'),
        XDG_CACHE_HOME: path.join(home, 'cache'),
      },
      timeout: 60_000,
      stdio: 'pipe',
    });
    install();
    const installed = path.join(consumer, '.agents/skills');
    await t.test('all 33 active names, no archive', () => {
      assert.deepEqual(readdirSync(installed).sort(), expected);
    });
    await t.test('installation writes only project skill files and installer lock, not Setup outputs', () => {
      assert.deepEqual(readdirSync(consumer).sort(), ['.agents', '.test-home', 'skills-lock.json']);
      assert.deepEqual(readdirSync(path.join(consumer, '.agents')), ['skills']);
      assert.deepEqual(readdirSync(home), []);
    });
    await t.test('every shipped support file is copied byte for byte', () => {
      assert.deepEqual(snapshot(installed), snapshot(path.join(root, '.agents/skills')));
    });
    await t.test('installed Markdown dependencies resolve inside the pack', () => {
      assertPortable(installed);
    });
    await t.test('installed routes can reach lifecycle, placement, readiness and review guidance', () => {
      assertLifecycleSupport(installed);
    });
    await t.test('required policies, provenance and licenses travel with the pack', () => {
      for (const name of [
        'LICENSE', 'NOTICE.md', 'INVOCATION.md', 'COMMIT-STYLE.md',
        'provenance/skills-lock.json', 'licenses/caveman.LICENSE',
        'licenses/caveman.LICENSING.md', 'licenses/mattpocock-skills.LICENSE',
        'licenses/superpowers.LICENSE', 'licenses/anthropic-skills.LICENSE',
      ]) {
        assert.ok(readFileSync(path.join(installed, 'setup', name)).length > 0, name);
      }
      execFileSync(process.execPath, [path.join(root, 'scripts/sync-pack-resources.mjs')]);
    });
    await t.test('Doctrine loads complete pinned texts from the installed package', () => {
      const hashes = {
        worktrees: '7dea063d55456fed452267b00e976403986b39b132877c65bdd10ed97cbe56ea',
        testing: '8b6bc36f184349007874ec8cb5aac759689aa553322bd9a84e779b7a641e2e27',
      };
      const args = Object.entries(hashes).flatMap(([id, hash]) => ['--expect', `${id}=${hash}`, id]);
      const output = execFileSync(process.execPath, [
        path.join(installed, 'doctrine/scripts/doctrine.mjs'), ...args,
      ], { cwd: consumer, encoding: 'utf8', timeout: 10_000 });
      assert.ok(!output.includes(path.join(root, '.agents/skills')), 'must not load source checkout');
      for (const [id, hash] of Object.entries(hashes)) {
        const source = path.join(installed, 'doctrine/doctrines', `${id}.doctrine.md`);
        assert.ok(output.includes(`path: ${source}\nsha256: ${hash}`));
        assert.ok(output.includes(readFileSync(source, 'utf8')), `full ${id} text`);
      }
    });
    await t.test('reinstall is byte-idempotent and preserves unrelated consumer files', () => {
      const unrelated = {
        'AGENTS.md': '# Consumer-owned instructions\n',
        'docs/agents/issue-tracker.md': 'Keep existing tracker configuration.\n',
        '.agents/skills/consumer-owned/SKILL.md': '---\nname: consumer-owned\ndescription: unrelated\n---\n',
        'application.txt': 'Application files remain untouched.\n',
      };
      for (const [name, content] of Object.entries(unrelated)) {
        const filename = path.join(consumer, name);
        mkdirSync(path.dirname(filename), { recursive: true });
        writeFileSync(filename, content);
      }
      const before = snapshot(consumer);
      install();
      assert.deepEqual(snapshot(consumer), before);
      assertLifecycleSupport(installed);
    });
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
});
