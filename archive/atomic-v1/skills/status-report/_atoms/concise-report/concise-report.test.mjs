import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { MAX_INPUT_BYTES, SnapshotError, formatDuration, main, renderStatus } from './concise-report.mjs';

function description(text, tickets = []) {
  return { text, tickets };
}

function snapshot() {
  const objectiveId = 'cache-migration';
  const agentId = 'coordinator';
  const asOf = '2026-09-07T12:00:00.000Z';
  return {
    scope: { objectiveId, agentId },
    asOf: { time: asOf, source: 'runtime clock' },
    objective: description('Finish the cache migration.', [{ ref: '#202', title: 'Handle empty cache entries' }]),
    completed: { coverage: 'complete', items: [description('Updated the cache reader.')], reason: null, objectiveId, observedAt: asOf, source: 'current objective tasks' },
    remaining: { coverage: 'complete', items: [description('Finish review.', [{ ref: '#204', title: 'Review cache behavior' }])], reason: null, objectiveId, observedAt: asOf, source: 'current objective tasks' },
    timing: { startedAt: '2026-09-07T10:00:00.000Z', objectiveId, source: 'native objective start' },
    toolCalls: { kind: 'authoritative', count: 47, objectiveId, agentId, through: asOf, source: 'native objective-scoped count', unit: 'attempts', complete: true, excludesDescendants: true, excludesReport: true },
    subagents: {
      coverage: 'complete', objectiveId, through: asOf, source: 'native descendant registry',
      items: [
        { id: 'reviewer', objectiveId, state: 'running', ancestors: [agentId], work: description('Reviewing cache behavior.', [{ ref: '#204', title: 'Review cache behavior' }]) },
        { id: 'nested-worker', objectiveId, state: 'running', ancestors: [agentId, 'reviewer'], work: description('Checking migration boundaries.') },
      ],
    },
  };
}

test('renders an objective-scoped overview with readable tickets and all running assignments', () => {
  assert.equal(renderStatus(snapshot()), [
    '**Objective:** Finish the cache migration. (#202 - Handle empty cache entries)',
    '',
    '**Completed**',
    '- Updated the cache reader.',
    '',
    '**Remaining**',
    '- Finish review. (#204 - Review cache behavior)',
    '',
    '**Snapshot:** 2026-09-07T12:00:00.000Z | **Elapsed (wall clock):** 2h 0m | **Tool calls (this agent):** 47',
    '**Running subagents:** 2',
    '- reviewer - Reviewing cache behavior. (#204 - Review cache behavior)',
    '- nested-worker - Checking migration boundaries.',
    '',
  ].join('\n'));
});

test('represents absent evidence explicitly instead of reporting zero activity', () => {
  const value = {
    scope: null, asOf: { time: null, reason: 'clock unavailable' }, objective: null,
    completed: { coverage: 'unavailable', items: [], reason: 'objective not established' },
    remaining: { coverage: 'unavailable', items: [], reason: 'objective not established' },
    timing: { startedAt: null, reason: 'start time unavailable' },
    toolCalls: { kind: 'unavailable', count: null, reason: 'objective call count unavailable' },
    subagents: { coverage: 'unavailable', items: [], reason: 'no descendant registry' },
  };
  const report = renderStatus(value);
  assert.match(report, /\*\*Objective:\*\* Unavailable/);
  assert.match(report, /\*\*Snapshot:\*\* Unavailable/);
  assert.match(report, /\*\*Elapsed \(wall clock\):\*\* Unavailable/);
  assert.match(report, /\*\*Tool calls \(this agent\):\*\* Unavailable/);
  assert.match(report, /\*\*Running subagents:\*\* Unavailable/);
  assert.doesNotMatch(report, /\*\*: 0|None recorded/);
});

