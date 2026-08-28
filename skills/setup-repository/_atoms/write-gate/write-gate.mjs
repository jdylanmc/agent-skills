/**
 * The preview -> confirmation -> safety -> stage -> commit -> readback cycle.
 *
 * Preview and write are one binding, not two steps that can drift. The
 * preview identity is derived canonically from the repository root, every
 * target's relative path, every new content hash, and the exact prior state
 * each target held (its existingSha256, or the sentinel `<absent>` when the
 * target did not exist). The gate never trusts an absolutePath in the
 * serialized preview payload: apply-time derives the absolute path fresh
 * from the validated repository root and the entry's relative path, so a
 * caller who deserializes a valid preview and mutates absolutePath alone
 * cannot redirect the write.
 *
 * The write itself is a two-phase commit. Every target is validated,
 * snapshotted, then written through a safe open. Two safe-open primitives
 * are supported, chosen once per process at import time and injectable by
 * tests:
 *
 * - `atomicNoFollow` (POSIX): a single atomic `openSync` with
 *   `O_NOFOLLOW`. A symbolic link at the final component fails at the open
 *   call itself, so a swap between inspection and open cannot redirect the
 *   write.
 * - `checkOpenVerify` (Windows and any platform that can lstat/open/fstat):
 *   `lstatSync` the target and refuse a symlink or reparse point, `openSync`,
 *   then `fstatSync` the descriptor and confirm it identifies the same
 *   entry the pre-open `lstat` saw. Not atomic — a swap inside the tiny
 *   window between the two calls would be caught by the post-open verify
 *   rather than atomically prevented. See the residual note in
 *   `write-gate.md`.
 *
 * Ancestor identities (dev, ino) are captured for the repository root and
 * every directory between the root and each target's parent, and re-verified
 * immediately before the truncating/creating open AND before readback.
 * Rollback runs in reverse order, verifies each restoration, and reports
 * accurately when it cannot un-do a mutation.
 *
 * A confirmation is an object carrying `{ previewId, grant }`. The grant
 * literal alone is not sufficient — it must be paired with the exact
 * previewId of the preview being applied. The executable cannot and does
 * not verify that a human, rather than an agent, produced the confirmation.
 * That obligation lives with the invoking skill.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT_ACCEPTED = 0;
export const EXIT_USAGE = 1;
export const EXIT_FINDINGS = 2;
/** Compatibility alias — legacy tests referenced EXIT_REFUSED as the usage code. */
export const EXIT_REFUSED = 1;

/** The literal grant a confirmation must carry, alongside a matching previewId. */
export const CONFIRMATION_GRANT = 'confirm-write';

export const WRITE_STATUSES = Object.freeze([
  'configured',
  'cancelled',
  'unsafe-target',
  'stale-preview',
  'blocked',
]);

/** Ceiling for prior-file snapshots. A prior file larger than this is refused. */
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export class WriteGateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WriteGateError';
    this.code = code;
  }
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

/**
 * Detection-only path normalization for duplicate detection. Unicode NFC
 * normalization is applied unconditionally so a `café.md` in NFC and the
 * same visual name in NFD compare equal — they refer to the same file on
 * macOS. Case-folding is additionally applied when the current platform is
 * case-insensitive at the filesystem layer (macOS, Windows), so `Foo.md`
 * and `foo.md` also compare equal on those platforms and pass as
 * duplicates. The value returned is used ONLY for the duplicate-detection
 * key: it is not the path the write is performed at. `buildPreview` and
 * `validatePreviewShape` still record and write the caller's original
 * `relativePath` unchanged; a serialized preview round-trips with the
 * bytes the caller supplied.
 */
function normalizePathForDuplicateDetection(relativePath) {
  const nfc = String(relativePath).normalize('NFC');
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return nfc.toLowerCase();
  }
  return nfc;
}

function realRootOf(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || !repositoryRoot) {
    throw new WriteGateError('usage', 'repositoryRoot is required');
  }
  return fs.realpathSync(repositoryRoot);
}

/**
 * Platform capability descriptor for the safe-open primitives. Two
 * independently sufficient primitives are recognized:
 *
 * - `atomicNoFollow` — POSIX only. A single atomic `openSync(...,
 *   O_NOFOLLOW)` refuses a symlink at the final component atomically.
 * - `checkOpenVerify` — universally available. `lstatSync` -> refuse
 *   symlink or reparse point -> `openSync` -> `fstatSync` the descriptor
 *   and verify (dev, ino) match. Not atomic; a swap inside the window
 *   between the two syscalls is caught after the fact by the post-open
 *   verify rather than atomically prevented. See the residual note in
 *   `write-gate.md`.
 *
 * The gate prefers `atomicNoFollow` when available. Both branches use
 * `platformCapability` rather than reading `process.platform` at each call
 * site, so `_setPlatformCapabilityForTests` can exercise the
 * check-open-verify branch on a POSIX host that would otherwise never take
 * it. The setter is not part of the runtime API.
 */
function detectPlatformCapability() {
  const oNoFollow = fs.constants.O_NOFOLLOW;
  const atomicNoFollow = typeof oNoFollow === 'number' && oNoFollow !== 0;
  return Object.freeze({
    atomicNoFollow,
    oNoFollow: atomicNoFollow ? oNoFollow : 0,
    checkOpenVerify:
      typeof fs.lstatSync === 'function'
      && typeof fs.fstatSync === 'function'
      && typeof fs.openSync === 'function',
  });
}

