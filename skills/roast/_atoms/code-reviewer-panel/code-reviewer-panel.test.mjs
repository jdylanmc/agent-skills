import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CodeReviewerPanelError,
  dispatchBundledRoastRoster,
  resolveBundledRoastRoster,
  resolveBundledRoastmasterRoute,
} from './code-reviewer-panel.mjs';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
);

test('an explicitly configured panel starts independent reviews before awaiting their reports', async () => {
  const resolvedRoster = resolveBundledRoastRoster({ root: REPOSITORY_ROOT });
  const started = [];
  const releases = [];
  const pending = dispatchBundledRoastRoster({
    resolvedRoster,
    promptForReviewer: () => 'Review the supplied material.',
    transport: (seat) => {
      started.push(seat.reviewerId);
      return new Promise((resolve) => releases.push(() => resolve(`Report ${seat.reviewerId}`)));
    },
  });
  try {
    assert.deepEqual(started, resolvedRoster.roster.map((seat) => seat.reviewerId));
  } finally {
    for (const release of releases) release();
  }
  const result = await pending;
  assert.equal(result.launched.length, resolvedRoster.roster.length);
});

test('default bundled roast roster preserves the current three-seat panel and reviewer ids', () => {
  const resolved = resolveBundledRoastRoster({ root: REPOSITORY_ROOT });
  assert.deepEqual(
    resolved.roster.map((entry) => entry.reviewerId),
    ['SOLID-ROASTER', 'SECURITY-ROASTER', 'TESTING-ROASTER'],
  );
  assert.equal(resolved.roster[0].role, 'architecture-candidate');
  assert.equal(resolved.roster[1].role, null);
  assert.equal(resolved.roster[2].role, 'qa-reviewer');
  assert.equal(resolved.roster[0].route.model, 'claude-opus-5');
  assert.equal(resolved.roster[2].route.model, 'gpt-5.6-sol');
});

test('one failed reviewer preserves completed reports and marks the panel partial', async () => {
  const resolvedRoster = resolveBundledRoastRoster({ root: REPOSITORY_ROOT });
  const result = await dispatchBundledRoastRoster({
    resolvedRoster,
    promptForReviewer: () => 'Review the supplied material.',
    transport: async (seat) => {
      if (seat.reviewerId === 'SECURITY-ROASTER') throw new Error('reviewer transport unavailable');
      return `Report ${seat.reviewerId}`;
    },
  });
  assert.equal(result.status, 'Partial');
  assert.deepEqual(result.launched.map((entry) => entry.response), [
    'Report SOLID-ROASTER', 'Report TESTING-ROASTER',
  ]);
  assert.deepEqual(result.launched.map((entry) => entry.reviewerId), [
    'SOLID-ROASTER', 'TESTING-ROASTER',
  ]);
  assert.deepEqual(result.failed.map(({ reviewerId, error }) => ({ reviewerId, error })), [{
    reviewerId: 'SECURITY-ROASTER', error: 'reviewer transport unavailable',
  }]);
});

test('synchronous reviewer preparation failures preserve the other seats', async () => {
  const resolvedRoster = resolveBundledRoastRoster({ root: REPOSITORY_ROOT });
  for (const failedPreparation of ['prompt', 'persona']) {
    const prepare = (seat) => {
      if (seat.reviewerId === 'SECURITY-ROASTER') throw new Error(`${failedPreparation} unavailable`);
      return 'Review the supplied material.';
    };
    const result = await dispatchBundledRoastRoster({
      resolvedRoster,
      promptForReviewer: failedPreparation === 'prompt' ? prepare : () => 'Review the supplied material.',
      personaForReviewer: failedPreparation === 'persona' ? prepare : () => null,
      transport: async (seat) => `Report ${seat.reviewerId}`,
    });
    assert.equal(result.status, 'Partial');
    assert.deepEqual(result.launched.map((entry) => entry.reviewerId), [
      'SOLID-ROASTER', 'TESTING-ROASTER',
    ]);
    assert.deepEqual(result.failed.map(({ reviewerId, error }) => ({ reviewerId, error })), [{
      reviewerId: 'SECURITY-ROASTER', error: `${failedPreparation} unavailable`,
    }]);
  }
});

