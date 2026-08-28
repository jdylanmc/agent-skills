#!/usr/bin/env node

/**
 * Doctrine selection.
 *
 * Nothing in the roast pipeline previously decided *which* doctrine governs
 * what is being roasted. `doctrine-evaluate` verifies the manifest and loads a
 * selection; it does not make one. This module makes the selection, and only
 * the selection.
 *
 * It reads `doctrine/manifest.md` for one reason: to learn the canonical
 * identifiers, so a selection can be rejected before anything downstream tries
 * to load it. It never resolves a doctrine path, never reads a doctrine file,
 * and never verifies a digest. Those belong to `doctrine-evaluate`, which owns
 * the trust boundary.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class DoctrineSelectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DoctrineSelectionError';
    this.code = code;
  }
}

/**
 * The governing map. A key is a classified artifact type; `primary` doctrine is
 * always selected for that type, and a `conditional` entry is selected only
 * when the caller reports its trigger as observed in the packet.
 *
 * `AGENTS.md` requires overlap between doctrine files to be resolved
 * explicitly. That is why `conditional` exists at all: without it the honest
 * options are to select every plausible doctrine, which is the indiscriminate
 * loading the rule forbids, or to drop a genuinely relevant one.
 */
export const GOVERNANCE = {
  agent: {
    primary: [
      { id: 'code', reason: 'explicit contracts, boundaries, errors, and validation' },
      {
        id: 'pragmatic',
        reason: 'ownership, coupling, feedback, reversibility, automation, and stopping points',
      },
    ],
    conditional: [
      {
        id: 'domain',
        trigger: 'domain-model',
        reason: 'domain vocabulary, invariants, lifecycle, or ownership are central',
      },
      {
        id: 'data',
        trigger: 'data-contract',
        reason: 'state, persistence, retries, schemas, lineage, or distributed behavior are central',
      },
    ],
  },
  prompt: {
    primary: [
      {
        id: 'pragmatic',
        reason: 'explicit assumptions, feedback, scope, and stopping points',
      },
      { id: 'code', reason: 'contracts, error behavior, verification, and clarity' },
    ],
    conditional: [
      {
        id: 'domain',
        trigger: 'domain-model',
        reason: 'exact domain language or invariants are central',
      },
      {
        id: 'data',
        trigger: 'data-contract',
        reason: 'the requested output depends on lineage, schemas, consistency, or temporal data',
      },
    ],
  },
  skill: {
    primary: [
      {
        id: 'pragmatic',
        reason: 'scope, ownership, feedback, reversibility, and automation',
      },
      {
        id: 'code',
        reason: 'contracts, clarity, bounded complexity, errors, and validation',
      },
    ],
    conditional: [
      {
        id: 'domain',
        trigger: 'domain-model',
        reason: 'domain vocabulary, lifecycle, invariants, or ownership boundaries drive behavior',
      },
      {
        id: 'data',
        trigger: 'data-contract',
        reason: 'persistence, retries, replay, ordering, schemas, consistency, or lineage drive behavior',
      },
      {
        id: 'testing',
        trigger: 'validation',
        reason: 'the package declares a regression suite or validation gate under review',
      },
    ],
  },
  spec: {
    primary: [
      {
        id: 'pragmatic',
        reason: 'explicit assumptions, scope boundaries, reversibility, and stopping points',
      },
      {
        id: 'code',
        reason: 'explicit contracts, unambiguous criteria, error behavior, and validation',
      },
    ],
    conditional: [
      {
        id: 'domain',
        trigger: 'domain-model',
        reason: 'domain vocabulary, invariants, lifecycle, or ownership boundaries carry the intention',
      },
      {
        id: 'data',
        trigger: 'data-contract',
        reason: 'persistence, lineage, schemas, consistency, retention, or temporal behavior are central to the stated outcomes',
      },
      {
        id: 'testing',
        trigger: 'validation',
        reason: 'whether an acceptance criterion is observable is a verification question',
      },
    ],
  },
  code: {
    primary: [
      { id: 'code', reason: 'contracts, clarity, bounded complexity, errors, and validation' },
      {
        id: 'pragmatic',
        reason: 'coupling, reversibility, feedback, and stopping points in the change set',
      },
    ],
    conditional: [
      {
        id: 'testing',
        trigger: 'validation',
        reason: 'tests or a validation gate are inside the reviewed change set',
      },
      {
        id: 'data',
        trigger: 'data-contract',
        reason: 'persistence, schemas, migrations, ordering, or lineage are inside the change set',
      },
      {
        id: 'domain',
        trigger: 'domain-model',
        reason: 'domain vocabulary, invariants, or lifecycle are inside the change set',
      },
    ],
  },
};

export const ARTIFACT_TYPES = Object.keys(GOVERNANCE);

const MANIFEST_ID = /^\s*-\s*id:\s*([a-z0-9][a-z0-9-]*)\s*$/;

