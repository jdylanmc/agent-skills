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
 * Everything is a pure function over text so the cases that matter - a tampered
 * digest, a foreign target, a self-approving report, two recommendations that
 * contradict each other - are decided by running something rather than by
 * trusting a paragraph.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { digestOf } from '../../../create-skill/_atoms/intent-storage-gate/intent-storage-gate.mjs';
import {
  assertRecordContract,
} from '../../../post-mortem/_atoms/postmortem-render-record/postmortem-render-record.mjs';
import { SKILL_NAME_PATTERN } from '../reinforcement-target/reinforcement-target.mjs';

/** The one envelope version this intake understands. */
export const REPORT_SCHEMA = 'reinforcement-report/v1';

/**
 * The exact value an approval must carry. A constant rather than a boolean:
 * `true`, `1`, `'yes'`, and any truthy object all read as approval under
 * truthiness, and each of them is a plausible accident. Only this string is.
 */
export const APPROVAL_GRANT = 'operator-approved-reinforcement-report';

export const REPORT_KEYS = ['schema', 'post_mortem_record', 'recommendations'];
export const RECOMMENDATION_KEYS = ['id', 'target_skill', 'source_ref', 'change', 'evidence', 'validation'];
export const APPROVAL_KEYS = ['grant', 'report_sha256', 'target_skill'];

/** What a proposed change may ask for. */
export const DIRECTIVES = ['add', 'revise', 'remove'];

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
 */
export const SOURCE_SECTIONS = [
  'skill_improvements',
  'candidate_skills',
  'candidate_lessons',
  'reinforcement_opportunities',
  'promotion_recommendations.proposed_only',
];

/** Candidate classifications the record itself has already discarded. */
const DROPPED_CLASSIFICATIONS = ['session_specific_no_reuse', 'duplicate_dropped'];

