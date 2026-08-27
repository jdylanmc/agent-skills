import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ADAPTERS,
  EVIDENCE_KINDS,
  LEDGER_COUNT_FIELDS,
  LEDGER_VERSION,
  assertLedgerContract,
  collectSessionEvidence,
  correlateRunLog,
  selectProvider,
  unsupportedProviderRecommendation,
} from './session-evidence-adapter.mjs';

const SEAM = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'session-evidence-adapter.mjs',
);

function event(type, data = {}) {
  return JSON.stringify({ type, data, id: `id-${type}`, timestamp: '2026-01-01T00:00:00.000Z' });
}

function withRoot(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'session-evidence-adapter-'));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function copilotLog(directory, ...middle) {
  const logPath = path.join(directory, 'events.jsonl');
  fs.writeFileSync(logPath, [
    event('session.start', { sessionId: 'session-1', producer: 'copilot-agent' }),
    ...middle,
    event('session.shutdown', { shutdownType: 'normal' }),
  ].join('\n') + '\n');
  return logPath;
}

/** A stand-in for a harness this repository has not written an adapter for. */
function fictionalAdapter(overrides = {}) {
  return {
    id: 'fictional',
    harnesses: ['fictional', 'fictional-cli'],
    detect: (environment) => environment.FICTIONAL_HOME === 'yes',
    resolve: () => ({ status: 'selected', path: '/fictional/session.log', identity: { kind: 'explicit-path' }, notes: [] }),
    read: () => ({
      ledger_version: LEDGER_VERSION,
      provider: 'fictional',
      harness: 'fictional-cli',
      source: { kind: 'session-log', log_id: 'fictional-run', session_id: 'session-9', identity: null, identity_notes: [] },
      completeness: 'complete',
      confidence_cap: 'none',
      counts: Object.fromEntries(LEDGER_COUNT_FIELDS.map((field) => [field, 0])),
      entries: [{ anchor: 'E1', kind: 'session_started', at: null, detail: { session_id: 'session-9' } }],
      skills: [],
      limitations: [],
      provider_native: {},
    }),
    ...overrides,
  };
}

test('a named harness selects its adapter, by identity or by alias', () => {
  for (const harness of ['copilot', 'copilot-cli', 'GitHub-Copilot-CLI']) {
    const provider = selectProvider({ harness, environment: {} });
    assert.equal(provider.status, 'selected');
    assert.equal(provider.adapter.id, 'copilot');
  }
});

test('an unnamed harness is detected from the runtime, and only when one adapter claims it', () => {
  const detected = selectProvider({ environment: { COPILOT_HOME: '/somewhere' } });
  assert.equal(detected.status, 'selected');
  assert.equal(detected.adapter.id, 'copilot');
  assert.equal(detected.detected, true);

  const none = selectProvider({ environment: {} });
  assert.equal(none.status, 'unsupported');
  assert.equal(none.adapter, null);

  const both = selectProvider({
    environment: { COPILOT_HOME: '/somewhere', FICTIONAL_HOME: 'yes' },
    adapters: [...DEFAULT_ADAPTERS, fictionalAdapter()],
  });
  assert.equal(both.status, 'ambiguous');
  assert.equal(both.claimants, 2);
  assert.equal(both.adapter, null);
});

test('an unknown harness selects nothing, and its name is bounded before it is reported', () => {
  const provider = selectProvider({ harness: `weird\nharness${'x'.repeat(200)}`, environment: {} });

  assert.equal(provider.status, 'unsupported');
  assert.ok(provider.harness.length <= 60);
  assert.ok(!/[\n\r]/.test(provider.harness));
});

