import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveBundledRoastRoster } from './code-reviewer-panel.mjs';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
);

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

test('role-aware roster routing fans out bundled architecture reviewers under the shared cap', () => {
  const resolved = resolveBundledRoastRoster({
    root: REPOSITORY_ROOT,
    repositoryModelRoles: {
      'architecture-candidate': 'gpt-5.6-sol',
    },
    panelLengthByRole: {
      'architecture-candidate': 3,
    },
    fanoutCap: 2,
    runtimeAvailableModels: ['gpt-5.6-sol', 'claude-opus-5'],
  });
  assert.deepEqual(
    resolved.roster.map((entry) => entry.reviewerId),
    ['SOLID-ROASTER', 'SOLID-ROASTER-02', 'SECURITY-ROASTER', 'TESTING-ROASTER'],
  );
  assert.equal(resolved.panels['architecture-candidate'].fanoutRequested, 3);
  assert.equal(resolved.panels['architecture-candidate'].fanoutApplied, 2);
  assert.deepEqual(resolved.panels['architecture-candidate'].reasons, ['fanout-capped']);
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
  assert.deepEqual(panel.reasons, ['unavailable-seat']);
  const unavailable = resolved.roster.find((entry) => entry.routeReceipt.modelStatus === 'Unavailable');
  assert.equal(unavailable.role, 'qa-reviewer');
});

test('security reviewer stays on the explicit inline route and does not join role-aware fanout', () => {
  const resolved = resolveBundledRoastRoster({
    root: REPOSITORY_ROOT,
    panelLengthByRole: {
      'architecture-candidate': 2,
      'qa-reviewer': 2,
    },
    fanoutCap: 2,
    runtimeAvailableModels: ['claude-opus-5', 'gpt-5.6-sol'],
  });
  const security = resolved.roster.filter((entry) => entry.agentName === 'security-roaster');
  assert.equal(security.length, 1);
  assert.equal(security[0].role, null);
  assert.equal(security[0].route.model, 'gpt-5.6-sol');
});