test('reviewer definitions cannot expand the executable read-only policy', (t) => {
  const sandbox = path.join(REPOSITORY_ROOT, '.test-sandbox');
  fs.mkdirSync(sandbox, { recursive: true });
  const root = fs.mkdtempSync(path.join(sandbox, 'panel-tools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['solid-yagni-kiss-roaster', 'security-roaster', 'testing-roaster', 'the-roastmaster']) {
    const file = `skills/roast/references/bundled-roasters/${name}/instructions.md`;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(REPOSITORY_ROOT, file), path.join(root, file));
  }
  const relative = 'skills/roast/references/bundled-roasters/solid-yagni-kiss-roaster/instructions.md';
  const original = fs.readFileSync(path.join(REPOSITORY_ROOT, relative), 'utf8');
  for (const tool of ['execute', 'write', 'task', '*']) {
    fs.writeFileSync(path.join(root, relative), original.replace(
      /^tools:.*$/m, `tools: ["read", "${tool}"]`,
    ));
    assert.throws(
      () => resolveBundledRoastRoster({ root }),
      (error) => error.code === 'invalid_reviewer_tools',
      tool,
    );
  }
  const legacy = 'skills/roast/references/bundled-roasters/the-roastmaster/instructions.md';
  fs.writeFileSync(path.join(root, legacy), fs.readFileSync(path.join(REPOSITORY_ROOT, legacy), 'utf8')
    .replace(/^tools:.*$/m, 'tools: ["write"]'));
  assert.throws(
    () => resolveBundledRoastmasterRoute({ root }),
    (error) => error.code === 'invalid_reviewer_tools',
  );
});

test('dispatch enforces read-only grants even for a forged roster', async () => {
  const resolvedRoster = structuredClone(resolveBundledRoastRoster({ root: REPOSITORY_ROOT }));
  resolvedRoster.roster[0].tools = ['read', 'write'];
  const observed = [];
  const result = await dispatchBundledRoastRoster({
    resolvedRoster,
    promptForReviewer: () => 'Review the material.',
    transport: async (seat, launch) => {
      observed.push({ id: seat.reviewerId, tools: launch.tools });
      return 'Reviewed.';
    },
  });
  assert.equal(result.status, 'Partial');
  assert.equal(result.failed[0].code, 'invalid_reviewer_tools');
  assert.equal(result.failed[0].phase, 'preparation');
  assert.deepEqual(observed.map((entry) => entry.id), ['SECURITY-ROASTER', 'TESTING-ROASTER']);
  assert.ok(observed.every((entry) => entry.tools.every((tool) => ['read', 'search'].includes(tool))));
});

test('failed reviewers retain useful typed diagnostics without copying arbitrary payloads', async () => {
  const resolvedRoster = resolveBundledRoastRoster({ root: REPOSITORY_ROOT });
  const result = await dispatchBundledRoastRoster({
    resolvedRoster,
    promptForReviewer: () => 'Review the material.',
    transport: async (seat) => {
      if (seat.reviewerId === 'SOLID-ROASTER') {
        throw Object.assign(new Error('Connection interrupted'), { code: 'ECONNRESET', retryable: true });
      }
      if (seat.reviewerId === 'SECURITY-ROASTER') {
        throw { type: 'RateLimit', code: 'RATE_LIMITED', statusCode: 429, message: 'Try later', accessToken: 'must-not-copy' };
      }
      return 'Reviewed.';
    },
  });
  assert.equal(result.status, 'Partial');
  assert.equal(result.launched.length, 1);
  assert.deepEqual(result.failed.map((entry) => entry.code), ['ECONNRESET', 'RATE_LIMITED']);
  assert.deepEqual(result.failed.map((entry) => entry.errorType), ['Error', 'RateLimit']);
  assert.ok(result.failed.every((entry) => entry.phase === 'transport'));
  assert.equal(result.failed[0].retryable, true);
  assert.equal(result.failed[1].statusCode, 429);
  assert.equal(result.failed[1].error, 'Try later');
  assert.equal(result.failed[0].routeReceipt.selectedModel, resolvedRoster.roster[0].route.model);
  assert.doesNotMatch(JSON.stringify(result.failed), /must-not-copy|accessToken/);
});

