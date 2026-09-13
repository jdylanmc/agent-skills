#!/usr/bin/env node
/**
 * The one entry point for checking artifact references and the section bodies
 * they exist to keep short.
 *
 * Exit 0 prints the normalized references and the bodies that were checked.
 * Any non-zero exit prints a stable failure category on standard error.
 */

import {
  checkArtifactReferences,
  isDirectInvocation,
  readPayload,
  runEntryPoint,
} from '../../_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';

const USAGE = 'Usage: artifact-reference.mjs (--payload <file> | --stdin) [--probe]';

export function run(argv) {
  const payload = readPayload(argv, USAGE);
  return `${JSON.stringify(checkArtifactReferences(payload), null, 2)}\n`;
}

if (isDirectInvocation(import.meta.url)) {
  runEntryPoint(process.argv.slice(2), run, 'artifact-reference');
}
