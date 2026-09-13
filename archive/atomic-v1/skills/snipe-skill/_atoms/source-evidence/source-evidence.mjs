/**
 * Deterministic source binding for Skill Sniper.
 *
 * The source skill is the one thing in an adoption run that nobody in this
 * repository wrote. It is read because it is the best available description of
 * what the operator wants brought over, and it is *only* read: a document that
 * could authorize its own execution would make "adopt this skill" a way to run
 * arbitrary instructions with the run's authority.
 *
 * So inertness is not a paragraph asking the model to behave. It is the shape
 * of this module:
 *
 *   1. `bindSource` accepts exactly one named source, refuses zero and refuses
 *      several, and pins the bytes it read to a digest. A later step can prove
 *      it cited the same bytes and not a newer draft.
 *   2. `consumeSource` is the only way to use those bytes. It recomputes their
 *      digest and refuses any content that is not what was bound, so a binding
 *      cannot vouch for one document while a different one is handed onward.
 *   3. `assertInert` has no success path for an executing action. There is no
 *      argument, flag, or source content that turns evidence into an
 *      instruction.
 *
 * `inventoryDirectives` sits beside those three and is a different kind of
 * thing: a **best-effort disclosure aid**, not a control. It matches a fixed
 * list of patterns, so it under-reports by construction - an installer spelled
 * an unusual way, or an injection written in homoglyphs, will not appear in it.
 * That is tolerable only because non-execution does not depend on it. The safety
 * property is structural: `assertInert` refuses executing actions whether or not
 * anything was ever detected. Read the inventory as "here is some of what is in
 * there", never as "here is everything, and the rest is clean".
 *
 * Nothing here judges whether the source is any good. That is a human's job,
 * downstream, on a synthesized intent the human confirms.
 */

import { createHash } from 'node:crypto';

export const EVIDENCE_FAILURES = {
  usage: 'usage',
  unnamedSource: 'unnamed_source',
  multipleSources: 'multiple_sources',
  emptySource: 'empty_source',
  revisionMismatch: 'revision_mismatch',
  executionRefused: 'execution_refused',
  contentDrift: 'content_drift',
};

export class SourceEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SourceEvidenceError';
    this.code = code;
  }
}

/**
 * The closed set of things a source may contain that must be disclosed and
 * must never be acted on. It is closed on purpose: an open taxonomy invites a
 * catch-all, and a catch-all is where an unreviewed judgement hides.
 */
export const DIRECTIVE_KINDS = [
  'embedded-prompt',
  'shell-command',
  'installer',
  'permission-declaration',
];

/** Actions a caller may take against bound evidence. */
export const EVIDENCE_ACTIONS = ['read', 'cite', 'quote', 'synthesize'];

/** Actions that would turn evidence into an instruction. Always refused. */
export const REFUSED_ACTIONS = ['execute', 'run', 'install', 'apply', 'invoke', 'source'];

const MAX_EXCERPT = 120;
const SHA256 = /^[0-9a-f]{64}$/;

const DIRECTIVE_PATTERNS = [
  ['embedded-prompt', /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|rules|prompts)/i],
  ['embedded-prompt', /disregard\s+(?:the\s+)?(?:previous|prior|above|earlier)\b/i],
  ['embedded-prompt', /you\s+are\s+now\s+(?:a|an|the)\b/i],
  ['embedded-prompt', /^\s*(?:system|assistant)\s*:/i],
  ['embedded-prompt', /\bnew\s+instructions\s*:/i],
  ['shell-command', /\b(?:curl|wget)\b[^\n]*\|\s*(?:ba|z)?sh\b/i],
  ['shell-command', /\bsudo\s+\S+/],
  ['shell-command', /\beval\s+["'$(]/],
  ['shell-command', /\brm\s+-rf\s+\S+/],
  ['installer', /\b(?:npm|pnpm|yarn)\s+(?:i|install|add)\b/],
  ['installer', /\bpip3?\s+install\b/],
  ['installer', /\b(?:brew|apt-get|choco)\s+install\b/],
  ['installer', /\b(?:go|cargo|gem)\s+install\b/],
  ['permission-declaration', /^\s*allowed-tools\s*:/i],
  ['permission-declaration', /^\s*requires-skills\s*:/i],
  ['permission-declaration', /^\s*disable-model-invocation\s*:/i],
];

function excerpt(line) {
  const flat = line.trim().replace(/\s+/g, ' ');
  return flat.length <= MAX_EXCERPT ? flat : `${flat.slice(0, MAX_EXCERPT - 1)}\u2026`;
}

function normalizeReferences(input) {
  if (typeof input === 'string') {
    return input.trim() ? [input.trim()] : [];
  }
  if (Array.isArray(input)) {
    return input
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry !== '');
  }
  if (input === undefined || input === null) {
    return [];
  }
  throw new SourceEvidenceError(
    EVIDENCE_FAILURES.usage,
    'reference must be a string or an array of strings',
  );
}