let platformCapability = detectPlatformCapability();

/** @internal Test-only. Override the process-wide capability descriptor. */
export function _setPlatformCapabilityForTests(override) {
  const prior = platformCapability;
  platformCapability = Object.freeze({ ...prior, ...(override ?? {}) });
  return () => { platformCapability = prior; };
}

/** @internal Test-only. Reset the descriptor to the freshly-detected default. */
export function _resetPlatformCapabilityForTests() {
  platformCapability = detectPlatformCapability();
}

function refusal(status, detail, extra = {}) {
  return { status, written: false, detail, ...extra };
}

/**
 * Read a file's bytes without following a symbolic link at the final
 * component. On POSIX the read is atomic (O_NOFOLLOW); on Windows the read
 * is a bounded check-open-verify sequence — see the residual note in
 * `write-gate.md`.
 */
function readSnapshotNoFollow(absolutePath) {
  if (platformCapability.atomicNoFollow) {
    let fd;
    try {
      fd = fs.openSync(absolutePath, fs.constants.O_RDONLY | platformCapability.oNoFollow);
    } catch (error) {
      if (error.code === 'ELOOP' || error.code === 'EMLINK') {
        return { ok: false, reason: 'symlink-component' };
      }
      return { ok: false, reason: `open:${error.code ?? 'unknown'}` };
    }
    try {
      const stat = fs.fstatSync(fd);
      if (stat.size > MAX_SNAPSHOT_BYTES) {
        return { ok: false, reason: 'prior-too-large' };
      }
      const bytes = fs.readFileSync(fd);
      return { ok: true, bytes };
    } catch (error) {
      return { ok: false, reason: `read:${error.code ?? 'unknown'}` };
    } finally {
      try { fs.closeSync(fd); } catch { /* noop */ }
    }
  }

  if (!platformCapability.checkOpenVerify) {
    return { ok: false, reason: 'no-follow-unavailable' };
  }

  // Windows check-open-verify: lstat, refuse a link or reparse point, open,
  // then fstat and confirm (dev, ino) match. A swap inside the small window
  // between lstat and open is caught by the post-open compare rather than
  // atomically prevented — the residual is documented in write-gate.md.
  let preStat;
  try {
    preStat = fs.lstatSync(absolutePath);
  } catch (error) {
    return { ok: false, reason: `open:${error.code ?? 'unknown'}` };
  }
  if (preStat.isSymbolicLink()) {
    return { ok: false, reason: 'symlink-component' };
  }
  if (!preStat.isFile()) {
    return { ok: false, reason: 'not-regular-file' };
  }
  if (preStat.size > MAX_SNAPSHOT_BYTES) {
    return { ok: false, reason: 'prior-too-large' };
  }

  let fd;
  try {
    fd = fs.openSync(absolutePath, fs.constants.O_RDONLY);
  } catch (error) {
    return { ok: false, reason: `open:${error.code ?? 'unknown'}` };
  }
  try {
    const postStat = fs.fstatSync(fd);
    if (postStat.dev !== preStat.dev || postStat.ino !== preStat.ino) {
      return { ok: false, reason: 'symlink-component' };
    }
    if (!postStat.isFile()) {
      return { ok: false, reason: 'not-regular-file' };
    }
    if (postStat.size > MAX_SNAPSHOT_BYTES) {
      return { ok: false, reason: 'prior-too-large' };
    }
    const bytes = fs.readFileSync(fd);
    return { ok: true, bytes };
  } catch (error) {
    return { ok: false, reason: `read:${error.code ?? 'unknown'}` };
  } finally {
    try { fs.closeSync(fd); } catch { /* noop */ }
  }
}

/**
 * Capture the ancestor chain from realRoot down to the target's PARENT.
 * Every existing ancestor's (dev, ino) is recorded. An ancestor missing at
 * inspection is recorded with a null identity and marked existed=false; the
 * apply path pins those identities after the mkdir.
 */
function walkAncestors(realRoot, relative) {
  const chain = [];
  let rootStat;
  try {
    rootStat = fs.lstatSync(realRoot);
  } catch {
    return { safe: false, reason: 'symlink-component', chain: [] };
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return { safe: false, reason: 'symlink-component', chain: [] };
  }
  chain.push({ path: realRoot, dev: rootStat.dev, ino: rootStat.ino, existed: true });

  let walked = realRoot;
  const segments = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length - 1; index += 1) {
    walked = path.join(walked, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(walked);
    } catch {
      chain.push({ path: walked, dev: null, ino: null, existed: false });
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return { safe: false, reason: 'symlink-component', chain: [] };
    }
    chain.push({ path: walked, dev: stat.dev, ino: stat.ino, existed: true });
  }
  return { safe: true, chain };
}

/**
 * Re-verify a previously captured chain. Any existing ancestor's (dev, ino)
 * must still match. Ancestors that did not exist at inspection are skipped;
 * they are pinned by the caller once mkdir creates them.
 */
function verifyChain(chain) {
  for (const link of chain) {
    if (!link.existed) {
      continue;
    }
    let stat;
    try {
      stat = fs.lstatSync(link.path);
    } catch {
      return { ok: false, reason: 'stale-preview', at: link.path };
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return { ok: false, reason: 'symlink-component', at: link.path };
    }
    if (stat.dev !== link.dev || stat.ino !== link.ino) {
      return { ok: false, reason: 'stale-preview', at: link.path };
    }
  }
  return { ok: true };
}

