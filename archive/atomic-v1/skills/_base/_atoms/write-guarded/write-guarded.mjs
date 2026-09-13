#!/usr/bin/env node
/**
 * The one entry point for a guarded, verified, create-only write.
 *
 * Exit 0 prints the written path and its byte count after the file has been
 * reread and compared. Any non-zero exit prints a stable failure category on
 * standard error and leaves no partial file behind.
 */

import {
  isDirectInvocation,
  parseFlags,
  readTextSource,
  runEntryPoint,
  writeGuarded,
} from '../../_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';

const USAGE = `Usage: write-guarded.mjs --destination <path> --allowed-root <path> \\
  (--content-file <path> | --stdin) [--probe]`;

export function run(argv) {
  const parsed = parseFlags(
    argv,
    {
      values: {
        '--destination': 'destination',
        '--allowed-root': 'allowedRoot',
        '--content-file': 'file',
      },
      flags: { '--stdin': 'stdin' },
    },
    USAGE,
  );
  const content = readTextSource(parsed, USAGE, 'content');
  const written = writeGuarded({
    destination: parsed.destination,
    allowedRoot: parsed.allowedRoot,
    content,
  });
  return `${JSON.stringify(written, null, 2)}\n`;
}

if (isDirectInvocation(import.meta.url)) {
  runEntryPoint(process.argv.slice(2), run, 'write-guarded');
}
