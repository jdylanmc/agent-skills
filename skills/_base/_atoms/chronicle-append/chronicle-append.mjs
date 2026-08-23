#!/usr/bin/env node
/**
 * The one emit entry point for Chronicle consumers.
 *
 * Exit 0 means the event was appended. Any non-zero exit prints a stable
 * failure category on standard error; the caller reports it, marks evidence
 * incomplete, and continues delivery.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { emitEvent, ChronicleError } from '../../_molecules/chronicler/chronicler.mjs';

const FLAGS = new Map([
  ['--log', 'log_path'],
  ['--run', 'run_id'],
  ['--root-skill', 'root_skill'],
  ['--skill', 'skill'],
  ['--event', 'event'],
  ['--phase', 'phase'],
  ['--summary', 'summary'],
  ['--operation', 'operation'],
  ['--outcome', 'outcome'],
]);

const USAGE = `Usage: chronicle-append.mjs --log <path> --run <id> --root-skill <name> \\
  --event <name> --phase <before|after|observation> --summary <text> \\
  [--skill <name>] [--operation <id>] [--outcome <id>] [--evidence <ref>]...`;

export function parseArguments(argv) {
  const values = {};
  const evidence = [];

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      return { probe: true };
    }
    if (flag === '--evidence') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new ChronicleError('usage', `${flag} requires a value`);
      }
      evidence.push(value);
      index += 1;
      continue;
    }
    const field = FLAGS.get(flag);
    if (!field) {
      throw new ChronicleError('usage', `unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new ChronicleError('usage', `${flag} requires a value`);
    }
    if (field in values) {
      throw new ChronicleError('usage', `${flag} was given more than once`);
    }
    values[field] = value;
    index += 1;
  }

  for (const required of ['log_path', 'run_id', 'root_skill', 'event', 'phase', 'summary']) {
    if (!(required in values)) {
      throw new ChronicleError('usage', `missing required argument for ${required}`);
    }
  }

  return {
    probe: false,
    context: {
      run_id: values.run_id,
      root_skill: values.root_skill,
      log_path: values.log_path,
    },
    input: {
      skill: values.skill ?? values.root_skill,
      event: values.event,
      phase: values.phase,
      summary: values.summary,
      operation: values.operation,
      outcome: values.outcome,
      evidence: evidence.length > 0 ? evidence : undefined,
    },
  };
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
    emitEvent(parsed.input, parsed.context);
    streams.stdout.write(`${JSON.stringify({ recorded: true })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof ChronicleError ? error.code : 'append_failed';
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
