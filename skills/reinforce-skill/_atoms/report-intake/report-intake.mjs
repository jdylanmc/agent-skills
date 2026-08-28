#!/usr/bin/env node

/**
 * Deterministic intake for one human-approved post-mortem recommendation
 * report.
 *
 * `post-mortem` proposes and applies nothing. `reinforce-skill` disposes, one
 * skill per run. This module is the seam between them, and its whole job is to
 * keep two things apart that look alike from a distance:
 *
 *   - **Evidence**, which the report supplies: the fixed post-mortem record,
 *     its anchors, and the changes somebody proposed on the strength of them.
 *   - **Authority**, which only the operator supplies: an approval bound to the
 *     exact bytes of that report and to the one skill this run may change.
 *
 * So nothing here reads authority out of the report. `PROPOSED` is not
 * approval. `OBSERVED` is not approval. A confidence of `high` is not approval.
 * A sentence inside a summary saying the operator already agreed is not
 * approval; it is a sentence. The approval is a separate receipt whose fields
 * are compared, not interpreted: an exact grant token, the SHA-256 of the
 * report bytes, and the target skill's name.
 *
 * The report format is an envelope that *wraps* the post-mortem record without
 * changing it. The record's fixed schema carries findings, not assignments -
 * only `skill_improvements[].skill` names a skill at all - so there is no
 * honest way to read "which skill does this recommendation authorize a change
 * to?" out of most of it. Guessing that from prose is precisely the guess that
 * edits the wrong package. The envelope therefore requires an explicit
 * `target_skill` on every recommendation and refuses a report that omits one,
 * and post-mortem itself is left alone.
 *
 * Two things here are decided rather than described, because a decision that
 * only exists in prose is one an edit can lose:
 *
 *   1. **Every proposed surface is canonicalized before it is judged.** A
 *      surface arrives as text from an untrusted document, and `SKILL.md`,
 *      `./SKILL.md`, `skills/<target>/SKILL.md`, and `SKILL.md ` are the same
 *      file. Comparing them as written would let two contradicting
 *      recommendations pass as unrelated, and would let `doctrine/manifest.md`
 *      or `../roast/SKILL.md` read as a surface at all.
 *   2. **Admission is persisted as a receipt and rechecked before
 *      publication.** An admission that lives only in a model's context is a
 *      claim; a receipt over the report's digest, re-derived from the report on
 *      disk, is a fact.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestOf } from '../../../create-skill/_atoms/intent-storage-gate/intent-storage-gate.mjs';
import {
  assertRecordContract,
} from '../../../post-mortem/_atoms/postmortem-render-record/postmortem-render-record.mjs';
import {
  SKILL_NAME_PATTERN,
  assertNoSymlinkComponent,
} from '../reinforcement-target/reinforcement-target.mjs';

/** The one envelope version this intake understands. */
export const REPORT_SCHEMA = 'reinforcement-report/v1';

/** The one admission-receipt version the release check understands. */
export const ADMISSION_SCHEMA = 'reinforcement-report-admission/v1';

/**
 * The exact value an approval must carry. A constant rather than a boolean:
 * `true`, `1`, `'yes'`, and any truthy object all read as approval under
 * truthiness, and each of them is a plausible accident. Only this string is.
 *
 * It is a fixed, public token by construction, which is why a receipt may
 * record it verbatim: there is exactly one accepted value, so the field can
 * never come to hold a secret.
 */
export const APPROVAL_GRANT = 'operator-approved-reinforcement-report';

export const REPORT_KEYS = ['schema', 'post_mortem_record', 'recommendations'];
export const RECOMMENDATION_KEYS = ['id', 'target_skill', 'source_ref', 'change', 'evidence', 'validation'];
export const APPROVAL_KEYS = ['grant', 'report_sha256', 'target_skill'];
export const CHANGE_KEYS = ['surface', 'directive', 'statement'];

export const ADMISSION_KEYS = [
  'schema',
  'status',
  'report_schema',
  'report_sha256',
  'target_skill',
  'approval',
  'applied_recommendation_ids',
  'excluded_recommendations',
  'evidence_anchors',
  'quarantined_untrusted_directives',
  'change_request_sha256',
];

/** What a proposed change may ask for. */
export const DIRECTIVES = ['add', 'revise', 'remove'];

/** The two sources a change may come from. Both produce one grounding shape. */
export const SOURCES = ['human-guidance', 'post-mortem-report'];

/**
 * Every outcome intake reports. `no-applicable-recommendations` is a real
 * outcome and not a quiet success: an approved report that proposes nothing for
 * this skill grounds nothing, so the run stops there rather than continuing to
 * an intent decision about a change nobody asked for.
 */
export const STATUSES = [
  'admitted',
  'no-applicable-recommendations',
  'admitted-unrecorded',
  'refused',
];

/**
 * Field names a report may never carry. A report that describes its own
 * approval is trying to be its own authority, and the fix is to refuse it
 * rather than to ignore the field and hope no later reader believes it.
 */
export const SELF_APPROVAL_KEYS = ['approval', 'approved', 'authorized', 'grant', 'human_approval'];

/**
 * The record sections a recommendation may point back into. Restricting the
 * grammar means a `source_ref` is resolved rather than evaluated, and a
 * reference to a section that carries no recommendations is a refusal instead
 * of a silent `undefined`.
 *
 * `promotion_recommendations.proposed_only` is deliberately absent. Its entries
 * are identifiers, not candidate objects, so "resolving" one would yield a
 * string with no `skill`, no `classification`, and nothing to cross-check a
 * recommendation against - an entry that could never be validated and could
 * only ever look validated. A recommendation cites the candidate itself.
 */
export const SOURCE_SECTIONS = [
  'skill_improvements',
  'candidate_skills',
  'candidate_lessons',
  'reinforcement_opportunities',
];

/** Candidate classifications the record itself has already discarded. */
const DROPPED_CLASSIFICATIONS = ['session_specific_no_reuse', 'duplicate_dropped'];

const SOURCE_REF = /^([a-z_]+)\[(\d+)\]$/;

/**
 * The evidence-anchor grammar, held compatible with post-mortem's own.
 *
 * post-mortem does not export its anchor check, and this issue's scope forbids
 * editing that package to make it do so. Restating the grammar is therefore the
 * only route, and a restatement that drifts is worse than none - it would admit
 * citations post-mortem would refuse. So the compatibility is not asserted in a
 * comment: the adversarial suite decides every case in a corpus twice, once
 * here and once by running post-mortem's contract over a record carrying the
 * same value, and requires the two verdicts to agree.
 */
export const ANCHOR_PATTERN = /^(?:[UATSRME]\d+(?:-\d+)?|L\d+:\d+(?:-\d+)?)$/;

/**
 * The one repository-relative root a run may keep its own state under.
 *
 * It is git-ignored, and the conformance suite pins that against `.gitignore`
 * rather than trusting this list - so adding a root here without ignoring it
 * first fails the build rather than quietly publishing a receipt. `.test-sandbox`
 * is deliberately absent: it is scratch space tests wipe between runs, and a
 * production run whose authority record lived there would be one `rm -rf` away
 * from unprovable. The ordinary case is a path outside the repository entirely,
 * which is the caller's own workspace and needs no entry at all.
 */
export const RUN_STATE_ROOTS = ['.skill-log'];

/** The largest guidance this intake will read from a file or standard input. */
export const MAX_GUIDANCE_BYTES = 64 * 1024;

/** The longest report-derived fragment any refusal message may quote. */
export const MAX_SNIPPET_LENGTH = 80;

/**
 * First path segments a proposed surface may never use. Each names a governance
 * boundary, and each is refused before any containment check runs, so a
 * recommendation cannot propose a change to doctrine or to another package by
 * spelling the path in a way a later comparison would forgive.
 */
