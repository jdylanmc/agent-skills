#!/usr/bin/env node
/**
 * The one entry point for rendering a bounded handoff document.
 *
 * Exit 0 prints the rendered Markdown. Nothing is written to disk here; the
 * guarded write owns persistence. Any non-zero exit prints a stable failure
 * category on standard error.
 */

import {
  isDirectInvocation,
  normalizePayload,
  readPayload,
  renderHandoff,
  runEntryPoint,
} from '../../_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';

const USAGE = 'Usage: handoff-render.mjs (--payload <file> | --stdin) [--probe]';

export function run(argv) {
  return renderHandoff(normalizePayload(readPayload(argv, USAGE))).document;
}

if (isDirectInvocation(import.meta.url)) {
  runEntryPoint(process.argv.slice(2), run, 'handoff-render');
}
