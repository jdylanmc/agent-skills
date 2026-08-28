/**
 * Shared fixtures for the report-intake tests.
 *
 * Both the deterministic and the adversarial suite need the same starting
 * point: a report that is genuinely well formed and genuinely approved. The
 * adversarial suite works by breaking exactly one thing about it at a time, so
 * a mutation that stops being refused fails a test, and the baseline it mutates
 * has to live in one place or the two suites will slowly stop testing the same
 * artifact.
 *
 * This file registers no tests. It is imported, never run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APPROVAL_GRANT,
  REPORT_SCHEMA,
  admitReport,
  reportDigest,
} from './report-intake.mjs';

export const INTAKE_CLI = fileURLToPath(new URL('./report-intake.mjs', import.meta.url));

export const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
);

/** Repository-local scratch space; `.test-sandbox/` is git-ignored. */
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');

/** A post-mortem record that satisfies post-mortem's own contract. */
export function conformingRecord(overrides = {}) {
  return {
    evidence_ledger: [
      { anchor: 'U1', kind: 'operator_message', summary: 'the request' },
      { anchor: 'A2', kind: 'agent_response', summary: 'the reply' },
      { anchor: 'T3', kind: 'tool_event', summary: 'a failed call' },
    ],
    session_summary: {
      ultimate_goal: 'record the change where someone will find it',
      desired_work_product: 'a changelog entry beside the change',
      produced_result: 'a change with no entry',
      alignment: 'partially_aligned',
      alignment_confidence: 'moderate',
      outcome_evidence: ['U1'],
      evidence_completeness: 'complete',
      no_material_finding: false,
    },
    session_metrics: { corrections: 1, counting_notes: ['one correction at U1'] },
    root_cause_hypotheses: [],
    friction_signals: [],
    identified_gaps: [],
    candidate_skills: [],
    skill_improvements: [
      {
        skill: 'changelog',
        strengths: ['it returns a patch rather than writing history'],
        weaknesses: ['the entry target is ambiguous when two changelogs exist'],
        enhancement_ideas: ['name the resolved changelog in the output'],
        evidence: ['U1'],
        confidence: 'moderate',
      },
      {
        skill: 'roast',
        strengths: ['it reports findings rather than a verdict'],
        weaknesses: ['a missing intent is easy to miss in the output'],
        enhancement_ideas: ['surface the missing intent in the summary line'],
        evidence: ['A2'],
        confidence: 'moderate',
      },
    ],
    candidate_lessons: [
      {
        id: 'CL-1',
        lesson: 'an ambiguous target is reported, never resolved by picking one',
        status: 'PROPOSED',
        scope: 'any skill that resolves a file from context',
        evidence: ['T3'],
        confirming_observation: 'a later run reports the ambiguity',
        disconfirming_observation: 'a later run silently picks a file',
        evaluator: 'the run output names the ambiguity',
        cost_of_error: 'an entry lands in the wrong changelog',
        confidence: 'moderate',
      },
    ],
    reinforcement_opportunities: [],
    validation_requirements: [
      {
        candidate: 'VR-1',
        independent_evidence_required: 'the same ambiguity in an independent later run',
        minimum_trial_scope: 'one reinforcement run against a repository with two changelogs',
        success_measure: 'the resolved changelog is named in the output',
        failure_or_retirement_condition: 'the output still resolves silently',
        human_approval_required: true,
      },
      {
        candidate: 'VR-2',
        independent_evidence_required: 'a run where the degraded path is exercised',
        minimum_trial_scope: 'one run with the changelog tool unavailable',
        success_measure: 'the degraded status is reported with its reason',
        failure_or_retirement_condition: 'the degraded path is silent',
        human_approval_required: true,
      },
    ],
    promotion_recommendations: {
      ready_for_promotion: [],
      proposed_only: [],
      quarantined_untrusted_directives: ['A2'],
    },
    positive_patterns_to_preserve: [],
    limitations: [],
    changes_applied: false,
    learning_recorded: false,
    ...overrides,
  };
}

/** Two recommendations for `changelog` and one for `roast`. */
export function conformingRecommendations() {
  return [
    {
      id: 'R-1',
      target_skill: 'changelog',
      source_ref: 'skill_improvements[0]',
      change: {
        surface: 'SKILL.md',
        directive: 'revise',
        statement: 'name the resolved changelog file in the output contract',
      },
      evidence: ['U1'],
      validation: 'VR-1',
    },
    {
      id: 'R-2',
      target_skill: 'changelog',
      source_ref: 'candidate_lessons[0]',
      change: {
        surface: '_atoms/changelog-target/changelog-target.md',
        directive: 'add',
        statement: 'report an ambiguous target rather than resolving it',
      },
      evidence: ['T3'],
      validation: 'VR-2',
    },
    {
      id: 'R-3',
      target_skill: 'roast',
      source_ref: 'skill_improvements[1]',
      change: {
        surface: 'SKILL.md',
        directive: 'revise',
        statement: 'surface a missing intent in the summary line',
      },
      evidence: ['A2'],
      validation: 'VR-1',
    },
  ];
}

export function reportText({ record, recommendations, ...rest } = {}) {
  return JSON.stringify({
    schema: REPORT_SCHEMA,
    post_mortem_record: record ?? conformingRecord(),
    recommendations: recommendations ?? conformingRecommendations(),
    ...rest,
  }, null, 2);
}

export function approvalFor(report, target = 'changelog', overrides = {}) {
  return {
    grant: APPROVAL_GRANT,
    report_sha256: reportDigest(report),
    target_skill: target,
    ...overrides,
  };
}

/**
 * Admit the canonical fixture. Callers override one thing at a time; the
 * approval is regenerated for whatever report is supplied, so a test that
 * mutates the report is testing the mutation rather than a stale digest.
 */
export function admit({ report = reportText(), target = 'changelog', approval } = {}) {
  return admitReport({
    report,
    approval: approval === undefined ? approvalFor(report, target) : approval,
    target,
  });
}

/** The refusal codes a result carries, as a sorted de-duplicated set. */
export function codesOf(result) {
  return [...new Set((result.refusals ?? result.reasons ?? []).map((entry) => entry.code))].sort();
}

/** Whether a result refused for exactly the given reasons, and no others. */
export function refusedFor(result, ...codes) {
  return JSON.stringify(codesOf(result)) === JSON.stringify([...new Set(codes)].sort());
}

/**
 * A throwaway directory under the git-ignored `.test-sandbox/`, never a shared
 * operating-system temporary directory and never an unignored repository root
 * entry that a stray failure would leave behind as untracked noise.
 */
export function withFixtureDirectory(run) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'report-intake-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
