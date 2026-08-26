import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { classifyConflictPath, conflictResolutionAction, validateConflictPolicy } from './_atoms/conflict-policy/conflict-policy.mjs';
import {
  classifyShepherdPlan,
  classifyTerminalDisposition,
  freshnessReceipt,
  isTerminalDisposition,
} from './_atoms/shepherd-disposition/shepherd-disposition.mjs';
import {
  detectProvider,
  normalizeUpToDatePolicy,
  requiresUpToDateBranch,
  shouldRunProviderIndependentCore,
} from './_atoms/provider-adapter/provider-adapter.mjs';

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
    observedAt: '2026-08-25T22:05:00Z',
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

test('base drift stays a no-op when the base does not require containing it', () => {
  // The busy-`main` case the no-op exists for. A repository with no such
  // policy, and one where the policy could not be read, must both keep it.
  for (const upToDate of [undefined, 'not-required', 'unobserved', 'strict', null]) {
    const result = classifyShepherdPlan(greenSignals({
      base: { moved: true },
      basePolicy: { upToDate },
      operatorRequest: { rebase: false },
      requiredChecks: [{ name: 'validate', expired: false }],
    }));

    assert.equal(
      result.disposition,
      'no-op-mergeable-and-green',
      `policy ${String(upToDate)} must not trigger a rebase`,
    );
    assert.equal(result.shouldRebase, false);
  }
});

test('an advanced base is a trigger when the base requires the branch to contain it', () => {
  // The incident: mergeable content, green checks, and a pull request that
  // could not merge because its base had moved under a required up-to-date
  // policy. A no-op here leaves it unlandable and reports it as green.
  const result = classifyShepherdPlan(greenSignals({
    base: { moved: true },
    basePolicy: { upToDate: 'required' },
    operatorRequest: { rebase: false },
    requiredChecks: [{ name: 'validate', expired: false }],
  }));

  assert.equal(result.disposition, 'shepherd-required');
  assert.equal(result.shouldRebase, true);
  assert.equal(result.reason, 'base-advanced-under-required-up-to-date-policy');
  assert.equal(result.upToDatePolicy, 'required');

  // Ancestry settles it in the other direction: a branch that already contains
  // the base satisfies the policy however far the base moved.
  const alreadyContains = classifyShepherdPlan(greenSignals({
    base: { moved: true },
    basePolicy: { upToDate: 'required' },
    mergeability: {
      state: 'mergeable',
      isDraft: false,
      baseSha: 'base-sha',
      headSha: 'head-sha',
      behind: false,
    },
    operatorRequest: { rebase: false },
    requiredChecks: [{ name: 'validate', expired: false }],
  }));
  assert.equal(alreadyContains.disposition, 'no-op-mergeable-and-green');
  assert.equal(alreadyContains.shouldRebase, false);
  assert.equal(alreadyContains.receipt.complete, true);
  assert.equal(alreadyContains.receipt.baseSha, 'base-sha');
  assert.equal(alreadyContains.receipt.headSha, 'head-sha');
  assert.ok(isTerminalDisposition(alreadyContains.disposition));

  const gitAlreadyContains = classifyShepherdPlan(greenSignals({
    base: { moved: true, behind: false },
    basePolicy: { upToDate: 'required' },
    mergeability: {
      state: 'mergeable',
      isDraft: false,
      baseSha: 'base-sha',
      headSha: 'head-sha',
    },
    operatorRequest: { rebase: false },
    requiredChecks: [{ name: 'validate', expired: false }],
  }));
  assert.equal(gitAlreadyContains.disposition, 'no-op-mergeable-and-green');
  assert.equal(gitAlreadyContains.shouldRebase, false);

  const undated = greenSignals({
    base: { moved: true },
    basePolicy: { upToDate: 'not-required' },
    operatorRequest: { rebase: false },
    requiredChecks: [{ name: 'validate', expired: false }],
  });
  delete undated.observedAt;
  const incomplete = classifyShepherdPlan(undated);
  assert.equal(incomplete.disposition, 'blocked');
  assert.equal(incomplete.reason, 'incomplete-freshness-receipt');
  assert.equal(incomplete.action, 'observe-state');
  assert.equal(incomplete.shouldRebase, false);
  assert.equal(incomplete.receipt.complete, false);
});

