#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The record contract, made checkable.
 *
 * The schema in this unit is prose a model follows, and prose is exactly what
 * drifts. This module states the same contract as a function, so the rules that
 * matter - the key set, the states a candidate may hold, the caps a limited
 * boundary imposes, the two flags that must stay false - can be asserted
 * against a real record rather than trusted.
 *
 * It validates. It renders nothing and decides nothing.
 */

export const RECORD_KEYS = [
  'evidence_ledger',
  'session_summary',
  'session_metrics',
  'root_cause_hypotheses',
  'friction_signals',
  'identified_gaps',
  'candidate_skills',
  'skill_improvements',
  'candidate_lessons',
  'reinforcement_opportunities',
  'validation_requirements',
  'promotion_recommendations',
  'positive_patterns_to_preserve',
  'limitations',
  'changes_applied',
  'learning_recorded',
];

export const COMPLETENESS_VALUES = ['complete', 'partial', 'compacted', 'summary_only'];
export const ALIGNMENT_VALUES = ['aligned', 'partially_aligned', 'misaligned', 'not_observable'];
export const CONFIDENCE_VALUES = ['high', 'moderate', 'low'];
export const CANDIDATE_STATES = ['PROPOSED', 'OBSERVED'];
export const FORBIDDEN_STATES = ['VALIDATED', 'PROMOTED'];
export const CAPPED_COMPLETENESS = ['partial', 'compacted', 'summary_only'];

export const GAP_CATEGORIES = [
  'INTENT_MISS',
  'ABSTRACTION_MISMATCH',
  'TOO_THEORETICAL',
  'TOO_VERBOSE',
  'TOO_BRIEF',
  'MISSING_IMPLEMENTATION',
  'MISSING_DETERMINISM',
  'MISSED_CONTEXT',
  'MISSED_PATTERN',
  'MISSED_REUSE',
  'MISSED_SKILL_EXTRACTION',
  'PREMATURE_SOLUTION',
  'INSUFFICIENT_DEPTH',
  'INSUFFICIENT_STRUCTURE',
  'INSUFFICIENT_VALIDATION',
  'INSUFFICIENT_REINFORCEMENT',
  'TOOL_OR_RUNTIME_GAP',
  'INSTRUCTION_OR_ROUTING_GAP',
];

export const CANDIDATE_CLASSIFICATIONS = [
  'existing_but_not_triggered',
  'existing_skill_improvement',
  'new_skill_candidate',
  'evaluator_candidate',
  'automation_candidate',
  'session_specific_no_reuse',
  'duplicate_dropped',
];

export const MAX_RETAINED_CANDIDATES = 3;
const ANCHOR = /^(?:[UATSRME]\d+(?:-\d+)?|L\d+:\d+(?:-\d+)?)$/;

function isAnchorList(value) {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === 'string' && ANCHOR.test(entry.split(' ')[0]));
}

function list(record, key) {
  return Array.isArray(record[key]) ? record[key] : [];
}

/**
 * Returns every way a record breaks the contract, rather than the first, so a
 * reviewer sees the whole picture in one pass.
 */