test('role-aware roster routing fans out bundled architecture reviewers under the shared cap', () => {
  const resolved = resolveBundledRoastRoster({
    root: REPOSITORY_ROOT,
    repositoryModelRoles: {
      'architecture-candidate': 'gpt-5.6-sol',
    },
    panelLengthByRole: {
      'architecture-candidate': 3,
    },
    fanoutCap: 4,
    runtimeAvailableModels: ['gpt-5.6-sol', 'claude-opus-5'],
  });
  assert.deepEqual(
    resolved.roster.map((entry) => entry.reviewerId),
    ['SOLID-ROASTER', 'SOLID-ROASTER-02', 'SECURITY-ROASTER', 'TESTING-ROASTER'],
  );
  assert.equal(resolved.panels['architecture-candidate'].fanoutRequested, 3);
  assert.equal(resolved.panels['architecture-candidate'].fanoutApplied, 2);
  assert.deepEqual(
    resolved.panels['architecture-candidate'].reasons,
    ['fanout-capped', 'same-family'],
  );
  assert.deepEqual(
    resolved.omittedSeats.map((entry) => entry.reviewerId),
    ['SOLID-ROASTER-03'],
  );
});

test('user mappings override repository mappings for bundled QA reviewers', () => {
  const resolved = resolveBundledRoastRoster({
    root: REPOSITORY_ROOT,
    repositoryModelRoles: {
      'qa-reviewer': 'claude-opus-5',
    },
    userModelRoles: {
      'qa-reviewer': 'gemini-3.8-flash',
    },
    runtimeAvailableModels: ['gemini-3.8-flash'],
  });
  const qa = resolved.roster.find((entry) => entry.role === 'qa-reviewer');
  assert.equal(qa.routeReceipt.resolutionSource, 'user-model-roles');
  assert.equal(qa.routeReceipt.selectedModel, 'gemini-3.8-flash');
});

test('same-family and unavailable panel outcomes stay explicit in the roster receipt', () => {
  const resolved = resolveBundledRoastRoster({
    root: REPOSITORY_ROOT,
    userModelRoles: {
      'qa-reviewer': ['claude-opus-5', 'claude-sonnet-5', 'grok-4.6'],
    },
    runtimeAvailableModels: ['claude-opus-5', 'claude-sonnet-5'],
  });
  const panel = resolved.panels['qa-reviewer'];
  assert.equal(panel.status, 'same-family');
  assert.equal(panel.degraded, true);
  assert.deepEqual(panel.reasons, ['unavailable-seat', 'same-family']);
  const unavailable = resolved.blockedSeats.find(
    (entry) => entry.routeReceipt.modelStatus === 'Unavailable',
  );
  assert.equal(unavailable.role, 'qa-reviewer');
  assert.equal(resolved.roster.some((entry) => entry.routeReceipt.modelStatus === 'Unavailable'), false);
});

test('security reviewer stays on the explicit inline route and does not join role-aware fanout', () => {
  const resolved = resolveBundledRoastRoster({
    root: REPOSITORY_ROOT,
    panelLengthByRole: {
      'architecture-candidate': 2,
      'qa-reviewer': 2,
    },
    fanoutCap: 3,
    runtimeAvailableModels: ['claude-opus-5', 'gpt-5.6-sol'],
  });
  const security = resolved.roster.filter((entry) => entry.agentName === 'security-roaster');
  assert.equal(security.length, 1);
  assert.equal(security[0].role, null);
  assert.equal(security[0].route.model, 'gpt-5.6-sol');
  assert.equal(resolved.fanoutApplied, 3);
});