test('partial progress and later agent observations never masquerade as totals', () => {
  const value = snapshot();
  value.completed.coverage = 'partial';
  value.completed.reason = 'earlier context was compacted';
  value.toolCalls = { kind: 'unavailable', count: null, reason: 'only a session-wide total is available' };
  value.subagents.coverage = 'partial';
  value.subagents.reason = 'registry read after the cutoff';
  value.subagents.through = '2026-09-07T12:00:05.000Z';
  const report = renderStatus(value);
  assert.match(report, /\*\*Completed\*\* \(partial - earlier context was compacted; observed 2026-09-07T12:00:00.000Z\)/);
  assert.match(report, /Total unavailable; 2 visible/);
  assert.match(report, /observed 2026-09-07T12:00:05.000Z/);
  assert.match(report, /Tool calls \(this agent\):\*\* Unavailable/);
});

test('known zero counts remain distinguishable from unavailable information', () => {
  const value = snapshot();
  value.toolCalls.count = 0;
  value.subagents.items = [];
  value.completed.items = [];
  assert.match(renderStatus(value), /Tool calls \(this agent\):\*\* 0/);
  assert.match(renderStatus(value), /Running subagents:\*\* 0/);
  assert.match(renderStatus(value), /None recorded\./);
});

test('missing ticket titles and assignments stay visible', () => {
  const value = snapshot();
  value.objective.tickets[0].title = null;
  value.subagents.items[0].work = null;
  assert.match(renderStatus(value), /#202 - title unavailable/);
  assert.match(renderStatus(value), /reviewer - assignment unavailable/);
});

test('does not allow source strings to inject report structure or embedded media', () => {
  const value = snapshot();
  value.objective.tickets[0].title = '![image](https://example.com) <script>not executed</script>';
  const report = renderStatus(value);
  assert.ok(report.includes('!\\[image\\]'));
  assert.ok(report.includes('\\<script\\>'));
  assert.doesNotMatch(report, /!\[image\]|<script>/);
});

for (const [name, mutate, message] of [
  ['foreign tool owner', (s) => { s.toolCalls.agentId = 'other-agent'; }, /agent identity/],
  ['foreign tool objective', (s) => { s.toolCalls.objectiveId = 'other-goal'; }, /objective identity/],
  ['foreign timing objective', (s) => { s.timing.objectiveId = 'other-goal'; }, /objective identity/],
  ['foreign agent objective', (s) => { s.subagents.items[0].objectiveId = 'other-goal'; }, /belong to the objective/],
  ['reporting agent included as a child', (s) => { s.subagents.items[0].id = 'coordinator'; }, /reporting agent/],
  ['completed worker', (s) => { s.subagents.items[0].state = 'completed'; }, /currently running/],
  ['idle worker', (s) => { s.subagents.items[0].state = 'idle'; }, /currently running/],
  ['duplicate nested worker', (s) => { s.subagents.items.push(structuredClone(s.subagents.items[0])); }, /duplicate subagent/],
  ['call count after cutoff', (s) => { s.toolCalls.through = '2026-09-07T12:00:01.000Z'; }, /reporting cutoff/],
  ['complete later agent list', (s) => { s.subagents.through = '2026-09-07T12:00:01.000Z'; }, /reporting cutoff/],
  ['missing count source', (s) => { delete s.toolCalls.source; }, /source/],
  ['negative count', (s) => { s.toolCalls.count = -1; }, /nonnegative safe integer/],
  ['fractional count', (s) => { s.toolCalls.count = 2.5; }, /nonnegative safe integer/],
  ['unsafe count', (s) => { s.toolCalls.count = Number.MAX_SAFE_INTEGER + 1; }, /nonnegative safe integer/],
  ['future objective start', (s) => { s.timing.startedAt = '2026-09-07T13:00:00.000Z'; }, /reporting cutoff/],
  ['invalid calendar date', (s) => { s.timing.startedAt = '2026-02-30T10:00:00.000Z'; }, /calendar timestamp/],
  ['missing timezone', (s) => { s.asOf.time = '2026-09-07T12:00:00.000'; }, /UTC timestamp/],
  ['four objective sentences', (s) => { s.objective.text = 'One. Two. Three. Four.'; }, /three sentences/],
  ['bare number reference', (s) => { s.remaining.items[0].text = 'Working on issue 202.'; }, /ticket references/],
  ['bare hash reference', (s) => { s.objective.text = 'Finish #202.'; }, /ticket references/],
  ['duplicate ticket', (s) => { s.objective.tickets.push(structuredClone(s.objective.tickets[0])); }, /duplicate ticket/],
  ['missing title instead of explicit unknown', (s) => { delete s.objective.tickets[0].title; }, /title/],
  ['multiline title', (s) => { s.objective.tickets[0].title = 'Title\n**Completed**'; }, /control characters/],
  ['terminal escape', (s) => { s.subagents.items[0].work.text = '\u001b[31mred'; }, /control characters/],
  ['unknown field', (s) => { s.publish = true; }, /unknown field/],
  ['unavailable list with asserted work', (s) => { s.completed.coverage = 'unavailable'; s.completed.reason = 'no evidence'; }, /cannot contain/],
  ['partial view without reason', (s) => { s.remaining.coverage = 'partial'; }, /reason/],
  ['unavailable agents with asserted workers', (s) => { s.subagents.coverage = 'unavailable'; s.subagents.reason = 'no evidence'; }, /cannot contain/],
  ['unknown scope with claimed metrics', (s) => { s.scope = null; }, /established objective scope/],
]) {
  test(`refuses ${name}`, () => {
    const value = snapshot();
    mutate(value);
    assert.throws(() => renderStatus(value), (error) => error instanceof SnapshotError && message.test(error.message));
  });
}

test('accepts three short objective sentences', () => {
  const value = snapshot();
  value.objective.text = 'Finish the cache migration. Preserve current behavior. Keep the rollout reversible.';
  assert.match(renderStatus(value), /Keep the rollout reversible/);
});

test('duration formatting remains objective elapsed time rather than a completion estimate', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(59_000), '59s');
  assert.equal(formatDuration(61_000), '1m 1s');
  assert.equal(formatDuration(3_660_000), '1h 1m');
  assert.equal(formatDuration(90_060_000), '1d 1h 1m');
  assert.throws(() => formatDuration(-1), SnapshotError);
});