const SOURCE_REF = /^([a-z_.]+)\[(\d+)\]$/;

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
  unvalidatedRecommendation: 'unvalidated_recommendation',
  approvalNotRequired: 'approval_not_required',
  contradictoryRecommendations: 'contradictory_recommendations',
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
      message: `an approval receipt carries only ${APPROVAL_KEYS.join(', ')}; found ${unknown.join(', ')}`,
    });
  }

  if (approval.grant !== APPROVAL_GRANT) {
    refusals.push({
      code: REFUSALS.unapprovedReport,
      message: `the grant must be exactly ${JSON.stringify(APPROVAL_GRANT)}; found ${JSON.stringify(approval.grant ?? null)}`,
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
  const container = section.split('.').reduce(
    (value, key) => (isPlainObject(value) ? value[key] : undefined),
    record,
  );
  if (!Array.isArray(container) || index >= container.length || !isPlainObject(container[index])) {
    return { entry: null, section };
  }
  return { entry: container[index], section };
}

function checkRecommendation(recommendation, context) {
  const { record, anchors, validations, index } = context;
  const refusals = [];
  const label = isPlainObject(recommendation) && nonEmptyString(recommendation.id)
    ? recommendation.id
    : `recommendations[${index}]`;

  if (!isPlainObject(recommendation)) {
    refusals.push({ code: REFUSALS.malformedReport, message: `${label} must be an object` });
    return refusals;
  }

  const keys = Object.keys(recommendation);
  const selfApproving = keys.filter((key) => SELF_APPROVAL_KEYS.includes(key)).sort();
  if (selfApproving.length) {
    refusals.push({
      code: REFUSALS.selfApprovingReport,
      message: `${label} carries ${selfApproving.join(', ')}; a report never approves itself`,
    });
  }
  const unknown = keys
    .filter((key) => !RECOMMENDATION_KEYS.includes(key) && !SELF_APPROVAL_KEYS.includes(key))
    .sort();
  if (unknown.length) {
    refusals.push({
      code: REFUSALS.malformedReport,
      message: `${label} carries unknown field(s): ${unknown.join(', ')}`,
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
      message: `${label} cites ${JSON.stringify(recommendation.source_ref ?? null)}, which resolves to nothing in the record`,
    });
  } else {
    // `skill_improvements[].skill` is the one place the fixed record names a
    // skill. Where it does, the envelope may not disagree with it.
    if (nonEmptyString(entry.skill)
      && nonEmptyString(recommendation.target_skill)
      && entry.skill !== recommendation.target_skill) {
      refusals.push({
        code: REFUSALS.sourceTargetMismatch,
        message: `${label} targets ${recommendation.target_skill} but cites evidence the record recorded against ${entry.skill}`,
      });
    }
    if (section === 'candidate_skills' && DROPPED_CLASSIFICATIONS.includes(entry.classification)) {
      refusals.push({
        code: REFUSALS.droppedSource,
        message: `${label} cites a candidate the record classified ${entry.classification}; the report contradicts itself`,
      });
    }
  }

  if (!Array.isArray(recommendation.evidence) || recommendation.evidence.length === 0) {
    refusals.push({
      code: REFUSALS.unanchoredEvidence,
      message: `${label} must cite at least one evidence anchor from the record`,
    });
  } else {
    const dangling = recommendation.evidence
      .filter((anchor) => !nonEmptyString(anchor) || !anchors.has(anchor.split(' ')[0]))
      .map((anchor) => String(anchor));
    if (dangling.length) {
      refusals.push({
        code: REFUSALS.unanchoredEvidence,
        message: `${label} cites ${dangling.join(', ')}, which the evidence ledger does not carry`,
      });
    }
  }

  const change = recommendation.change;
  if (!isPlainObject(change)
    || !nonEmptyString(change.surface)
    || !nonEmptyString(change.statement)
    || !DIRECTIVES.includes(change.directive)) {
    refusals.push({
      code: REFUSALS.malformedChange,
      message: `${label} must propose a change naming a surface, a statement, and a directive of ${DIRECTIVES.join(', ')}`,
    });
  }

  if (!nonEmptyString(recommendation.validation)) {
    refusals.push({
      code: REFUSALS.unvalidatedRecommendation,
      message: `${label} must name the validation requirement that governs it`,
    });
  } else if (!validations.has(recommendation.validation)) {
    refusals.push({
      code: REFUSALS.unvalidatedRecommendation,
      message: `${label} names validation requirement ${recommendation.validation}, which the record does not carry`,
    });
  } else if (validations.get(recommendation.validation).human_approval_required !== true) {
    refusals.push({
      code: REFUSALS.approvalNotRequired,
      message: `${label} rests on a validation requirement that does not require human approval`,
    });
  }

  return refusals;
}

/**
 * Two recommendations for the same target may both apply, and reconciling them
 * into one bounded change request is the point. What may not happen is applying
 * a pair that cannot both be true: one asking that a surface be removed while
 * another asks that it be kept and changed. That is a decision for the
 * operator, so it refuses rather than picking a winner.
 */
export function findContradictions(applicable) {
  const bySurface = new Map();
  for (const recommendation of applicable) {
    const surface = recommendation.change.surface;
    if (!bySurface.has(surface)) {
      bySurface.set(surface, []);
    }
    bySurface.get(surface).push(recommendation);
  }

  const refusals = [];
  for (const [surface, group] of bySurface) {
    if (group.length < 2) {
      continue;
    }
    const removals = group.filter((entry) => entry.change.directive === 'remove');
    const others = group.filter((entry) => entry.change.directive !== 'remove');
    if (removals.length && others.length) {
      refusals.push({
        code: REFUSALS.contradictoryRecommendations,
        message: `${removals.map((entry) => entry.id).join(', ')} would remove ${surface} while `
          + `${others.map((entry) => entry.id).join(', ')} would keep and change it`,
      });
    }
  }
  return refusals;
}

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
  validationRequirements = [],
  lineage = null,
} = {}) {
  return {
    source: 'post-mortem-report',
    target,
    untrusted: true,
    report_sha256: lineage?.report_sha256 ?? null,
    recommendation_ids: applicable.map((entry) => entry.id),
    evidence_anchors: [...new Set(applicable.flatMap((entry) => entry.evidence))],
    changes: applicable.map((entry) => ({
      id: entry.id,
      surface: entry.change.surface,
      directive: entry.change.directive,
      statement: entry.change.statement,
      evidence: [...entry.evidence],
      source_ref: entry.source_ref,
    })),
    validation: validationRequirements.filter(Boolean),
  };
}