test('under a required policy the branch must be known to contain the base', () => {
  const mergeability = (behind) => ({
    state: 'mergeable',
    isDraft: false,
    baseSha: 'base-sha',
    headSha: 'head-sha',
    ...(behind === undefined ? {} : { behind }),
  });

  const behind = classifyTerminalDisposition(greenSignals({
    basePolicy: { upToDate: 'required' },
    mergeability: mergeability(true),
  }));
  assert.equal(behind.disposition, 'blocked');
  assert.equal(behind.reason, 'base-advanced-under-required-up-to-date-policy');

  // Being behind and not knowing are different facts, and neither is green.
  // Treating an unread state as "not behind" is how a change request that
  // cannot merge gets reported as mergeable.
  for (const unread of [undefined, null, 'no', 0, 'false']) {
    const result = classifyTerminalDisposition(greenSignals({
      basePolicy: { upToDate: 'required' },
      mergeability: mergeability(unread),
    }));
    assert.equal(result.disposition, 'blocked', `behind=${String(unread)} must not read as contained`);
    assert.equal(result.reason, 'up-to-date-state-unobserved-under-required-policy');
  }

  // Only a settled `false` clears it.
  assert.equal(
    classifyTerminalDisposition(greenSignals({
      basePolicy: { upToDate: 'required' },
      mergeability: mergeability(false),
    })).disposition,
    'mergeable-and-green',
  );
  assert.equal(
    classifyTerminalDisposition(greenSignals({
      base: { behind: false },
      basePolicy: { upToDate: 'required' },
      mergeability: mergeability(undefined),
    })).disposition,
    'mergeable-and-green',
  );

  for (const [providerBehind, gitBehind, expectedPlan, expectedTerminal] of [
    [true, false, 'shepherd-required', 'blocked'],
    [false, true, 'no-op-mergeable-and-green', 'mergeable-and-green'],
  ]) {
    const conflictingSignals = greenSignals({
      base: { moved: true, behind: gitBehind },
      basePolicy: { upToDate: 'required' },
      mergeability: mergeability(providerBehind),
    });
    assert.equal(
      classifyShepherdPlan(conflictingSignals).disposition,
      expectedPlan,
      `provider behind=${providerBehind} must override git behind=${gitBehind} in planning`,
    );
    assert.equal(
      classifyTerminalDisposition(conflictingSignals).disposition,
      expectedTerminal,
      `provider behind=${providerBehind} must override git behind=${gitBehind} at the terminal gate`,
    );
  }

  // Without the policy, or with it unobserved, the same evidence is green:
  // nothing about the base decides landability there.
  for (const basePolicy of [undefined, { upToDate: 'not-required' }, { upToDate: 'unobserved' }]) {
    const result = classifyTerminalDisposition(greenSignals({ basePolicy, mergeability: mergeability(true) }));
    assert.equal(result.disposition, 'mergeable-and-green');
  }
});

test('an unobserved up-to-date policy is never treated as not-required', () => {
  for (const value of [undefined, null, '', 'strict', 'Required', 0]) {
    assert.equal(normalizeUpToDatePolicy(value), 'unobserved', `${String(value)} must not resolve a policy`);
    assert.equal(requiresUpToDateBranch(value), false);
  }

  assert.equal(normalizeUpToDatePolicy(true), 'required');
  assert.equal(normalizeUpToDatePolicy(false), 'not-required');
  assert.equal(requiresUpToDateBranch('required'), true);
  assert.equal(requiresUpToDateBranch('not-required'), false);
  assert.equal(requiresUpToDateBranch('unobserved'), false);
});

