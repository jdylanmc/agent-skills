import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, validateRepository } from '../../../../scripts/validate-skill-graph.mjs';
import {
  adaptOrchestrationPayload,
  normalizeOrchestrationPayload,
  persistOrchestrationHandoff,
  probeResponse,
} from './persist-orchestration-handoff.mjs';
import {
  ATOMS,
  REPOSITORY_ROOT,
  failureOf,
  sandbox,
  sandboxEnvironment,
} from '../persist-bounded-handoff/persist-bounded-handoff.fixtures.mjs';
import { normalizePayload } from '../persist-bounded-handoff/persist-bounded-handoff.mjs';
import { loadIdentifierConfig } from '../../_atoms/redact-sensitive/redact-sensitive.config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, 'persist-orchestration-handoff.mjs');
const MOLECULE = '_base/_molecules/persist-orchestration-handoff/persist-orchestration-handoff.md';
const ATOM_UNITS = [
  '_base/_atoms/artifact-reference/artifact-reference.md',
  '_base/_atoms/handoff-render/handoff-render.md',
  '_base/_atoms/redact-sensitive/redact-sensitive.md',
  '_base/_atoms/temp-path-resolve/temp-path-resolve.md',
  '_base/_atoms/write-guarded/write-guarded.md',
];

function orchestrationPayload(overrides = {}) {
  return {
    schema_version: 1,
    slug_source: 'ship-with-squadron timeout worker',
    run_identity: {
      run_id: 'run-20260824-230439',
      root_skill: 'ship-with-squadron',
      parent_run_id: 'root-123',
      log_path: '.skill-log/ship-with-squadron.20260824.root-123.jsonl',
    },
    source_agent: { id: 'orchestrator', role: 'run coordinator' },
    target_agent: {
      id: 'worker-respawn-1',
      role: 'implementation worker',
      invocation_reason: 'previous worker timed out',
    },
    task_contract: {
      goal: 'Finish the package validation without touching unrelated worktrees.',
      scope: 'Only the orchestration handoff package and its registered tests.',
      context: 'The previous worker created the package and stopped during validation.',
      verify: 'Run graph derivation, validation, sensitive scan, and registered tests.',
      timebox: '45 minutes',
      forbidden: 'Do not edit doctrine or merge the pull request.',
      report: 'Return the PR URL, checks, and any unresolved questions.',
      standing: 'Autonomous unless a repository safety gate fails.',
    },
    inputs: [
      { name: 'issue', value: '#34', source: 'GitHub' },
      'current branch issue-34-orchestration-handoff',
    ],
    constraints: ['Use only the isolated worktree.', 'Artifacts are linked, never copied.'],
    assumptions: ['The target worker has repository access.'],
    artifacts_and_references: [
      { reference: '#34', note: 'orchestration handoff issue' },
      { reference: 'skills/orchestration-handoff/SKILL.md', note: 'wrapper' },
    ],
    acceptance_criteria: ['No validation failures remain.', 'The exact created path is returned.'],
    open_questions: ['Whether CI exposes a platform-specific failure.'],
    ...overrides,
  };
}

test('orchestration schema is validated before adapting to the bounded handoff core', () => {
  const normalized = normalizeOrchestrationPayload(orchestrationPayload());
  assert.equal(normalized.schema_version, 1);
  assert.equal(normalized.run_identity.run_id, 'run-20260824-230439');
  assert.equal(normalized.target_agent.id, 'worker-respawn-1');

  assert.throws(
    () => normalizeOrchestrationPayload(orchestrationPayload({ extra: true })),
    failureOf('malformed_payload'),
  );
  assert.throws(
    () => normalizeOrchestrationPayload(orchestrationPayload({ schema_version: 2 })),
    failureOf('malformed_payload'),
  );
  assert.throws(
    () => normalizeOrchestrationPayload(orchestrationPayload({ target_agent: { role: 'missing id' } })),
    failureOf('malformed_payload'),
  );
  assert.throws(
    () => normalizeOrchestrationPayload(orchestrationPayload({
      source_agent: { id: 'orchestrator', invocation_reason: 'not a source field' },
    })),
    failureOf('malformed_payload'),
    'source_agent must not accept and drop target-only fields',
  );
  const { artifacts_and_references: removed, ...withoutArtifacts } = orchestrationPayload();
  assert.throws(
    () => normalizeOrchestrationPayload(withoutArtifacts),
    failureOf('malformed_payload'),
    'missing artifacts_and_references must be distinguished from an explicit empty list',
  );
  assert.throws(
    () => normalizeOrchestrationPayload(orchestrationPayload({ artifacts_and_references: null })),
    failureOf('malformed_payload'),
  );
  assert.throws(
    () => normalizeOrchestrationPayload(orchestrationPayload({ artifacts_and_references: '#34' })),
    failureOf('malformed_payload'),
  );
  assert.doesNotThrow(
    () => normalizeOrchestrationPayload(orchestrationPayload({ artifacts_and_references: [] })),
    'an explicit empty artifact list remains allowed',
  );
});

