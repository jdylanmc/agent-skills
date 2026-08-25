import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { classifyConflictPath, conflictResolutionAction, validateConflictPolicy } from './_atoms/conflict-policy/conflict-policy.mjs';
import { classifyShepherdPlan, classifyTerminalDisposition } from './_atoms/shepherd-disposition/shepherd-disposition.mjs';
import { detectProvider, shouldRunProviderIndependentCore } from './_atoms/provider-adapter/provider-adapter.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'shepherd/SKILL.md';
const PINNED_TOOLS = ['execute', 'read', 'search', 'edit'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

function greenSignals(overrides = {}) {
  return {
    provider: { status: 'supported-provider', provider: 'example' },
    preflight: { status: 'ok' },
    rebase: { status: 'completed', baseSha: 'base-sha' },
    regeneration: { status: 'completed' },
    localValidation: { status: 'passed', evidenceComplete: true },
    push: { status: 'pushed-with-lease', headSha: 'head-sha' },
    remoteChecks: { checks: [{ name: 'validate', status: 'success' }] },
    mergeability: { state: 'mergeable', isDraft: false, baseSha: 'base-sha', headSha: 'head-sha' },
    ...overrides,
  };
}

test('shepherd is routable with narrow mutation authority and run-ci dependency', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'shepherd');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.deepEqual(parsed.requiresSkills, [{ id: 'run-ci', source: 'local', required: true }]);
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('routing description includes positive and negative triggers', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /git-hosted change request/);
  assert.match(description, /green or clearly handed back/);
  assert.match(description, /shepherd/);
  assert.match(description, /rebase/);
  assert.match(description, /Do not use/);
  assert.match(description, /merge/);
  assert.match(description, /assume one provider/);
});

test('the skill composes chronicler and the local shepherd molecule', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'shepherd/_molecules/pr-shepherding/pr-shepherding.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    'shepherd/_molecules/pr-shepherding/pr-shepherding.md',
    'shepherd/_atoms/provider-adapter/provider-adapter.md',
    'shepherd/_atoms/git-shepherd-core/git-shepherd-core.md',
    'shepherd/_atoms/pr-intake/pr-intake.md',
    'shepherd/_atoms/conflict-policy/conflict-policy.md',
    'shepherd/_atoms/shepherd-disposition/shepherd-disposition.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('boundaries prohibit merge, unsafe force push, semantic conflict silence, and test weakening', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /Never merges/);
  assert.match(entry, /Never resolves a semantic conflict silently/);
  assert.match(entry, /Never weakens, deletes, narrows, skips, or rewrites a test/);
  assert.match(entry, /Never force-pushes without an explicit SHA-pinned `--force-with-lease`/);
  assert.match(entry, /Never edits `doctrine\/`/);
  assert.match(entry, /Never widens another skill's permissions/);
  assert.match(entry, /untrusted data/);
  assert.match(entry, /isolated worktree/);
  assert.match(entry, /Do not rebase merely because the base branch advanced/);
  assert.match(entry, /a pull request rebased on\s+every base movement never lands/);
  assert.match(entry, /one blocking adapter wait/);
});

test('the provider-independent core carries no provider-specific vocabulary', () => {
  const core = flat('shepherd/_atoms/git-shepherd-core/git-shepherd-core.md');

  assert.match(core, /provider-independent layer/);
  assert.doesNotMatch(core, /GitHub|Azure DevOps|GitLab|Gitea|Bitbucket|gh\b|pull request number|check-run/i);
});

test('the provider adapter seam is declared and unknown providers degrade to core', () => {
  const adapter = flat('shepherd/_atoms/provider-adapter/provider-adapter.md');
  const molecule = flat('shepherd/_molecules/pr-shepherding/pr-shepherding.md');

  assert.match(adapter, /resolve-target/);
  assert.match(adapter, /read-state/);
  assert.match(adapter, /read-checks/);
  assert.match(adapter, /`gh` for GitHub and `az` for Azure DevOps/);
  assert.match(adapter, /authentication, token\s+refresh, enterprise host configuration, pagination, and rate-limit behavior/);
  assert.match(adapter, /`provider-unsupported`, `provider-tool-missing`, and\s+`provider-tool-unauthenticated` are not blanket failures/);
  assert.match(molecule, /Always run \[Git shepherd core\]/);

  const detected = detectProvider({ remoteUrls: ['ssh://example.invalid/repo.git'] });
  assert.equal(detected.status, 'provider-unsupported');
  assert.equal(shouldRunProviderIndependentCore(detected), true);
});