function inspectTarget(realRoot, artifactPath) {
  const absolute = path.resolve(realRoot, artifactPath);
  const relative = path.relative(realRoot, absolute);
  const relativePosix = toPosix(relative);

  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { relativePath: relativePosix, absolutePath: absolute, safe: false, reason: 'path-escape' };
  }

  const walk = walkAncestors(realRoot, relative);
  if (!walk.safe) {
    return { relativePath: relativePosix, absolutePath: absolute, safe: false, reason: walk.reason };
  }

  let existingSha256 = null;
  let existingMode = null;
  let action = 'create';
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    stat = null;
  }
  if (stat) {
    if (stat.isSymbolicLink()) {
      return { relativePath: relativePosix, absolutePath: absolute, safe: false, reason: 'symlink-component' };
    }
    if (!stat.isFile()) {
      return { relativePath: relativePosix, absolutePath: absolute, safe: false, reason: 'not-regular-file' };
    }
    if (stat.size > MAX_SNAPSHOT_BYTES) {
      return { relativePath: relativePosix, absolutePath: absolute, safe: false, reason: 'prior-too-large' };
    }
    const priorRead = readSnapshotNoFollow(absolute);
    if (!priorRead.ok) {
      return { relativePath: relativePosix, absolutePath: absolute, safe: false, reason: priorRead.reason };
    }
    existingSha256 = sha256(priorRead.bytes);
    // Capture only the permission bits so a prior 0o600 file is restored to
    // 0o600 after a rollback rather than silently relaxed to the default
    // creation mode of `fs.writeFileSync`.
    existingMode = stat.mode & 0o777;
    action = 'overwrite';
  }

  return {
    relativePath: relativePosix,
    absolutePath: absolute,
    safe: true,
    reason: null,
    existingSha256,
    existingMode,
    action,
    chain: walk.chain,
  };
}

/**
 * Canonical hash over the immutable preview state. `absolutePath` is
 * deliberately NOT part of this: at apply time the gate derives the absolute
 * path fresh from realRoot + relativePath, and never trusts a caller-supplied
 * absolutePath.
 */
function previewIdOf(realRoot, entries) {
  const parts = [realRoot];
  for (const entry of entries) {
    const existing = entry.existingSha256 === null || entry.existingSha256 === undefined
      ? '<absent>'
      : entry.existingSha256;
    parts.push(`${entry.relativePath}\u0000${entry.sha256}\u0000${existing}`);
  }
  return sha256(parts.join('\n'));
}

function requireArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new WriteGateError('usage', 'at least one artifact is required');
  }
  const seen = new Set();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact.path !== 'string' || typeof artifact.content !== 'string') {
      throw new WriteGateError('usage', 'each artifact requires a path and string content');
    }
    if (seen.has(artifact.path)) {
      throw new WriteGateError('usage', `duplicate artifact path: ${artifact.path}`);
    }
    seen.add(artifact.path);
  }
}

/**
 * Build a preview binding every target path to the exact content that will be
 * written and to a preview identity derived from all of them. Duplicate target
 * paths are refused before a preview is returned.
 */
export function buildPreview({ repositoryRoot, artifacts }) {
  requireArtifacts(artifacts);
  const realRoot = realRootOf(repositoryRoot);

  const entries = [];
  const safety = [];
  for (const artifact of artifacts) {
    const content = artifact.content;
    const contentSha = sha256(content);
    const inspection = inspectTarget(realRoot, artifact.path);
    safety.push(Object.freeze({
      relativePath: inspection.relativePath,
      safe: inspection.safe,
      reason: inspection.reason,
    }));
    entries.push({
      relativePath: inspection.relativePath,
      content,
      sha256: contentSha,
      action: inspection.safe ? inspection.action : null,
      existingSha256: inspection.safe ? inspection.existingSha256 : null,
    });
  }

  const normalizedPaths = new Set();
  for (const entry of entries) {
    const detectionKey = normalizePathForDuplicateDetection(entry.relativePath);
    if (normalizedPaths.has(detectionKey)) {
      throw new WriteGateError('usage', `duplicate normalized target path: ${entry.relativePath}`);
    }
    normalizedPaths.add(detectionKey);
  }

  const preview = {
    previewId: previewIdOf(realRoot, entries),
    entries: entries.map((entry) => Object.freeze({ ...entry })),
    safety: Object.freeze([...safety]),
  };
  Object.freeze(preview.entries);
  return Object.freeze(preview);
}

const ALLOWED_ENTRY_KEYS = Object.freeze(new Set([
  'relativePath', 'content', 'sha256', 'action', 'existingSha256',
]));

const ALLOWED_PREVIEW_KEYS = Object.freeze(new Set(['previewId', 'entries', 'safety']));

/**
 * Strictly validate a supplied (possibly deserialized) preview payload.
 * A schema mismatch — missing fields, wrong types, unknown fields, or
 * duplicate normalized paths — returns a declared refusal rather than
 * throwing.
 *
 * The check refuses any `absolutePath` field in an entry, because the
 * apply path derives the absolute path fresh from the validated repository
 * root and the entry's relative path. Trusting a caller-supplied
 * absolutePath is how a serialized preview could redirect the write.
 */