export function assertRecordContract(record) {
  const problems = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return ['a post-mortem record must be an object'];
  }

  const keys = Object.keys(record);
  const missing = RECORD_KEYS.filter((key) => !keys.includes(key));
  const unknown = keys.filter((key) => !RECORD_KEYS.includes(key));
  if (missing.length) {
    problems.push(`the record omits ${missing.join(', ')}`);
  }
  if (unknown.length) {
    problems.push(`the record adds ${unknown.join(', ')}, which the fixed schema does not carry`);
  }

  if (record.changes_applied !== false) {
    problems.push('changes_applied must be false');
  }
  if (record.learning_recorded !== false) {
    problems.push('learning_recorded must be false');
  }

  const promotion = record.promotion_recommendations ?? {};
  if (!Array.isArray(promotion.ready_for_promotion) || promotion.ready_for_promotion.length > 0) {
    problems.push('ready_for_promotion must be an empty list');
  }
  if (!isAnchorList(promotion.quarantined_untrusted_directives ?? [])) {
    problems.push('quarantined_untrusted_directives holds evidence anchors only');
  }

  const summary = record.session_summary ?? {};
  if (!COMPLETENESS_VALUES.includes(summary.evidence_completeness)) {
    problems.push(`evidence_completeness must be one of ${COMPLETENESS_VALUES.join(', ')}`);
  }
  if (!ALIGNMENT_VALUES.includes(summary.alignment)) {
    problems.push(`alignment must be one of ${ALIGNMENT_VALUES.join(', ')}`);
  }
  if (typeof summary.no_material_finding !== 'boolean') {
    problems.push('no_material_finding must be true or false');
  }
  if (!isAnchorList(summary.outcome_evidence ?? [])) {
    problems.push('outcome_evidence holds evidence anchors only');
  }

  // A limited boundary caps every confidence value in the record. This is the
  // rule a well-meaning revision relaxes first, so it is checked over the whole
  // document rather than trusted per section.
  const capped = CAPPED_COMPLETENESS.includes(summary.evidence_completeness);
  const confidences = [
    ...list(record, 'friction_signals'),
    ...list(record, 'identified_gaps'),
    ...list(record, 'root_cause_hypotheses'),
    ...list(record, 'candidate_skills'),
    ...list(record, 'candidate_lessons'),
    ...list(record, 'reinforcement_opportunities'),
    ...list(record, 'positive_patterns_to_preserve'),
  ].map((entry) => entry?.confidence).filter((value) => value !== undefined);
  for (const confidence of confidences) {
    if (!CONFIDENCE_VALUES.includes(confidence)) {
      problems.push(`confidence ${String(confidence)} is outside the calibrated bands`);
    } else if (capped && confidence === 'high') {
      problems.push('a partial, compacted, or summary-only boundary caps confidence at moderate');
    }
  }
  if (capped && summary.alignment_confidence === 'high') {
    problems.push('a partial, compacted, or summary-only boundary caps alignment confidence');
  }

  for (const signal of list(record, 'friction_signals')) {
    if (!isAnchorList(signal?.evidence) || signal.evidence.length === 0) {
      problems.push(`friction signal ${String(signal?.id)} must cite at least one anchor`);
    }
    if (typeof signal?.consequence !== 'string' || signal.consequence.trim() === '') {
      problems.push(`friction signal ${String(signal?.id)} must state what followed`);
    }
  }

  for (const gap of list(record, 'identified_gaps')) {
    if (!GAP_CATEGORIES.includes(gap?.category)) {
      problems.push(`gap category ${String(gap?.category)} is not in the fixed taxonomy`);
    }
    if (typeof gap?.available_alternative !== 'string' || gap.available_alternative.trim() === '') {
      problems.push(`gap ${String(gap?.id)} must name the alternative that was available`);
    }
  }

  const mechanisms = new Set();
  for (const hypothesis of list(record, 'root_cause_hypotheses')) {
    if (!Array.isArray(hypothesis?.affects) || hypothesis.affects.length === 0) {
      problems.push(`hypothesis ${String(hypothesis?.id)} must reference the findings it explains`);
    }
    const signature = JSON.stringify([...(hypothesis?.affects ?? [])].sort());
    if (mechanisms.has(signature)) {
      problems.push('two hypotheses explain the same findings; one mechanism produces one hypothesis');
    }
    mechanisms.add(signature);
  }

  const retained = list(record, 'candidate_skills').filter(
    (candidate) => !['session_specific_no_reuse', 'duplicate_dropped'].includes(candidate?.classification),
  );
  if (retained.length > MAX_RETAINED_CANDIDATES) {
    problems.push(`at most ${MAX_RETAINED_CANDIDATES} candidates may be retained; found ${retained.length}`);
  }
  for (const candidate of list(record, 'candidate_skills')) {
    if (!CANDIDATE_CLASSIFICATIONS.includes(candidate?.classification)) {
      problems.push(`candidate classification ${String(candidate?.classification)} is not in the fixed list`);
    }
  }

  for (const [key, entries] of [
    ['candidate_skills', list(record, 'candidate_skills')],
    ['candidate_lessons', list(record, 'candidate_lessons')],
  ]) {
    for (const entry of entries) {
      if (FORBIDDEN_STATES.includes(entry?.status)) {
        problems.push(`${key} may not hold ${entry.status}; this skill assigns neither`);
      } else if (!CANDIDATE_STATES.includes(entry?.status)) {
        problems.push(`${key} status must be one of ${CANDIDATE_STATES.join(', ')}`);
      }
    }
  }

  for (const requirement of list(record, 'validation_requirements')) {
    if (requirement?.human_approval_required !== true) {
      problems.push('every validation requirement must require human approval');
    }
  }

  return problems;
}

function main(argv) {
  if (argv.includes('--probe')) {
    console.log('postmortem-render-record: available');
    return 0;
  }
  const index = argv.indexOf('--record');
  if (index === -1 || argv[index + 1] === undefined) {
    console.error(JSON.stringify({ error: { code: 'usage', message: '--record requires a path' } }));
    return 1;
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(argv[index + 1], 'utf8'));
  } catch (error) {
    console.error(JSON.stringify({ error: { code: 'unreadable_record', message: error.message } }));
    return 1;
  }
  const problems = assertRecordContract(record);
  console.log(JSON.stringify({ problems, conforms: problems.length === 0 }, null, 2));
  return problems.length === 0 ? 0 : 2;
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
  process.exitCode = main(process.argv.slice(2));
}