test('accessor-bearing objects are refused without executing the accessor', () => {
  let touched = false;
  const value = snapshot();
  Object.defineProperty(value, 'objective', { get() { touched = true; return null; } });
  assert.throws(() => renderStatus(value), /accessor fields/);
  assert.equal(touched, false);
});

test('CLI formatter is stdin/stdout-only and never returns a success-shaped fallback', async () => {
  for (const [input, status, expected] of [
    [JSON.stringify(snapshot()), 0, /Finish the cache migration/],
    ['{', 1, /status-report:/],
    [JSON.stringify({}), 1, /status-report:/],
    [' '.repeat(MAX_INPUT_BYTES + 1), 1, /256 KiB/],
  ]) {
    let stdout = '';
    let stderr = '';
    assert.equal(await main(Readable.from([input]), { write(value) { stdout += value; } }, { write(value) { stderr += value; } }), status);
    assert.match(status === 0 ? stdout : stderr, expected);
    assert.equal(status === 0 ? stderr : stdout, '');
  }
});

function eventSnapshot() {
  const value = snapshot();
  value.toolCalls = {
    kind: 'events', complete: true,
    objectiveId: value.scope.objectiveId, agentId: value.scope.agentId,
    from: value.timing.startedAt, through: value.asOf.time,
    source: 'complete native objective event slice', events: [],
  };
  return value;
}

function call(overrides = {}) {
  return {
    callId: 'call-1', agentId: 'coordinator', objectiveId: 'cache-migration',
    timestamp: '2026-09-07T11:00:00.000Z', phase: 'start', report: false,
    ...overrides,
  };
}

