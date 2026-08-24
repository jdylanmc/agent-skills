#!/usr/bin/env node
/**
 * The one entry point for the deterministic redaction floor.
 *
 * Exit 0 prints the redacted text and the categories that were replaced. Any
 * non-zero exit prints a stable failure category on standard error.
 */

import {
  HandoffError,
  isDirectInvocation,
  parseFlags,
  readTextSource,
  redactText,
  runEntryPoint,
} from '../../_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';
import {
  loadIdentifierConfig,
  redactConfiguredIdentifiers,
} from './redact-sensitive.config.mjs';

const USAGE = 'Usage: redact-sensitive.mjs (--file <path> | --stdin) [--config <path>] [--probe]';

export function run(argv) {
  const parsed = parseFlags(
    argv,
    {
      values: { '--file': 'file', '--config': 'config' },
      flags: { '--stdin': 'stdin' },
    },
    USAGE,
  );
  const source = readTextSource(parsed, USAGE, 'text');
  const floor = redactText(source);
  let configured;
  try {
    configured = loadIdentifierConfig({
      file: parsed.config,
      json: process.env.REDACT_SENSITIVE_CONFIG_JSON,
    });
  } catch (error) {
    if (error.code === 'malformed_config') {
      throw new HandoffError(error.code, error.message);
    }
    throw error;
  }
  const identifiers = redactConfiguredIdentifiers(floor.text, configured.identifiers);
  const counts = new Map();
  for (const entry of [...floor.redactions, ...identifiers.redactions]) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + entry.count);
  }
  const redactions = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => left.category.localeCompare(right.category));
  return `${JSON.stringify({ text: identifiers.text, redactions }, null, 2)}\n`;
}

if (isDirectInvocation(import.meta.url)) {
  runEntryPoint(process.argv.slice(2), run, 'redact-sensitive');
}
