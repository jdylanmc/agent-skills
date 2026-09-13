/**
 * Deterministic diff and ledger reconciliation for prompt optimization.
 *
 * The failure this file exists to prevent is an undisclosed edit: an improved
 * prompt that quietly weakens a constraint, with no ledger entry for anyone to
 * reject. Asking the optimizer whether it disclosed everything is asking the
 * author of the change to grade its own disclosure, so the comparison is done
 * here instead, in code that cannot be talked out of a finding.
 *
 * This module decides only whether every textual change is *accounted for*. It
 * has no opinion on whether a change is good, permitted, or safe.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_INPUT_BYTES = 262144;

const FAILURES = {
  usage: 'usage',
  malformedPayload: 'malformed_payload',
  malformedLedger: 'malformed_ledger',
};

/** A ledger entry uses these sentinels rather than an empty string. */
const ABSENT = 'absent';
const REMOVED = 'removed';

export class OptimizationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function assertText(value, label) {
  if (typeof value !== 'string') {
    throw new OptimizationError(FAILURES.malformedPayload, `${label} must be a string`);
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_INPUT_BYTES) {
    throw new OptimizationError(
      FAILURES.malformedPayload,
      `${label} exceeds ${MAX_INPUT_BYTES} UTF-8 bytes`,
    );
  }
}