test('every terminal disposition carries the snapshot it was observed against', () => {
  const result = classifyTerminalDisposition(greenSignals({
    basePolicy: { upToDate: 'required' },
    mergeability: { state: 'mergeable', isDraft: false, baseSha: 'base-sha', headSha: 'head-sha', behind: false },
  }));

  assert.equal(result.disposition, 'mergeable-and-green');
  assert.deepEqual(result.receipt, {
    observedAt: '2026-08-25T22:05:00Z',
    baseSha: 'base-sha',
    headSha: 'head-sha',
    upToDatePolicy: 'required',
    provider: 'supported-provider',
    complete: true,
  });

  // A receipt nobody can date or place is a claim rather than evidence, so it
  // says so, and the disposition it accompanies is not green.
  const undated = greenSignals();
  delete undated.observedAt;
  assert.equal(freshnessReceipt(undated).complete, false);
  assert.equal(classifyTerminalDisposition(undated).disposition, 'blocked');
  assert.equal(classifyTerminalDisposition(undated).reason, 'incomplete-freshness-receipt');

  assert.equal(freshnessReceipt({}).complete, false);
  assert.equal(freshnessReceipt({}).upToDatePolicy, 'unobserved');
  assert.equal(freshnessReceipt({}).provider, 'unobserved');
});

test('the terminal vocabulary is the shared one, including every provider condition', () => {
  // A disposition this classifier can return that a consumer does not know is
  // read as no ending at all, which is why the list has one home.
  for (const status of [
    'provider-unsupported',
    'provider-tool-unsupported',
    'provider-tool-missing',
    'provider-tool-unauthenticated',
  ]) {
    const result = classifyTerminalDisposition(greenSignals({
      provider: { status, provider: 'example', tool: 'cli' },
      remoteChecks: undefined,
      mergeability: undefined,
    }));
    assert.equal(result.disposition, status);
    assert.ok(isTerminalDisposition(result.disposition), `${status} must be a shared terminal disposition`);
    assert.ok(result.nextHumanAction, `${status} must name the next human action`);
  }

  for (const signals of [
    greenSignals(),
    greenSignals({ localValidation: { status: 'failed', evidenceComplete: true } }),
    greenSignals({ push: { status: 'pushed-without-lease', headSha: 'head-sha' } }),
    greenSignals({ conflicts: [{ kind: 'authored', path: 'src/a.ts' }] }),
    {},
  ]) {
    assert.ok(
      isTerminalDisposition(classifyTerminalDisposition(signals).disposition),
      'every classified ending must be in the shared vocabulary',
    );
  }
});

test('every non-green terminal result names the next human action', () => {
  for (const signals of [
    greenSignals({ localValidation: { status: 'failed', evidenceComplete: true } }),
    greenSignals({ push: { status: 'pushed-without-lease', headSha: 'head-sha' } }),
    greenSignals({ conflicts: [{ kind: 'authored', path: 'src/a.ts' }] }),
  ]) {
    const result = classifyTerminalDisposition(signals);
    assert.notEqual(result.disposition, 'mergeable-and-green');
    assert.ok(result.nextHumanAction);
  }
});

test('shepherd states plainly that it does not watch', () => {
  const entry = flat(ENTRY);
  const molecule = flat('shepherd/_molecules/pr-shepherding/pr-shepherding.md');

  assert.match(entry, /\*\*Never watches\.\*\*/);
  assert.match(entry, /belongs to the caller\s+that owns the set of open change requests/);
  assert.match(entry, /freshness receipt/);
  assert.match(molecule, /One Snapshot, Not A Watch/);
  assert.match(molecule, /it does not track siblings/);
});

test('the required up-to-date policy is adapter evidence, not core vocabulary', () => {
  const adapter = flat('shepherd/_atoms/provider-adapter/provider-adapter.md');
  const core = flat('shepherd/_atoms/git-shepherd-core/git-shepherd-core.md');

  assert.match(adapter, /The Required Up-To-Date Policy/);
  assert.match(adapter, /`unobserved` is never reported as `not-required`/);
  assert.match(adapter, /This is a field of `read-state`, not a fourth operation/);

  // The core consumes the normalized signal and still resolves nothing itself.
  assert.match(core, /`up-to-date-policy`/);
  assert.match(core, /Resolved by the coordinating molecule and never by this layer/);
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
