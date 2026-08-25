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
 * Parse a unified diff into files and hunks.
 *
 * Hunks are indexed per file from 0, in file order, so a mapping can address
 * one precisely. File-level addressing is deliberately not offered: an entry
 * naming a file would vouch for every change anywhere in it, including the
 * one-line adjacent fix the scope boundary exists to refuse.
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
      current = { file: fileHeader[2], hunks: [], binary: false };
      files.push(current);
      continue;
    }

    if (!current) continue;

    if (/^Binary files? /.test(line) || /^GIT binary patch$/.test(line)) {
      current.binary = true;
      continue;
    }

    const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkHeader) {
      current.hunks.push({
        index: current.hunks.length,
        oldStart: Number(hunkHeader[1]),
        oldLines: hunkHeader[2] === undefined ? 1 : Number(hunkHeader[2]),
        newStart: Number(hunkHeader[3]),
        newLines: hunkHeader[4] === undefined ? 1 : Number(hunkHeader[4]),
      });
    }
  }

  // A binary change carries no hunks but is still a change. Give it one
  // addressable unit so it cannot pass through unclaimed.
  for (const file of files) {
    if (file.binary && file.hunks.length === 0) {
      file.hunks.push({ index: 0, binary: true });
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

  // Every addressable unit of the diff.
  const hunks = new Map();
  for (const file of files) {
    for (const hunk of file.hunks ?? []) {
      hunks.set(hunkKey(file.file, hunk.index), { file: file.file, hunkIndex: hunk.index });
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
      undisclosed.push({ ...hunk, reason: 'no ledger entry claims this hunk' });
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