test('native call evidence counts attempts once and excludes other owners, objectives and report calls', () => {
  const value = eventSnapshot();
  value.toolCalls.events = [
    call(), call(), call({ phase: 'complete' }),
    call({ callId: 'child', agentId: 'reviewer' }),
    call({ callId: 'other', objectiveId: 'unrelated' }),
    call({ callId: 'report', report: true }),
    call({ callId: 'future', timestamp: '2026-09-07T12:00:01.000Z' }),
    call({ callId: 'before', timestamp: '2026-09-07T09:59:59.000Z' }),
    call({ callId: 'failed-attempt' }),
  ];
  assert.match(renderStatus(value), /Tool calls \(this agent\):\*\* 2/);
});

test('an empty complete event slice proves zero rather than unavailable', () => {
  assert.match(renderStatus(eventSnapshot()), /Tool calls \(this agent\):\*\* 0/);
});

for (const [name, mutate] of [
  ['truncated native events', (s) => { s.toolCalls.complete = false; }],
  ['incomplete objective window', (s) => { s.toolCalls.from = '2026-09-07T11:00:00.000Z'; }],
  ['completion without its attempt', (s) => { s.toolCalls.events = [call({ phase: 'complete' })]; }],
  ['contradictory reporting-invocation membership', (s) => { s.toolCalls.events = [call(), call({ phase: 'complete', report: true })]; }],
  ['one native identity with different start times', (s) => { s.toolCalls.events = [call(), call({ timestamp: '2026-09-07T11:01:00.000Z' })]; }],
]) {
  test(`does not turn ${name} into an exact count`, () => {
    const value = eventSnapshot();
    mutate(value);
    assert.throws(() => renderStatus(value), SnapshotError);
  });
}

for (const [name, mutate] of [
  ['untyped counter', (s) => { delete s.toolCalls.kind; }],
  ['descendant-inclusive counter', (s) => { s.toolCalls.excludesDescendants = false; }],
  ['report-inclusive counter', (s) => { s.toolCalls.excludesReport = false; }],
  ['completion counter rather than attempts', (s) => { s.toolCalls.unit = 'completions'; }],
  ['incomplete authoritative counter', (s) => { s.toolCalls.complete = false; }],
  ['worker without ancestry', (s) => { delete s.subagents.items[0].ancestors; }],
  ['foreign-root ancestry', (s) => { s.subagents.items[0].ancestors = ['unrelated']; }],
  ['cyclic ancestry', (s) => { s.subagents.items[1].ancestors = ['coordinator', 'reviewer', 'reviewer']; }],
  ['worker in its own ancestry', (s) => { s.subagents.items[0].ancestors.push('reviewer'); }],
  ['contradictory represented parent', (s) => { s.subagents.items[0].ancestors.push('another-parent'); }],
  ['padded caller identity', (s) => { s.scope.agentId = 'coordinator '; }],
  ['padded objective identity', (s) => { s.scope.objectiveId = ' cache-migration'; }],
  ['padded child identity', (s) => { s.subagents.items[0].id = 'reviewer '; }],
  ['padded ancestry identity', (s) => { s.subagents.items[0].ancestors = ['coordinator ']; }],
  ['stale partial workers', (s) => { s.subagents.coverage = 'partial'; s.subagents.reason = 'older registry'; s.subagents.through = '2026-09-07T11:59:00.000Z'; }],
  ['foreign progress scope', (s) => { s.completed.objectiveId = 'unrelated'; }],
  ['complete progress without its observation time', (s) => { delete s.remaining.observedAt; }],
  ['complete progress observed later', (s) => { s.remaining.observedAt = '2026-09-07T12:00:01.000Z'; }],
  ['clock without a source', (s) => { delete s.asOf.source; }],
  ['unavailable clock without a reason', (s) => { s.asOf = { time: null }; }],
  ['overlong objective', (s) => { s.objective.text = 'x'.repeat(1000) + '.'; }],
  ['too many progress bullets', (s) => { s.completed.items = Array.from({ length: 20 }, () => description('Completed work.')); }],
  ['too many ticket references', (s) => { s.objective.tickets = Array.from({ length: 20 }, (_, i) => ({ ref: `#${i + 1}`, title: 'Ticket title' })); }],
  ['URL-shaped ticket reference', (s) => { s.objective.tickets[0].ref = 'https://example.com/item#202'; }],
]) {
  test(`rejects ${name}`, () => {
    const value = snapshot();
    mutate(value);
    assert.throws(() => renderStatus(value), SnapshotError);
  });
}

