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
  'automate-this', 'breakdown-tickets', 'caveman', 'changelog', 'chart-a-course', 'conflicts', 'create-pull-request',
  'discovery', 'doctrine', 'domain-modeling', 'eli5', 'evolve-architecture',
  'handoff', 'interrogate', 'joe-mode', 'joe-mode-cmux', 'joe-mode-orca', 'joe-mode-paseo', 'migration', 'patch', 'poc', 'pull-request', 'refactor',
  'research', 'retro', 'roast', 'scout', 'setup', 'shepherd', 'ship', 'simplified-technical-caveman', 'simplified-technical-english', 'specify',
  'squadron', 'status-report', 'synthesize', 'tdd', 'triage', 'verify', 'wait-what',
];
const originalNames = expected.filter(name => ![
  'chart-a-course', 'create-pull-request', 'joe-mode-cmux', 'joe-mode-orca', 'joe-mode-paseo', 'pull-request',
  'simplified-technical-caveman', 'simplified-technical-english',
].includes(name));

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
    // New CMUX adapter intent explicitly authorized separately; pinned below.
    .filter(filename => filename !== '.agents/skills/joe-mode-cmux/intent.md')
    // New Orca adapter intent explicitly approved separately; pinned below.
    .filter(filename => filename !== '.agents/skills/joe-mode-orca/intent.md')
    // New PM intent explicitly authorized separately; pinned below.
    .filter(filename => filename !== '.agents/skills/joe-mode-paseo/intent.md')
    // Only Shepherd intent was authorized for the adaptive/recovery extension.
    .filter(filename => filename !== '.agents/skills/shepherd/intent.md')
    // New simplified-technical-caveman intent explicitly requested by the human; pinned below.
    .filter(filename => filename !== '.agents/skills/simplified-technical-caveman/intent.md');
  sources.push('intent.md');
  assert.equal(sources.length, 36);
  // Human authorized root/Ship changes and the status-report never-stop intent update.
  assert.equal(digestFiles(sources), '84c763a796047a4bda690d1252b6b4ecfb7333e56095683c5a35eef8157c9107');
});

test('specifically authorized Shepherd intent remains pinned to the extension', () => {
  const intent = readFileSync(path.join(root, '.agents/skills/shepherd/intent.md'));
  assert.equal(createHash('sha256').update(intent).digest('hex'),
    '57e4a3bbf91ef2bb561d5067228791b92a1212e700390870a17cb7c01ed06344');
});

test('human-requested simplified-technical-caveman intent remains pinned', () => {
  const intent = readFileSync(path.join(root, '.agents/skills/simplified-technical-caveman/intent.md'));
  assert.equal(createHash('sha256').update(intent).digest('hex'),
    '93ad3a618cbf8ad150b3cb81b4b08992b46c0c8298a02a4e3d41c690bed826b9');
});

test('separately authorized PM intent and entrypoint metadata remain pinned', () => {
  const directory = path.join(root, '.agents/skills/joe-mode-paseo');
  assert.equal(createHash('sha256').update(readFileSync(path.join(directory, 'intent.md'))).digest('hex'),
    '940efe203ed323da3f6e40e6c6c41f604b5a0e2c9ef6d98c4f16d08646808560');
  const metadata = readFileSync(path.join(directory, 'SKILL.md'), 'utf8').split('---\n')[1];
  assert.equal(createHash('sha256').update(metadata).digest('hex'),
    '49313554a1b8b8913c78b55c94bfe63da41c43b9c417c461bab64abe68663698');
  assert.match(metadata, /^name: joe-mode-paseo$/m);
  assert.match(metadata, /^disable-model-invocation: false$/m);
  assert.match(metadata, /^user-invocable: true$/m);
  for (const support of ['RUN.md', 'RUNTIME.md', 'STATE.md', 'TEAM.md', 'MERGE.md', 'SCENARIOS.md', 'intent.md']) {
    const text = readFileSync(path.join(directory, support), 'utf8');
    assert.ok(text.trim(), support);
    assert.ok(!text.startsWith('---\n'), `${support}: support is not a second skill entry`);
  }
});

test('separately authorized CMUX adapter intent and entrypoint metadata remain pinned', () => {
  const directory = path.join(root, '.agents/skills/joe-mode-cmux');
  const intent = readFileSync(path.join(directory, 'intent.md'));
  assert.equal(createHash('sha256').update(intent).digest('hex'),
    '8e36ca606c7c09eef63e2ddf76cde5ff03e0fdda826483bd48960fc7885907a4');
  const metadata = readFileSync(path.join(directory, 'SKILL.md'), 'utf8').split('---\n')[1];
  assert.equal(createHash('sha256').update(metadata).digest('hex'),
    '03aae606d8aa350017dd9da9bbb9feff926b1c0c30d7396e529c55949a7b5770');
  assert.match(metadata, /^name: joe-mode-cmux$/m);
  assert.match(metadata, /^disable-model-invocation: true$/m);
  assert.match(metadata, /^user-invocable: true$/m);
  for (const support of ['LAYOUT.md', 'RUNTIME.md', 'intent.md']) {
    const text = readFileSync(path.join(directory, support), 'utf8');
    assert.ok(text.trim(), support);
    assert.ok(!text.startsWith('---\n'), `${support}: support is not a second skill entry`);
  }
});