/**
 * Lines that match a known instruction-shaped pattern, with what they are and
 * where they are.
 *
 * The inventory is disclosure, not detection of malice, and it is deliberately
 * incomplete. A perfectly honest skill contains installer lines and declares its
 * own permissions; the point is that those are reported as things this run will
 * not carry over by default rather than quietly copied into a new package. An
 * empty inventory means nothing matched, never that the source is clean.
 */
export function inventoryDirectives(text) {
  if (typeof text !== 'string') {
    throw new SourceEvidenceError(EVIDENCE_FAILURES.usage, 'text must be a string');
  }
  const findings = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    for (const [kind, pattern] of DIRECTIVE_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          kind,
          line: index + 1,
          excerpt: excerpt(line),
          disposition: 'evidence-only',
        });
      }
    }
  }
  return findings;
}

/**
 * Bind exactly one named source to the exact bytes that were read.
 *
 * `revision` is optional and may be either a full SHA-256 of the bytes or an
 * opaque label such as a tag. A declared digest that disagrees with the bytes
 * is a refusal rather than a warning: the whole value of pinning a revision is
 * that a later citation can prove which bytes it meant.
 */
export function bindSource({ reference, references, bytes, revision } = {}) {
  const named = normalizeReferences(references ?? reference);
  if (named.length === 0) {
    throw new SourceEvidenceError(
      EVIDENCE_FAILURES.unnamedSource,
      'the operator names the source; nothing is discovered on its behalf',
    );
  }
  if (named.length > 1) {
    throw new SourceEvidenceError(
      EVIDENCE_FAILURES.multipleSources,
      `one source per run; received ${named.length}: ${named.join(', ')}`,
    );
  }
  if (typeof bytes !== 'string') {
    throw new SourceEvidenceError(EVIDENCE_FAILURES.usage, 'bytes must be a UTF-8 string');
  }
  if (bytes.trim() === '') {
    throw new SourceEvidenceError(
      EVIDENCE_FAILURES.emptySource,
      `${named[0]} is empty; there is nothing to synthesize`,
    );
  }

  const digest = createHash('sha256').update(bytes, 'utf8').digest('hex');
  let declaredRevision = null;
  let revisionKind = 'none';
  if (revision !== undefined && revision !== null && `${revision}`.trim() !== '') {
    declaredRevision = `${revision}`.trim();
    if (SHA256.test(declaredRevision)) {
      if (declaredRevision !== digest) {
        throw new SourceEvidenceError(
          EVIDENCE_FAILURES.revisionMismatch,
          `declared revision ${declaredRevision} is not the digest of the bytes read (${digest})`,
        );
      }
      revisionKind = 'digest';
    } else {
      revisionKind = 'declared';
    }
  }

  return {
    status: 'bound',
    reference: named[0],
    revision: declaredRevision,
    revisionKind,
    digest,
    byteLength: Buffer.byteLength(bytes, 'utf8'),
    inert: true,
    directives: inventoryDirectives(bytes),
  };
}

/**
 * Use the bound bytes, or refuse.
 *
 * `bindSource` returns a digest, not the content, so a later step cannot quietly
 * treat the binding as a container for whatever it happens to be holding. Every
 * use passes the candidate bytes back through here, where they are re-digested
 * against the binding. Bind document A and hand this document B and it refuses,
 * which is the difference between a pinned revision and a decorative one.
 */
export function consumeSource(binding, bytes, action) {
  const permitted = assertInert(binding, action);
  if (typeof bytes !== 'string') {
    throw new SourceEvidenceError(EVIDENCE_FAILURES.usage, 'bytes must be a UTF-8 string');
  }
  const digest = createHash('sha256').update(bytes, 'utf8').digest('hex');
  if (digest !== binding.digest) {
    throw new SourceEvidenceError(
      EVIDENCE_FAILURES.contentDrift,
      `${binding.reference} was bound at ${binding.digest}; these bytes digest to ${digest}`,
    );
  }
  return { ...permitted, bytes, digest };
}

/**
 * The action gate between bound evidence and an action.
 *
 * There is deliberately no allowlist parameter and no override. A caller that
 * wants to run something the source described writes that step itself, in the
 * open, under its own authority - it does not obtain permission from the
 * document that asked for it.
 */
export function assertInert(binding, action) {
  if (!binding || binding.inert !== true || typeof binding.digest !== 'string') {
    throw new SourceEvidenceError(EVIDENCE_FAILURES.usage, 'binding must come from bindSource');
  }
  if (typeof action !== 'string' || action.trim() === '') {
    throw new SourceEvidenceError(EVIDENCE_FAILURES.usage, 'action must be a non-empty string');
  }
  const requested = action.trim().toLowerCase();
  if (EVIDENCE_ACTIONS.includes(requested)) {
    return { action: requested, permitted: true, digest: binding.digest };
  }
  throw new SourceEvidenceError(
    EVIDENCE_FAILURES.executionRefused,
    `${binding.reference} is evidence; "${requested}" is not one of ${EVIDENCE_ACTIONS.join(', ')}`,
  );
}