/**
 * The human-guidance path, unchanged in substance: the operator's words go in
 * as the operator wrote them. It exists so the workflow below has one input
 * shape rather than two, and it requires no report, no approval receipt, and no
 * synthetic post-mortem record.
 */
export function groundingFromGuidance({ target, guidance } = {}) {
  if (!nonEmptyString(target) || !SKILL_NAME_PATTERN.test(target)) {
    throw new IntakeError(
      REFUSALS.invalidTarget,
      `a run reinforces one routable skill; ${JSON.stringify(target ?? null)} is not one`,
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
      id: 'guidance',
      surface: null,
      directive: 'revise',
      statement: guidance,
      evidence: [],
      source_ref: null,
    }],
    validation: [],
  };
}

/**
 * Admit one approved report for one target skill, or refuse it and say every
 * reason at once.
 *
 * Refusals accumulate rather than short-circuit: a reviewer reading a refusal
 * should see the whole state of the report, not the first thing that failed
 * followed by another round trip for the next one.
 */
export function admitReport({
  report = undefined,
  reports = undefined,
  reportPath = null,
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
      message: `a run reinforces one routable skill; ${JSON.stringify(target ?? null)} is not one`,
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
        message: `the report carries ${selfApproving.join(', ')}; authority comes from the operator's receipt, never from the report`,
      });
    }
    const unknown = keys
      .filter((key) => !REPORT_KEYS.includes(key) && !SELF_APPROVAL_KEYS.includes(key))
      .sort();
    if (unknown.length) {
      refusals.push({
        code: REFUSALS.malformedReport,
        message: `the report carries unknown field(s): ${unknown.join(', ')}`,
      });
    }
    const missing = REPORT_KEYS.filter((key) => !keys.includes(key));
    if (missing.length) {
      refusals.push({ code: REFUSALS.malformedReport, message: `the report omits ${missing.join(', ')}` });
    }
    if (envelope.schema !== REPORT_SCHEMA) {
      refusals.push({
        code: REFUSALS.malformedReport,
        message: `the report declares schema ${JSON.stringify(envelope.schema ?? null)}; this intake reads ${REPORT_SCHEMA}`,
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
      quarantined = [...(record.promotion_recommendations.quarantined_untrusted_directives ?? [])];
    }

    if (!Array.isArray(envelope.recommendations)) {
      refusals.push({
        code: REFUSALS.malformedReport,
        message: 'recommendations must be a list; a report proposing none carries an empty list',
      });
    } else if (record !== null) {
      const anchors = new Set(
        (Array.isArray(record.evidence_ledger) ? record.evidence_ledger : [])
          .map((entry) => entry?.anchor)
          .filter((anchor) => nonEmptyString(anchor)),
      );
      const validations = new Map(
        (Array.isArray(record.validation_requirements) ? record.validation_requirements : [])
          .filter((entry) => isPlainObject(entry) && nonEmptyString(entry.candidate))
          .map((entry) => [entry.candidate, entry]),
      );
      const seen = new Set();
      envelope.recommendations.forEach((recommendation, index) => {
        const problems = checkRecommendation(recommendation, { record, anchors, validations, index });
        refusals.push(...problems);
        const id = isPlainObject(recommendation) ? recommendation.id : undefined;
        if (nonEmptyString(id)) {
          if (seen.has(id)) {
            refusals.push({
              code: REFUSALS.duplicateRecommendationId,
              message: `two recommendations share the id ${id}`,
            });
          }
          seen.add(id);
        }
        if (problems.length) {
          return;
        }
        if (recommendation.target_skill === resolvedTarget) {
          applicable.push(recommendation);
        } else {
          excluded.push({
            id: recommendation.id,
            target_skill: recommendation.target_skill,
            reason: 'targets-another-skill',
          });
        }
      });
      refusals.push(...findContradictions(applicable));
    }
  }

  if (refusals.length) {
    return {
      status: 'refused',
      refusals,
      report: { path: reportPath, sha256: digest, schema: envelope?.schema ?? null },
      target: resolvedTarget,
      applicable: [],
      excluded: [],
      lineage: null,
      change_request: null,
    };
  }

  const validationRequirements = applicable.map((entry) => record.validation_requirements
    .find((requirement) => requirement.candidate === entry.validation));

  const lineage = {
    report_sha256: digest,
    report_path: reportPath,
    schema: envelope.schema,
    target_skill: resolvedTarget,
    approval_receipt: {
      grant: approval.grant,
      report_sha256: approval.report_sha256,
      target_skill: approval.target_skill,
    },
    applied_recommendation_ids: applicable.map((entry) => entry.id),
    excluded_recommendations: excluded,
    evidence_anchors: [...new Set(applicable.flatMap((entry) => entry.evidence))],
    quarantined_untrusted_directives: quarantined,
  };

  return {
    status: 'admitted',
    refusals: [],
    report: { path: reportPath, sha256: digest, schema: envelope.schema },
    target: resolvedTarget,
    applicable,
    excluded,
    lineage,
    change_request: groundingFromReport({
      target: resolvedTarget,
      applicable,
      validationRequirements,
      lineage,
    }),
  };
}

