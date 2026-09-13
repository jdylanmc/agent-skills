#!/usr/bin/env node
/**
 * The one entry point for resolving a bounded temporary destination.
 *
 * Exit 0 prints the resolved directory and proposed file path as JSON. Any
 * non-zero exit prints a stable failure category on standard error.
 */

import {
  DEFAULT_CHILD_DIRECTORY,
  HandoffError,
  isDirectInvocation,
  parseFlags,
  resolveHandoffPath,
  runEntryPoint,
} from '../../_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';

const USAGE = `Usage: temp-path-resolve.mjs (--slug <slug> | --slug-source <name>) \\
  [--child <name>] [--probe]`;

export function run(argv) {
  const parsed = parseFlags(
    argv,
    { values: { '--slug': 'slug', '--slug-source': 'slugSource', '--child': 'child' } },
    USAGE,
  );
  if (Boolean(parsed.slug) === Boolean(parsed.slugSource)) {
    throw new HandoffError('usage', `supply exactly one of --slug or --slug-source\n${USAGE}`);
  }
  const resolved = resolveHandoffPath({
    slug: parsed.slug,
    slugSource: parsed.slugSource,
    child: parsed.child ?? DEFAULT_CHILD_DIRECTORY,
  });
  return `${JSON.stringify(resolved, null, 2)}\n`;
}

if (isDirectInvocation(import.meta.url)) {
  runEntryPoint(process.argv.slice(2), run, 'temp-path-resolve');
}
