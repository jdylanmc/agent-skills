/**
 * Deterministic duplicate-capability routing for Skill Sniper.
 *
 * The failure this exists to prevent is the pleasant one: a run that was asked
 * to adopt a skill, found the destination already does that job, and created a
 * second one anyway because creating is what it came to do. A library gains two
 * skills with one job, and the router picks the wrong one at the wrong moment.
 *
 * The judgement - does this destination capability do the same job? - belongs to
 * a model reading both. This module does not make that judgement. It takes the
 * assessment as evidence-backed input and enforces what follows from it:
 *
 *   - a capability doing the same job means route to it and create nothing;
 *   - two capabilities doing the same job is a question, not a coin flip;
 *   - a partial overlap stops for a human, because "close enough to reuse" and
 *     "different enough to build" are product decisions;
 *   - and an inventory nobody enumerated cannot establish that a job is absent.
 *
 * A confirmed synthesis may warrant several destination skills. Nothing here
 * caps the number of jobs a run may carry; each job is decided on its own.
 */

export const OVERLAP_LEVELS = ['same-job', 'partial', 'none'];
export const ADOPTION_DECISIONS = ['create', 'route-existing', 'stop'];

export const CAPABILITY_FAILURES = {
  usage: 'usage',
  noJobs: 'no_jobs',
  invalidOverlap: 'invalid_overlap',
  unknownCapability: 'unknown_capability',
  incompleteAssessment: 'incomplete_assessment',
  missingEvidence: 'missing_evidence',
};

export class CapabilityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CapabilityError';
    this.code = code;
  }
}

function requireString(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CapabilityError(code, message);
  }
  return value.trim();
}

function validateCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) {
    throw new CapabilityError(CAPABILITY_FAILURES.usage, 'capabilities must be an array');
  }
  const ids = new Set();
  for (const [index, capability] of capabilities.entries()) {
    if (!capability || typeof capability !== 'object' || Array.isArray(capability)) {
      throw new CapabilityError(CAPABILITY_FAILURES.usage, `capability ${index} must be an object`);
    }
    const id = requireString(
      capability.id,
      CAPABILITY_FAILURES.usage,
      `capability ${index} requires an id`,
    );
    if (ids.has(id)) {
      throw new CapabilityError(CAPABILITY_FAILURES.usage, `duplicate capability id: ${id}`);
    }
    ids.add(id);
  }
  return ids;
}

function decideOne(job, capabilityIds, enumerated) {
  const jobId = requireString(job?.id, CAPABILITY_FAILURES.usage, 'every job requires an id');
  requireString(job?.statement, CAPABILITY_FAILURES.usage, `job ${jobId} requires a statement`);

  const assessments = job.assessments;
  if (!Array.isArray(assessments)) {
    throw new CapabilityError(
      CAPABILITY_FAILURES.usage,
      `job ${jobId} requires an assessments array`,
    );
  }

  const seen = new Map();
  for (const assessment of assessments) {
    const capabilityId = requireString(
      assessment?.capabilityId,
      CAPABILITY_FAILURES.usage,
      `job ${jobId} has an assessment with no capabilityId`,
    );
    if (!capabilityIds.has(capabilityId)) {
      throw new CapabilityError(
        CAPABILITY_FAILURES.unknownCapability,
        `job ${jobId} assesses ${capabilityId}, which the destination did not declare`,
      );
    }
    if (seen.has(capabilityId)) {
      throw new CapabilityError(
        CAPABILITY_FAILURES.usage,
        `job ${jobId} assesses ${capabilityId} more than once`,
      );
    }
    if (!OVERLAP_LEVELS.includes(assessment.overlap)) {
      throw new CapabilityError(
        CAPABILITY_FAILURES.invalidOverlap,
        `job ${jobId} vs ${capabilityId}: overlap must be one of ${OVERLAP_LEVELS.join(', ')}`,
      );
    }
    if (assessment.overlap !== 'none') {
      requireString(
        assessment.evidence,
        CAPABILITY_FAILURES.missingEvidence,
        `job ${jobId} vs ${capabilityId}: a ${assessment.overlap} overlap requires evidence`,
      );
    }
    seen.set(capabilityId, assessment);
  }

  for (const capabilityId of capabilityIds) {
    if (!seen.has(capabilityId)) {
      throw new CapabilityError(
        CAPABILITY_FAILURES.incompleteAssessment,
        `job ${jobId} did not assess declared capability ${capabilityId}`,
      );
    }
  }

  if (enumerated !== true) {
    return {
      job: jobId,
      decision: 'stop',
      reason: 'capability-inventory-unavailable',
      evidence: [],
      waysForward: [
        "Enumerate the destination's existing skills and re-run the decision.",
        'Ask the operator to confirm the destination has no skill for this job.',
      ],
    };
  }

  const same = [...seen.entries()].filter(([, entry]) => entry.overlap === 'same-job');
  const partial = [...seen.entries()].filter(([, entry]) => entry.overlap === 'partial');

  if (same.length === 1) {
    return {
      job: jobId,
      decision: 'route-existing',
      reason: 'destination-already-provides-this-job',
      existing: same[0][0],
      evidence: [same[0][1].evidence.trim()],
      waysForward: [
        `Use ${same[0][0]} in the destination instead of creating a second skill for this job.`,
        `Reinforce ${same[0][0]} if it is missing something this source has.`,
      ],
    };
  }

  if (same.length > 1) {
    return {
      job: jobId,
      decision: 'stop',
      reason: 'ambiguous-existing-capability',
      existing: same.map(([id]) => id),
      evidence: same.map(([, entry]) => entry.evidence.trim()),
      waysForward: [
        'Ask the operator which existing skill owns this job.',
        'Report the overlap and let the destination resolve its own duplication first.',
      ],
    };
  }

  if (partial.length > 0) {
    return {
      job: jobId,
      decision: 'stop',
      reason: 'undecided-overlap',
      existing: partial.map(([id]) => id),
      evidence: partial.map(([, entry]) => entry.evidence.trim()),
      waysForward: [
        'Ask the operator whether to extend the overlapping skill or create a distinct one.',
        'Narrow the synthesized job until it no longer overlaps, and confirm the narrower words.',
      ],
    };
  }

  return {
    job: jobId,
    decision: 'create',
    reason: 'no-existing-capability-for-this-job',
    evidence: [],
    waysForward: [],
  };
}

/**
 * Decide, per job in the confirmed synthesis, whether the destination should
 * gain a skill, be routed to one it already has, or stop for a human.
 */
export function decideAdoptions({ jobs, capabilities, capabilitiesEnumerated } = {}) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new CapabilityError(
      CAPABILITY_FAILURES.noJobs,
      'a confirmed synthesis carries at least one job',
    );
  }
  const capabilityIds = validateCapabilities(capabilities ?? []);
  const jobIds = new Set();
  const decisions = jobs.map((job) => {
    const decision = decideOne(job, capabilityIds, capabilitiesEnumerated);
    if (jobIds.has(decision.job)) {
      throw new CapabilityError(CAPABILITY_FAILURES.usage, `duplicate job id: ${decision.job}`);
    }
    jobIds.add(decision.job);
    return decision;
  });

  const summary = { create: 0, 'route-existing': 0, stop: 0 };
  for (const decision of decisions) summary[decision.decision] += 1;

  return {
    decisions,
    summary,
    creatable: decisions.filter((decision) => decision.decision === 'create').map((d) => d.job),
    blocking: decisions.filter((decision) => decision.decision === 'stop').map((d) => d.job),
  };
}