test('authorized Orca intent and bounded-continuation entry remain preserved', () => {
  const directory = path.join(root, '.agents/skills/joe-mode-orca');
  assert.equal(createHash('sha256').update(readFileSync(path.join(directory, 'intent.md'))).digest('hex'),
    '206acf554a449bc423f9bf0618176126cce939e5add6868c866ee42be97034fb');
  const metadata = readFileSync(path.join(directory, 'SKILL.md'), 'utf8').split('---\n')[1];
  assert.match(metadata, /^name: joe-mode-orca$/m);
  assert.match(metadata, /^disable-model-invocation: false$/m);
  assert.match(metadata, /^user-invocable: true$/m);
  for (const support of ['RUN.md', 'RUNTIME.md', 'AUTOMATIONS.md', 'STATE.md', 'intent.md']) {
    const text = readFileSync(path.join(directory, support), 'utf8');
    assert.ok(text.trim(), support);
    assert.ok(!text.startsWith('---\n'), `${support}: support is not a second skill entry`);
  }
});

test('all original entrypoint metadata, including invocation flags, is preserved', () => {
  const sources = originalNames.map(name => `.agents/skills/${name}/SKILL.md`);
  // #306 explicitly authorizes the caveman and synthesize description changes (style skills);
  // the digest was regenerated for that change only.
  assert.equal(digestFiles(sources, bytes => bytes.toString().split('---\n')[1]),
    '52484b045769e6d2a4c5cbe96086f01d25d4d87a7935b08d84d7b292afbf60ff');
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
  assert.equal(digestFiles(sources), '4a3e14e9b3c8a2203e46578812f283645dfa37ebe5d6735a70ae9c766364e13c');
});

test('style skills own their rules and Synthesize delegates to them', () => {
  const read = name => readFileSync(path.join(root, `.agents/skills/${name}/SKILL.md`), 'utf8');
  const synthesize = read('synthesize');
  assert.match(synthesize, /\]\(\.\.\/caveman\/SKILL\.md\)/);
  assert.match(synthesize, /\]\(\.\.\/simplified-technical-english\/SKILL\.md\)/);
  assert.doesNotMatch(synthesize, /Drop: articles|Clarity register/, 'rules live in the style skills');
  for (const name of ['caveman', 'simplified-technical-english']) {
    const skill = read(name);
    assert.match(skill, /disable-model-invocation: true/);
    assert.match(skill, /\*\*One-shot/);
    assert.match(skill, /\*\*Sticky/);
  }
  const ste = read('simplified-technical-english');
  assert.match(ste, /Never say "compliant"/);
  assert.ok(!existsSync(path.join(root, '.agents/skills/simplified-technical-english/references/dictionary.md')));
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
    'joe-mode/SKILL.md', 'joe-mode/RUNTIME.md', 'joe-mode-cmux/SKILL.md',
    'joe-mode-orca/SKILL.md', 'joe-mode-orca/RUN.md', 'joe-mode-paseo/SKILL.md',
    'joe-mode-paseo/RUN.md', 'shepherd/SKILL.md',
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

