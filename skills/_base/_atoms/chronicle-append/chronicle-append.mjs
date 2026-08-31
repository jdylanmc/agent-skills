#!/usr/bin/env node
/**
 * The one emit entry point for Chronicle consumers.
 *
 * Chronicle recording is best effort. Run lifecycle registration is a separate
 * required control operation: non-timeout failures return non-zero, while an
 * actual registration timeout remains explicitly fail-open.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { emitEvent, ChronicleError } from '../../_molecules/chronicler/chronicler.mjs';

const FLAGS = new Map([
  ['--log', 'log_path'],
  ['--run', 'run_id'],
  ['--root-skill', 'root_skill'],
  ['--harness', 'harness'],
  ['--session', 'session_id'],
  ['--skill', 'skill'],
  ['--event', 'event'],
  ['--phase', 'phase'],
  ['--summary', 'summary'],
  ['--operation', 'operation'],
  ['--outcome', 'outcome'],
]);

const USAGE = `Usage: chronicle-append.mjs --log <path> --run <id> --root-skill <name> \\
  --event <name> --phase <before|after|observation> --summary <text> \\
  [--skill <name>] [--harness <id>] [--session <id>] \\
  [--operation <id>] [--outcome <id>] [--evidence <ref>]...`;

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
      harness: values.harness,
      session_id: values.session_id,
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

export function run(argv, streams = process, options = {}) {
  const spawn = options.spawnSync ?? spawnSync;
  const registrationTimeoutMs = options.registrationTimeoutMs ?? 3000;
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
    {
      const logDirectory = path.dirname(parsed.context.log_path);
      const lifecycleRegistration =
        parsed.input.event === 'run' &&
        (parsed.input.phase === 'before' || parsed.input.phase === 'after');
      if (path.basename(logDirectory) !== '.skill-log') {
        const reason = 'invalid-log-root: log is not directly below .skill-log';
        if (lifecycleRegistration) {
          streams.stdout.write(`${JSON.stringify({ recorded: true, rehydrationTracked: false })}\n`);
          streams.stderr.write(`rehydration_registration_failed: Chronicle event recorded; ${reason}\n`);
          return 2;
        }
        streams.stderr.write(`rehydration_tracking_failed: ${reason}\n`);
      } else {
        const repositoryRoot = path.dirname(logDirectory);
        const tracker = path.join(repositoryRoot, 'scripts', 'compaction-rehydration-register.mjs');
        const result = spawn(process.execPath, [tracker], {
          input: JSON.stringify({
            repositoryRoot,
            sessionId: parsed.context.session_id,
            runId: parsed.context.run_id,
            rootSkill: parsed.context.root_skill,
            skill: parsed.input.skill,
            logPath: parsed.context.log_path,
            event: parsed.input.event,
            phase: parsed.input.phase,
            operation: parsed.input.operation,
            outcome: parsed.input.outcome,
          }),
          encoding: 'utf8',
          timeout: registrationTimeoutMs,
        });
        if (result.status !== 0) {
          const reason = result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`;
          if (result.error?.code === 'ETIMEDOUT') {
            if (lifecycleRegistration) {
              streams.stderr.write(`rehydration_registration_timeout: ${reason}; continuing fail-open\n`);
              streams.stdout.write(`${JSON.stringify({
                recorded: true,
                rehydrationTracked: false,
                registrationTimeout: true,
              })}\n`);
              return 0;
            }
            streams.stderr.write(`rehydration_tracking_timeout: ${reason}; continuing fail-open\n`);
          } else if (lifecycleRegistration) {
            streams.stdout.write(`${JSON.stringify({ recorded: true, rehydrationTracked: false })}\n`);
            streams.stderr.write(
              `rehydration_registration_failed: Chronicle event recorded; ${reason}\n`,
            );
            return 2;
          } else {
            streams.stderr.write(`rehydration_tracking_failed: ${reason}\n`);
          }
        }
      }
    }
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
