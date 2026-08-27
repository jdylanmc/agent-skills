import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MAX_EVENTS,
  SessionEvidenceError,
  extractSessionEvidenceFromText,
  parseArguments,
  readSelectedSession,
} from './copilot-session-events.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const READER = path.join(HERE, 'copilot-session-events.mjs');

function event(type, data = {}, extra = {}) {
  return JSON.stringify({
    type,
    data,
    id: `id-${type}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...extra,
  });
}

function log(...lines) {
  return `${lines.join('\n')}\n`;
}

function codes(result) {
  return result.limitations.map((entry) => entry.code);
}

function completeSession(...middle) {
  return log(
    event('session.start', { sessionId: 'session-1', producer: 'copilot-agent' }),
    ...middle,
    event('session.shutdown', { shutdownType: 'normal' }),
  );
}

function withTemporaryDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-session-events-'));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('a whole session reads as complete evidence with no limitation', () => {
  const result = extractSessionEvidenceFromText(
    completeSession(
      event('assistant.turn_start', { turnId: 't1' }),
      event('assistant.turn_end', { turnId: 't1' }),
    ),
    { logId: 'run-a' },
  );

  assert.equal(result.log_id, 'run-a');
  assert.equal(result.session_id, 'session-1');
  assert.equal(result.evidence_completeness, 'complete');
  assert.equal(result.confidence_cap, 'none');
  assert.deepEqual(result.limitations, []);
});

test('a skill invoked inside a subagent is reported as nested, and one outside it is not', () => {
  const result = extractSessionEvidenceFromText(
    completeSession(
      event('skill.invoked', { name: 'discovery', source: 'project', trigger: 'user' }),
      event('subagent.started', { toolCallId: 'call-1', agentName: 'explore' }),
      event('skill.invoked', { name: 'wiki-search', source: 'plugin', trigger: 'model' }),
      event('subagent.completed', { toolCallId: 'call-1', agentName: 'explore' }),
      event('skill.invoked', { name: 'changelog', source: 'project', trigger: 'user' }),
    ),
  );

  assert.equal(result.counts.skill_invocations, 3);
  assert.deepEqual(
    result.skills.invocations.map((entry) => [entry.name, entry.within_subagent]),
    [
      ['discovery', null],
      ['wiki-search', 'explore'],
      ['changelog', null],
    ],
  );
  assert.deepEqual(result.subagents.spans, [
    { anchor: 'E3', agent: 'explore', completed_anchor: 'E5', outcome: 'completed' },
  ]);
  assert.equal(result.evidence_completeness, 'complete');
});

test('a failed subagent closes its span as failed and is counted separately', () => {
  const result = extractSessionEvidenceFromText(
    completeSession(
      event('subagent.started', { toolCallId: 'call-1', agentName: 'explore' }),
      event('subagent.failed', { toolCallId: 'call-1', agentName: 'explore', error: 'boom' }),
      event('session.error', { errorType: 'provider', message: 'boom', statusCode: 500 }),
    ),
  );

  assert.equal(result.counts.subagent_failures, 1);
  assert.equal(result.subagents.completed, 0);
  assert.deepEqual(result.subagents.spans, [
    { anchor: 'E2', agent: 'explore', completed_anchor: 'E3', outcome: 'failed' },
  ]);
  assert.equal(result.counts.session_errors, 1);
  assert.deepEqual(
    result.events.find((entry) => entry.type === 'session.error'),
    {
      anchor: 'E4',
      type: 'session.error',
      timestamp: '2026-01-01T00:00:00.000Z',
      error_type: 'provider',
      status_code: 500,
    },
  );
  assert.ok(!JSON.stringify(result).includes('boom'));
  assert.deepEqual(result.limitations, []);
});

test('a subagent that never completes is a limitation, not a closed span', () => {
  const result = extractSessionEvidenceFromText(
    completeSession(event('subagent.started', { toolCallId: 'call-1', agentName: 'explore' })),
  );

  assert.ok(codes(result).includes('incomplete_subagent'));
  assert.equal(result.subagents.spans[0].completed_anchor, null);
  assert.equal(result.subagents.spans[0].outcome, null);
  assert.equal(result.evidence_completeness, 'partial');
});

test('repeated turns are counted, and a turn started twice is reported rather than merged', () => {
  const result = extractSessionEvidenceFromText(
    completeSession(
      event('assistant.turn_start', { turnId: 't1' }),
      event('assistant.turn_end', { turnId: 't1' }),
      event('assistant.turn_start', { turnId: 't2' }),
      event('assistant.turn_end', { turnId: 't2' }),
      event('assistant.turn_start', { turnId: 't3' }),
      event('assistant.turn_start', { turnId: 't3' }),
      event('assistant.turn_end', { turnId: 't3' }),
    ),
  );

  assert.equal(result.counts.turns_started, 4);
  assert.equal(result.counts.turns_completed, 3);
  assert.deepEqual(result.turns.repeated, ['E7']);
  assert.ok(codes(result).includes('duplicate_turn_start'));
});

test('a turn that ends without a start, and one that never ends, are both reported', () => {
  const result = extractSessionEvidenceFromText(
    completeSession(
      event('assistant.turn_end', { turnId: 'unknown' }),
      event('assistant.turn_start', { turnId: 'open' }),
    ),
  );

  assert.ok(codes(result).includes('unmatched_turn_end'));
  assert.ok(codes(result).includes('incomplete_turn'));
  assert.deepEqual(result.turns.incomplete, ['E3']);
});

test('tool calls are counted by name, failures are anchored, and an unfinished call is reported', () => {
  const result = extractSessionEvidenceFromText(
    completeSession(
      event('tool.execution_start', { toolCallId: 'c1', toolName: 'bash' }),
      event('tool.execution_complete', { toolCallId: 'c1', success: true }),
      event('tool.execution_start', { toolCallId: 'c2', toolName: 'bash' }),
      event('tool.execution_complete', { toolCallId: 'c2', success: false }),
      event('tool.execution_start', { toolCallId: 'c3', toolName: 'view' }),
    ),
  );

  assert.deepEqual(result.tools.by_tool, { bash: 2, view: 1 });
  assert.equal(result.counts.tool_failures, 1);
  assert.deepEqual(result.tools.failure_anchors, ['E5']);
  assert.deepEqual(result.tools.incomplete, ['E6']);
  assert.ok(codes(result).includes('incomplete_tool_call'));

  const failure = result.events.find((entry) => entry.success === false);
  assert.deepEqual(failure, {
    anchor: 'E5',
    type: 'tool.execution_complete',
    timestamp: '2026-01-01T00:00:00.000Z',
    tool_name: 'bash',
    success: false,
    request_anchor: 'E4',
  });
});

test('a malformed line is anchored and the records around it stay usable', () => {
  const result = extractSessionEvidenceFromText(
    log(
      event('session.start', { sessionId: 'session-1' }),
      '{"type":"tool.execution_start"',
      event('skill.invoked', { name: 'roast' }),
      event('session.shutdown', { shutdownType: 'normal' }),
    ),
  );

  assert.deepEqual(
    result.limitations.filter((entry) => entry.code === 'malformed_record'),
    [{ code: 'malformed_record', anchor: 'E2', detail: 'the line is not valid JSON' }],
  );
  assert.equal(result.usable_records, 3);
  assert.equal(result.counts.skill_invocations, 1);
  assert.equal(result.evidence_completeness, 'partial');
  assert.equal(result.confidence_cap, 'moderate');
});

test('a torn final record is reported as torn rather than malformed', () => {
  const text = `${event('session.start', { sessionId: 'session-1' })}\n{"type":"tool.exec`;
  const result = extractSessionEvidenceFromText(text);

  assert.deepEqual(codes(result).filter((code) => code.endsWith('_record')), ['torn_final_record']);
});

test('a blank line inside the log is reported, and a trailing newline is not', () => {
  const inside = extractSessionEvidenceFromText(
    log(event('session.start', { sessionId: 'session-1' }), '', event('session.shutdown', { shutdownType: 'normal' })),
  );
  assert.deepEqual(
    inside.limitations.map((entry) => [entry.code, entry.anchor]),
    [['blank_record', 'E2']],
  );

  const trailing = extractSessionEvidenceFromText(
    completeSession(event('assistant.turn_start', { turnId: 't1' }), event('assistant.turn_end', { turnId: 't1' })),
  );
  assert.deepEqual(codes(trailing), []);
});

test('an unknown event type is counted and named once, never mapped onto a known one', () => {
  const result = extractSessionEvidenceFromText(
    completeSession(
      event('runtime.telepathy', { intent: 'unknowable' }),
      event('runtime.telepathy', { intent: 'unknowable' }),
    ),
  );

  assert.deepEqual(
    result.limitations.filter((entry) => entry.code === 'unrecognized_event'),
    [
      {
        code: 'unrecognized_event',
        anchor: 'E2',
        detail: 'unsupported event type runtime.telepathy',
      },
    ],
  );
  assert.equal(result.counts.by_type['runtime.telepathy'], 2);
  assert.equal(result.usable_records, 4);
});

test('a supported event missing a depended-on field is drift, not a default', () => {
  const result = extractSessionEvidenceFromText(
    completeSession(
      event('tool.execution_start', { toolCallId: 'c1' }),
      event('tool.execution_complete', { toolCallId: 'c1', success: true }),
    ),
  );

  assert.deepEqual(
    result.limitations.filter((entry) => entry.code === 'schema_drift'),
    [
      {
        code: 'schema_drift',
        anchor: 'E2',
        detail: 'tool.execution_start is missing data.toolName',
      },
    ],
  );
  assert.deepEqual(result.tools.by_tool, { unnamed: 1 });
});

test('a record without an event type is invalid rather than guessed at', () => {
  const result = extractSessionEvidenceFromText(log('{"data":{"turnId":"t1"}}', '[1,2,3]'));

  assert.deepEqual(codes(result), ['invalid_record', 'invalid_record', 'no_usable_records']);
  assert.equal(result.usable_records, 0);
  assert.equal(result.evidence_completeness, 'partial');
});

test('an aborted session with no shutdown reports both conditions and caps confidence', () => {
  const result = extractSessionEvidenceFromText(
    log(
      event('session.start', { sessionId: 'session-1' }),
      event('assistant.turn_start', { turnId: 't1' }),
      event('abort', { reason: 'user_cancelled' }),
    ),
  );

  const reported = codes(result);
  assert.ok(reported.includes('session_aborted'));
  assert.ok(reported.includes('session_incomplete'));
  assert.ok(reported.includes('incomplete_turn'));
  assert.equal(result.evidence_completeness, 'partial');
  assert.equal(result.confidence_cap, 'moderate');
  assert.deepEqual(
    result.events.find((entry) => entry.type === 'abort'),
    {
      anchor: 'E3',
      type: 'abort',
      timestamp: '2026-01-01T00:00:00.000Z',
      reason: 'user_cancelled',
    },
  );
});

test('a compacted session is compacted, which outranks the other partial conditions', () => {
  const result = extractSessionEvidenceFromText(
    log(
      event('session.start', { sessionId: 'session-1' }),
      event('session.compaction_start', { trigger: 'auto' }),
      event('session.compaction_complete', {}),
    ),
  );

  assert.equal(result.evidence_completeness, 'compacted');
  assert.equal(result.confidence_cap, 'moderate');
  assert.ok(codes(result).includes('context_compacted'));
});

test('a log that does not begin at a session start says so', () => {
  const result = extractSessionEvidenceFromText(
    log(event('assistant.turn_start', { turnId: 't1' }), event('assistant.turn_end', { turnId: 't1' })),
  );

  assert.ok(codes(result).includes('session_start_absent'));
  assert.equal(result.session_id, null);
});

test('a second session identity in one file is reported as foreign', () => {
  const result = extractSessionEvidenceFromText(
    log(
      event('session.start', { sessionId: 'session-1' }),
      event('session.start', { sessionId: 'session-2' }),
      event('session.shutdown', { shutdownType: 'normal' }),
    ),
  );

  assert.ok(codes(result).includes('foreign_session'));
  assert.equal(result.session_id, 'session-1');
});

test('no prompt, tool result, or skill body reaches the output', () => {
  const marker = 'NEVER-EMIT-THIS-PAYLOAD';
  const result = extractSessionEvidenceFromText(
    completeSession(
      event('user.message', { content: marker, transformedContent: marker }),
      event('assistant.message', { content: marker }),
      event('tool.execution_start', {
        toolCallId: 'c1',
        toolName: 'bash',
        arguments: { command: marker },
      }),
      event('tool.execution_complete', {
        toolCallId: 'c1',
        success: false,
        result: { content: marker, detailedContent: marker },
      }),
      event('skill.invoked', {
        name: 'roast',
        source: 'project',
        trigger: 'user',
        content: marker,
        description: marker,
        path: `/home/someone/${marker}/SKILL.md`,
      }),
    ),
  );

  assert.ok(!JSON.stringify(result).includes(marker));
  assert.equal(result.counts.operator_messages, 1);
  assert.equal(result.counts.agent_messages, 1);
  assert.equal(result.counts.tool_failures, 1);
  assert.deepEqual(result.skills.invocations, [
    { anchor: 'E6', name: 'roast', source: 'project', trigger: 'user', within_subagent: null },
  ]);
});

test('a published string is bounded, stripped of control characters, and redacted', () => {
  const result = extractSessionEvidenceFromText(
    completeSession(
      event('skill.invoked', {
        name: `over\nthe\tbound-${'x'.repeat(400)}`,
        source: 'Authorization: Bearer abcdef0123456789abcdef',
      }),
    ),
  );

  const [invocation] = result.skills.invocations;
  assert.ok(invocation.name.length <= 120);
  assert.ok(!/[\n\t]/.test(invocation.name));
  assert.match(invocation.name, /^over the bound-x+$/);
  assert.match(invocation.source, /\[REDACTED:credential\]/);
});

test('material events are bounded, and the bound is reported rather than applied silently', () => {
  const invocations = Array.from({ length: 8 }, (_, index) =>
    event('skill.invoked', { name: `skill-${index}` }));
  const result = extractSessionEvidenceFromText(completeSession(...invocations), { maxEvents: 3 });

  assert.equal(result.events.length, 3);
  assert.equal(result.counts.skill_invocations, 8);
  assert.ok(codes(result).includes('event_budget_exhausted'));
});

test('the limitation list is bounded, and says so once', () => {
  const malformed = Array.from({ length: 12 }, () => '{');
  const result = extractSessionEvidenceFromText(log(...malformed), { maxNotes: 4 });

  assert.equal(result.limitations.length, 5);
  assert.equal(result.limitations.at(-1).code, 'limitation_budget_exhausted');
});

test('the same input always produces the same output', () => {
  const text = completeSession(
    event('skill.invoked', { name: 'roast' }),
    event('tool.execution_start', { toolCallId: 'c1', toolName: 'bash' }),
    event('tool.execution_complete', { toolCallId: 'c1', success: false }),
  );

  assert.equal(
    JSON.stringify(extractSessionEvidenceFromText(text, { logId: 'fixed' })),
    JSON.stringify(extractSessionEvidenceFromText(text, { logId: 'fixed' })),
  );
});

test('an empty selection is reported as holding no usable record', () => {
  const result = extractSessionEvidenceFromText('');

  assert.deepEqual(codes(result), ['no_usable_records']);
  assert.deepEqual(result.events, []);
  assert.equal(result.confidence_cap, 'moderate');
});

test('a selected file is read from disk, with the path replaced by an opaque identifier', () => {
  withTemporaryDirectory((directory) => {
    const selected = path.join(directory, 'events.jsonl');
    fs.writeFileSync(selected, completeSession(event('skill.invoked', { name: 'roast' })));

    const result = readSelectedSession(selected, { logId: 'run-7' });

    assert.equal(result.log_id, 'run-7');
    assert.equal(result.counts.skill_invocations, 1);
    assert.equal(result.evidence_completeness, 'complete');
  });
});

test('a log longer than the line bound is truncated with the truncation reported', () => {
  withTemporaryDirectory((directory) => {
    const selected = path.join(directory, 'events.jsonl');
    fs.writeFileSync(
      selected,
      log(
        event('session.start', { sessionId: 'session-1' }),
        event('skill.invoked', { name: 'roast' }),
        event('skill.invoked', { name: 'changelog' }),
        event('session.shutdown', { shutdownType: 'normal' }),
      ),
    );

    const result = readSelectedSession(selected, { maxLines: 2 });

    assert.equal(result.lines_read, 2);
    assert.ok(codes(result).includes('line_budget_exhausted'));
    assert.equal(result.evidence_completeness, 'partial');
  });
});

test('a record longer than the record bound is reported rather than parsed', () => {
  withTemporaryDirectory((directory) => {
    const selected = path.join(directory, 'events.jsonl');
    const huge = JSON.stringify({ type: 'user.message', data: { content: 'x'.repeat(1_200_000) } });
    fs.writeFileSync(
      selected,
      log(
        event('session.start', { sessionId: 'session-1' }),
        huge,
        event('skill.invoked', { name: 'roast' }),
        event('session.shutdown', { shutdownType: 'normal' }),
      ),
    );

    const result = readSelectedSession(selected);

    assert.deepEqual(
      result.limitations.filter((entry) => entry.code === 'oversized_record'),
      [
        {
          code: 'oversized_record',
          anchor: 'E2',
          detail: 'the record exceeded 1048576 bytes and was not read',
        },
      ],
    );
    assert.equal(result.counts.operator_messages, 0);
    // The dropped record still occupies its line, so later anchors are unmoved.
    assert.deepEqual(result.skills.invocations.map((entry) => entry.anchor), ['E3']);
    assert.equal(result.lines_read, 4);
  });
});

test('reading refuses anything but one explicitly named file', () => {
  withTemporaryDirectory((directory) => {
    fs.writeFileSync(path.join(directory, 'events.jsonl'), completeSession());

    assert.throws(() => readSelectedSession(directory), (error) => {
      assert.ok(error instanceof SessionEvidenceError);
      assert.equal(error.code, 'not_a_file');
      return true;
    });
    assert.throws(() => readSelectedSession(''), { code: 'no_selection' });
    assert.throws(() => readSelectedSession(undefined), { code: 'no_selection' });
    assert.throws(
      () => readSelectedSession(path.join(directory, 'absent.jsonl')),
      { code: 'unreadable_selection' },
    );
  });
});

test('the command line takes one named path and refuses every way of asking it to choose', () => {
  assert.deepEqual(parseArguments(['/logs/events.jsonl', '--log-id', 'run-7']), {
    logId: 'run-7',
    selectedPath: '/logs/events.jsonl',
  });
  assert.deepEqual(parseArguments(['--probe']), { probe: true });

  assert.throws(() => parseArguments([]), { code: 'no_selection' });
  assert.throws(() => parseArguments(['--latest']), { code: 'usage' });
  assert.throws(() => parseArguments(['--newest', '/logs']), { code: 'usage' });
  assert.throws(() => parseArguments(['/logs/a.jsonl', '/logs/b.jsonl']), { code: 'usage' });
  assert.throws(() => parseArguments(['/logs/a.jsonl', '--max-events', '0']), { code: 'usage' });
});

test('the module offers no way to discover a log', () => {
  const source = fs.readFileSync(READER, 'utf8');

  for (const discovery of ['readdirSync', 'globSync', 'opendirSync', 'mtime', 'homedir']) {
    assert.ok(!source.includes(discovery), `the reader must not use ${discovery}`);
  }
});

test('the entry point refuses an unselected run and reads a selected one', () => {
  withTemporaryDirectory((directory) => {
    const selected = path.join(directory, 'events.jsonl');
    fs.writeFileSync(selected, completeSession(event('skill.invoked', { name: 'roast' })));

    const printed = execFileSync('node', [READER, selected, '--log-id', 'run-7'], {
      encoding: 'utf8',
    });
    const result = JSON.parse(printed);
    assert.equal(result.log_id, 'run-7');
    assert.equal(result.counts.skill_invocations, 1);

    assert.equal(
      execFileSync('node', [READER, '--probe'], { encoding: 'utf8' }).trim(),
      'copilot-session-events: available',
    );

    const refusal = (() => {
      try {
        execFileSync('node', [READER], { encoding: 'utf8', stdio: 'pipe' });
        return null;
      } catch (error) {
        return { status: error.status, stderr: error.stderr };
      }
    })();

    assert.equal(refusal.status, 1);
    assert.equal(JSON.parse(refusal.stderr).error.code, 'no_selection');
  });
});

test('the default event bound is a stated constant rather than an inline number', () => {
  assert.equal(typeof DEFAULT_MAX_EVENTS, 'number');
  assert.ok(DEFAULT_MAX_EVENTS > 0);
});
