import assert from 'node:assert/strict';
import test from 'node:test';
import { computeFrontier } from './dependency-frontier.mjs';

const manifest = {
  concurrency: 2,
  issues: ['a', 'b', 'c', 'd'].map((identity) => ({ identity })),
  dependencies: [
    { dependency: 'a', dependent: 'b', satisfiedBy: 'human-merge' },
    { dependency: 'b', dependent: 'c', satisfiedBy: 'completed' },
  ],
};

function state(statuses = {}, merges = []) {
  return {
    issues: Object.fromEntries(manifest.issues.map(({ identity }) => [identity, {
      status: statuses[identity] ?? 'pending',
      terminalDisposition: null,
    }])),
    observedHumanMerges: merges.map((issue) => ({ issue })),
  };
}

test('preserves chain blockers and fills parallel capacity from ready work', () => {
  const result = computeFrontier(manifest, state());
  assert.deepEqual(result.ready.map((entry) => entry.issue), ['a', 'd']);
  assert.deepEqual(result.capacity.dispatch.map((entry) => entry.issue), ['a', 'd']);
  assert.equal(result.blocked.find((entry) => entry.issue === 'b').reason, 'awaiting-observed-human-merge:a');
  assert.equal(result.blocked.find((entry) => entry.issue === 'c').reason, 'awaiting-completion:b');
});

test('recomputes after observed merges and terminal transitions', () => {
  const afterMerge = computeFrontier(manifest, state({ a: 'completed', d: 'active' }, ['a']));
  assert.deepEqual(afterMerge.capacity.dispatch.map((entry) => entry.issue), ['b']);
  const afterCompletion = computeFrontier(manifest, state({ a: 'completed', b: 'completed' }, ['a']));
  assert.deepEqual(afterCompletion.ready.map((entry) => entry.issue), ['c', 'd']);
});