export const USAGE = `Usage: report-intake.mjs --report <path> --target <skill> --approval <path>
       report-intake.mjs --probe

Exit 0 when the report is admitted, 2 when it is refused, 1 on a usage error.`;

export function parseArguments(argv) {
  const parsed = { reports: [], target: null, approval: null, probe: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      parsed.probe = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new IntakeError('usage', `${flag} requires a value`);
    }
    index += 1;
    if (flag === '--report') {
      parsed.reports.push(value);
    } else if (flag === '--target') {
      if (parsed.target !== null) {
        throw new IntakeError('usage', '--target is given once; a run reinforces one skill');
      }
      parsed.target = value;
    } else if (flag === '--approval') {
      if (parsed.approval !== null) {
        throw new IntakeError('usage', '--approval is given once');
      }
      parsed.approval = value;
    } else {
      throw new IntakeError('usage', `unknown option: ${flag}`);
    }
  }
  return parsed;
}

export function run(argv, streams = process) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    streams.stderr.write(`${JSON.stringify({ error: { code: error.code, message: error.message } })}\n${USAGE}\n`);
    return 1;
  }
  if (parsed.probe) {
    streams.stdout.write('report-intake: available\n');
    return 0;
  }
  if (parsed.target === null) {
    streams.stderr.write(`${JSON.stringify({ error: { code: 'usage', message: '--target is required' } })}\n${USAGE}\n`);
    return 1;
  }

  const preRefusals = [];
  const reports = [];
  for (const candidate of parsed.reports) {
    try {
      reports.push(fs.readFileSync(candidate, 'utf8'));
    } catch (error) {
      preRefusals.push({
        code: REFUSALS.unreadableReport,
        message: `${candidate} could not be read: ${error.message}`,
      });
    }
  }

  let approval = null;
  if (parsed.approval !== null) {
    try {
      approval = JSON.parse(fs.readFileSync(parsed.approval, 'utf8'));
    } catch (error) {
      preRefusals.push({
        code: REFUSALS.malformedApproval,
        message: `${parsed.approval} could not be read as an approval receipt: ${error.message}`,
      });
    }
  }

  const result = admitReport({
    reports,
    reportPath: parsed.reports.length === 1 ? parsed.reports[0] : null,
    approval,
    target: parsed.target,
  });
  const refusals = [...preRefusals, ...result.refusals];
  const decided = refusals.length
    ? {
      ...result,
      status: 'refused',
      refusals,
      applicable: [],
      excluded: [],
      lineage: null,
      change_request: null,
    }
    : result;

  streams.stdout.write(`${JSON.stringify(decided, null, 2)}\n`);
  return decided.status === 'admitted' ? 0 : 2;
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