function validatePreviewShape(preview) {
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    return { ok: false, refusal: refusal('stale-preview', 'preview payload has the wrong shape') };
  }
  for (const key of Object.keys(preview)) {
    if (!ALLOWED_PREVIEW_KEYS.has(key)) {
      return { ok: false, refusal: refusal('stale-preview', `preview payload carries unknown field: ${key}`) };
    }
  }
  if (typeof preview.previewId !== 'string' || !preview.previewId) {
    return { ok: false, refusal: refusal('stale-preview', 'preview payload missing previewId') };
  }
  if (!Array.isArray(preview.entries) || preview.entries.length === 0) {
    return { ok: false, refusal: refusal('stale-preview', 'preview payload missing entries') };
  }
  const seenRelative = new Set();
  for (let i = 0; i < preview.entries.length; i += 1) {
    const entry = preview.entries[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, refusal: refusal('stale-preview', `entry ${i} is not an object`) };
    }
    for (const key of Object.keys(entry)) {
      if (!ALLOWED_ENTRY_KEYS.has(key)) {
        return { ok: false, refusal: refusal('stale-preview', `entry ${i} carries unknown field: ${key}`) };
      }
    }
    if (typeof entry.relativePath !== 'string' || !entry.relativePath) {
      return { ok: false, refusal: refusal('stale-preview', `entry ${i} missing relativePath`) };
    }
    if (typeof entry.content !== 'string') {
      return { ok: false, refusal: refusal('stale-preview', `entry ${i} missing content`) };
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      return { ok: false, refusal: refusal('stale-preview', `entry ${i} sha256 is malformed`) };
    }
    if (entry.action !== 'create' && entry.action !== 'overwrite' && entry.action !== null) {
      return { ok: false, refusal: refusal('stale-preview', `entry ${i} action is malformed`) };
    }
    if (entry.existingSha256 !== null
      && !(typeof entry.existingSha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.existingSha256))) {
      return { ok: false, refusal: refusal('stale-preview', `entry ${i} existingSha256 is malformed`) };
    }
    const detectionKey = normalizePathForDuplicateDetection(toPosix(entry.relativePath));
    if (seenRelative.has(detectionKey)) {
      return {
        ok: false,
        refusal: refusal('stale-preview', `duplicate normalized target path: ${entry.relativePath}`, { target: entry.relativePath }),
      };
    }
    seenRelative.add(detectionKey);
  }
  return { ok: true };
}

function confirmationMatches(confirmation, previewId) {
  return Boolean(
    confirmation
    && typeof confirmation === 'object'
    && !Array.isArray(confirmation)
    && confirmation.grant === CONFIRMATION_GRANT
    && confirmation.previewId === previewId,
  );
}

function readbackNoFollow(absolutePath) {
  if (platformCapability.atomicNoFollow) {
    let fd;
    try {
      fd = fs.openSync(absolutePath, fs.constants.O_RDONLY | platformCapability.oNoFollow);
    } catch (error) {
      if (error.code === 'ELOOP' || error.code === 'EMLINK') {
        return { ok: false, reason: 'symlink' };
      }
      return { ok: false, reason: `open:${error.code ?? 'unknown'}` };
    }
    try {
      const bytes = fs.readFileSync(fd);
      return { ok: true, bytes, sha256: sha256(bytes), byteLength: bytes.length };
    } catch (error) {
      return { ok: false, reason: `read:${error.code ?? 'unknown'}` };
    } finally {
      try { fs.closeSync(fd); } catch { /* noop */ }
    }
  }

  if (!platformCapability.checkOpenVerify) {
    return { ok: false, reason: 'no-follow-unavailable' };
  }

  // Windows check-open-verify. See readSnapshotNoFollow for the rationale
  // and residual.
  let preStat;
  try {
    preStat = fs.lstatSync(absolutePath);
  } catch (error) {
    return { ok: false, reason: `open:${error.code ?? 'unknown'}` };
  }
  if (preStat.isSymbolicLink()) {
    return { ok: false, reason: 'symlink' };
  }
  if (!preStat.isFile()) {
    return { ok: false, reason: 'not-regular-file' };
  }

  let fd;
  try {
    fd = fs.openSync(absolutePath, fs.constants.O_RDONLY);
  } catch (error) {
    return { ok: false, reason: `open:${error.code ?? 'unknown'}` };
  }
  try {
    const postStat = fs.fstatSync(fd);
    if (postStat.dev !== preStat.dev || postStat.ino !== preStat.ino) {
      return { ok: false, reason: 'symlink' };
    }
    if (!postStat.isFile()) {
      return { ok: false, reason: 'not-regular-file' };
    }
    const bytes = fs.readFileSync(fd);
    return { ok: true, bytes, sha256: sha256(bytes), byteLength: bytes.length };
  } catch (error) {
    return { ok: false, reason: `read:${error.code ?? 'unknown'}` };
  } finally {
    try { fs.closeSync(fd); } catch { /* noop */ }
  }
}

/**
 * Open a target for writing without following a symbolic link at the final
 * component. Two branches, one per capability:
 *
 * - `atomicNoFollow` (POSIX): single atomic openSync with O_NOFOLLOW plus
 *   O_CREAT|O_EXCL (for `create`) or O_TRUNC (for `overwrite`).
 * - `checkOpenVerify` (Windows): lstat the target, refuse a symlink or
 *   reparse point, open (with O_CREAT|O_EXCL or O_TRUNC), then fstat and
 *   verify (dev, ino) match. `ENOTREG` on the post-verify is mapped to
 *   `symlink-component` by the caller — the target changed shape unsafely.
 *
 * Returns `{ ok: true, fd }` on success or `{ ok: false, code, message }`
 * on failure. The caller interprets the code — EEXIST -> stale-preview,
 * ELOOP/EMLINK/ENOTREG -> unsafe-target (symlink-component), anything else
 * -> blocked.
 */