function splitLines(value) {
  return value.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Whitespace-only differences are real differences but not material ones, so
 * they are counted rather than itemised. Collapsing runs of whitespace is
 * enough: a line that differs only in indentation or spacing normalises to the
 * same key, while a line whose words changed does not.
 */
function cosmeticKey(line) {
  return line.replace(/\s+/g, ' ').trim();
}

/**
 * Longest common subsequence over lines.
 *
 * Quadratic, which is fine: this compares two prompts, and the input bound
 * above caps the work long before the algorithm matters.
 */
function lcsTable(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/**
 * Line-level diff returning contiguous change hunks.
 *
 * Each hunk carries the removed and added lines together, because a
 * replacement is one change to a reader and one ledger entry to an author,
 * even though it is a deletion and an insertion to a diff algorithm.
 */
export function diffPrompts(original, improved) {
  assertText(original, 'original');
  assertText(improved, 'improved');

  const a = splitLines(original);
  const b = splitLines(improved);
  const table = lcsTable(a, b);

  const operations = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      operations.push({ type: 'context', line: a[i], originalLine: i + 1, improvedLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      operations.push({ type: 'remove', line: a[i], originalLine: i + 1 });
      i += 1;
    } else {
      operations.push({ type: 'add', line: b[j], improvedLine: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    operations.push({ type: 'remove', line: a[i], originalLine: i + 1 });
    i += 1;
  }
  while (j < b.length) {
    operations.push({ type: 'add', line: b[j], improvedLine: j + 1 });
    j += 1;
  }

  const hunks = [];
  let current = null;
  for (const operation of operations) {
    if (operation.type === 'context') {
      current = null;
      continue;
    }
    if (!current) {
      current = {
        id: `H${hunks.length + 1}`,
        originalLine: operation.originalLine ?? null,
        improvedLine: operation.improvedLine ?? null,
        removed: [],
        added: [],
      };
      hunks.push(current);
    }
    if (operation.type === 'remove') {
      current.removed.push(operation.line);
      current.originalLine = current.originalLine ?? operation.originalLine;
    } else {
      current.added.push(operation.line);
      current.improvedLine = current.improvedLine ?? operation.improvedLine;
    }
  }

  for (const hunk of hunks) {
    const removedKeys = hunk.removed.map(cosmeticKey).filter(Boolean);
    const addedKeys = hunk.added.map(cosmeticKey).filter(Boolean);
    hunk.cosmetic = removedKeys.length === addedKeys.length
      && removedKeys.every((key, index) => key === addedKeys[index]);
  }

  return { operations, hunks };
}

/** Render a unified-style diff so a person can read what changed. */
export function renderDiff(diff) {
  const lines = [];
  for (const hunk of diff.hunks) {
    lines.push(`@@ ${hunk.id} original:${hunk.originalLine ?? '-'} improved:${hunk.improvedLine ?? '-'} @@`);
    for (const line of hunk.removed) {
      lines.push(`-${line}`);
    }
    for (const line of hunk.added) {
      lines.push(`+${line}`);
    }
  }
  return lines.join('\n');
}

function normalizeEntry(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new OptimizationError(FAILURES.malformedLedger, `ledger entry ${index} must be an object`);
  }
  for (const field of ['id', 'before', 'after', 'classification']) {
    if (typeof entry[field] !== 'string' || entry[field].length === 0) {
      throw new OptimizationError(
        FAILURES.malformedLedger,
        `ledger entry ${index} is missing ${field}`,
      );
    }
  }
  return entry;
}

/**
 * Reconcile the ledger against the actual differences.
 *
 * Coverage is tracked per line, not per hunk. A deletion and a rewording that
 * land next to each other form one hunk, and hunk-level coverage would let the
 * disclosed rewording vouch for the undisclosed deletion beside it — which is
 * precisely how a constraint disappears while the ledger looks complete.
 *
 * Two directions matter and they fail differently. An undisclosed change is a
 * real edit nobody was told about, which is how an invariant gets weakened
 * unnoticed. A fabricated entry is a claimed edit that never happened, which
 * makes the ledger evidence of nothing.
 */
export function reconcile(diff, ledger) {
  if (!Array.isArray(ledger)) {
    throw new OptimizationError(FAILURES.malformedLedger, 'ledger must be an array');
  }
  const entries = ledger.map(normalizeEntry);

  const material = diff.hunks.filter((hunk) => !hunk.cosmetic);
  const cosmeticCount = diff.hunks.length - material.length;

  const used = new Set();
  const undisclosed = [];

  const cover = (line, side) => {
    const key = cosmeticKey(line);
    if (!key) {
      return true;
    }
    const match = entries.find((entry) => {
      const claim = side === 'removed' ? entry.before : entry.after;
      const sentinel = side === 'removed' ? ABSENT : REMOVED;
      if (claim === sentinel) {
        return false;
      }
      const claimKey = cosmeticKey(claim);
      return claimKey.length > 0 && key.includes(claimKey);
    });
    if (!match) {
      return false;
    }
    used.add(match.id);
    return true;
  };

  for (const hunk of material) {
    const removed = hunk.removed.filter((line) => !cover(line, 'removed'));
    const added = hunk.added.filter((line) => !cover(line, 'added'));
    if (removed.length || added.length) {
      undisclosed.push({ hunk: hunk.id, removed, added });
    }
  }

  const fabricated = entries
    .filter((entry) => !used.has(entry.id))
    .map((entry) => ({ id: entry.id, before: entry.before, after: entry.after }));

  const status = undisclosed.length === 0 && fabricated.length === 0
    ? 'reconciled'
    : 'ledger-incomplete';

  return {
    status,
    materialChanges: material.length,
    cosmeticChanges: cosmeticCount,
    undisclosed,
    fabricated,
  };
}

/**
 * Every entry claiming review grounding must name the finding it came from,
 * and that finding must exist. Without this an edit made on taste can be
 * labelled review-grounded and nothing contradicts it.
 */
export function verifyGrounding(ledger, reviewFindingIds) {
  if (!Array.isArray(ledger)) {
    throw new OptimizationError(FAILURES.malformedLedger, 'ledger must be an array');
  }
  const known = new Set(reviewFindingIds ?? []);
  const unmapped = [];
  const unknown = [];

  for (const entry of ledger.map(normalizeEntry)) {
    if (entry.grounding !== 'review-finding') {
      continue;
    }
    const id = entry['review-finding-id'];
    if (typeof id !== 'string' || id.length === 0) {
      unmapped.push(entry.id);
      continue;
    }
    if (!known.has(id)) {
      unknown.push({ entry: entry.id, reviewFindingId: id });
    }
  }

  return {
    status: unmapped.length === 0 && unknown.length === 0 ? 'grounded' : 'grounding-unverified',
    unmapped,
    unknown,
  };
}

/**
 * The improved prompt must not reproduce a sensitive literal that the
 * redaction floor found in the original. Checking only values the caller
 * happened to name would miss exactly the ones nobody noticed.
 */
export function verifyRedaction(improved, sensitiveLiterals) {
  assertText(improved, 'improved');
  if (!Array.isArray(sensitiveLiterals)) {
    throw new OptimizationError(FAILURES.malformedPayload, 'sensitiveLiterals must be an array');
  }

  const leaked = sensitiveLiterals
    .filter((literal) => typeof literal === 'string' && literal.length > 0)
    .filter((literal) => improved.includes(literal));

  return { status: leaked.length === 0 ? 'clean' : 'sensitive-leak', leaked };
}

function parseArguments(argv) {
  const args = { };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--probe') {
      args.probe = true;
      continue;
    }
    if (!token.startsWith('--')) {
      throw new OptimizationError(FAILURES.usage, `unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new OptimizationError(FAILURES.usage, `${token} requires a value`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

async function main(argv) {
  const args = parseArguments(argv);

  if (args.probe) {
    process.stdout.write('prompt-optimization: available\n');
    return;
  }

  for (const required of ['original', 'improved', 'ledger']) {
    if (!args[required]) {
      throw new OptimizationError(FAILURES.usage, `--${required} is required`);
    }
  }

  const original = fs.readFileSync(args.original, 'utf8');
  const improved = fs.readFileSync(args.improved, 'utf8');

  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(args.ledger, 'utf8'));
  } catch (error) {
    throw new OptimizationError(FAILURES.malformedLedger, `ledger is not valid JSON: ${error.message}`);
  }

  const diff = diffPrompts(original, improved);
  const reconciliation = reconcile(diff, ledger);

  process.stdout.write(`${JSON.stringify({
    diff: renderDiff(diff),
    hunks: diff.hunks.length,
    reconciliation,
  }, null, 2)}\n`);

  if (reconciliation.status !== 'reconciled') {
    process.exitCode = 1;
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
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      error: {
        code: error.code ?? FAILURES.usage,
        reason: null,
        message: error.message,
      },
    })}\n`);
    process.exitCode = 1;
  });
}

export { ABSENT, REMOVED, FAILURES, MAX_INPUT_BYTES, cosmeticKey, main };