const FORBIDDEN_SURFACE_ROOTS = ['skills', 'doctrine', '.github', '.git'];

export const REFUSALS = {
  missingReport: 'missing_report',
  ambiguousReport: 'ambiguous_report',
  unreadableReport: 'unreadable_report',
  malformedReport: 'malformed_report',
  malformedRecord: 'malformed_record',
  selfApprovingReport: 'self_approving_report',
  unapprovedReport: 'unapproved_report',
  malformedApproval: 'malformed_approval',
  digestMismatch: 'digest_mismatch',
  targetMismatch: 'target_mismatch',
  invalidTarget: 'invalid_target',
  targetlessRecommendation: 'targetless_recommendation',
  duplicateRecommendationId: 'duplicate_recommendation_id',
  unresolvedSource: 'unresolved_source',
  sourceTargetMismatch: 'source_target_mismatch',
  droppedSource: 'dropped_source',
  unanchoredEvidence: 'unanchored_evidence',
  malformedChange: 'malformed_change',
  malformedSurface: 'malformed_surface',
  unvalidatedRecommendation: 'unvalidated_recommendation',
  approvalNotRequired: 'approval_not_required',
  contradictoryRecommendations: 'contradictory_recommendations',
  statePathPublished: 'state_path_published',
  statePathSymlink: 'state_path_symlink',
  stateNotRecorded: 'state_not_recorded',
  oversizedGuidance: 'oversized_guidance',
  stateUnwritable: 'state_unwritable',
  stateMissing: 'state_missing',
  malformedState: 'malformed_state',
  stateRefused: 'state_refused',
  stateStale: 'state_stale',
  stateMismatch: 'state_mismatch',
};

export class IntakeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntakeError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Render a report-derived value for a refusal message.
 *
 * A refusal is read by a person and often pasted into a pull request, so a
 * value copied out of an untrusted document has to arrive bounded and on one
 * line. Otherwise the refusal itself becomes the delivery mechanism: a
 * multi-kilobyte "surface" reproduced verbatim, or a statement carrying a
 * newline and a plausible-looking instruction, lands in a reviewer's terminal
 * looking like output this run produced rather than input it rejected.
 *
 * Prefer a code or an index. Use this only where the value itself is the
 * information the reader needs.
 */
export function snippet(value) {
  if (value === undefined) {
    return 'nothing';
  }
  if (typeof value !== 'string') {
    return `a ${value === null ? 'null' : Array.isArray(value) ? 'list' : typeof value}`;
  }
  // JSON escaping does the flattening: a newline, a tab, a quote, and every
  // control character come back as printable escapes, so the result cannot
  // break out of one line however the report was written.
  const encoded = JSON.stringify(value)
    .slice(1, -1)
    .replace(/[\u007f-\u009f]/g, (character) => `\\x${character.charCodeAt(0).toString(16)}`);
  if (encoded.length <= MAX_SNIPPET_LENGTH) {
    return `"${encoded}"`;
  }
  // A cut can land mid-escape; dropping a dangling backslash keeps the snippet
  // readable rather than ending in a half-written escape.
  const cut = encoded.slice(0, MAX_SNIPPET_LENGTH).replace(/\\+$/, (run) => (run.length % 2 ? run.slice(0, -1) : run));
  return `"${cut}..."`;
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * Names Windows refuses as a file, with or without an extension. A surface that
 * cannot exist on one supported platform is a proposal nobody can apply there,
 * and it is better refused at intake than discovered by a contributor whose
 * checkout will not clone.
 */
const RESERVED_DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_unused, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_unused, index) => `lpt${index + 1}`),
]);

/**
 * The key two surfaces are compared by.
 *
 * File identity is not string identity. `SKILL.md`, `skill.md`, and `SKILL.MD`
 * are one file on the two case-insensitive filesystems this library is
 * developed on, and two Unicode spellings of one accented name are one file
 * everywhere. Comparing the spellings would let a removal and a revision of a
 * single file group as unrelated proposals, so comparison runs on this key
 * while the canonical spelling is what a human reads.
 *
 * The key is never written anywhere. It decides grouping and containment only.
 */
export function surfaceKey(canonicalSurface) {
  return canonicalSurface.normalize('NFC').toLowerCase();
}

/**
 * Canonicalize one proposed surface to a target-relative POSIX path, or refuse
 * it.
 *
 * A surface is text out of an untrusted document, so it is normalized before it
 * is compared to anything. Everything that is not a plain relative path inside
 * the target skill is refused rather than repaired: an absolute path, a Windows
 * drive path, a UNC share, a `file:` URL, a traversal, an NTFS alternate data
 * stream, a segment ending in a dot or a space, a reserved device name, and a
 * first segment naming a governance boundary. Each of those has a way of
 * reading as harmless in one place and resolving somewhere else in another,
 * which is exactly the class of difference a later comparison forgives.
 *
 * Returns the canonical spelling. Compare with `surfaceKey`.
 */
export function normalizeSurface(surface, { target } = {}) {
  const refuse = (message) => {
    throw new IntakeError(REFUSALS.malformedSurface, message);
  };
  if (typeof surface !== 'string' || surface.trim() === '') {
    refuse('a proposed change names a surface');
  }
  // Whitespace wrapping the whole value is field formatting and is dropped; a
  // segment that *itself* ends in whitespace or a dot is not, and is refused
  // below. The distinction matters because Windows silently strips a trailing
  // dot or space from a name while POSIX keeps it, so `_atoms /x.md` is two
  // different files depending on where it is applied - while `  SKILL.md  ` is
  // one file, sloppily quoted.
  const trimmed = surface.trim();
  if (/[\u0000-\u001f]/.test(trimmed)) {
    refuse('a surface may not contain a control character');
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    refuse(`a surface is a path inside the target skill, never a URL: ${snippet(trimmed)}`);
  }
  if (/^[A-Za-z]:[\\/]?/.test(trimmed)) {
    refuse(`a surface is never a drive-rooted path: ${snippet(trimmed)}`);
  }

  const slashed = trimmed.replace(/\\/g, '/');
  if (slashed.startsWith('//')) {
    refuse(`a surface is never a network share: ${snippet(trimmed)}`);
  }
  if (slashed.startsWith('/')) {
    refuse(`a surface is target-relative, never absolute: ${snippet(trimmed)}`);
  }
  if (slashed.endsWith('/')) {
    refuse(`a surface names a file, not a directory: ${snippet(trimmed)}`);
  }

  const segments = [];
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      refuse(`a surface may not traverse out of the target skill: ${snippet(trimmed)}`);
    }
    if (segment.includes(':')) {
      refuse(`a surface may not name an alternate data stream: ${snippet(trimmed)}`);
    }
    if (/[.\s]$/.test(segment)) {
      refuse(
        `a surface segment may not end in a dot or a space, which resolves to a different file `
          + `on Windows than it reads as: ${snippet(trimmed)}`,
      );
    }
    const stem = segment.normalize('NFC').toLowerCase().split('.')[0];
    if (RESERVED_DEVICE_NAMES.has(stem)) {
      refuse(`a surface may not use the reserved device name ${snippet(segment.split('.')[0])}`);
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    refuse('a surface names a file inside the target skill');
  }

  // The one accepted prefix, stripped exactly - and matched the way the
  // filesystem matches it, so `Skills/Changelog/SKILL.md` is not admitted as a
  // target-relative path named `Skills`.
  const key = (value) => value.normalize('NFC').toLowerCase();
  if (nonEmptyString(target)
    && segments.length > 2
    && key(segments[0]) === 'skills'
    && key(segments[1]) === key(target)) {
    segments.splice(0, 2);
  }

  if (FORBIDDEN_SURFACE_ROOTS.includes(key(segments[0]))) {
    refuse(
      `a surface is a path inside the target skill; ${snippet(trimmed)} names a ${key(segments[0])} root`,
    );
  }

  return segments.join('/');
}