test('global panel cap refuses to omit a mandatory bundled reviewer', () => {
  assert.throws(
    () => resolveBundledRoastRoster({
      root: REPOSITORY_ROOT,
      fanoutCap: 2,
    }),
    (error) => error instanceof CodeReviewerPanelError
      && error.code === 'panel_cap_too_small',
  );
});

test('global panel cap includes security and identifies every omitted seat', () => {
  const resolved = resolveBundledRoastRoster({
    root: REPOSITORY_ROOT,
    panelLengthByRole: {
      'architecture-candidate': 3,
      'qa-reviewer': 2,
    },
    fanoutCap: 4,
  });
  assert.equal(resolved.fanoutRequested, 6);
  assert.equal(resolved.fanoutApplied, 4);
  assert.deepEqual(
    resolved.roster.map((entry) => entry.reviewerId),
    ['SOLID-ROASTER', 'SOLID-ROASTER-02', 'SECURITY-ROASTER', 'TESTING-ROASTER'],
  );
  assert.deepEqual(
    resolved.omittedSeats.map((entry) => entry.reviewerId),
    ['SOLID-ROASTER-03', 'TESTING-ROASTER-02'],
  );
});

test('bundled dispatch uses the selected route and never launches blocked seats', async () => {
  const resolved = resolveBundledRoastRoster({
    root: REPOSITORY_ROOT,
    userModelRoles: {
      'architecture-candidate': {
        model: 'missing',
        fallbackModels: ['gpt-5.6-sol'],
      },
      'qa-reviewer': 'missing-too',
    },
    runtimeAvailableModels: ['gpt-5.6-sol'],
  });
  const calls = [];
  const dispatched = await dispatchBundledRoastRoster({
    resolvedRoster: resolved,
    promptForReviewer: (seat) => `Review as ${seat.reviewerId}.`,
    transport: async (seat, launch) => {
      calls.push({ seat: seat.reviewerId, launch });
      return `${seat.reviewerId} complete`;
    },
  });
  assert.deepEqual(
    calls.map((entry) => [entry.seat, entry.launch.model]),
    [
      ['SOLID-ROASTER', 'gpt-5.6-sol'],
      ['SECURITY-ROASTER', 'gpt-5.6-sol'],
    ],
  );
  assert.deepEqual(
    dispatched.blocked.map((entry) => entry.reviewerId),
    ['TESTING-ROASTER'],
  );
});

test('roster receipts and shared panel snapshots are deeply immutable', () => {
  const resolved = resolveBundledRoastRoster({
    root: REPOSITORY_ROOT,
    panelLengthByRole: { 'qa-reviewer': 2 },
  });

  test('confirmed deep route reaches every bundled reviewer and both Roastmaster invocations', () => {
    const deepRoute = {
      model: 'gpt-6-astra',
      fallbackModels: ['gpt-5.6-sol'],
      reasoningEffort: 'high',
      contextTier: 'default',
    };
    const available = ['gpt-6-astra', 'gpt-5.6-sol'];
    const roster = resolveBundledRoastRoster({
      root: REPOSITORY_ROOT,
      deepRoute,
      runtimeAvailableModels: available,
    });
    assert.deepEqual(roster.roster.map((entry) => entry.route.model), [
      'gpt-6-astra',
      'gpt-6-astra',
      'gpt-6-astra',
    ]);
    const roastmaster = resolveBundledRoastmasterRoute({
      root: REPOSITORY_ROOT,
      deepRoute,
      runtimeAvailableModels: available,
    });
    assert.equal(roastmaster.coordinate.route.model, 'gpt-6-astra');
    assert.equal(roastmaster.synthesize.route.model, 'gpt-6-astra');
  });
  const qa = resolved.roster.filter((entry) => entry.role === 'qa-reviewer');
  assert.equal(Object.isFrozen(resolved.roster), true);
  assert.equal(Object.isFrozen(qa[0].routeReceipt), true);
  assert.equal(Object.isFrozen(qa[0].panelReceipt), true);
  assert.throws(() => {
    qa[0].panelReceipt.reasons.push('changed');
  }, TypeError);
});