function openTargetForWrite(absolutePath, action) {
  if (platformCapability.atomicNoFollow) {
    const flags = action === 'create'
      ? (fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | platformCapability.oNoFollow)
      : (fs.constants.O_TRUNC | fs.constants.O_WRONLY | platformCapability.oNoFollow);
    try {
      const fd = fs.openSync(absolutePath, flags, 0o644);
      return { ok: true, fd };
    } catch (error) {
      return { ok: false, code: error.code ?? 'unknown', message: error.message };
    }
  }

  if (!platformCapability.checkOpenVerify) {
    return { ok: false, code: 'ENOSAFEPRIMITIVE', message: 'no safe write primitive on this platform' };
  }

  let preStat = null;
  try {
    preStat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      return { ok: false, code: error.code ?? 'unknown', message: error.message };
    }
  }
  if (preStat) {
    if (preStat.isSymbolicLink()) {
      return { ok: false, code: 'ELOOP', message: 'target is a symbolic link' };
    }
    if (!preStat.isFile()) {
      return { ok: false, code: 'ENOTREG', message: 'target is not a regular file' };
    }
  }

  const flags = action === 'create'
    ? (fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR)
    : (fs.constants.O_TRUNC | fs.constants.O_RDWR);

  let fd;
  try {
    fd = fs.openSync(absolutePath, flags, 0o644);
  } catch (error) {
    return { ok: false, code: error.code ?? 'unknown', message: error.message };
  }

  try {
    // The post-open fstat is what confirms the descriptor still identifies
    // the entry the pre-open `lstat` saw. On Windows this is why the open
    // uses `O_RDWR` rather than `O_WRONLY`: NtQueryInformationFile
    // (which powers fstat under libuv) needs FILE_READ_ATTRIBUTES on the
    // handle, and Windows' GENERIC_WRITE (the mapping for O_WRONLY alone)
    // omits that right — so an O_WRONLY handle would fail every fstat call
    // with EACCES and turn every overwrite into `blocked` on the Windows
    // job. GENERIC_READ | GENERIC_WRITE (the mapping for O_RDWR) includes
    // FILE_READ_ATTRIBUTES and lets the identity check run.
    const postStat = fs.fstatSync(fd);
    if (!postStat.isFile()) {
      try { fs.closeSync(fd); } catch { /* noop */ }
      return { ok: false, code: 'ENOTREG', message: 'opened descriptor is not a regular file' };
    }
    if (preStat && (postStat.dev !== preStat.dev || postStat.ino !== preStat.ino)) {
      try { fs.closeSync(fd); } catch { /* noop */ }
      return { ok: false, code: 'ELOOP', message: 'target identity changed between lstat and open' };
    }
    return { ok: true, fd };
  } catch (error) {
    try { fs.closeSync(fd); } catch { /* noop */ }
    return { ok: false, code: error.code ?? 'unknown', message: error.message };
  }
}

/**
 * Roll back mutations in REVERSE order. Every step is verified — a newly
 * created file must be gone, and an overwritten file must hash back to its
 * prior snapshot AND (on platforms that expose file modes) restore to its
 * prior permission bits. Anything that could not be un-done is named in the
 * returned residue so the operator sees exactly what remains on disk.
 */
function rollback(records) {
  const remaining = [];
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i];
    if (!record.mutated) {
      continue;
    }
    if (record.priorSnapshot === null) {
      try {
        fs.rmSync(record.absolutePath, { force: true });
      } catch (error) {
        remaining.push({ relativePath: record.relativePath, state: 'still-present', reason: error.code ?? error.message });
        continue;
      }
      if (fs.existsSync(record.absolutePath)) {
        remaining.push({ relativePath: record.relativePath, state: 'still-present', reason: 'exists-after-rm' });
      }
    } else {
      // Overwrite rollback: restore the bytes AND the prior permission mode
      // in one open. `fs.writeFileSync` opens with a default `0o666 & ~umask`,
      // so a prior 0o600 file would silently become 0o644. Opening the file
      // ourselves lets us `fchmodSync` back to the prior mode before closing,
      // and re-reading the mode via `fs.lstatSync` afterwards verifies the
      // restoration. The open uses the same capability-selected safe path as
      // the commit itself, so a rollback on Windows takes the same
      // check-open-verify branch a commit takes and a rollback on POSIX takes
      // the same atomic O_NOFOLLOW branch.
      const opened = openTargetForWrite(record.absolutePath, 'overwrite');
      if (!opened.ok) {
        remaining.push({ relativePath: record.relativePath, state: 'not-restored', reason: opened.code ?? opened.message });
        continue;
      }
      const fd = opened.fd;
      let writeFailed = null;
      try {
        fs.writeFileSync(fd, record.priorSnapshot);
      } catch (error) {
        writeFailed = error.code ?? error.message;
      }
      if (writeFailed === null && record.priorMode !== null && record.priorMode !== undefined) {
        try {
          fs.fchmodSync(fd, record.priorMode);
        } catch (error) {
          writeFailed = error.code ?? error.message;
        }
      }
      try { fs.closeSync(fd); } catch { /* noop */ }
      if (writeFailed !== null) {
        remaining.push({ relativePath: record.relativePath, state: 'not-restored', reason: writeFailed });
        continue;
      }
      let restoredBytes;
      let restoredStat;
      try {
        restoredBytes = fs.readFileSync(record.absolutePath);
      } catch (error) {
        remaining.push({ relativePath: record.relativePath, state: 'not-verified', reason: error.code ?? error.message });
        continue;
      }
      if (sha256(restoredBytes) !== record.priorSha256) {
        remaining.push({ relativePath: record.relativePath, state: 'not-restored', reason: 'hash-mismatch' });
        continue;
      }
      if (record.priorMode !== null && record.priorMode !== undefined) {
        try {
          restoredStat = fs.lstatSync(record.absolutePath);
        } catch (error) {
          remaining.push({ relativePath: record.relativePath, state: 'not-verified', reason: error.code ?? error.message });
          continue;
        }
        if ((restoredStat.mode & 0o777) !== (record.priorMode & 0o777)) {
          remaining.push({ relativePath: record.relativePath, state: 'not-restored', reason: 'mode-mismatch' });
        }
      }
    }
  }
  return remaining;
}

