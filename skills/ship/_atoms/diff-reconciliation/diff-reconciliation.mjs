/**
 * Deterministic diff reconciliation for the ship delivery cycle.
 *
 * The confirmed change ledger is a delivery run's authority boundary. This
 * module is what makes it a boundary instead of an intention: it checks that
 * every hunk of the actual diff is claimed by exactly one confirmed ledger
 * entry, and that the claiming entry is one the operator authorized.
 *
 * WHAT THIS VERIFIES, AND WHAT IT DOES NOT
 *
 * It verifies coverage and uniqueness — arithmetic over a claimed mapping.
 * That is deliberately the part an agent narrating its own diligence gets
 * wrong, and the part prose cannot enforce.
 *
 * It does NOT verify that a hunk *semantically belongs* to the entry that
 * claims it. Nothing here can read a diff and know whether entry `L2` really
 * describes it. Saying otherwise would make this module the same kind of
 * promise it exists to replace. The semantic judgement stays with the reviewer;
 * what this removes is the ability to leave a change undisclosed.
 */

const AUTHORIZED_CLASSIFICATIONS = new Set(['in-scope', 'enabling']);

/**
 * Metadata changes a content hunk cannot express, in report order.
 *
 * A rename, a copy, and a mode change survive a file whose contents are
 * untouched, so a diff carries them as headers and no `@@` line at all. They
 * are real changes to the repository and must be claimable.
 */
const STRUCTURAL_REASONS = ['rename', 'copy', 'mode-change'];
const REASON_ORDER = [...STRUCTURAL_REASONS, 'add', 'delete', 'binary'];

/** The address of the single file-metadata unit. Never a hunk index. */
export const METADATA_UNIT = 'metadata';

/**
 * Parse a unified diff into files and addressable units.
 *
 * Hunks are indexed per file from 0, in file order, so a mapping can address
 * one precisely. File-level addressing is deliberately not offered: an entry
 * naming a file would vouch for every change anywhere in it, including the
 * one-line adjacent fix the scope boundary exists to refuse.
 *
 * A file's metadata gets its own unit at the address `metadata`, separate from
 * its content hunks, because a rename claimed by the entry that edited the
 * file's body would be vouched for by a claim that says nothing about it.
 *
 * EVERY CHANGED FILE YIELDS AT LEAST ONE UNIT. A file header with no hunks and
 * no recognized metadata still produces a unit with the reason `unknown`. That
 * fails closed: an unparsed header becomes an unclaimable change that stops the
 * run, rather than a file that quietly reconciles because nothing addressed it.
 */
export function parseUnifiedDiff(text) {
  if (typeof text !== 'string') {
    throw new TypeError('parseUnifiedDiff expects the diff as a string');
  }

  const files = [];
  let current = null;

  for (const line of text.split('\n')) {
    const fileHeader = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (fileHeader) {
      current = { file: fileHeader[2], hunks: [], reasons: new Set() };
      files.push(current);
      continue;
    }

    if (!current) continue;

    if (/^Binary files? /.test(line) || /^GIT binary patch$/.test(line)) {
      current.reasons.add('binary');
      continue;
    }

    if (/^old mode \d+$/.test(line) || /^new mode \d+$/.test(line)) {
      current.reasons.add('mode-change');
      continue;
    }

    if (/^new file mode \d+$/.test(line)) {
      current.reasons.add('add');
      continue;
    }

    if (/^deleted file mode \d+$/.test(line)) {
      current.reasons.add('delete');
      continue;
    }

    const renameFrom = /^rename from (.+)$/.exec(line);
    if (renameFrom) {
      current.reasons.add('rename');
      current.previousFile = renameFrom[1];
      continue;
    }

    const copyFrom = /^copy from (.+)$/.exec(line);
    if (copyFrom) {
      current.reasons.add('copy');
      current.previousFile = copyFrom[1];
      continue;
    }

    if (/^rename to /.test(line) || /^copy to /.test(line)) {
      current.reasons.add(line.startsWith('rename to ') ? 'rename' : 'copy');
      continue;
    }

    const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkHeader) {
      current.hunks.push({
        kind: 'hunk',
        index: current.hunks.length,
        oldStart: Number(hunkHeader[1]),
        oldLines: hunkHeader[2] === undefined ? 1 : Number(hunkHeader[2]),
        newStart: Number(hunkHeader[3]),
        newLines: hunkHeader[4] === undefined ? 1 : Number(hunkHeader[4]),
      });
    }
  }

  for (const file of files) {
    const reasons = REASON_ORDER.filter((reason) => file.reasons.has(reason));
    delete file.reasons;

    const structural = reasons.some((reason) => STRUCTURAL_REASONS.includes(reason));
    if (file.hunks.length > 0 && !structural) continue;

    // A hunkless file always gets a unit, named or not; a file with hunks gets
    // an extra one only for the changes those hunks cannot express.
    const change = reasons.length > 0 ? reasons.join('+') : 'unknown';
    file.hunks.unshift({ kind: 'metadata', index: METADATA_UNIT, change });
    if (file.previousFile !== undefined) {
      file.hunks[0].previousFile = file.previousFile;
    }
  }

  return files;
}

function hunkKey(file, index) {
  return `${file}#${index}`;
}

