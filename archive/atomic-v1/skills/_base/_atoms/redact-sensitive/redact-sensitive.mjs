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
  redactTextWithConfiguredIdentifiers,
  runEntryPoint,
} from '../../_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';
import {
  loadIdentifierConfig,
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
  const result = redactTextWithConfiguredIdentifiers(source, configured.identifiers);
  return `${JSON.stringify(result, null, 2)}\n`;
}

if (isDirectInvocation(import.meta.url)) {
  runEntryPoint(process.argv.slice(2), run, 'redact-sensitive');
}
