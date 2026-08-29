#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CandidatePersistenceError,
  persistCandidate,
} from '../../_atoms/candidate-persistence/candidate-persistence.mjs';

export function finalizeSynthesis(input, { persist = persistCandidate } = {}) {
  if (!input || typeof input !== 'object' || !input.outcome || typeof input.outcome !== 'object') {
    return { status: 'blocked', reasons: ['candidate-persistence-invalid-input'] };
  }
  if (input.outcome.status !== 'complete') {
    return input.outcome;
  }
  try {
    const persistence = persist(input);
    return { ...input.outcome, persistence };
  } catch (error) {
    if (!(error instanceof CandidatePersistenceError)) throw error;
    return {
      status: 'blocked',
      reasons: [`candidate-persistence-${error.code}`],
      detail: error.detail ?? {},
    };
  }
}

export const USAGE = 'Usage: bounded-synthesis.mjs --finalize <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 2 || argv[0] !== '--finalize' || !path.isAbsolute(argv[1])) {
    throw new CandidatePersistenceError('invalid-input', USAGE);
  }
  const input = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  streams.stdout.write(`${JSON.stringify(finalizeSynthesis(input), null, 2)}\n`);
  return 0;
}

function direct() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (direct()) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: { code: error.code ?? 'invalid-input', message: error.message } })}\n`);
    process.exitCode = 1;
  }
}