test('adaptation produces the existing strict schema-version-1 core payload', () => {
  const adapted = adaptOrchestrationPayload(orchestrationPayload());
  const core = normalizePayload(adapted);

  assert.equal(core.schema_version, 1);
  assert.equal(core.title, 'Orchestration Handoff');
  assert.match(core.goal, /GOAL\nFinish the package validation/);
  assert.match(core.goal, /ACCEPTANCE\n- No validation failures remain/);
  assert.match(core.goal, /FORBIDDEN\nDo not edit doctrine/);
  assert.match(core.current_progress, /Target agent:/);
  assert.match(core.decisions_and_constraints, /Assumptions:/);
  assert.deepEqual(core.artifacts_and_references, [
    { reference: '#34', note: 'orchestration handoff issue' },
    { reference: 'skills/orchestration-handoff/SKILL.md', note: 'wrapper' },
  ]);
});

test('representative orchestration handoff persists through the shared temp path and redaction core', (t) => {
  const root = sandbox(t, 'orchestration-persist');
  const configuredIdentifier = 'Private System';
  const configuration = loadIdentifierConfig({
    json: JSON.stringify({
      version: 1,
      identifiers: [{ value: configuredIdentifier, evidenceType: 'internal-system' }],
    }),
  });
  const result = persistOrchestrationHandoff(orchestrationPayload({
    task_contract: {
      ...orchestrationPayload().task_contract,
      context: `${configuredIdentifier} was referenced by the previous worker and then the worker stopped.`,
    },
  }), {
    now: new Date('2026-08-24T23:04:39Z'),
    identifiers: configuration.identifiers,
  });

  assert.equal(path.dirname(result.path), path.join(root, 'handoffs'));
  assert.equal(result.name, 'ship-with-squadron-timeout-worker-20260824T230439Z.md');
  assert.equal(result.suggested_skills_included, false);
  assert.deepEqual(result.redactions, [{ category: 'internal-system', count: 1 }]);

  const written = fs.readFileSync(result.path, 'utf8');
  assert.ok(written.startsWith('# Orchestration Handoff\n'));
  assert.match(written, /GOAL\nFinish the package validation/);
  assert.match(written, /STANDING\nAutonomous unless/);
  assert.ok(!written.includes(configuredIdentifier));
  assert.match(written, /- #34 - orchestration handoff issue/);
});

test('entry point supports stdin and probe using the same failure envelope as the core', (t) => {
  const root = sandbox(t, 'orchestration-cli');
  const stdout = execFileSync(process.execPath, [ENTRY, '--stdin'], {
    input: JSON.stringify(orchestrationPayload()),
    env: sandboxEnvironment(root),
    encoding: 'utf8',
  });
  const result = JSON.parse(stdout);
  assert.equal(path.dirname(result.path), path.join(root, 'handoffs'));

  const probe = execFileSync(process.execPath, [ENTRY, '--probe'], {
    env: sandboxEnvironment(root),
    encoding: 'utf8',
  });
  assert.equal(probe.trim(), probeResponse());

  assert.throws(
    () => execFileSync(process.execPath, [ENTRY, '--stdin'], {
      input: JSON.stringify(orchestrationPayload({ schema_version: 2 })),
      env: sandboxEnvironment(root),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
    (error) => error.status === 1 && JSON.parse(error.stderr).error.code === 'malformed_payload',
  );
});

test('sibling molecule reuses the same five atoms without making the bounded core routable', () => {
  const repository = validateRepository(REPOSITORY_ROOT);
  const closure = closureFor(repository, MOLECULE);
  for (const atom of ATOM_UNITS) {
    assert.ok(closure.includes(atom), `${MOLECULE} must compose ${atom}`);
  }
  assert.ok(!repository.routableSkills.includes('persist-orchestration-handoff'));
  assert.ok(!repository.routableSkills.includes('persist-bounded-handoff'));

  for (const atom of ATOM_UNITS) {
    const name = path.basename(atom, '.md');
    assert.ok(fs.existsSync(path.join(ATOMS, name, `${name}.mjs`)), `${atom} keeps its entry point`);
  }
});