/**
 * Apply an approved preview. Every failure returns one of the seven
 * documented statuses. A filesystem exception never crosses the public
 * boundary; the only WriteGateError thrown is a caller-usage error such as
 * a missing repositoryRoot argument.
 */
export function applyPreview({ repositoryRoot, preview, confirmation }) {
  const shape = validatePreviewShape(preview);
  if (!shape.ok) {
    return shape.refusal;
  }

  let realRoot;
  try {
    realRoot = realRootOf(repositoryRoot);
  } catch (error) {
    if (error instanceof WriteGateError) {
      throw error;
    }
    return refusal('blocked', `repository root not usable: ${error.message}`);
  }

  // Fail closed only when NEITHER safe primitive is available. On POSIX
  // the atomic O_NOFOLLOW open is used; on Windows and any platform that
  // exposes lstat/open/fstat, check-open-verify is used with the residual
  // documented in write-gate.md. A platform offering neither is refused
  // rather than opening a symbolic link.
  if (!platformCapability.atomicNoFollow && !platformCapability.checkOpenVerify) {
    return refusal('blocked', 'no safe-open primitive is available on this platform; the gate fails closed');
  }

  if (!confirmationMatches(confirmation, preview.previewId)) {
    return refusal('cancelled', 'confirmation absent or does not match the preview');
  }

  const reconstructed = previewIdOf(
    realRoot,
    preview.entries.map((entry) => ({
      relativePath: entry.relativePath,
      sha256: sha256(entry.content),
      existingSha256: entry.existingSha256 ?? null,
    })),
  );
  if (reconstructed !== preview.previewId) {
    return refusal('stale-preview', 'preview entries no longer hash to the recorded preview identity');
  }

  const inspections = [];
  for (const entry of preview.entries) {
    const inspection = inspectTarget(realRoot, entry.relativePath);
    if (!inspection.safe) {
      return refusal('unsafe-target', `refused ${entry.relativePath}: ${inspection.reason}`, {
        target: entry.relativePath,
        reason: inspection.reason,
      });
    }
    inspections.push(inspection);
  }

  for (let index = 0; index < preview.entries.length; index += 1) {
    const entry = preview.entries[index];
    const current = inspections[index].existingSha256 ?? null;
    const recordedExisting = entry.existingSha256 ?? null;
    if (current !== recordedExisting) {
      return refusal('stale-preview', `target changed since preview: ${entry.relativePath}`, {
        target: entry.relativePath,
      });
    }
  }

  // Build one record per target and snapshot ALL prior bytes UP FRONT,
  // before the first mutation. Snapshots are bounded per entry by
  // MAX_SNAPSHOT_BYTES (inspectTarget refused anything larger).
  const records = preview.entries.map((entry, index) => {
    const inspection = inspections[index];
    return {
      relativePath: entry.relativePath,
      absolutePath: inspection.absolutePath,
      inspection,
      entry,
      priorSnapshot: null,
      priorSha256: inspection.existingSha256,
      priorMode: inspection.existingMode ?? null,
      intendedSha: entry.sha256,
      change: null,
      mutated: false,
    };
  });

  for (const record of records) {
    if (record.inspection.existingSha256 !== null) {
      const snapshot = readSnapshotNoFollow(record.absolutePath);
      if (!snapshot.ok) {
        const remaining = rollback(records);
        return refusal('blocked', `could not snapshot ${record.relativePath}: ${snapshot.reason}`, {
          target: record.relativePath,
          rollbackRemaining: remaining,
        });
      }
      record.priorSnapshot = snapshot.bytes;
    }
  }

  // Commit each target. Rollback responsibility is registered BEFORE the
  // mutating open, so a write or close failure after the truncation still
  // has an entry in the rollback set.
  for (const record of records) {
    const chainVerdict = verifyChain(record.inspection.chain);
    if (!chainVerdict.ok) {
      const remaining = rollback(records);
      return {
        status: chainVerdict.reason === 'symlink-component' ? 'unsafe-target' : 'stale-preview',
        written: false,
        detail: `ancestor of ${record.relativePath} changed: ${chainVerdict.at}`,
        target: record.relativePath,
        reason: chainVerdict.reason === 'symlink-component' ? 'symlink-component' : null,
        rollbackRemaining: remaining,
      };
    }

    const parentPath = path.dirname(record.absolutePath);
    try {
      fs.mkdirSync(parentPath, { recursive: true });
    } catch (error) {
      const remaining = rollback(records);
      return refusal('blocked', `mkdir failed for ${record.relativePath}: ${error.code ?? error.message}`, {
        target: record.relativePath,
        rollbackRemaining: remaining,
      });
    }
    // Pin any ancestors this run just created so the chain verification
    // covers them too.
    for (const link of record.inspection.chain) {
      if (link.existed) {
        continue;
      }
      let stat;
      try {
        stat = fs.lstatSync(link.path);
      } catch (error) {
        const remaining = rollback(records);
        return refusal('blocked', `newly-created ancestor missing for ${record.relativePath}: ${error.code ?? error.message}`, {
          target: record.relativePath,
          rollbackRemaining: remaining,
        });
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        const remaining = rollback(records);
        return refusal('unsafe-target', `newly-created ancestor unsafe for ${record.relativePath}: ${link.path}`, {
          target: record.relativePath,
          reason: 'symlink-component',
          rollbackRemaining: remaining,
        });
      }
      link.dev = stat.dev;
      link.ino = stat.ino;
      link.existed = true;
    }

    let targetState = null;
    try {
      targetState = fs.lstatSync(record.absolutePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const remaining = rollback(records);
        return refusal('blocked', `pre-open stat failed for ${record.relativePath}: ${error.code}`, {
          target: record.relativePath,
          rollbackRemaining: remaining,
        });
      }
    }
    if (record.inspection.action === 'overwrite') {
      if (!targetState) {
        const remaining = rollback(records);
        return {
          status: 'stale-preview',
          written: false,
          detail: `target vanished before write: ${record.relativePath}`,
          target: record.relativePath,
          rollbackRemaining: remaining,
        };
      }
      if (targetState.isSymbolicLink()) {
        const remaining = rollback(records);
        return refusal('unsafe-target', `target became a symlink: ${record.relativePath}`, {
          target: record.relativePath,
          reason: 'symlink-component',
          rollbackRemaining: remaining,
        });
      }
      if (!targetState.isFile()) {
        const remaining = rollback(records);
        return refusal('unsafe-target', `target is not a file: ${record.relativePath}`, {
          target: record.relativePath,
          reason: 'not-regular-file',
          rollbackRemaining: remaining,
        });
      }
      // Re-verify the approved prior content hash IMMEDIATELY before
      // truncation. A change between inspection and open is stale-preview.
      const currentSnapshot = readSnapshotNoFollow(record.absolutePath);
      if (!currentSnapshot.ok) {
        const remaining = rollback(records);
        return refusal('blocked', `pre-open snapshot failed for ${record.relativePath}: ${currentSnapshot.reason}`, {
          target: record.relativePath,
          rollbackRemaining: remaining,
        });
      }
      if (sha256(currentSnapshot.bytes) !== record.priorSha256) {
        const remaining = rollback(records);
        return {
          status: 'stale-preview',
          written: false,
          detail: `target changed just before write: ${record.relativePath}`,
          target: record.relativePath,
          rollbackRemaining: remaining,
        };
      }
    } else {
      if (targetState !== null) {
        const remaining = rollback(records);
        return {
          status: 'stale-preview',
          written: false,
          detail: `target appeared before write: ${record.relativePath}`,
          target: record.relativePath,
          rollbackRemaining: remaining,
        };
      }
    }

    if (record.inspection.existingSha256 === record.intendedSha) {
      record.change = 'unchanged';
      continue;
    }

    // Register rollback responsibility BEFORE the truncating/creating open,
    // so a write or close failure after the truncation still has this entry
    // on the rollback list.
    record.mutated = true;

    // The safe-open helper picks between the atomic O_NOFOLLOW open on POSIX
    // and the check-open-verify sequence on Windows. It returns the same
    // set of error codes so the mapping below is platform-neutral: EEXIST
    // -> stale-preview, ELOOP/EMLINK/ENOTREG -> unsafe-target
    // (symlink-component), and anything else -> blocked.
    const opened = openTargetForWrite(record.absolutePath, record.inspection.action);
    if (!opened.ok) {
      // The open failed before the file was mutated. Roll back the earlier
      // committed entries and mark this one as never-mutated.
      record.mutated = false;
      const code = opened.code;
      if (code === 'ELOOP' || code === 'EMLINK' || code === 'ENOTREG') {
        const remaining = rollback(records);
        return refusal('unsafe-target', `symlink at ${record.relativePath}`, {
          target: record.relativePath,
          reason: 'symlink-component',
          rollbackRemaining: remaining,
        });
      }
      if (code === 'EEXIST') {
        const remaining = rollback(records);
        return {
          status: 'stale-preview',
          written: false,
          detail: `target appeared since preview: ${record.relativePath}`,
          target: record.relativePath,
          rollbackRemaining: remaining,
        };
      }
      const remaining = rollback(records);
      return refusal('blocked', `open failed for ${record.relativePath}: ${code ?? opened.message}`, {
        target: record.relativePath,
        rollbackRemaining: remaining,
      });
    }
    const fd = opened.fd;

    try {
      fs.writeFileSync(fd, record.entry.content);
    } catch (error) {
      try { fs.closeSync(fd); } catch { /* noop */ }
      const remaining = rollback(records);
      return refusal('blocked', `write failed for ${record.relativePath}: ${error.code ?? error.message}`, {
        target: record.relativePath,
        rollbackRemaining: remaining,
      });
    }
    try {
      fs.closeSync(fd);
    } catch (error) {
      const remaining = rollback(records);
      return refusal('blocked', `close failed for ${record.relativePath}: ${error.code ?? error.message}`, {
        target: record.relativePath,
        rollbackRemaining: remaining,
      });
    }
    record.change = record.inspection.action === 'create' ? 'created' : 'overwritten';
  }

  const readback = [];
  for (const record of records) {
    const chainVerdict = verifyChain(record.inspection.chain);
    if (!chainVerdict.ok) {
      const remaining = rollback(records);
      return {
        status: chainVerdict.reason === 'symlink-component' ? 'unsafe-target' : 'stale-preview',
        written: false,
        detail: `ancestor of ${record.relativePath} changed before readback: ${chainVerdict.at}`,
        target: record.relativePath,
        reason: chainVerdict.reason === 'symlink-component' ? 'symlink-component' : null,
        rollbackRemaining: remaining,
      };
    }
    const result = readbackNoFollow(record.absolutePath);
    if (!result.ok) {
      const remaining = rollback(records);
      return refusal('blocked', `readback failed for ${record.relativePath}: ${result.reason}`, {
        target: record.relativePath,
        rollbackRemaining: remaining,
      });
    }
    if (result.sha256 !== record.intendedSha) {
      const remaining = rollback(records);
      return refusal('blocked', `readback hash mismatch for ${record.relativePath}`, {
        target: record.relativePath,
        expected: record.intendedSha,
        actual: result.sha256,
        rollbackRemaining: remaining,
      });
    }
    readback.push({
      relativePath: record.relativePath,
      byteLength: result.byteLength,
      sha256: result.sha256,
      change: record.change ?? 'unchanged',
    });
  }

  return {
    status: 'configured',
    written: true,
    previewId: preview.previewId,
    readback,
  };
}