function assertShepherdReplayInventory(directory) {
  for (const [file, heading] of [
    ['shepherd/OBSERVATION.md', '## Resume work on every wake'],
    ['ship/DELIVERY.md', '### Publication is not readiness'],
    ['shepherd/SCENARIOS.md', '## Proactive remote repair traces'],
  ]) {
    assert.ok(readFileSync(path.join(directory, file), 'utf8').split('\n').includes(heading),
      `${file}: missing proactive guidance section`);
  }
  const scenarios = readFileSync(path.join(directory, 'shepherd/SCENARIOS.md'), 'utf8');
  // Package inventory only; the scenarios do not execute a live repair or scheduler.
  assert.deepEqual([...scenarios.matchAll(/^\| (P\d+)\b/gm)].map(match => match[1]),
    ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
}

test('Shepherd proactive guidance and replay inventory are present in the source pack', () => {
  assertShepherdReplayInventory(path.join(root, '.agents/skills'));
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

test('Create-pull-request is the model-invocable generic fallback', () => {
  const skill = readFileSync(path.join(root, '.agents/skills/create-pull-request/SKILL.md'), 'utf8');
  const metadata = skill.split('---\n')[1];
  assert.match(metadata, /^name: create-pull-request$/m);
  assert.match(metadata, /^disable-model-invocation: false$/m);
  assert.match(metadata, /^user-invocable: true$/m);
  assert.match(metadata, /fallback/i);
  assert.match(metadata, /repository-specific/i);
  assert.match(skill, /active delivery (?:workflow|owner)/i);
});

test('Status-report never stops the owning agent\'s authorized work', () => {
  const read = file => readFileSync(path.join(root, '.agents/skills/status-report', file), 'utf8').replace(/\s+/g, ' ');
  const skill = read('SKILL.md');
  const intent = read('intent.md');
  for (const text of [skill, intent]) {
    assert.match(text, /interruption, not a stop/);
    assert.match(text, /explicit(?:ly asked to)? pause or stop/);
    assert.doesNotMatch(text, /never (?:resume|restart) the task/i);
  }
  assert.match(skill, /resume the next verified in-scope action/);
  assert.match(skill, /after a crashed prior turn too/);
  assert.match(skill, /human decision\/authority is pending/);
  assert.match(skill, /grants no new scope, merge, approval, or destructive authority/);
  assert.match(skill, /reporter does not take over the owner's work/);
});

test('released CLI copy-installs exactly the complete active pack', { timeout: 180_000 }, async t => {
  assert.ok(installSource.trim(), 'SKILLS_PACK_SOURCE must not be empty');
  const sandbox = path.join(root, '.test-sandbox');
  mkdirSync(sandbox, { recursive: true });
  const consumer = mkdtempSync(path.join(sandbox, 'pack-'));
  try {
    const home = path.join(consumer, '.test-home');
    mkdirSync(home);
    const install = (selection = '*') => execFileSync(process.execPath, [
      path.join(root, 'node_modules/skills/bin/cli.mjs'), 'add', installSource,
      '--skill', selection, '--agent', 'github-copilot', '--copy', '-y',
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
    await t.test('all 37 active names, no archive', () => {
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
    await t.test('installed Shepherd includes proactive guidance and replay inventory', () => {
      assertShepherdReplayInventory(installed);
    });
    await t.test('PM is separately selectable alongside prerequisites with all support intact', () => {
      const pm = path.join(installed, 'joe-mode-paseo');
      rmSync(pm, { recursive: true });
      install('joe-mode-paseo');
      assert.deepEqual(snapshot(pm), snapshot(path.join(root, '.agents/skills/joe-mode-paseo')));
      assert.deepEqual(readdirSync(installed).sort(), expected);
      assertPortable(installed);
    });
    await t.test('CMUX adapter is separately selectable alongside prerequisites with all support intact', () => {
      const adapter = path.join(installed, 'joe-mode-cmux');
      rmSync(adapter, { recursive: true });
      install('joe-mode-cmux');
      assert.deepEqual(snapshot(adapter), snapshot(path.join(root, '.agents/skills/joe-mode-cmux')));
      assert.deepEqual(readdirSync(installed).sort(), expected);
      assertPortable(installed);
    });
    await t.test('Orca adapter is separately selectable alongside prerequisites with all support intact', () => {
      const adapter = path.join(installed, 'joe-mode-orca');
      rmSync(adapter, { recursive: true });
      install('joe-mode-orca');
      assert.deepEqual(snapshot(adapter), snapshot(path.join(root, '.agents/skills/joe-mode-orca')));
      assert.deepEqual(readdirSync(installed).sort(), expected);
      assertPortable(installed);
    });
    await t.test('installed PM helper runs read-only from the consumer without activating anything', () => {
      const inspect = request => execFileSync(process.execPath, [
        path.join(installed, 'joe-mode-paseo/scripts/state.mjs'),
        path.join(consumer, 'absent-board.json'), request,
      ], { cwd: consumer, encoding: 'utf8', timeout: 10_000 });
      assert.deepEqual(JSON.parse(inspect('{"op":"inspect"}')),
        { status: 'observed', view: { initialized: false } });
      assert.deepEqual(JSON.parse(inspect('{"op":"inspect","view":"full"}')),
        { status: 'observed', state: {} });
      assert.ok(!existsSync(path.join(consumer, 'absent-board.json')));
    });
    await t.test('installed Orca helper inspects without a checkout or runtime activation', () => {
      const commonDir = path.join(consumer, 'private-control');
      mkdirSync(commonDir);
      const output = execFileSync(process.execPath, [
        path.join(installed, 'joe-mode-orca/scripts/owner.mjs'), 'inspect',
        JSON.stringify({ commonDir }),
      ], { cwd: consumer, encoding: 'utf8', timeout: 10_000 });
      assert.equal(JSON.parse(output).status, 'uninitialized');
      assert.deepEqual(readdirSync(commonDir), []);
    });
    await t.test('required policies, provenance and licenses travel with the pack', () => {
      for (const name of [
        'LICENSE', 'NOTICE.md', 'INVOCATION.md', 'COMMIT-STYLE.md',
        'provenance/skills-lock.json', 'licenses/caveman.LICENSE',
        'licenses/humanlayer-skills.LICENSE', 'licenses/danyuchn-asd-ste100-skill.LICENSE',
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