test('missing or unauthenticated provider tools are distinct from unsupported provider', () => {
  const missing = detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: { available: false, authenticated: false } },
  });
  assert.equal(missing.status, 'provider-tool-missing');
  assert.equal(missing.provider, 'github');
  assert.equal(missing.tool, 'gh');
  assert.equal(shouldRunProviderIndependentCore(missing), true);

  const unauthenticated = detectProvider({
    explicitProvider: 'azure-devops',
    toolAvailability: { az: { available: true, authenticated: false } },
  });
  assert.equal(unauthenticated.status, 'provider-tool-unauthenticated');
  assert.equal(unauthenticated.provider, 'azure-devops');
  assert.equal(unauthenticated.tool, 'az');
  assert.notEqual(unauthenticated.status, 'provider-unsupported');
  assert.equal(shouldRunProviderIndependentCore(unauthenticated), true);
});

test('run-ci reuse is explicit instead of duplicating validation discovery', () => {
  const entry = flat(ENTRY);
  const molecule = flat('shepherd/_molecules/pr-shepherding/pr-shepherding.md');

  assert.match(entry, /Invoke the required `run-ci` skill/);
  assert.match(entry, /Do not duplicate its provider discovery/);
  assert.match(molecule, /Shepherd relies on that skill's provider discovery and evidence envelope/);
});

test('repo-specific conflict behavior stays in configuration', () => {
  const policy = flat('shepherd/_atoms/conflict-policy/conflict-policy.md');

  assert.match(policy, /Configuration Contract/);
  assert.match(policy, /The skill body contains no repository-specific path conventions/);
  assert.match(policy, /absent a matching trusted policy, a conflicted path is authored or ambiguous/);
  assert.doesNotMatch(policy, /validate-skills\.yml.*union/);
  assert.doesNotMatch(policy, /registered-test list is resolved by union/);
});

test('derived conflicts resolve by regeneration, authored conflicts stop', () => {
  const config = {
    source: { kind: 'caller-explicit', digest: 'policy-digest' },
    derivedPathPatterns: ['generated/**', 'dist/*.json'],
    regenerationCommands: [
      { name: 'generate', command: 'npm run generate', paths: ['generated/**', 'dist/*.json'] },
    ],
  };

  const derived = classifyConflictPath('generated/frontmatter.json', config);
  assert.equal(derived.kind, 'derived');
  assert.equal(conflictResolutionAction(derived), 'regenerate');

  const authored = classifyConflictPath('src/behavior.ts', config);
  assert.equal(authored.kind, 'authored');
  assert.equal(conflictResolutionAction(authored), 'stop-needs-human');
});

test('semantic authored conflicts are not auto-resolved even with nearby derived config', () => {
  const classified = classifyConflictPath('doctrine/testing.doctrine.md', {
    source: { kind: 'caller-explicit', digest: 'policy-digest' },
    derivedPathPatterns: ['docs/**/*.md'],
    regenerationCommands: [{ name: 'docs', command: 'npm run docs', paths: ['docs/**/*.md'] }],
  });

  assert.equal(classified.kind, 'authored');
  assert.equal(classified.reason, 'authored-denylist');
  assert.equal(conflictResolutionAction(classified), 'stop-needs-human');
});

test('derived conflict without one regeneration command is ambiguous', () => {
  const none = classifyConflictPath('generated/file.json', {
    source: { kind: 'caller-explicit', digest: 'policy-digest' },
    derivedPathPatterns: ['generated/**'],
  });
  assert.equal(none.kind, 'ambiguous');
  assert.equal(conflictResolutionAction(none), 'stop-needs-human');

  const multiple = classifyConflictPath('generated/file.json', {
    source: { kind: 'caller-explicit', digest: 'policy-digest' },
    derivedPathPatterns: ['generated/**'],
    regenerationCommands: [
      { name: 'a', command: 'npm run a', paths: ['generated/**'] },
      { name: 'b', command: 'npm run b', paths: ['generated/**'] },
    ],
  });
  assert.equal(multiple.kind, 'ambiguous');
});

test('untrusted, catch-all, protected, and unknown policy rules fail closed', () => {
  assert.equal(validateConflictPolicy({ derivedPathPatterns: ['generated/**'] }).valid, false);
  assert.equal(validateConflictPolicy({
    source: { kind: 'caller-explicit' },
    derivedPathPatterns: ['**/*'],
  }).reason, 'overbroad-derived-pattern');

  const workflow = classifyConflictPath('.github/workflows/validate-skills.yml', {
    source: { kind: 'caller-explicit' },
    derivedPathPatterns: ['.github/workflows/**'],
    regenerationCommands: [{ name: 'generate', command: 'npm run generate', paths: ['.github/workflows/**'] }],
  });
  assert.equal(workflow.kind, 'authored');
  assert.equal(workflow.reason, 'protected-validation-or-permission-path');

  const unknown = validateConflictPolicy({
    source: { kind: 'base-commit-snapshot' },
    structuredMergeRules: [{ operation: 'execute-arbitrary-script', paths: ['data/*.json'], validationCommand: 'npm test' }],
  });
  assert.equal(unknown.valid, false);
  assert.equal(unknown.reason, 'unknown-structured-operation');
});

test('a red or intermittent suite never becomes mergeable-and-green', () => {
  assert.equal(classifyTerminalDisposition(greenSignals({
    localValidation: { status: 'failed', evidenceComplete: true },
  })).disposition, 'failing');

  assert.equal(classifyTerminalDisposition(greenSignals({
    localValidation: { status: 'intermittent', evidenceComplete: true },
  })).disposition, 'failing');
});

test('base drift while mergeable and green is a no-op, not a rebase or force-push', () => {
  const result = classifyShepherdPlan(greenSignals({
    base: { moved: true },
    operatorRequest: { rebase: false },
    requiredChecks: [{ name: 'validate', expired: false }],
  }));

  assert.equal(result.disposition, 'no-op-mergeable-and-green');
  assert.equal(result.shouldRebase, false);
  assert.equal(result.shouldForcePush, false);
  assert.equal(result.action, 'no-op');
});

test('operator request, expired required check, or unmergeable state are action triggers', () => {
  assert.equal(classifyShepherdPlan(greenSignals({
    base: { moved: true },
    operatorRequest: { rebase: true },
  })).shouldRebase, true);

  const expired = classifyShepherdPlan(greenSignals({
    base: { moved: true },
    requiredChecks: [{ name: 'validate', expired: true }],
  }));
  assert.equal(expired.disposition, 'shepherd-required');
  assert.equal(expired.shouldRebase, false);

  assert.equal(classifyShepherdPlan(greenSignals({
    mergeability: { state: 'dirty', isDraft: false, baseSha: 'base-sha', headSha: 'head-sha' },
  })).shouldRebase, true);
});

test('only complete green local and remote evidence is mergeable-and-green', () => {
  const result = classifyTerminalDisposition(greenSignals());

  assert.equal(result.disposition, 'mergeable-and-green');
});

test('missing required evidence, stale mergeability, draft PRs, and skipped checks are not green', () => {
  const missingRebase = greenSignals();
  delete missingRebase.rebase;
  assert.equal(classifyTerminalDisposition(missingRebase).disposition, 'blocked');

  assert.equal(classifyTerminalDisposition(greenSignals({
    mergeability: { state: 'mergeable', isDraft: false, baseSha: 'old-base', headSha: 'head-sha' },
  })).disposition, 'blocked');

  assert.equal(classifyTerminalDisposition(greenSignals({
    mergeability: { state: 'mergeable', isDraft: true, baseSha: 'base-sha', headSha: 'head-sha' },
  })).disposition, 'needs-human');

  assert.equal(classifyTerminalDisposition(greenSignals({
    remoteChecks: { checks: [{ name: 'validate', status: 'skipped' }] },
  })).disposition, 'failing');
});

test('unsupported or unavailable provider tools still complete the git core instead of failing outright', () => {
  const unsupported = classifyTerminalDisposition(greenSignals({
    provider: { status: 'provider-unsupported' },
    remoteChecks: undefined,
    mergeability: undefined,
  }));
  assert.equal(unsupported.disposition, 'provider-unsupported');
  assert.equal(unsupported.reason, 'git-core-complete-host-state-unobserved');

  const missingTool = classifyTerminalDisposition(greenSignals({
    provider: { status: 'provider-tool-missing', provider: 'github', tool: 'gh' },
    remoteChecks: undefined,
    mergeability: undefined,
  }));
  assert.equal(missingTool.disposition, 'provider-tool-missing');
  assert.deepEqual(missingTool.defects, ['gh']);

  const unauthenticatedTool = classifyTerminalDisposition(greenSignals({
    provider: { status: 'provider-tool-unauthenticated', provider: 'azure-devops', tool: 'az' },
    remoteChecks: undefined,
    mergeability: undefined,
  }));
  assert.equal(unauthenticatedTool.disposition, 'provider-tool-unauthenticated');
  assert.deepEqual(unauthenticatedTool.defects, ['az']);
});

test('plain force push or missing checks are blocked', () => {
  assert.equal(classifyTerminalDisposition(greenSignals({
    push: { status: 'pushed-without-lease', headSha: 'head-sha' },
  })).disposition, 'blocked');

  assert.equal(classifyTerminalDisposition(greenSignals({
    remoteChecks: { checks: [] },
  })).disposition, 'blocked');
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'shepherd', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: shepherd\s*$/m);
  assert.ok(!intent.startsWith('---'));
  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /existing git-hosted change request/);
  assert.match(normalized, /generated or derived file/);
  assert.match(normalized, /Repository-specific conflict behavior belongs in configuration/);
});