export function exitCodeFor(report) {
  if (!report || report.status === 'configured') {
    return EXIT_ACCEPTED;
  }
  return EXIT_FINDINGS;
}

export { sha256 };

// --- Command interface ------------------------------------------------------
//
// Every subcommand accepts exactly one `--input <path>` argument (or falls
// back to stdin), rejects unknown or repeated flags, and returns a documented
// exit code. The exit-code table lives beside the subcommand table in
// `write-gate.md`.

const SUBCOMMAND_SCHEMA = Object.freeze({
  'build-preview': { input: 'json' },
  'apply-preview': { input: 'json' },
  '--probe': { input: 'none' },
});

function parseArgs(argv, schema) {
  const args = { inputPath: null };
  let sawInput = 0;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input') {
      if (schema.input !== 'json') {
        throw new WriteGateError('usage', 'this subcommand does not accept --input');
      }
      sawInput += 1;
      if (sawInput > 1) {
        throw new WriteGateError('usage', '--input may only be given once');
      }
      const value = argv[i + 1];
      if (typeof value !== 'string' || value.startsWith('--')) {
        throw new WriteGateError('usage', '--input requires a file path');
      }
      args.inputPath = value;
      i += 1;
      continue;
    }
    throw new WriteGateError('usage', `unknown argument: ${token}`);
  }
  return args;
}

