#!/usr/bin/env node
/**
 * The one entry point for the deterministic redaction floor.
 *
 * Exit 0 prints the redacted text and the categories that were replaced. Any
 * non-zero exit prints a stable failure category on standard error.
 */

import {
  isDirectInvocation,
  parseFlags,
  readTextSource,
  redactText,
  runEntryPoint,
} from '../../_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';

const USAGE = 'Usage: redact-sensitive.mjs (--file <path> | --stdin) [--probe]';

export function run(argv) {
  const parsed = parseFlags(
    argv,
    { values: { '--file': 'file' }, flags: { '--stdin': 'stdin' } },
    USAGE,
  );
  const source = readTextSource(parsed, USAGE, 'text');
  return `${JSON.stringify(redactText(source), null, 2)}\n`;
}

if (isDirectInvocation(import.meta.url)) {
  runEntryPoint(process.argv.slice(2), run, 'redact-sensitive');
}
