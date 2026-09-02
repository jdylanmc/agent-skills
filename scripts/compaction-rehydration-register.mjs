#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  registerRun,
  updateCheckpoint,
} from '../skills/_base/_atoms/rehydration-state/rehydration-state.mjs';

export function run(input, streams = process) {
  try {
    if (input.event === 'run' && (input.phase === 'before' || input.phase === 'after')) {
      registerRun(input);
    } else {
      updateCheckpoint(input);
    }
    streams.stdout.write('{"tracked":true}\n');
    return 0;
  } catch (error) {
    streams.stderr.write(`${error.code ?? 'tracking-error'}: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { text += chunk; });
  process.stdin.on('end', () => {
    try {
      process.exitCode = run(JSON.parse(text));
    } catch (error) {
      process.stderr.write(`invalid-input: ${error.message}\n`);
      process.exitCode = 1;
    }
  });
}