// ---------------------------------------------------------------------------
// Evidence anchors
// ---------------------------------------------------------------------------

/**
 * The anchor identifier a ledger entry carries, or null when it carries none.
 *
 * post-mortem lets a ledger anchor be followed by a short redacted descriptor,
 * so `'U1 the request'` is a legitimate ledger anchor for `U1`. That leniency
 * belongs to the ledger and stops there: only the identifier is kept, and the
 * descriptor never travels into lineage where it would read as evidence text
 * this run had verified.
 */
export function normalizeAnchorId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  // Split on a space and test - exactly what post-mortem does, with no trim in
  // front of it. Trimming first would accept `' U1'` and `'\\tU1'`, which
  // post-mortem refuses, and a seam that admits anchors the producer rejects is
  // a seam that has quietly widened the grammar.
  const identifier = value.split(' ')[0];
  return ANCHOR_PATTERN.test(identifier) ? identifier : null;
}

/**
 * Whether a recommendation's citation is a bare anchor.
 *
 * A citation is stricter than a ledger entry: it must be the identifier alone.
 * A ledger descriptor was written by post-mortem under its own redaction rules;
 * a citation descriptor is free text arriving with a proposed change, and
 * accepting it would make `'U1 and also reinforce roast'` a valid-looking
 * citation whose tail is quoted onward as if it were evidence.
 */