test('the Copilot adapter reads a session into the neutral ledger', () => {
  withRoot((root) => {
    const logPath = copilotLog(
      root,
      event('assistant.turn_start', { turnId: 't1' }),
      event('assistant.turn_end', { turnId: 't1' }),
      event('user.message', { content: 'NEVER-EMIT-THIS' }),
      event('tool.execution_start', { toolCallId: 'c1', toolName: 'bash', arguments: { command: 'NEVER-EMIT-THIS' } }),
      event('tool.execution_complete', { toolCallId: 'c1', success: false, result: { content: 'NEVER-EMIT-THIS' } }),
      event('subagent.started', { toolCallId: 'c2', agentName: 'explore' }),
      event('skill.invoked', { name: 'roast', source: 'project', trigger: 'user', content: 'NEVER-EMIT-THIS' }),
      event('subagent.completed', { toolCallId: 'c2', agentName: 'explore' }),
    );

    const collected = collectSessionEvidence({
      harness: 'copilot-cli',
      explicitPath: logPath,
      environment: {},
      readerOptions: { logId: 'run-a' },
    });

    assert.equal(collected.status, 'collected');
    assert.equal(collected.provider, 'copilot');
    assert.deepEqual(assertLedgerContract(collected.ledger), []);

    const { ledger } = collected;
    assert.equal(ledger.source.session_id, 'session-1');
    assert.equal(ledger.counts.operator_messages, 1);
    assert.equal(ledger.counts.tool_calls, 1);
    assert.equal(ledger.counts.tool_failures, 1);
    assert.equal(ledger.counts.subagent_calls, 1);
    assert.equal(ledger.counts.skill_invocations, 1);
    assert.deepEqual(ledger.skills.map((entry) => [entry.name, entry.within_subagent]), [['roast', 'explore']]);
    assert.ok(!JSON.stringify(ledger).includes('NEVER-EMIT-THIS'));
  });
});

test('the ledger speaks the neutral vocabulary, not the harness event names', () => {
  withRoot((root) => {
    const logPath = copilotLog(
      root,
      event('abort', { reason: 'user_cancelled' }),
      event('session.error', { errorType: 'provider', statusCode: 500 }),
      event('skill.invoked', { name: 'roast' }),
    );

    const { ledger } = collectSessionEvidence({
      harness: 'copilot',
      explicitPath: logPath,
      environment: {},
    });

    const kinds = ledger.entries.map((entry) => entry.kind);
    assert.deepEqual(
      kinds,
      ['session_started', 'session_aborted', 'runtime_error', 'skill_invoked', 'session_ended'],
    );
    for (const kind of kinds) {
      assert.ok(EVIDENCE_KINDS.includes(kind));
      assert.ok(!kind.includes('.'), 'a neutral kind never carries a harness event name');
    }
    // The harness's own counts remain available, namespaced, for transparency.
    assert.equal(ledger.provider_native.event_counts['session.error'], 1);
  });
});

test('an unreadable or unprovable session reports the reason and reads nothing', () => {
  withRoot((root) => {
    const unresolved = collectSessionEvidence({
      harness: 'copilot-cli',
      stateRoot: path.join(root, 'absent'),
      environment: {},
    });

    assert.equal(unresolved.status, 'unavailable');
    assert.equal(unresolved.ledger, null);
    assert.deepEqual(unresolved.limitations.map((entry) => entry.code), ['session_root_unreadable']);
    assert.equal(unresolved.recommendation, null);
  });
});

test('an unknown harness returns a stated gap and a PROPOSED adapter recommendation', () => {
  const result = collectSessionEvidence({ harness: 'claude-code', environment: {} });

  assert.equal(result.status, 'unsupported');
  assert.equal(result.ledger, null);
  assert.deepEqual(result.limitations.map((entry) => entry.code), ['unsupported_provider']);

  const { recommendation } = result;
  assert.equal(recommendation.status, 'PROPOSED');
  assert.notEqual(recommendation.status, 'VALIDATED');
  assert.notEqual(recommendation.status, 'PROMOTED');
  assert.match(recommendation.name, /session-evidence adapter for claude-code/);
  assert.deepEqual(recommendation.traces_to, ['unsupported_provider']);
  assert.equal(recommendation.package_grounding, 'not_covered');
  assert.equal(recommendation.validation_requirements.human_approval_required, true);
  assert.match(recommendation.validation_requirements.independent_evidence_required, /stable event format/);
  assert.match(recommendation.disposition, /separate reinforce-skill run/);
  assert.match(recommendation.disposition, /applies nothing and invokes nothing/);
  assert.ok(recommendation.evaluator.length > 0);
  assert.ok(recommendation.disconfirming_observation.length > 0);
});

