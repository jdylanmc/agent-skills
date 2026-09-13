#!/usr/bin/env node
/**
 * Read-only replay of one explicitly selected Skill Run Log.
 *
 * Exit 0 prints the reconstructed Skill Run State as JSON, including any
 * defects. Replay never repairs, reorders, or invents evidence. A non-zero
 * exit means the selected log could not be read at all.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { replayLog, ChronicleError } from '../../_molecules/chronicler/chronicler.mjs';

const USAGE = 'Usage: chronicle-replay.mjs <selected-log-path> [--log-id <opaque-id>]';

export function parseArguments(argv) {
  if (argv.includes('--probe')) {
    return { probe: true };
  }

  let logPath;
  let logId;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--log-id') {
      logId = argv[index + 1];
      if (logId === undefined) {
        throw new ChronicleError('usage', '--log-id requires a value');
      }
      index += 1;
      continue;
    }
    if (argument.startsWith('--')) {
      throw new ChronicleError('usage', `unknown argument: ${argument}`);
    }
    if (logPath !== undefined) {
      throw new ChronicleError('usage', 'exactly one log path is accepted');
    }
    logPath = argument;
  }

  if (logPath === undefined) {
    throw new ChronicleError('usage', 'a selected log path is required');
  }
  return { probe: false, logPath, logId };
}

export function run(argv, streams = process) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    streams.stderr.write(`${error.code ?? 'usage'}: ${error.message}\n${USAGE}\n`);
    return 1;
  }

  if (parsed.probe) {
    streams.stdout.write('chronicle: available\n');
    return 0;
  }

  try {
    const state = replayLog(parsed.logPath, { logId: parsed.logId });
    streams.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof ChronicleError ? error.code : 'log_unavailable';
    streams.stderr.write(`${code}: ${error.message}\n`);
    return 1;
  }
}

function isDirectInvocation() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  process.exitCode = run(process.argv.slice(2));
}