function readJsonInput(inputPath) {
  let raw;
  if (inputPath) {
    try {
      raw = fs.readFileSync(inputPath, 'utf8');
    } catch (error) {
      throw new WriteGateError('usage', `could not read --input ${inputPath}: ${error.code ?? error.message}`);
    }
  } else {
    raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) {
      throw new WriteGateError('usage', 'no input supplied on stdin or via --input');
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new WriteGateError('usage', 'input is not valid JSON');
  }
}

function serializePreview(preview) {
  return {
    previewId: preview.previewId,
    // `absolutePath` is deliberately omitted from the serialized payload,
    // and `applyPreview` rejects an entry that carries one. Trusting a
    // caller-supplied absolutePath is how a serialized preview could
    // redirect the write.
    entries: preview.entries.map((entry) => ({
      relativePath: entry.relativePath,
      content: entry.content,
      sha256: entry.sha256,
      action: entry.action,
      existingSha256: entry.existingSha256,
    })),
    safety: preview.safety.map((entry) => ({ ...entry })),
  };
}

async function runCommand(argv) {
  const [subcommand, ...rest] = argv;
  const schema = SUBCOMMAND_SCHEMA[subcommand];
  if (!schema) {
    throw new WriteGateError(
      'usage',
      'write-gate subcommands are `build-preview`, `apply-preview`, and `--probe`',
    );
  }
  const args = parseArgs(rest, schema);

  if (subcommand === '--probe') {
    process.stdout.write('write-gate: available\n');
    return EXIT_ACCEPTED;
  }

  const input = readJsonInput(args.inputPath);

  if (subcommand === 'build-preview') {
    let preview;
    try {
      preview = buildPreview({
        repositoryRoot: input.repositoryRoot,
        artifacts: input.artifacts,
      });
    } catch (error) {
      if (error instanceof WriteGateError) {
        throw error;
      }
      throw new WriteGateError('usage', error.message);
    }
    process.stdout.write(`${JSON.stringify(serializePreview(preview))}\n`);
    return EXIT_ACCEPTED;
  }

  // apply-preview
  const result = applyPreview({
    repositoryRoot: input.repositoryRoot,
    preview: input.preview,
    confirmation: input.confirmation,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return exitCodeFor(result);
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
  runCommand(process.argv.slice(2))
    .then((code) => { process.exitCode = code ?? EXIT_ACCEPTED; })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ error: { code: error.code ?? 'usage', message: error.message } })}\n`);
      process.exitCode = EXIT_USAGE;
    });
}