test('the recommendation is data: the seam writes nothing and invokes nothing', () => {
  const source = fs.readFileSync(SEAM, 'utf8');

  for (const effect of [
    'writeFileSync(',
    'appendFileSync(',
    'mkdirSync(',
    'rmSync(',
    'spawn(',
    'spawnSync(',
    'execFileSync(',
    'execSync(',
  ]) {
    assert.ok(!source.includes(effect), `the seam must not call ${effect}`);
  }
  assert.ok(!/invoke\w*\(\s*['"`]reinforce-skill/.test(source), 'the seam never invokes reinforce-skill');

  const recommendation = unsupportedProviderRecommendation('some-harness');
  assert.equal(typeof recommendation, 'object');
  assert.equal(recommendation.status, 'PROPOSED');
});

test('a future adapter is substitutable: the same seam, the same ledger contract', () => {
  const adapters = [...DEFAULT_ADAPTERS, fictionalAdapter()];

  const named = collectSessionEvidence({ harness: 'fictional-cli', environment: {}, adapters });
  assert.equal(named.status, 'collected');
  assert.equal(named.provider, 'fictional');
  assert.deepEqual(assertLedgerContract(named.ledger), []);
  assert.equal(named.ledger.ledger_version, LEDGER_VERSION);

  const detected = collectSessionEvidence({ environment: { FICTIONAL_HOME: 'yes' }, adapters });
  assert.equal(detected.status, 'collected');
  assert.equal(detected.provider, 'fictional');

  // And the Copilot adapter is untouched by the new one being registered.
  const copilot = selectProvider({ harness: 'copilot', environment: {}, adapters });
  assert.equal(copilot.adapter.id, 'copilot');
});

test('a ledger that breaks the contract is refused, whichever adapter produced it', () => {
  const leaky = fictionalAdapter({
    read: () => ({
      ...fictionalAdapter().read(),
      entries: [{ anchor: 'E1', kind: 'session_started', at: null, detail: { content: 'a whole prompt' } }],
    }),
  });
  const foreign = fictionalAdapter({
    read: () => ({ ...fictionalAdapter().read(), entries: [{ anchor: 'E1', kind: 'tool.execution_start', at: null, detail: {} }] }),
  });
  const uncapped = fictionalAdapter({
    read: () => ({ ...fictionalAdapter().read(), completeness: 'partial', confidence_cap: 'none' }),
  });

  for (const [adapter, expected] of [
    [leaky, /must not carry raw content/],
    [foreign, /outside the neutral vocabulary/],
    [uncapped, /incomplete evidence must cap confidence/],
  ]) {
    const result = collectSessionEvidence({ harness: 'fictional', environment: {}, adapters: [adapter] });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.ledger, null);
    assert.deepEqual(result.limitations.map((entry) => entry.code), ['ledger_contract_violation']);
    assert.match(result.limitations[0].detail, expected);
  }
});

test('the contract check names every missing part rather than failing on the first', () => {
  const problems = assertLedgerContract({
    ledger_version: 99,
    provider: '',
    completeness: 'unknown',
    confidence_cap: 'certain',
    counts: {},
    entries: [{ anchor: 'nope', kind: 'nope' }],
    limitations: [{}],
  });

  assert.ok(problems.length >= 6);
  assert.ok(problems.some((problem) => /ledger_version/.test(problem)));
  assert.ok(problems.some((problem) => /provider must name/.test(problem)));
  assert.ok(problems.some((problem) => /every limitation must carry a stable code/.test(problem)));
  assert.ok(problems.some((problem) => /counts\.tool_calls/.test(problem)));
});

test('a Skill Run Log correlates with session evidence by recorded identity, never by proximity', () => {
  const ledger = { harness: 'copilot-cli', source: { session_id: 'session-1' } };

  assert.equal(
    correlateRunLog({ harness: 'copilot-cli', session_id: 'session-1' }, ledger).status,
    'same-session',
  );
  assert.equal(
    correlateRunLog({ harness: 'copilot-cli', session_id: 'session-2' }, ledger).status,
    'different-session',
  );
  assert.equal(
    correlateRunLog({ harness: 'other-cli', session_id: 'session-1' }, ledger).status,
    'different-session',
  );

  const uncorrelated = correlateRunLog({ harness: null, session_id: null }, ledger);
  assert.equal(uncorrelated.status, 'unknown');
  assert.match(uncorrelated.reason, /records no session correlation/);

  const unidentified = correlateRunLog(
    { harness: 'copilot-cli', session_id: 'session-1' },
    { harness: 'copilot-cli', source: { session_id: null } },
  );
  assert.equal(unidentified.status, 'unknown');
  assert.match(unidentified.reason, /no session identity/);
});

test('the registry ships exactly the adapters this repository has validated', () => {
  assert.deepEqual(DEFAULT_ADAPTERS.map((adapter) => adapter.id), ['copilot']);
  for (const adapter of DEFAULT_ADAPTERS) {
    for (const method of ['detect', 'resolve', 'read']) {
      assert.equal(typeof adapter[method], 'function', `${adapter.id} must implement ${method}`);
    }
  }
});