function assertSafePath(candidate, label) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new DoctrineSelectionError('usage', `${label} must be a non-empty string`);
  }
  if (!path.isAbsolute(candidate)) {
    throw new DoctrineSelectionError('unsafe_path', `${label} must be an absolute path`);
  }
  if (candidate.split(path.sep).includes('..')) {
    throw new DoctrineSelectionError('unsafe_path', `${label} must not traverse upward`);
  }
  let stats;
  try {
    stats = fs.lstatSync(candidate);
  } catch {
    throw new DoctrineSelectionError('unsafe_path', `${label} does not exist: ${candidate}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new DoctrineSelectionError('unsafe_path', `${label} must be a regular file`);
  }
  return candidate;
}

/**
 * Canonical identifiers only. This deliberately reads nothing but the id lines
 * of the manifest frontmatter: knowing which identifiers exist is selection
 * work, and loading what they point at is not.
 */
export function manifestIds(manifestPath) {
  assertSafePath(manifestPath, 'manifest');
  const content = fs.readFileSync(manifestPath, 'utf8').replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) {
    throw new DoctrineSelectionError('invalid_manifest', 'manifest has no frontmatter');
  }
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new DoctrineSelectionError('invalid_manifest', 'manifest frontmatter is unterminated');
  }
  const ids = [];
  for (const line of content.slice(4, end).split('\n')) {
    const match = MANIFEST_ID.exec(line);
    if (match) {
      if (ids.includes(match[1])) {
        throw new DoctrineSelectionError(
          'invalid_manifest',
          `manifest repeats the identifier ${match[1]}`,
        );
      }
      ids.push(match[1]);
    }
  }
  if (!ids.length) {
    throw new DoctrineSelectionError('invalid_manifest', 'manifest declares no doctrine identifier');
  }
  return ids;
}

function refusal(category, detail, extra = {}) {
  return { status: 'Refused', category, detail, ...extra };
}

function normalizeTriggers(triggers) {
  if (triggers === undefined || triggers === null) {
    return [];
  }
  if (!Array.isArray(triggers) || triggers.some((entry) => typeof entry !== 'string')) {
    throw new DoctrineSelectionError('usage', 'triggers must be an array of strings');
  }
  return [...new Set(triggers.map((entry) => entry.trim()).filter(Boolean))];
}

/**
 * Selects the doctrine that governs one classified artifact type.
 *
 * @param {object} input
 * @param {string} [input.artifactType] The classified type. Required unless
 *   `explicitSelection` is supplied.
 * @param {string[]} [input.explicitSelection] A caller-supplied selection that
 *   overrides inference entirely. The reviewer sometimes knows better than the
 *   classifier, and this is how they say so.
 * @param {string[]} [input.triggers] Trigger names the caller observed in the
 *   packet. Only a conditional doctrine whose trigger appears here is selected.
 * @param {string[]} input.availableIds Canonical identifiers from the manifest.
 */
export function selectDoctrine(input = {}) {
  const available = input.availableIds;
  if (!Array.isArray(available) || !available.length) {
    throw new DoctrineSelectionError('usage', 'availableIds must be a non-empty string array');
  }
  const triggers = normalizeTriggers(input.triggers);

  if (input.explicitSelection !== undefined && input.explicitSelection !== null) {
    if (!Array.isArray(input.explicitSelection) || !input.explicitSelection.length) {
      throw new DoctrineSelectionError(
        'usage',
        'explicitSelection must be a non-empty string array when supplied',
      );
    }
    const requested = [...new Set(input.explicitSelection.map((entry) => String(entry).trim()))];
    const unknown = requested.filter((id) => !available.includes(id));
    if (unknown.length) {
      return refusal(
        'Unknown doctrine identifier',
        `the manifest declares no doctrine named ${unknown.join(', ')}`,
        { requested, availableIds: available },
      );
    }
    return {
      status: 'Selected',
      source: 'caller-override',
      artifactType: input.artifactType ?? null,
      selection: requested.map((id) => ({
        id,
        role: 'explicit',
        reason: 'selected explicitly by the caller, which overrides inference',
      })),
      reasoning: [
        'A caller-supplied selection overrides inference. The classified artifact type did not choose this doctrine.',
        input.artifactType
          ? `The inferred selection for ${input.artifactType} was not used.`
          : 'No artifact type was supplied, so nothing was inferred.',
      ],
      selectors: requested.map((id) => `--select ${id}`),
    };
  }

  const artifactType = input.artifactType;
  if (typeof artifactType !== 'string' || artifactType.trim() === '') {
    return refusal(
      'Ambiguous artifact type',
      'no artifact type was supplied and no explicit selection was given, so nothing governs this packet',
      { availableIds: available },
    );
  }
  const governance = GOVERNANCE[artifactType];
  if (!governance) {
    return refusal(
      'No governing doctrine',
      `no doctrine governs the artifact type ${artifactType}; declared types are ${ARTIFACT_TYPES.join(', ')}`,
      { artifactType, availableIds: available },
    );
  }

  const missingPrimary = governance.primary.filter((entry) => !available.includes(entry.id));
  if (missingPrimary.length) {
    return refusal(
      'Unknown doctrine identifier',
      `the manifest declares no doctrine named ${missingPrimary.map((entry) => entry.id).join(', ')}, which ${artifactType} requires`,
      { artifactType, availableIds: available },
    );
  }

  const selection = governance.primary.map((entry) => ({
    id: entry.id,
    role: 'primary',
    reason: entry.reason,
  }));
  const reasoning = [
    `Artifact type ${artifactType} was classified, so its declared primary doctrine applies.`,
  ];

  for (const entry of governance.conditional) {
    if (!triggers.includes(entry.trigger)) {
      reasoning.push(
        `Skipped ${entry.id}: its trigger ${entry.trigger} was not observed, and selecting it anyway would load doctrine merely because it is available.`,
      );
      continue;
    }
    if (!available.includes(entry.id)) {
      reasoning.push(
        `Skipped ${entry.id}: its trigger ${entry.trigger} was observed but the manifest declares no such doctrine.`,
      );
      continue;
    }
    selection.push({ id: entry.id, role: 'conditional', trigger: entry.trigger, reason: entry.reason });
    reasoning.push(`Selected ${entry.id}: its trigger ${entry.trigger} was observed in the packet.`);
  }

  const unusedTriggers = triggers.filter(
    (trigger) => !governance.conditional.some((entry) => entry.trigger === trigger),
  );
  for (const trigger of unusedTriggers) {
    reasoning.push(
      `Ignored trigger ${trigger}: no doctrine is conditional on it for artifact type ${artifactType}.`,
    );
  }

  return {
    status: 'Selected',
    source: 'inferred',
    artifactType,
    selection,
    reasoning,
    selectors: selection.map((entry) => `--select ${entry.id}`),
  };
}

function readOption(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name) {
      values.push(argv[index + 1] ?? '');
    }
  }
  return values;
}

/**
 * Argument handling deliberately mirrors `doctrine-evaluate`'s
 * `parseArguments`. The two atoms sit next to each other in one pipeline and a
 * caller uses them together, so a flag that is rejected by one and silently
 * discarded by the other is a trap.
 *
 * The consequence of discarding is specific and bad here: a typo'd override
 * such as `--slect testing` would be dropped, the atom would quietly fall back
 * to inference, and it would still report `"source": "inferred"` as though that
 * had been intended. A caller could then not trace a surprising roast to the
 * doctrine that produced it, which is the one thing this atom exists to make
 * possible.
 *
 * The only intentional divergence is which flags repeat. `doctrine-evaluate`
 * repeats `--select` alone; here `--select` and `--trigger` both repeat,
 * because a caller genuinely names several doctrine identifiers and several
 * observed triggers. `--manifest` and `--type` are single-valued, as they are
 * there.
 */
const VALUE_FLAGS = ['--manifest', '--type', '--select', '--trigger'];
const REPEATABLE_FLAGS = ['--select', '--trigger'];

export const USAGE = `Usage: doctrine-select.mjs --manifest <path> \\
  [--type <agent|prompt|skill|spec|code>] [--select <id>]... [--trigger <name>]...

  --manifest  Absolute path to doctrine/manifest.md. Required. Read for
              canonical identifiers only; no doctrine file is opened.
  --type      The classified artifact type. Supply this, --select, or both;
              supplying neither is a refusal, not a default.
  --select    An explicit doctrine identifier. Repeatable. Overrides inference.
  --trigger   A trigger observed in the packet. Repeatable. Enables a
              conditional doctrine.
  --probe     Report availability and exit.`;

function failUsage(message) {
  throw new DoctrineSelectionError('usage', message);
}

export function parseArguments(argv) {
  const values = {};
  const selectors = [];
  const triggers = [];

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      return { probe: true };
    }
    if (!VALUE_FLAGS.includes(flag)) {
      failUsage(`unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      failUsage(`${flag} requires a value`);
    }
    if (flag === '--select') {
      selectors.push(value);
    } else if (flag === '--trigger') {
      triggers.push(value);
    } else {
      const field = flag.slice(2);
      if (field in values) {
        failUsage(`${flag} was given more than once`);
      }
      values[field] = value;
    }
    index += 1;
  }

  if (!('manifest' in values)) {
    failUsage('missing required argument for --manifest');
  }

  return { probe: false, ...values, selectors, triggers };
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
    streams.stdout.write('doctrine-select: available\n');
    return 0;
  }

  let result;
  try {
    result = selectDoctrine({
      artifactType: parsed.type,
      explicitSelection: parsed.selectors.length ? parsed.selectors : undefined,
      triggers: parsed.triggers,
      availableIds: manifestIds(parsed.manifest),
    });
  } catch (error) {
    const code = error instanceof DoctrineSelectionError ? error.code : 'usage';
    streams.stderr.write(`${code}: ${error.message}\n`);
    return 1;
  }

  streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'Selected' ? 0 : 2;
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