test('later progress observations retain partial status and observed time', () => {
  const value = snapshot();
  value.remaining.coverage = 'partial';
  value.remaining.reason = 'observed after cutoff';
  value.remaining.observedAt = '2026-09-07T12:00:01.000Z';
  assert.match(renderStatus(value), /Remaining\*\* \(partial.*observed 2026-09-07T12:00:01.000Z/);
});

for (const ref of ['#202', '!202', 'AB#202', 'owner/repo#202', 'owner/repo!202', 'issue 202', 'PR !202', 'work item AB#202']) {
  test(`ticket grammar supports ${ref} in structured references and rejects it bare`, () => {
    const value = snapshot();
    value.objective.tickets[0].ref = ref;
    assert.match(renderStatus(value), /Handle empty cache entries/);
    value.objective.text = `Working on ${ref}.`;
    assert.throws(() => renderStatus(value), /ticket references/);
  });
}

test('non-ticket hash text stays ordinary technical prose', () => {
  const value = snapshot();
  value.completed.items[0].text = 'Updated CSS color #123456 and checksum abc#123def.';
  assert.match(renderStatus(value), /CSS color #123456/);
});

for (const control of ['\u061c', '\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069']) {
  test(`refuses hidden directionality control U+${control.codePointAt(0).toString(16)}`, () => {
    for (const mutate of [
      (s) => { s.objective.tickets[0].title += control; },
      (s) => { s.subagents.items[0].work.text += control; },
      (s) => { s.toolCalls = { kind: 'unavailable', count: null, reason: `unknown${control}` }; },
    ]) {
      const value = snapshot();
      mutate(value);
      assert.throws(() => renderStatus(value), /control characters/);
    }
  });
}

test('ordinary right-to-left script is preserved', () => {
  const value = snapshot();
  const title = '\u05d1\u05d3\u05d9\u05e7\u05ea \u05de\u05e6\u05d1';
  value.objective.tickets[0].title = title;
  assert.ok(renderStatus(value).includes(title));
});

test('refusal diagnostics do not echo hostile keys or parser input', async () => {
  for (const input of [
    JSON.stringify({ ['hostile\n\u001b[31mkey']: true }),
    JSON.stringify({ ['x'.repeat(20_000)]: true }),
    'not-json-private-marker\n\u001b[31m',
  ]) {
    let stdout = '';
    let stderr = '';
    assert.equal(await main(Readable.from([input]), { write(value) { stdout += value; } }, { write(value) { stderr += value; } }), 1);
    assert.equal(stdout, '');
    assert.ok(stderr.length <= 400);
    assert.equal(stderr.split('\n').length, 2);
    assert.doesNotMatch(stderr, /hostile|private-marker|\u001b/);
    assert.match(stderr, /^status-report: (invalid_snapshot|invalid_json): /);
  }
});

for (const reference of ['[#202]', '"#202"', "'#202'", '**#202**', '`#202`', '(!202)', 'blocked:#202', 'blocked=#202']) {
  test(`recognizes bare references at punctuation boundaries: ${reference}`, () => {
    const value = snapshot();
    value.completed.items[0].text = `Waiting for ${reference}.`;
    assert.throws(() => renderStatus(value), /ticket references/);
  });

}

test('ordinary URLs and quoted CSS colors are not bare numbered reference tokens', () => {
  const value = snapshot();
  value.completed.items[0].text = "See https://example.com/path#202 and www.example.com/path#203; CSS color: '#123456'.";
  assert.match(renderStatus(value), /https:\/\/example\.com\/path#202/);
});

for (const [name, mutate] of [
  ['clock reason', (s) => { s.asOf = { time: null, reason: 'Waiting for [#202]' }; }],
  ['timing reason', (s) => { s.timing = { startedAt: null, reason: 'Waiting for [#202]' }; }],
  ['counter reason', (s) => { s.toolCalls = { kind: 'unavailable', count: null, reason: 'Waiting for [#202]' }; }],
  ['completed reason', (s) => { s.completed.coverage = 'partial'; s.completed.reason = 'Waiting for [#202]'; }],
  ['remaining reason', (s) => { s.remaining.coverage = 'partial'; s.remaining.reason = 'Waiting for [#202]'; }],
  ['subagent reason', (s) => { s.subagents.coverage = 'partial'; s.subagents.reason = 'Waiting for [#202]'; }],
]) {
  test(`does not introduce titleless tickets through ${name}`, () => {
    const value = snapshot();
    mutate(value);
    assert.throws(() => renderStatus(value), /ticket references/);
  });
}

for (const [name, mutate] of [
  ['complete progress limitation', (s) => { s.completed.reason = 'task list truncated'; }],
  ['complete remaining limitation', (s) => { s.remaining.reason = 'task list truncated'; }],
  ['complete registry limitation', (s) => { s.subagents.reason = 'registry response truncated'; }],
  ['known clock limitation', (s) => { s.asOf.reason = 'clock unavailable'; }],
  ['known start limitation', (s) => { s.timing.reason = 'start unproven'; }],
  ['unavailable progress with dormant scope', (s) => { s.completed = { coverage: 'unavailable', items: [], reason: 'no evidence', objectiveId: 'foreign' }; }],
  ['unavailable registry with dormant source', (s) => { s.subagents = { coverage: 'unavailable', items: [], reason: 'no evidence', source: 'foreign' }; }],
  ['unavailable start with dormant scope', (s) => { s.timing = { startedAt: null, reason: 'no evidence', objectiveId: 'foreign' }; }],
  ['unavailable clock with dormant source', (s) => { s.asOf = { time: null, reason: 'no evidence', source: 'foreign' }; }],
  ['established scope with no objective summary', (s) => { s.objective = null; }],
]) {
  test(`refuses contradictory availability: ${name}`, () => {
    const value = snapshot();
    mutate(value);
    assert.throws(() => renderStatus(value), SnapshotError);
  });
}

test('immutable known titles do not disappear into prose limits', () => {
  for (const length of [240, 241, 512, 4096]) {
    const value = snapshot();
    const title = 't'.repeat(length);
    value.objective.tickets = [{ ref: '#202', title }, { ref: '#204', title }];
    const report = renderStatus(value);
    assert.ok(report.includes(`#202 - ${title}`));
    assert.ok(report.includes(`#204 - ${title}`));
    assert.doesNotMatch(report, /title unavailable/);
  }
});

test('ticket aliases share canonical identity while distinct markers and qualifiers do not', () => {
  for (const [a, b] of [['#202', 'issue 202'], ['AB#0202', 'work item AB#202']]) {
    const value = snapshot();
    value.objective.tickets = [{ ref: a, title: 'One' }, { ref: b, title: 'Conflicting title' }];
    assert.throws(() => renderStatus(value), /duplicate ticket/);
  }
  const value = snapshot();
  value.objective.tickets = [{ ref: '#202', title: 'Issue' }, { ref: '!202', title: 'Merge request' }];
  assert.match(renderStatus(value), /#202 - Issue; !202 - Merge request/);
  value.objective.tickets = [{ ref: 'one/repo#202', title: 'One' }, { ref: 'two/repo#202', title: 'Two' }];
  assert.match(renderStatus(value), /one\/repo#202 - One; two\/repo#202 - Two/);
});

test('opaque worker identifiers that resemble tickets get a presentation label, not a bare reference', () => {
  const value = snapshot();
  value.subagents.items[0].id = '#999';
  value.subagents.items[1].ancestors[1] = '#999';
  const report = renderStatus(value);
  assert.match(report, /worker 1 - Reviewing/);
  assert.doesNotMatch(report, /#999/);
});