/**
 * Reconcile a diff against a confirmed ledger using a claimed mapping.
 *
 * @param {object} input
 * @param {Array<{id: string, classification: string}>} input.ledger
 *   The confirmed change ledger.
 * @param {Array<{file: string, hunks: Array<object>}>|string} input.diff
 *   Parsed diff files, or raw unified diff text.
 * @param {Array<{file: string, hunkIndex: number, entryId: string}>} input.mapping
 *   Each claim that one hunk belongs to one ledger entry.
 * @returns {{verdict: string, undisclosed: Array, ambiguous: Array, unfulfilled: Array, phantom: Array, duplicateEntryIds: Array}}
 */
export function reconcile({ ledger, diff, mapping }) {
  if (!Array.isArray(ledger)) throw new TypeError('ledger must be an array');
  if (!Array.isArray(mapping)) throw new TypeError('mapping must be an array');

  const files = typeof diff === 'string' ? parseUnifiedDiff(diff) : diff;
  if (!Array.isArray(files)) throw new TypeError('diff must be parsed files or diff text');

  const entries = new Map();
  const duplicateEntryIds = [];
  for (const entry of ledger) {
    if (!entry || typeof entry.id !== 'string' || entry.id === '') {
      throw new TypeError('every ledger entry needs a stable string id');
    }
    if (entries.has(entry.id)) {
      // Two entries sharing an id make "exactly one entry" unverifiable, so
      // this is surfaced rather than silently deduplicated.
      duplicateEntryIds.push(entry.id);
    }
    entries.set(entry.id, entry);
  }

  // Every addressable unit of the diff: one per content hunk, plus one per
  // file-metadata change a content hunk cannot express.
  const hunks = new Map();
  for (const file of files) {
    // `parseUnifiedDiff` never yields a file with nothing to claim. A caller
    // supplying one has removed a change from the reconciliation without
    // saying so, which is the failure this module exists to catch.
    if ((file.hunks ?? []).length === 0) {
      throw new TypeError(`${file.file}: a changed file must carry at least one addressable unit`);
    }
    for (const hunk of file.hunks ?? []) {
      const unit = { file: file.file, hunkIndex: hunk.index };
      if (hunk.kind === 'metadata') {
        unit.change = hunk.change;
        if (hunk.previousFile !== undefined) unit.previousFile = hunk.previousFile;
      }
      hunks.set(hunkKey(file.file, hunk.index), unit);
    }
  }

  // Claims, deduplicated per (hunk, entry). The same entry claiming one hunk
  // twice is still exactly one entry, and is not ambiguity.
  const claims = new Map();
  const phantom = [];
  for (const claim of mapping) {
    const key = hunkKey(claim.file, claim.hunkIndex);
    if (!hunks.has(key)) {
      phantom.push({ ...claim, reason: 'no such hunk in the diff' });
      continue;
    }
    if (!claims.has(key)) claims.set(key, new Set());
    claims.get(key).add(claim.entryId);
  }

  const undisclosed = [];
  const ambiguous = [];

  for (const [key, hunk] of hunks) {
    const claimed = claims.get(key);

    if (!claimed || claimed.size === 0) {
      undisclosed.push({
        ...hunk,
        reason:
          hunk.change === undefined
            ? 'no ledger entry claims this hunk'
            : 'no ledger entry claims this file-metadata change',
      });
      continue;
    }

    const unknown = [...claimed].filter((id) => !entries.has(id));
    if (unknown.length > 0) {
      undisclosed.push({ ...hunk, reason: `claimed by unknown ledger entry: ${unknown.sort().join(', ')}` });
      continue;
    }

    // An `adjacent` or `out-of-scope` entry is a reported finding, not an
    // authorization. Letting one vouch for a hunk would turn the report of a
    // finding into permission to act on it — the exact failure the scope
    // boundary exists to refuse.
    const unauthorized = [...claimed].filter(
      (id) => !AUTHORIZED_CLASSIFICATIONS.has(entries.get(id).classification),
    );
    if (unauthorized.length > 0) {
      undisclosed.push({
        ...hunk,
        reason: `claimed only by an unauthorized classification: ${unauthorized
          .sort()
          .map((id) => `${id} (${entries.get(id).classification})`)
          .join(', ')}`,
      });
      continue;
    }

    if (claimed.size > 1) {
      ambiguous.push({ ...hunk, entryIds: [...claimed].sort() });
    }
  }

  const fulfilled = new Set();
  for (const claimed of claims.values()) {
    for (const id of claimed) fulfilled.add(id);
  }
  const unfulfilled = ledger
    .filter((entry) => AUTHORIZED_CLASSIFICATIONS.has(entry.classification) && !fulfilled.has(entry.id))
    .map((entry) => ({ entryId: entry.id, classification: entry.classification }));

  // Precedence is worst-first. An undisclosed change stops the run, so it may
  // never be masked by a less severe verdict computed alongside it.
  let verdict = 'reconciled';
  if (undisclosed.length > 0 || phantom.length > 0 || duplicateEntryIds.length > 0) {
    verdict = 'undisclosed-change';
  } else if (ambiguous.length > 0) {
    verdict = 'ambiguous-mapping';
  } else if (unfulfilled.length > 0) {
    verdict = 'unfulfilled-entry';
  }

  return { verdict, undisclosed, ambiguous, unfulfilled, phantom, duplicateEntryIds };
}

/** True only when the run may continue. Never softened by caller opinion. */
export function mayContinue(result) {
  return result.verdict === 'reconciled' || result.verdict === 'unfulfilled-entry';
}
