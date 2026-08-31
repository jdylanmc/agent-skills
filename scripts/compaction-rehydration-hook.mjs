#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  agentStop,
  postToolUse,
  preCompact,
  preToolUse,
  sessionStart,
} from '../skills/_base/_atoms/copilot-rehydration-adapter/copilot-rehydration-adapter.mjs';
import { emitEvent } from '../skills/_base/_molecules/chronicler/chronicler.mjs';
import { readState } from '../skills/_base/_atoms/rehydration-state/rehydration-state.mjs';

const handlers = { agentStop, postToolUse, preCompact, preToolUse, sessionStart };

function repositoryRoot(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, 'skills')) && fs.existsSync(path.join(current, 'intent.md'))) {
      return fs.realpathSync(current);
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error('repository root not found');
    current = parent;
  }
}

function record(root, sessionId, event, phase, outcome) {
  let state;
  try {
    state = readState(root, sessionId);
  } catch {
    return;
  }
  if (!state) return;
  for (const frame of state.stack) {
    try {
      emitEvent({
        skill: frame.skill,
        event,
        phase,
        summary: `${event} ${outcome}`,
        operation: `rehydration-${state.generation}`,
        outcome,
      }, {
        run_id: frame.runId,
        root_skill: frame.rootSkill,
        log_path: path.join(root, frame.logPath),
        harness: 'copilot-cli',
        session_id: sessionId,
      });
    } catch {
      // Hook enforcement never depends on best-effort Chronicle recording.
    }
  }
}

export function run(kind, input, streams = process) {
  const handler = handlers[kind];
  if (!handler) {
    streams.stderr.write(`unsupported hook event: ${kind}\n`);
    return 1;
  }
  try {
    const root = repositoryRoot(input.cwd ?? process.cwd());
    const sid = input.sessionId ?? input.session_id;
    const before = kind === 'preCompact' ? 'compaction' : kind === 'postToolUse' ? 'rehydration' : null;
    const result = handler(root, input);
    if (before === 'compaction' && result.status && result.status !== 'inactive') {
      record(root, sid, before, kind === 'preCompact' ? 'before' : 'after', result.status);
    } else if (kind === 'postToolUse' && result._rehydrationStatus) {
      record(root, sid, 'rehydration', 'after', result._rehydrationStatus);
    } else if (kind === 'preToolUse' && result._recordEnforcement) {
      record(root, sid, 'rehydration-gate', 'observation', 'enforced');
    } else if (kind === 'agentStop' && result.degraded) {
      record(root, sid, 'rehydration', 'after', 'degraded');
    } else if (kind === 'sessionStart' && result.additionalContext) {
      record(root, sid, 'rehydration', 'before', 'resume-armed');
    }
    streams.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    streams.stderr.write(`compaction-rehydration ${kind} failed: ${error.code ?? 'error'}: ${error.message}\n`);
    return kind === 'preToolUse' ? 2 : 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      process.exitCode = run(process.argv[2], JSON.parse(input));
    } catch (error) {
      process.stderr.write(`invalid hook input: ${error.message}\n`);
      process.exitCode = process.argv[2] === 'preToolUse' ? 2 : 1;
    }
  });
}
