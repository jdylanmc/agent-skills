import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  canonicalHarness,
  collectSessionEvidence,
  correlateRunLog,
  correlateSelectedRunLog,
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
      // The published harness is always the adapter's own identity.
      harness: 'fictional',
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
  assert.equal(provider.harness, null, 'no adapter owns the harness, so none is claimed');
  assert.ok(provider.requested_harness.length <= 60);
  assert.ok(!/[\n\r]/.test(provider.requested_harness));
});

test('an alias is canonicalized to the adapter identity everywhere it is published', () => {
  for (const alias of ['copilot', 'copilot-cli', 'github-copilot', 'github-copilot-cli', 'GitHub-Copilot-CLI']) {
    const provider = selectProvider({ harness: alias, environment: {} });
    assert.equal(provider.harness, 'copilot', `${alias} must canonicalize to the adapter identity`);
    assert.equal(provider.requested_harness.toLowerCase(), alias.toLowerCase());
    assert.equal(canonicalHarness(alias), 'copilot');
  }

  assert.equal(canonicalHarness('claude-code'), 'claude-code', 'an unknown name is kept, not invented');
  assert.equal(canonicalHarness(null), null);
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

test('a compaction is one beginning and one end, not one event counted twice', () => {
  withRoot((root) => {
    const logPath = copilotLog(
      root,
      event('session.compaction_start', { trigger: 'auto' }),
      event('session.compaction_complete', {}),
    );

    const { ledger } = collectSessionEvidence({
      harness: 'copilot',
      explicitPath: logPath,
      environment: {},
    });

    const compaction = ledger.entries.filter((entry) => entry.kind.startsWith('context_compaction'));
    assert.deepEqual(
      compaction.map((entry) => entry.kind),
      ['context_compaction_started', 'context_compaction_completed'],
    );
    assert.equal(ledger.completeness, 'compacted');
    assert.equal(ledger.confidence_cap, 'moderate');
  });
});

test('the published source identity is never a filesystem path', () => {
  withRoot((root) => {
    const identified = copilotLog(root);

    const named = collectSessionEvidence({
      harness: 'copilot',
      explicitPath: identified,
      environment: {},
    });
    assert.equal(named.ledger.source.log_id, 'session:session-1');
    assert.ok(!JSON.stringify(named.ledger).includes(root));

    const transcriptDirectory = path.join(root, 'anonymous');
    fs.mkdirSync(transcriptDirectory, { recursive: true });
    const transcript = path.join(transcriptDirectory, 'events.jsonl');
    fs.writeFileSync(transcript, `${event('assistant.turn_start', { turnId: 't1' })}\n`);

    const runtimeNamed = collectSessionEvidence({
      harness: 'copilot',
      transcriptPath: transcript,
      environment: {},
    });
    assert.equal(runtimeNamed.ledger.source.session_id, null);
    assert.match(runtimeNamed.ledger.source.log_id, /^sha256:[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(runtimeNamed.ledger).includes(transcriptDirectory));

    assert.deepEqual(
      assertLedgerContract({ ...named.ledger, source: { ...named.ledger.source, log_id: '/var/log/events.jsonl' } }),
      ['source.log_id must not be a filesystem path'],
    );
    assert.deepEqual(
      assertLedgerContract({ ...named.ledger, source: { ...named.ledger.source, log_id: 'C:\\logs\\events.jsonl' } }),
      ['source.log_id must not be a filesystem path'],
    );
  });
});

test('the contract reaches into details, nested fields, skills, and native counts', () => {
  const base = fictionalAdapter().read();
  const problemsFor = (overrides) => assertLedgerContract({ ...base, ...overrides });

  assert.deepEqual(
    problemsFor({ entries: [{ anchor: 'E1', kind: 'session_started', detail: { nested: { prompt: 'x' } } }] }),
    ['entry detail.nested must not carry raw prompt'],
  );
  assert.deepEqual(
    problemsFor({ entries: [{ anchor: 'E1', kind: 'session_started', detail: { note: 'x'.repeat(400) } }] }),
    ['entry detail.note exceeds 200 characters, which is payload rather than evidence'],
  );
  assert.deepEqual(
    problemsFor({ entries: [{ anchor: 'E1', kind: 'session_started', detail: { where: '/home/someone/log' } }] }),
    ['entry detail.where publishes a filesystem path'],
  );
  assert.deepEqual(
    problemsFor({ entries: [{ anchor: 'E1', kind: 'session_started', detail: { items: ['a', 'b'] } }] }),
    ['entry detail.items must be a scalar; a list is a payload in disguise'],
  );
  assert.deepEqual(
    problemsFor({ entries: [{ anchor: 'E1', kind: 'session_started', detail: { a: { b: { c: 1 } } } }] }),
    ['entry detail.a.b nests deeper than the ledger permits'],
  );
  assert.deepEqual(
    problemsFor({ skills: [{ anchor: 'nope', name: 'roast' }] }),
    ['skill anchor must be a source-scoped anchor; found nope'],
  );
  assert.deepEqual(
    problemsFor({ skills: [{ anchor: 'E1', name: 'roast', content: 'the whole skill body' }] }),
    ['skills entry must not carry raw content'],
  );
  assert.deepEqual(
    problemsFor({ provider_native: { event_counts: { 'a.b': 'many' } } }),
    ['provider_native.event_counts.a.b must be a whole number'],
  );
  assert.deepEqual(
    problemsFor({ provider_native: { transcript: 'the session as text' } }),
    ['provider_native.transcript must be a count or a group of counts'],
  );
  assert.deepEqual(
    problemsFor({ source: { kind: 'guesswork', log_id: 'x', session_id: null } }),
    ['source.kind must be one of session-log'],
  );
});

test('a replay whose identity is in doubt correlates to unknown, never to same-session', () => {
  const ledger = { harness: 'copilot', source: { session_id: 'session-1' } };

  const drifted = correlateRunLog(
    {
      harness: 'copilot-cli',
      session_id: 'session-1',
      defects: [{ type: 'session_identity_drift', anchor: 'L2', detail: 'changed session' }],
    },
    ledger,
  );
  assert.equal(drifted.status, 'unknown');
  assert.match(drifted.reason, /session_identity_drift/);

  for (const type of ['foreign_run', 'run_identity_drift']) {
    const doubted = correlateRunLog(
      { harness: 'copilot', session_id: 'session-1', defects: [{ type, anchor: 'L2' }] },
      ledger,
    );
    assert.equal(doubted.status, 'unknown', `${type} must not support a correlation claim`);
  }

  // A defect that says nothing about identity leaves correlation intact.
  const unrelated = correlateRunLog(
    {
      harness: 'copilot',
      session_id: 'session-1',
      defects: [{ type: 'incomplete_operation', anchor: 'L3' }],
    },
    ledger,
  );
  assert.equal(unrelated.status, 'same-session');
});

test('an alias on either side of a correlation is one harness, not two', () => {
  const ledger = { harness: 'copilot', source: { session_id: 'session-1' } };

  for (const alias of ['copilot', 'copilot-cli', 'github-copilot', 'github-copilot-cli']) {
    assert.equal(
      correlateRunLog({ harness: alias, session_id: 'session-1', defects: [] }, ledger).status,
      'same-session',
      `${alias} must correlate with the canonical identity`,
    );
    assert.equal(
      correlateRunLog(
        { harness: 'copilot', session_id: 'session-1', defects: [] },
        { harness: alias, source: { session_id: 'session-1' } },
      ).status,
      'same-session',
    );
  }

  assert.equal(
    correlateRunLog({ harness: 'fictional-cli', session_id: 'session-1', defects: [] }, ledger).status,
    'different-session',
  );
});

test('a Chronicle run log and the session it recorded correlate end to end', () => {
  withRoot((root) => {
    const logPath = copilotLog(root, event('skill.invoked', { name: 'post-mortem' }));
    const { ledger } = collectSessionEvidence({
      harness: 'copilot-cli',
      explicitPath: logPath,
      environment: {},
    });

    const runLog = path.join(root, '.skill-log', 'post-mortem.2026-01-01.run-1.jsonl');
    const context = {
      run_id: 'run-1',
      root_skill: 'post-mortem',
      log_path: runLog,
      // Exactly what the workflow passes: the canonical harness identity and
      // the session identity the seam established.
      harness: ledger.harness,
      session_id: ledger.source.session_id,
    };
    emitEvent({ event: 'run', phase: 'before', summary: 'Post-mortem begins.' }, context);
    emitEvent(
      { event: 'run', phase: 'after', summary: 'Post-mortem produced a record.', outcome: 'succeeded' },
      context,
    );

    const replayed = replayLog(runLog, { logId: 'run-1' });
    assert.deepEqual(replayed.defects, []);
    assert.equal(replayed.session_id, 'session-1');

    const correlation = correlateRunLog(replayed, ledger);
    assert.equal(correlation.status, 'same-session');

    // A run log from another session never correlates, however close in time.
    const otherLog = path.join(root, '.skill-log', 'post-mortem.2026-01-01.run-2.jsonl');
    emitEvent(
      { event: 'run', phase: 'observation', summary: 'A different session.' },
      { ...context, run_id: 'run-2', log_path: otherLog, session_id: 'session-elsewhere' },
    );
    assert.equal(correlateRunLog(replayLog(otherLog, { logId: 'run-2' }), ledger).status, 'different-session');

    // And a run log written without correlation is unknown rather than matched.
    const uncorrelatedLog = path.join(root, '.skill-log', 'post-mortem.2026-01-01.run-3.jsonl');
    emitEvent(
      { event: 'run', phase: 'observation', summary: 'No correlation recorded.' },
      { run_id: 'run-3', root_skill: 'post-mortem', log_path: uncorrelatedLog },
    );
    const uncorrelated = replayLog(uncorrelatedLog, { logId: 'run-3' });
    assert.equal(uncorrelated.session_id, null);
    assert.equal(correlateRunLog(uncorrelated, ledger).status, 'unknown');
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
import { emitEvent, replayLog } from '../../../_base/_molecules/chronicler/chronicler.mjs';

test('the correlation command replays a selected run log and returns a verdict', () => {
  withRoot((root) => {
    const logPath = copilotLog(root, event('skill.invoked', { name: 'post-mortem' }));
    const evidence = collectSessionEvidence({
      harness: 'copilot-cli',
      explicitPath: logPath,
      environment: {},
    });

    const runLog = path.join(root, '.skill-log', 'post-mortem.2026-01-01.run-1.jsonl');
    const context = {
      run_id: 'run-1',
      root_skill: 'post-mortem',
      log_path: runLog,
      harness: 'copilot-cli',
      session_id: 'session-1',
    };
    emitEvent({ event: 'run', phase: 'observation', summary: 'A run in this session.' }, context);

    const matched = correlateSelectedRunLog(runLog, evidence);
    assert.equal(matched.status, 'same-session');
    assert.equal(matched.run_log.harness, 'copilot', 'the alias is canonicalized in the report');
    assert.equal(matched.run_log.session_id, 'session-1');
    assert.equal(matched.session_evidence.session_id, 'session-1');
    assert.deepEqual(matched.run_log.defects, []);
    assert.ok(!JSON.stringify(matched).includes(root), 'the report publishes no path');

    // A log that cannot be replayed is unknown, never assumed to match.
    const absent = correlateSelectedRunLog(path.join(root, 'absent.jsonl'), evidence);
    assert.equal(absent.status, 'unknown');
    assert.match(absent.reason, /could not be replayed/);
    assert.equal(correlateSelectedRunLog(null, evidence).status, 'unknown');
  });
});

test('the command line correlates a selected run log against collected evidence', () => {
  withRoot((root) => {
    const logPath = copilotLog(root, event('skill.invoked', { name: 'post-mortem' }));
    const runLog = path.join(root, '.skill-log', 'post-mortem.2026-01-01.run-1.jsonl');
    emitEvent(
      { event: 'run', phase: 'observation', summary: 'A run in this session.' },
      {
        run_id: 'run-1',
        root_skill: 'post-mortem',
        log_path: runLog,
        harness: 'copilot',
        session_id: 'session-1',
      },
    );

    const printed = execFileSync(
      'node',
      [SEAM, '--harness', 'copilot-cli', '--path', logPath, '--correlate', runLog],
      { encoding: 'utf8' },
    );
    const result = JSON.parse(printed);

    assert.equal(result.evidence.status, 'collected');
    assert.equal(result.correlation.status, 'same-session');
    assert.equal(result.correlation.run_log.run_id, 'run-1');
    assert.equal(result.evidence.ledger.harness, 'copilot');
    assert.ok(!printed.includes(root), 'the command publishes no filesystem path');
  });
});

test('a native count key that is a path, a credential, or a sentence is refused', () => {
  const base = fictionalAdapter().read();
  const scheme = ['Bea', 'rer'].join('');

  for (const hostile of ['/etc/passwd', 'C:\\logs\\x', `Authorization: ${scheme} abc123abc123`, 'a name with spaces', 'x'.repeat(80)]) {
    const problems = assertLedgerContract({
      ...base,
      provider_native: { event_counts: { [hostile]: 3 } },
    });
    assert.deepEqual(
      problems,
      [`provider_native.event_counts key ${JSON.stringify(hostile)} is not a publishable name`],
      `key ${hostile} must be refused`,
    );
  }

  assert.deepEqual(
    assertLedgerContract({ ...base, provider_native: { '/etc/passwd': 1 } }),
    ['provider_native key "/etc/passwd" is not a publishable name'],
  );
  assert.deepEqual(
    assertLedgerContract({ ...base, provider_native: { event_counts: { 'session.start': 4, other_event_types: 9 } } }),
    [],
  );
});

test('an adapter reading a hostile log publishes no key it did not sanitize', () => {
  withRoot((root) => {
    const scheme = ['Bea', 'rer'].join('');
    const logPath = path.join(root, 'events.jsonl');
    fs.writeFileSync(logPath, [
      event('session.start', { sessionId: 'session-1' }),
      JSON.stringify({ type: '/etc/passwd', data: {}, timestamp: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ type: `Authorization: ${scheme} abc123abc123`, data: {}, timestamp: '2026-01-01T00:00:00.000Z' }),
      event('session.shutdown', { shutdownType: 'normal' }),
    ].join('\n') + '\n');

    const collected = collectSessionEvidence({
      harness: 'copilot',
      explicitPath: logPath,
      environment: {},
    });

    assert.equal(collected.status, 'collected');
    assert.deepEqual(assertLedgerContract(collected.ledger), []);
    const published = JSON.stringify(collected.ledger);
    assert.ok(!published.includes('/etc/passwd'));
    assert.ok(!published.includes(scheme));
    assert.equal(collected.ledger.provider_native.event_counts.other_event_types, 2);
  });
});

test('session evidence whose identity is contested cannot anchor a correlation', () => {
  const contested = {
    harness: 'copilot',
    source: { session_id: 'session-1' },
    limitations: [{ code: 'session_identity_contradiction', anchor: null, detail: 'claims another session' }],
  };

  const verdict = correlateRunLog(
    { harness: 'copilot', session_id: 'session-1', defects: [] },
    contested,
  );
  assert.equal(verdict.status, 'unknown');
  assert.match(verdict.reason, /session_identity_contradiction/);
});