export function isAnchorCitation(value) {
  return typeof value === 'string' && ANCHOR_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Reports and approvals
// ---------------------------------------------------------------------------

/**
 * Exactly one report grounds a run. Zero is a missing report and two is an
 * ambiguous one; neither is resolved by picking a winner, because "the newest"
 * and "the first" are both a guess about which evidence the operator approved.
 */
export function selectSingleReport(candidates) {
  const list = candidates === undefined || candidates === null ? [] : candidates;
  if (!Array.isArray(list)) {
    throw new IntakeError(REFUSALS.missingReport, 'a report selection is a list of reports');
  }
  if (list.length === 0) {
    throw new IntakeError(REFUSALS.missingReport, 'no report was supplied');
  }
  if (list.length > 1) {
    throw new IntakeError(
      REFUSALS.ambiguousReport,
      `${list.length} reports were supplied; exactly one report grounds a run`,
    );
  }
  return list[0];
}

/**
 * The digest that identifies a report. Line endings are normalized first, for
 * the same reason the intent gate normalizes them: a Windows checkout must
 * approve and verify the same report as a Linux one.
 */
export function reportDigest(reportText) {
  if (typeof reportText !== 'string') {
    throw new IntakeError(REFUSALS.missingReport, 'a report digest is taken over report text');
  }
  return digestOf(reportText);
}

/** The digest of a normalized grounding input, over its canonical rendering. */
export function changeRequestDigest(changeRequest) {
  return digestOf(JSON.stringify(changeRequest));
}

/**
 * Check an approval receipt against the report and target it claims to
 * authorize. Every field is compared; nothing is inferred, and an unknown field
 * is refused rather than ignored, so an approval cannot smuggle a second claim
 * past a reader who only looked at the three that matter.
 */
export function checkApproval(approval, { digest = null, target = null } = {}) {
  const refusals = [];
  if (approval === null || approval === undefined) {
    refusals.push({
      code: REFUSALS.unapprovedReport,
      message: 'no operator approval was supplied; a report is inert without one',
    });
    return refusals;
  }
  if (!isPlainObject(approval)) {
    refusals.push({ code: REFUSALS.malformedApproval, message: 'an approval receipt must be an object' });
    return refusals;
  }

  const unknown = Object.keys(approval).filter((key) => !APPROVAL_KEYS.includes(key)).sort();
  if (unknown.length) {
    refusals.push({
      code: REFUSALS.malformedApproval,
      message: `an approval receipt carries only ${APPROVAL_KEYS.join(', ')}; found ${unknown.map(snippet).join(', ')}`,
    });
  }

  if (approval.grant !== APPROVAL_GRANT) {
    refusals.push({
      code: REFUSALS.unapprovedReport,
      message: `the grant must be exactly ${JSON.stringify(APPROVAL_GRANT)}; found ${snippet(approval.grant ?? null)}`,
    });
  }

  if (!nonEmptyString(approval.report_sha256)) {
    refusals.push({
      code: REFUSALS.malformedApproval,
      message: 'an approval receipt names the SHA-256 of the report it approved',
    });
  } else if (digest !== null && approval.report_sha256 !== digest) {
    refusals.push({
      code: REFUSALS.digestMismatch,
      message: `the approval names report ${approval.report_sha256}, but the supplied report is ${digest}`,
    });
  }

  if (!nonEmptyString(approval.target_skill)) {
    refusals.push({
      code: REFUSALS.malformedApproval,
      message: 'an approval receipt names the one skill it authorizes a change to',
    });
  } else if (target !== null && approval.target_skill !== target) {
    refusals.push({
      code: REFUSALS.targetMismatch,
      message: `the approval authorizes ${approval.target_skill}, but this run reinforces ${target}`,
    });
  }

  return refusals;
}

function resolveSource(record, sourceRef) {
  const match = SOURCE_REF.exec(typeof sourceRef === 'string' ? sourceRef : '');
  if (!match || !SOURCE_SECTIONS.includes(match[1])) {
    return { entry: null, section: null };
  }
  const section = match[1];
  const index = Number(match[2]);
  const container = record?.[section];
  if (!Array.isArray(container) || index >= container.length || !isPlainObject(container[index])) {
    return { entry: null, section };
  }
  return { entry: container[index], section };
}

/**
 * Validate one recommendation and, when it is sound, return its normalized
 * form. Every refusal is collected rather than thrown, because a reviewer
 * reading a refused report should see the whole state of it at once.
 */
function checkRecommendation(recommendation, context) {
  const { record, anchors, validations, index, target } = context;
  const refusals = [];
  // A stable positional label, never the report's own id. An id is untrusted
  // text like everything else in the document, and a refusal that adopts it as
  // its subject lets the report choose how the refusal reads.
  const label = `recommendations[${index}]`;

  if (!isPlainObject(recommendation)) {
    refusals.push({ code: REFUSALS.malformedReport, message: `${label} must be an object` });
    return { refusals, normalized: null };
  }

  const keys = Object.keys(recommendation);
  const selfApproving = keys.filter((key) => SELF_APPROVAL_KEYS.includes(key)).sort();
  if (selfApproving.length) {
    refusals.push({
      code: REFUSALS.selfApprovingReport,
      message: `${label} carries ${selfApproving.map(snippet).join(', ')}; a report never approves itself`,
    });
  }
  const unknown = keys
    .filter((key) => !RECOMMENDATION_KEYS.includes(key) && !SELF_APPROVAL_KEYS.includes(key))
    .sort();
  if (unknown.length) {
    refusals.push({
      code: REFUSALS.malformedReport,
      message: `${label} carries unknown field(s): ${unknown.map(snippet).join(', ')}`,
    });
  }
  const missing = RECOMMENDATION_KEYS.filter((key) => !keys.includes(key));
  if (missing.length) {
    refusals.push({ code: REFUSALS.malformedReport, message: `${label} omits ${missing.join(', ')}` });
  }

  if (!nonEmptyString(recommendation.id)) {
    refusals.push({ code: REFUSALS.malformedReport, message: `${label} must carry a non-empty id` });
  }

  // The load-bearing field. A recommendation that names no skill is refused
  // rather than attributed to the skill in hand: the record's fixed schema
  // gives no honest way to derive a target from prose, and the wrong guess
  // edits the wrong package.
  if (!nonEmptyString(recommendation.target_skill)
    || !SKILL_NAME_PATTERN.test(recommendation.target_skill)) {
    refusals.push({
      code: REFUSALS.targetlessRecommendation,
      message: `${label} names no explicit routable target_skill; an implied target is never inferred from prose`,
    });
  }

  const { entry, section } = resolveSource(record, recommendation.source_ref);
  if (entry === null) {
    refusals.push({
      code: REFUSALS.unresolvedSource,
      message: `${label} cites ${snippet(recommendation.source_ref ?? null)}, which resolves to nothing in the record`,
    });
  } else {
    // `skill_improvements[].skill` is the one place the fixed record names a
    // skill. Where it does, the envelope may not disagree with it.
    if (nonEmptyString(entry.skill)
      && nonEmptyString(recommendation.target_skill)
      && entry.skill !== recommendation.target_skill) {
      refusals.push({
        code: REFUSALS.sourceTargetMismatch,
        message: `${label} targets ${snippet(recommendation.target_skill)} but cites evidence the record recorded against ${snippet(entry.skill)}`,
      });
    }
    if (section === 'candidate_skills' && DROPPED_CLASSIFICATIONS.includes(entry.classification)) {
      refusals.push({
        code: REFUSALS.droppedSource,
        message: `${label} cites a candidate the record classified ${snippet(entry.classification)}; the report contradicts itself`,
      });
    }
  }

  let citations = [];
  if (!Array.isArray(recommendation.evidence) || recommendation.evidence.length === 0) {
    refusals.push({
      code: REFUSALS.unanchoredEvidence,
      message: `${label} must cite at least one evidence anchor from the record`,
    });
  } else {
    const malformed = recommendation.evidence.filter((anchor) => !isAnchorCitation(anchor));
    if (malformed.length) {
      refusals.push({
        code: REFUSALS.unanchoredEvidence,
        message: `${label} cites ${malformed.map((anchor) => snippet(anchor)).join(', ')}; `
          + 'a citation is an anchor identifier alone, never an identifier followed by prose',
      });
    }
    const dangling = recommendation.evidence
      .filter((anchor) => isAnchorCitation(anchor) && !anchors.has(anchor));
    if (dangling.length) {
      refusals.push({
        code: REFUSALS.unanchoredEvidence,
        message: `${label} cites ${dangling.map(snippet).join(', ')}, which the evidence ledger does not carry`,
      });
    }
    citations = [...new Set(recommendation.evidence.filter((anchor) => isAnchorCitation(anchor)))];
  }

  const change = recommendation.change;
  let surface = null;
  if (!isPlainObject(change)) {
    refusals.push({
      code: REFUSALS.malformedChange,
      message: `${label} must propose a change naming a surface, a statement, and a directive of ${DIRECTIVES.join(', ')}`,
    });
  } else {
    const unknownChange = Object.keys(change).filter((key) => !CHANGE_KEYS.includes(key)).sort();
    if (unknownChange.length) {
      refusals.push({
        code: REFUSALS.malformedChange,
        message: `${label} proposes a change with unknown field(s): ${unknownChange.map(snippet).join(', ')}`,
      });
    }
    if (!DIRECTIVES.includes(change.directive)) {
      refusals.push({
        code: REFUSALS.malformedChange,
        message: `${label} proposes ${snippet(change.directive ?? null)}; a directive is one of ${DIRECTIVES.join(', ')}`,
      });
    }
    if (!nonEmptyString(change.statement)) {
      refusals.push({
        code: REFUSALS.malformedChange,
        message: `${label} must say what the change is`,
      });
    }
    try {
      surface = normalizeSurface(change.surface, {
        target: nonEmptyString(recommendation.target_skill) ? recommendation.target_skill : null,
      });
    } catch (error) {
      refusals.push({ code: error.code, message: `${label}: ${error.message}` });
    }
  }

  if (!nonEmptyString(recommendation.validation)) {
    refusals.push({
      code: REFUSALS.unvalidatedRecommendation,
      message: `${label} must name the validation requirement that governs it`,
    });
  } else if (!validations.has(recommendation.validation)) {
    refusals.push({
      code: REFUSALS.unvalidatedRecommendation,
      message: `${label} names validation requirement ${snippet(recommendation.validation)}, which the record does not carry`,
    });
  } else if (validations.get(recommendation.validation).human_approval_required !== true) {
    // Defence in depth. post-mortem's own record contract already requires
    // human approval on every validation requirement, so a record that reaches
    // this line with the flag relaxed has already been refused as malformed.
    // The check stays because the two rules are owned by different packages: if
    // that contract is ever relaxed, this seam must not start admitting
    // recommendations whose validation nobody has to sign off on.
    refusals.push({
      code: REFUSALS.approvalNotRequired,
      message: `${label} rests on a validation requirement that does not require human approval`,
    });
  }

  if (refusals.length) {
    return { refusals, normalized: null };
  }

  return {
    refusals,
    normalized: {
      id: recommendation.id,
      target_skill: recommendation.target_skill,
      source_ref: recommendation.source_ref,
      surface,
      directive: change.directive,
      statement: change.statement,
      evidence: citations,
      validation: recommendation.validation,
      applicable: recommendation.target_skill === target,
    },
  };
}

/**
 * Reconcile the applicable recommendations, or refuse the pair that cannot be
 * reconciled.
 *
 * Two recommendations naming one canonical surface are either the same proposal
 * written twice - identical directive, identical statement - or they are two
 * different proposals about one file. The first deduplicates. The second
 * refuses.
 *
 * Refusing the second is the deliberate part. It is tempting to let two
 * revisions of `SKILL.md` "both apply", but nothing here can tell whether they
 * compose, overlap, or contradict: "tighten the output contract" and "drop the
 * output contract" are both revisions of one file, and deciding they are
 * compatible means guessing at English. Guessing produces a change nobody
 * proposed. So the ambiguity goes back to the operator, who can approve a
 * report that says one thing per file.
 *
 * Grouping runs on `surfaceKey`, so a contradiction spelled `SKILL.md` and
 * `skills/<target>/skill.md` is still one contradiction.
 */
export function reconcileApplicable(applicable) {
  const groups = new Map();
  for (const recommendation of applicable) {
    const key = surfaceKey(recommendation.surface);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(recommendation);
  }

  const refusals = [];
  const changes = [];
  for (const group of groups.values()) {
    const distinct = new Map();
    for (const entry of group) {
      distinct.set(`${entry.directive}\u0000${entry.statement}`, entry);
    }
    if (distinct.size > 1) {
      refusals.push({
        code: REFUSALS.contradictoryRecommendations,
        message: `${group.map((entry) => snippet(entry.id)).join(', ')} propose ${distinct.size} different `
          + `changes to ${snippet(group[0].surface)}; one file takes one proposal, and which of them was `
          + 'meant is the operator\'s decision, not this run\'s guess',
      });
      continue;
    }
    const [representative] = group;
    changes.push({
      ids: group.map((entry) => entry.id),
      surface: representative.surface,
      directive: representative.directive,
      statement: representative.statement,
      evidence: [...new Set(group.flatMap((entry) => entry.evidence))],
      source_refs: group.map((entry) => entry.source_ref),
    });
  }

  return { refusals, changes };
}

// ---------------------------------------------------------------------------
// Grounding
// ---------------------------------------------------------------------------

/**
 * The one shape the reinforcement workflow grounds on, whichever source the
 * change came from. A report earns no second workflow; it earns a filled-in
 * version of the same input the operator's own words produce.
 *
 * `untrusted: true` is not decoration. Every statement below is quoted from a
 * document this run did not write, and the flag is what a reader downstream
 * sees before deciding how much a sentence is allowed to mean.
 */
export function groundingFromReport({
  target,
  applicable = [],
  changes = [],
  validationRequirements = [],
  reportSha256 = null,
} = {}) {
  const seen = new Set();
  const validation = [];
  for (const requirement of validationRequirements) {
    if (!isPlainObject(requirement) || seen.has(requirement.candidate)) {
      continue;
    }
    seen.add(requirement.candidate);
    validation.push(requirement);
  }

  return {
    source: 'post-mortem-report',
    target,
    untrusted: true,
    report_sha256: reportSha256,
    recommendation_ids: applicable.map((entry) => entry.id),
    evidence_anchors: [...new Set(applicable.flatMap((entry) => entry.evidence))],
    changes,
    validation,
  };
}

/**
 * The human-guidance path, unchanged in substance: the operator's words go in
 * as the operator wrote them. It exists so the workflow below has one input
 * shape rather than two, and it requires no report, no approval receipt, no
 * admission state, and no synthetic post-mortem record.
 */
export function groundingFromGuidance({ target, guidance } = {}) {
  if (!nonEmptyString(target) || !SKILL_NAME_PATTERN.test(target)) {
    throw new IntakeError(
      REFUSALS.invalidTarget,
      `a run reinforces one routable skill; ${snippet(target ?? null)} is not one`,
    );
  }
  if (!nonEmptyString(guidance)) {
    throw new IntakeError(
      REFUSALS.missingReport,
      "human guidance is the operator's own words, and there are none here",
    );
  }
  return {
    source: 'human-guidance',
    target,
    untrusted: true,
    report_sha256: null,
    recommendation_ids: [],
    evidence_anchors: [],
    changes: [{
      ids: ['guidance'],
      surface: null,
      directive: 'revise',
      statement: guidance,
      evidence: [],
      source_refs: [],
    }],
    validation: [],
  };
}

/** The result a grounded human-guidance run reports, in the one shared shape. */
export function admitGuidance({ target = null, guidance = null } = {}) {
  try {
    const changeRequest = groundingFromGuidance({ target, guidance });
    return {
      status: 'admitted',
      source: 'human-guidance',
      refusals: [],
      report: null,
      target,
      applicable: [],
      excluded: [],
      lineage: null,
      change_request: changeRequest,
    };
  } catch (error) {
    return {
      status: 'refused',
      source: 'human-guidance',
      refusals: [{ code: error.code, message: error.message }],
      report: null,
      target: null,
      applicable: [],
      excluded: [],
      lineage: null,
      change_request: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

/**
 * Admit one approved report for one target skill, or refuse it and say every
 * reason at once.
 *
 * A refusal reports no applicable and no excluded recommendations. That is
 * deliberate rather than an omission: excluding a recommendation is a selection
 * decision, and a report that was never admitted supplied no trustworthy basis
 * for one. Reporting "these two were excluded" out of a refused report would
 * assert a reading of a document this run just declined to trust.
 */
export function admitReport({
  report = undefined,
  reports = undefined,
  approval = null,
  target = null,
} = {}) {
  const refusals = [];

  let reportText = null;
  if (report !== undefined && reports !== undefined) {
    refusals.push({
      code: REFUSALS.ambiguousReport,
      message: 'a run grounds on one report; both a single report and a report list were supplied',
    });
  } else {
    const candidates = reports === undefined
      ? (report === undefined || report === null ? [] : [report])
      : reports;
    try {
      reportText = selectSingleReport(candidates);
    } catch (error) {
      refusals.push({ code: error.code, message: error.message });
    }
  }
  if (reportText !== null && typeof reportText !== 'string') {
    refusals.push({ code: REFUSALS.missingReport, message: 'a report is supplied as text' });
    reportText = null;
  }
  if (reportText !== null && reportText.trim() === '') {
    refusals.push({ code: REFUSALS.missingReport, message: 'the supplied report is empty' });
    reportText = null;
  }

  const digest = reportText === null ? null : reportDigest(reportText);

  const resolvedTarget = nonEmptyString(target) && SKILL_NAME_PATTERN.test(target) ? target : null;
  if (resolvedTarget === null) {
    refusals.push({
      code: REFUSALS.invalidTarget,
      message: `a run reinforces one routable skill; ${snippet(target ?? null)} is not one`,
    });
  }

  refusals.push(...checkApproval(approval, { digest, target: resolvedTarget }));

  let envelope = null;
  if (reportText !== null) {
    try {
      envelope = JSON.parse(reportText);
    } catch (error) {
      refusals.push({
        code: REFUSALS.malformedReport,
        message: `the report is not readable as a reinforcement report: ${error.message}`,
      });
    }
  }
  if (envelope !== null && !isPlainObject(envelope)) {
    refusals.push({ code: REFUSALS.malformedReport, message: 'a reinforcement report is an object' });
    envelope = null;
  }

  const applicable = [];
  const excluded = [];
  let record = null;
  let quarantined = [];

  if (envelope !== null) {
    const keys = Object.keys(envelope);
    const selfApproving = keys.filter((key) => SELF_APPROVAL_KEYS.includes(key)).sort();
    if (selfApproving.length) {
      refusals.push({
        code: REFUSALS.selfApprovingReport,
        message: `the report carries ${selfApproving.map(snippet).join(', ')}; authority comes from the operator's receipt, never from the report`,
      });
    }
    const unknown = keys
      .filter((key) => !REPORT_KEYS.includes(key) && !SELF_APPROVAL_KEYS.includes(key))
      .sort();
    if (unknown.length) {
      refusals.push({
        code: REFUSALS.malformedReport,
        message: `the report carries unknown field(s): ${unknown.map(snippet).join(', ')}`,
      });
    }
    const missing = REPORT_KEYS.filter((key) => !keys.includes(key));
    if (missing.length) {
      refusals.push({ code: REFUSALS.malformedReport, message: `the report omits ${missing.join(', ')}` });
    }
    if (envelope.schema !== REPORT_SCHEMA) {
      refusals.push({
        code: REFUSALS.malformedReport,
        message: `the report declares schema ${snippet(envelope.schema ?? null)}; this intake reads ${REPORT_SCHEMA}`,
      });
    }

    // The wrapped record is checked against post-mortem's own contract rather
    // than against a restatement of it, so the two cannot drift apart.
    const recordProblems = assertRecordContract(envelope.post_mortem_record);
    if (recordProblems.length) {
      refusals.push({
        code: REFUSALS.malformedRecord,
        message: `the wrapped post-mortem record breaks its contract: ${recordProblems.join('; ')}`,
      });
    } else {
      record = envelope.post_mortem_record;
      quarantined = (record.promotion_recommendations.quarantined_untrusted_directives ?? [])
        .map((anchor) => normalizeAnchorId(anchor))
        .filter((anchor) => anchor !== null);
    }

    if (!Array.isArray(envelope.recommendations)) {
      refusals.push({
        code: REFUSALS.malformedReport,
        message: 'recommendations must be a list; a report proposing none carries an empty list',
      });
    } else if (record !== null) {
      const anchors = new Set(
        (Array.isArray(record.evidence_ledger) ? record.evidence_ledger : [])
          .map((entry) => normalizeAnchorId(entry?.anchor))
          .filter((anchor) => anchor !== null),
      );
      const validations = new Map(
        (Array.isArray(record.validation_requirements) ? record.validation_requirements : [])
          .filter((entry) => isPlainObject(entry) && nonEmptyString(entry.candidate))
          .map((entry) => [entry.candidate, entry]),
      );
      const seen = new Set();
      envelope.recommendations.forEach((recommendation, index) => {
        const checked = checkRecommendation(recommendation, {
          record,
          anchors,
          validations,
          index,
          target: resolvedTarget,
        });
        refusals.push(...checked.refusals);
        const id = isPlainObject(recommendation) ? recommendation.id : undefined;
        if (nonEmptyString(id)) {
          if (seen.has(id)) {
            refusals.push({
              code: REFUSALS.duplicateRecommendationId,
              message: `recommendations[${index}] repeats the id ${snippet(id)}`,
            });
          }
          seen.add(id);
        }
        if (checked.normalized === null) {
          return;
        }
        if (checked.normalized.applicable) {
          applicable.push(checked.normalized);
        } else {
          excluded.push({
            id: checked.normalized.id,
            target_skill: checked.normalized.target_skill,
            reason: 'targets-another-skill',
          });
        }
      });

    }
  }

  const reconciled = refusals.length ? { refusals: [], changes: [] } : reconcileApplicable(applicable);
  refusals.push(...reconciled.refusals);

  if (refusals.length) {
    return {
      status: 'refused',
      source: 'post-mortem-report',
      refusals,
      // A refused report validated nothing, so it declares nothing either: the
      // schema it *claimed* is as untrustworthy as the rest of it.
      report: { sha256: digest, schema: null },
      target: resolvedTarget,
      applicable: [],
      excluded: [],
      lineage: null,
      change_request: null,
    };
  }

  const validationRequirements = applicable.map((entry) => record.validation_requirements
    .find((requirement) => requirement.candidate === entry.validation));
  const changeRequest = groundingFromReport({
    target: resolvedTarget,
    applicable,
    changes: reconciled.changes,
    validationRequirements,
    reportSha256: digest,
  });

  // An approved report that proposes nothing for this skill is a real outcome
  // and not a quiet success. There is no change to ground, so the run stops
  // here rather than carrying an empty request into an intent decision about a
  // change nobody proposed. The exclusions are still reported, because they are
  // what the operator will want to look at next.
  if (applicable.length === 0) {
    return {
      status: 'no-applicable-recommendations',
      source: 'post-mortem-report',
      refusals: [],
      report: { sha256: digest, schema: envelope.schema },
      target: resolvedTarget,
      applicable: [],
      excluded,
      lineage: {
        report_sha256: digest,
        schema: envelope.schema,
        target_skill: resolvedTarget,
        approval_receipt: {
          grant: approval.grant,
          report_sha256: approval.report_sha256,
          target_skill: approval.target_skill,
        },
        applied_recommendation_ids: [],
        excluded_recommendations: excluded,
        evidence_anchors: [],
        quarantined_untrusted_directives: quarantined,
        change_request_sha256: null,
      },
      change_request: null,
    };
  }

  return {
    status: 'admitted',
    source: 'post-mortem-report',
    refusals: [],
    report: { sha256: digest, schema: envelope.schema },
    target: resolvedTarget,
    applicable,
    excluded,
    lineage: {
      report_sha256: digest,
      schema: envelope.schema,
      target_skill: resolvedTarget,
      approval_receipt: {
        grant: approval.grant,
        report_sha256: approval.report_sha256,
        target_skill: approval.target_skill,
      },
      applied_recommendation_ids: applicable.map((entry) => entry.id),
      excluded_recommendations: excluded,
      evidence_anchors: changeRequest.evidence_anchors,
      quarantined_untrusted_directives: quarantined,
      change_request_sha256: changeRequestDigest(changeRequest),
    },
    change_request: changeRequest,
  };
}

// ---------------------------------------------------------------------------
// Admission state
// ---------------------------------------------------------------------------

/**
 * Where a run may keep its admission receipt.
 *
 * The receipt is run state, not part of any package, so it never lands inside
 * the skill being reinforced - which would make it a file the diff audit has to
 * explain - and never anywhere the repository publishes. A path inside the
 * repository is accepted only under a git-ignored run-state root; a path
 * outside the repository is the caller's own workspace and is accepted as such.
 */
export function assertStatePath(statePath, { repositoryRoot = null } = {}) {
  // No refusal below quotes the path. A state path is caller-supplied and often
  // absolute, and a refusal that echoes it back turns a boundary message into a
  // disclosure of somebody's home directory in a pull request.
  if (!nonEmptyString(statePath)) {
    throw new IntakeError(REFUSALS.statePathPublished, 'an admission state path is required');
  }
  if (!path.isAbsolute(statePath)) {
    throw new IntakeError(
      REFUSALS.statePathPublished,
      'an admission state path is absolute; the supplied one is relative',
    );
  }
  if (statePath.split(/[\\/]/).includes('..')) {
    throw new IntakeError(REFUSALS.statePathPublished, 'an admission state path may not traverse');
  }
  if (!nonEmptyString(repositoryRoot)) {
    throw new IntakeError(
      REFUSALS.statePathPublished,
      'a repository root is required to prove an admission state path is unpublished',
    );
  }

  const lexical = path.resolve(statePath);
  let realRoot;
  try {
    realRoot = fs.realpathSync(repositoryRoot);
  } catch (error) {
    throw new IntakeError(REFUSALS.statePathPublished, `unreadable repository root: ${error.code}`);
  }

  // Containment is judged on the *real* location, not the spelling. The deepest
  // existing ancestor is resolved through every link, and the not-yet-existing
  // tail is rejoined to it, so a link planted anywhere in the prefix - inside
  // the repository or outside it - moves the answer rather than being ignored.
  const segments = [];
  let ancestor = lexical;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      throw new IntakeError(REFUSALS.statePathPublished, 'an admission state path has no existing ancestor');
    }
    segments.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  let realAncestor;
  try {
    realAncestor = fs.realpathSync(ancestor);
  } catch (error) {
    throw new IntakeError(REFUSALS.statePathPublished, `unreadable admission state path: ${error.code}`);
  }
  const real = path.join(realAncestor, ...segments);

  const lexicalRelative = path.relative(realRoot, lexical);
  const lexicallyInside = lexicalRelative !== ''
    && !lexicalRelative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(lexicalRelative);
  if (lexicallyInside) {
    // The same guard the write-boundary check uses, not a second copy of it:
    // one definition of "no component of this path is a link".
    try {
      assertNoSymlinkComponent(realRoot, lexical);
    } catch {
      throw new IntakeError(
        REFUSALS.statePathSymlink,
        'a component of the admission state path is a symbolic link, so where it writes is not where it reads',
      );
    }
  }

  const relative = path.relative(realRoot, real);
  const inside = relative !== ''
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
  if (!inside) {
    if (lexicallyInside) {
      throw new IntakeError(
        REFUSALS.statePathSymlink,
        'the admission state path resolves outside the repository it appears to be inside',
      );
    }
    return { location: 'caller-owned', real };
  }

  const [first] = relative.split(path.sep);
  if (!RUN_STATE_ROOTS.includes(first)) {
    throw new IntakeError(
      REFUSALS.statePathPublished,
      `an admission receipt is run state and is never published; it belongs under `
        + `${RUN_STATE_ROOTS.join(', ')} or outside the repository, not under ${first}/`,
    );
  }
  return { location: 'run-owned', real };
}

/** The bounded receipt an admitted report leaves behind. */
export function buildAdmissionReceipt(result) {
  if (result?.source !== 'post-mortem-report'
    || !['admitted', 'no-applicable-recommendations'].includes(result.status)) {
    throw new IntakeError(
      REFUSALS.stateRefused,
      'only a report that reached intake intact produces an admission receipt',
    );
  }
  const { lineage } = result;
  return {
    schema: ADMISSION_SCHEMA,
    status: result.status,
    report_schema: lineage.schema,
    report_sha256: lineage.report_sha256,
    target_skill: lineage.target_skill,
    approval: { ...lineage.approval_receipt },
    applied_recommendation_ids: [...lineage.applied_recommendation_ids],
    excluded_recommendations: lineage.excluded_recommendations.map((entry) => ({ ...entry })),
    evidence_anchors: [...lineage.evidence_anchors],
    quarantined_untrusted_directives: [...lineage.quarantined_untrusted_directives],
    change_request_sha256: lineage.change_request_sha256,
  };
}

/** The receipt a refusal leaves behind, so no stale admission survives it. */
export function buildRefusalReceipt(result) {
  return {
    schema: ADMISSION_SCHEMA,
    status: result?.status === 'admitted-unrecorded' ? 'admitted-unrecorded' : 'refused',
    // A refused report validated nothing, so the receipt claims nothing about
    // its schema either. Recording the schema it declared would be recording a
    // claim from a document this run just refused to trust.
    report_schema: null,
    report_sha256: result?.report?.sha256 ?? null,
    target_skill: result?.target ?? null,
    approval: null,
    applied_recommendation_ids: [],
    excluded_recommendations: [],
    evidence_anchors: [],
    quarantined_untrusted_directives: [],
    change_request_sha256: null,
  };
}

/**
 * Write a receipt atomically.
 *
 * A half-written receipt is worse than none: a release check reading it would
 * report a malformed state where the truth is an interrupted write. The
 * temporary file lives beside the destination so the rename stays on one
 * filesystem and is therefore atomic.
 */
export function writeAdmissionState(statePath, receipt, { repositoryRoot = null } = {}) {
  const { real } = assertStatePath(statePath, { repositoryRoot });
  const directory = path.dirname(real);
  const temporary = path.join(directory, `.${path.basename(real)}.${crypto.randomUUID()}.part`);
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
    fs.renameSync(temporary, real);
  } catch (error) {
    throw new IntakeError(REFUSALS.stateUnwritable, `the admission receipt could not be written: ${error.code}`);
  } finally {
    // A failed rename leaves the part file behind, and a directory slowly
    // filling with half-receipts is the kind of litter nobody attributes to the
    // run that made it.
    fs.rmSync(temporary, { force: true });
  }
  return real;
}

/**
 * The publication precondition for a report-grounded run: prove, from the
 * report on disk and the receipt this run wrote, that the admission still
 * holds.
 *
 * It re-admits rather than reading a label. The receipt carries the approval it
 * was admitted under, so the whole decision is recomputed and compared: the
 * digest, the target, which recommendations applied, and the digest of the
 * grounding those recommendations produced. A receipt that merely *says*
 * `admitted` over a report that has since changed is refused on the arithmetic,
 * not on trust.
 */
export function requireAdmittedState({ state = null, report = null, target = null } = {}) {
  const reasons = [];
  const blocked = () => ({ requirement: 'blocked', reasons });

  if (state === null || state === undefined) {
    reasons.push({ code: REFUSALS.stateMissing, message: 'no admission receipt was recorded for this run' });
    return blocked();
  }
  if (!isPlainObject(state)) {
    reasons.push({ code: REFUSALS.malformedState, message: 'an admission receipt must be an object' });
    return blocked();
  }
  if (state.schema !== ADMISSION_SCHEMA) {
    reasons.push({
      code: REFUSALS.malformedState,
      message: `the receipt declares schema ${snippet(state.schema ?? null)}; this check reads ${ADMISSION_SCHEMA}`,
    });
  }
  const unknown = Object.keys(state).filter((key) => !ADMISSION_KEYS.includes(key)).sort();
  const missing = ADMISSION_KEYS.filter((key) => !Object.keys(state).includes(key));
  if (unknown.length) {
    reasons.push({ code: REFUSALS.malformedState, message: `the receipt carries unknown field(s): ${unknown.map(snippet).join(', ')}` });
  }
  if (missing.length) {
    reasons.push({ code: REFUSALS.malformedState, message: `the receipt omits ${missing.join(', ')}` });
  }
  if (reasons.length) {
    return blocked();
  }

  if (state.status !== 'admitted') {
    reasons.push({
      code: REFUSALS.stateRefused,
      message: `the recorded intake ended ${snippet(state.status)}; only an admitted report may publish`,
    });
    return blocked();
  }
  if (!nonEmptyString(target) || state.target_skill !== target) {
    reasons.push({
      code: REFUSALS.stateMismatch,
      message: `the receipt admits ${snippet(state.target_skill)}, but this run publishes ${snippet(target ?? null)}`,
    });
    return blocked();
  }
  if (typeof report !== 'string' || report.trim() === '') {
    reasons.push({ code: REFUSALS.missingReport, message: 'the approved report is no longer available to verify' });
    return blocked();
  }

  const digest = reportDigest(report);
  if (digest !== state.report_sha256) {
    reasons.push({
      code: REFUSALS.stateStale,
      message: `the receipt admits report ${state.report_sha256}, but the report on disk is ${digest}`,
    });
    return blocked();
  }

  const readmitted = admitReport({ report, approval: state.approval, target });
  if (readmitted.status !== 'admitted') {
    reasons.push({
      code: REFUSALS.stateStale,
      message: `the report no longer admits under the recorded approval: ${readmitted.refusals.map((entry) => entry.code).join(', ')}`,
    });
    return blocked();
  }

  const recomputed = readmitted.lineage;
  if (JSON.stringify(recomputed.applied_recommendation_ids) !== JSON.stringify(state.applied_recommendation_ids)) {
    reasons.push({
      code: REFUSALS.stateMismatch,
      message: 'the recommendations that apply now are not the ones the receipt recorded',
    });
  }
  if (JSON.stringify(recomputed.evidence_anchors) !== JSON.stringify(state.evidence_anchors)) {
    reasons.push({
      code: REFUSALS.stateMismatch,
      message: 'the evidence anchors behind the applied recommendations are not the ones the receipt recorded',
    });
  }
  if (recomputed.change_request_sha256 !== state.change_request_sha256) {
    reasons.push({
      code: REFUSALS.stateMismatch,
      message: 'the grounding these recommendations produce is not the grounding the receipt recorded',
    });
  }
  if (reasons.length) {
    return blocked();
  }

  return {
    requirement: 'satisfied',
    reasons: [],
    receipt: state,
    change_request: readmitted.change_request,
  };
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

export const USAGE = `Usage:
  report-intake.mjs --report <path> --target <skill> --approval <path>
                    --root <repository root> --state <absolute receipt path>
  report-intake.mjs --guidance <text> --target <skill>
  report-intake.mjs --guidance-file <path> --target <skill>
  report-intake.mjs --guidance - --target <skill>          (reads standard input)
  report-intake.mjs --require-admitted-state <path> --report <path> --target <skill>
  report-intake.mjs --probe

A report grounds a run only when its admission is recorded, so --report requires
--state and --root. Human guidance records nothing and needs neither.

Exit 0 when the report is admitted, when an approved report applies to nothing
here, or when the release check is satisfied; 2 when it is refused, unrecorded,
or blocked; 1 on a usage error.`;

/** Flags whose value is taken literally, so guidance may itself begin with --. */
const LITERAL_VALUE_FLAGS = new Set(['--guidance']);

export function parseArguments(argv) {
  const parsed = {
    reports: [],
    target: null,
    approval: null,
    guidance: null,
    guidanceFile: null,
    state: null,
    requireState: null,
    root: null,
    probe: false,
  };
  const once = (field, flag, value) => {
    if (parsed[field] !== null) {
      throw new IntakeError('usage', `${flag} is given once`);
    }
    parsed[field] = value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      parsed.probe = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new IntakeError('usage', `${flag} requires a value`);
    }
    // Guidance is prose the operator wrote, and prose can start with a dash.
    // Refusing it as a missing value would make the operator quote around this
    // parser, which is a worse failure than reading the next argument.
    if (!LITERAL_VALUE_FLAGS.has(flag) && value.startsWith('--')) {
      throw new IntakeError('usage', `${flag} requires a value`);
    }
    index += 1;
    switch (flag) {
      case '--report':
        parsed.reports.push(value);
        break;
      case '--target':
        if (parsed.target !== null) {
          throw new IntakeError('usage', '--target is given once; a run reinforces one skill');
        }
        parsed.target = value;
        break;
      case '--approval':
        once('approval', flag, value);
        break;
      case '--guidance':
        once('guidance', flag, value);
        break;
      case '--guidance-file':
        once('guidanceFile', flag, value);
        break;
      case '--state':
        once('state', flag, value);
        break;
      case '--require-admitted-state':
        once('requireState', flag, value);
        break;
      case '--root':
        once('root', flag, value);
        break;
      default:
        throw new IntakeError('usage', `unknown option: ${flag}`);
    }
  }
  return parsed;
}

function usageError(streams, message) {
  streams.stderr.write(`${JSON.stringify({ error: { code: 'usage', message } })}\n${USAGE}\n`);
  return 1;
}

/** Read a report without letting its path reach the output. */
function readReport(candidate) {
  try {
    return { text: fs.readFileSync(candidate, 'utf8'), refusal: null };
  } catch (error) {
    return {
      text: null,
      refusal: {
        code: REFUSALS.unreadableReport,
        message: `the supplied report could not be read: ${error.code ?? 'unreadable'}`,
      },
    };
  }
}

/**
 * Read guidance from a file or standard input, bounded.
 *
 * Bounded because an unbounded read is a way to make this process the problem:
 * guidance is meant to be a paragraph a person wrote, and a gigabyte of it is
 * not guidance. The limit is checked on bytes read, not on a promise about the
 * source.
 */
export function readBoundedGuidance(source, { readFile = fs.readFileSync } = {}) {
  const buffer = readFile(source === '-' ? 0 : source);
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8');
  if (bytes.length > MAX_GUIDANCE_BYTES) {
    throw new IntakeError(
      REFUSALS.oversizedGuidance,
      `guidance is bounded at ${MAX_GUIDANCE_BYTES} bytes; ${bytes.length} were supplied`,
    );
  }
  return bytes.toString('utf8');
}

export function run(argv, streams = process) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    return usageError(streams, error.message);
  }
  if (parsed.probe) {
    streams.stdout.write('report-intake: available\n');
    return 0;
  }
  if (parsed.target === null) {
    return usageError(streams, '--target is required');
  }

  const guided = parsed.guidance !== null || parsed.guidanceFile !== null;
  if (guided && parsed.guidance !== null && parsed.guidanceFile !== null) {
    return usageError(streams, 'guidance comes from one place: --guidance or --guidance-file');
  }
  if (guided
    && (parsed.reports.length || parsed.approval !== null || parsed.state !== null || parsed.requireState !== null)) {
    return usageError(
      streams,
      'a run grounds on one source: guidance takes no report, approval, or admission state',
    );
  }

  if (guided) {
    let guidance = parsed.guidance;
    if (parsed.guidanceFile !== null || guidance === '-') {
      try {
        guidance = readBoundedGuidance(parsed.guidanceFile ?? '-');
      } catch (error) {
        if (error.code === REFUSALS.oversizedGuidance) {
          streams.stdout.write(`${JSON.stringify({
            status: 'refused',
            source: 'human-guidance',
            refusals: [{ code: error.code, message: error.message }],
            report: null,
            target: parsed.target,
            applicable: [],
            excluded: [],
            lineage: null,
            change_request: null,
          }, null, 2)}\n`);
          return 2;
        }
        return usageError(streams, `guidance could not be read: ${error.code ?? 'unreadable'}`);
      }
    }
    const grounded = admitGuidance({ target: parsed.target, guidance });
    streams.stdout.write(`${JSON.stringify(grounded, null, 2)}\n`);
    return grounded.status === 'admitted' ? 0 : 2;
  }

  if (parsed.requireState !== null) {
    if (parsed.reports.length !== 1) {
      return usageError(streams, '--require-admitted-state verifies exactly one --report');
    }
    const reasons = [];
    let state = null;
    try {
      state = JSON.parse(fs.readFileSync(parsed.requireState, 'utf8'));
    } catch (error) {
      reasons.push({
        code: error instanceof SyntaxError ? REFUSALS.malformedState : REFUSALS.stateMissing,
        message: `the admission receipt could not be read: ${error.code ?? 'malformed'}`,
      });
    }
    const { text, refusal } = readReport(parsed.reports[0]);
    if (refusal) {
      reasons.push(refusal);
    }
    const result = reasons.length
      ? { requirement: 'blocked', reasons: [] }
      : requireAdmittedState({ state, report: text, target: parsed.target });
    const decided = result.requirement === 'blocked'
      ? { requirement: 'blocked', reasons: [...reasons, ...result.reasons] }
      : { requirement: 'satisfied', reasons: [], receipt: result.receipt };
    streams.stdout.write(`${JSON.stringify(decided, null, 2)}\n`);
    return decided.requirement === 'satisfied' ? 0 : 2;
  }

  if (parsed.reports.length === 0) {
    return usageError(streams, 'a run grounds on one report or on guidance');
  }

  const preRefusals = [];
  const reports = [];
  for (const candidate of parsed.reports) {
    const { text, refusal } = readReport(candidate);
    if (refusal) {
      preRefusals.push(refusal);
    } else {
      reports.push(text);
    }
  }

  let approval = null;
  if (parsed.approval !== null) {
    try {
      approval = JSON.parse(fs.readFileSync(parsed.approval, 'utf8'));
    } catch (error) {
      preRefusals.push({
        code: REFUSALS.malformedApproval,
        message: `the approval receipt could not be read: ${error.code ?? 'malformed'}`,
      });
    }
  }

  const result = admitReport({ reports, approval, target: parsed.target });
  const refusals = [...preRefusals, ...result.refusals];
  let decided = refusals.length
    ? {
      ...result,
      status: 'refused',
      refusals,
      report: { ...result.report, schema: null },
      applicable: [],
      excluded: [],
      lineage: null,
      change_request: null,
    }
    : result;

  // A report grounds a run only when its admission is recorded. Without a
  // receipt there is nothing for publication to re-derive, so an admission that
  // was never written down is not an admission this command hands onward: it
  // reports what it found and withholds the grounding.
  if (parsed.state === null || parsed.root === null) {
    decided = {
      ...decided,
      status: decided.status === 'refused' ? 'refused' : 'admitted-unrecorded',
      refusals: [
        ...decided.refusals,
        {
          code: REFUSALS.stateNotRecorded,
          message: '--report requires --state and --root; an admission that is not recorded '
            + 'cannot be re-derived before publication, so no change request is returned',
        },
      ],
      change_request: null,
    };
    streams.stdout.write(`${JSON.stringify({ ...decided, admission_state: 'not-recorded' }, null, 2)}\n`);
    return 2;
  }

  let admissionState = 'recorded';
  const receipt = decided.status === 'refused'
    ? buildRefusalReceipt(decided)
    : buildAdmissionReceipt(decided);
  try {
    writeAdmissionState(parsed.state, receipt, { repositoryRoot: parsed.root });
  } catch (error) {
    decided = {
      ...decided,
      status: 'refused',
      refusals: [...decided.refusals, { code: error.code, message: error.message }],
      applicable: [],
      excluded: [],
      lineage: null,
      change_request: null,
    };
    admissionState = 'not-recorded';
  }

  streams.stdout.write(`${JSON.stringify({ ...decided, admission_state: admissionState }, null, 2)}\n`);
  return decided.status === 'refused' ? 2 : 0;
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
