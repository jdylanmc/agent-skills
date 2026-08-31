import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  adaptOrchestrationPayload,
  normalizeOrchestrationPayload,
} from '../../../_base/_molecules/persist-orchestration-handoff/persist-orchestration-handoff.mjs';
import {
  normalizePayload,
  redactPayload,
  redactTextWithConfiguredIdentifiers,
  renderHandoff,
} from '../../../_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';

export const LOCAL_REMEDIATION_LIMIT = 5;

const HANDOFF_RESULT_KEYS = [
  'path', 'directory', 'name', 'bytes', 'headings', 'redactions',
  'suggested_skills_included',
];

const REQUIRED_BINDINGS = [
  'issue',
  'branch',
  'worktree',
  'base_sha',
  'head_sha',
  'continuation_generation',
  'local_remediation_limit',
  'global_continuation_limit',
  'global_continuation_source',
  'confirmed_packet_id',
  'confirmed_packet_digest',
  'finding_fingerprints',
  'change_ledger',
  'exclusions',
  'change_request',
  'isolation_state',
  'criterion_verdicts',
  'reconciliation_result',
  'run_ci_evidence',
  'roast_findings',
  'prior_remediation_attempts',
];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function exactKeys(value, keys) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && same(Object.keys(value).sort(), [...keys].sort());
}

function binding(payload, name) {
  return payload.inputs.filter((entry) => entry?.name === name);
}

function structuredBindingMatches(entry, expected) {
  try {
    return same(JSON.parse(entry.value), expected);
  } catch {
    return false;
  }
}

function validCount(value, { positive = false } = {}) {
  return Number.isInteger(value) && value >= (positive ? 1 : 0);
}

function validRevision(value) {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

function stepIdentity(step) {
  return JSON.stringify({
    workflow: step.workflow ?? null,
    job: step.job ?? null,
    name: step.name ?? null,
    command: step.command ?? null,
  });
}

export function fingerprintFinding(finding) {
  if (!finding || typeof finding !== 'object'
      || !nonEmpty(finding.location)
      || !nonEmpty(finding.rule)
      || !nonEmpty(finding.ledgerEntryId)) {
    throw new Error('stable finding location, rule, and ledger entry are required');
  }
  return crypto.createHash('sha256').update(JSON.stringify(stable({
    kind: finding.kind ?? 'roast',
    classification: finding.classification ?? null,
    ledgerEntryId: finding.ledgerEntryId,
    location: finding.locationIdentity ?? finding.location.replace(/:\d+(?::\d+)?$/, ''),
    rule: finding.rule,
  }))).digest('hex');
}

function validationFindings(validation, classifications) {
  if (!validation || validation.evidenceComplete !== true) return null;
  if (validation.status === 'passed') return [];
  if (validation.status === 'intermittent') return 'intermittent';
  if (validation.status !== 'failed') return validation.status ?? 'incomplete';
  const failed = (validation.steps ?? []).filter((step) =>
    !['passed', 'intermittent'].includes(step?.status));
  if (failed.length === 0 || !Array.isArray(classifications)) return null;
  const findings = failed.map((step) => {
    const identity = stepIdentity(step);
    const matches = classifications.filter((entry) => entry?.stepIdentity === identity);
    if (matches.length !== 1) return null;
    return {
      ...matches[0],
      id: matches[0].id ?? identity,
      kind: 'run-ci',
      severity: 'Must fix',
    };
  });
  return findings.includes(null) ? null : findings;
}

function measurableProgress(previous, current, currentFingerprints) {
  if (previous === null || previous === undefined) return true;
  const required = ['headSha', 'diffDigest', 'validationStatus'];
  if (required.some((field) => !nonEmpty(previous?.[field]) || !nonEmpty(current?.[field]))) {
    return false;
  }
  const revisionChanged = previous.headSha !== current.headSha
    || previous.diffDigest !== current.diffDigest;
  const validationRank = { failed: 0, intermittent: 1, passed: 2 };
  const validationImproved = (validationRank[current.validationStatus] ?? -1)
    > (validationRank[previous.validationStatus] ?? -1);
  const priorFindings = new Set(previous.findingFingerprints ?? []);
  const blockerRemoved = [...priorFindings].some((fingerprint) =>
    !currentFingerprints.includes(fingerprint));
  const criterionRank = {
    'not-satisfied': 0,
    'not-verifiable': 0,
    partial: 1,
    satisfied: 2,
    descoped: 2,
  };
  const priorCriteria = new Map((previous.criterionVerdicts ?? [])
    .map((criterion) => [criterion.id, criterion.verdict]));
  const currentCriteria = new Map((current.criterionVerdicts ?? [])
    .map((criterion) => [criterion.id, criterion.verdict]));
  const criteriaComparable = priorCriteria.size > 0
    && priorCriteria.size === currentCriteria.size
    && [...priorCriteria.keys()].every((id) => currentCriteria.has(id));
  const criteriaImproved = criteriaComparable
    && [...priorCriteria].every(([id, verdict]) =>
      (criterionRank[currentCriteria.get(id)] ?? -1) >= (criterionRank[verdict] ?? -1))
    && [...priorCriteria].some(([id, verdict]) =>
      (criterionRank[currentCriteria.get(id)] ?? -1) > (criterionRank[verdict] ?? -1));
  return revisionChanged && (validationImproved || blockerRemoved || criteriaImproved);
}

export function evaluateRemediationContinuation(input) {
  const packet = input.confirmedPacket;
  const policy = packet && {
    source: packet.globalContinuationSource,
    packetId: packet.id,
    packetDigest: packet.digest,
    limit: packet.globalContinuationLimit,
  };
  if (!validCount(input.localAttempts)
      || input.localLimit !== LOCAL_REMEDIATION_LIMIT
      || !validCount(input.continuationsUsed)
      || !nonEmpty(policy?.source)
      || !nonEmpty(policy?.packetId)
      || !nonEmpty(policy?.packetDigest)
      || !validCount(policy?.limit, { positive: true })) {
    throw new Error('bounded local and global continuation accounting is required');
  }
  if (input.localAttempts > LOCAL_REMEDIATION_LIMIT) {
    return {
      action: 'human-handoff',
      reason: 'local-attempt-accounting-invalid',
      invokeShepherd: false,
      unresolved: [],
    };
  }
  if (!Array.isArray(input.findings)) throw new Error('review findings are required');
  if (!validRevision(input.currentState?.headSha)
      || input.validation?.repository?.revision !== input.currentState.headSha) {
    return {
      action: 'human-handoff',
      reason: 'validation-revision-stale-or-invalid',
      invokeShepherd: false,
      unresolved: [],
    };
  }
  const ciFindings = validationFindings(input.validation, input.validationClassifications);
  if (ciFindings === 'intermittent') {
    return {
      action: 'human-handoff',
      reason: 'validation-intermittent',
      invokeShepherd: false,
      unresolved: [],
    };
  }
  if (ciFindings === null) {
    return {
      action: 'human-handoff',
      reason: 'validation-evidence-incomplete',
      invokeShepherd: false,
      unresolved: [],
    };
  }
  if (!Array.isArray(ciFindings)) {
    return {
      action: 'human-handoff',
      reason: `validation-${ciFindings}`,
      invokeShepherd: false,
      unresolved: [],
    };
  }

  const unresolved = [...input.findings, ...ciFindings]
    .filter((finding) => finding?.severity === 'Must fix' && finding?.cleared !== true)
    .map((finding) => ({
      ...finding,
      fingerprint: fingerprintFinding(finding),
    }));
  const fingerprints = unresolved.map((finding) => finding.fingerprint).sort();
  if (new Set(fingerprints).size !== fingerprints.length) {
    return {
      action: 'human-handoff',
      reason: 'finding-fingerprint-collision',
      invokeShepherd: false,
      unresolved,
    };
  }
  if (unresolved.length === 0) {
    return { action: 'invoke-shepherd', reason: 'no-unresolved-implementation-must-fix', invokeShepherd: true, unresolved };
  }
  if (unresolved.some((finding) => finding.classification === 'human-owned')) {
    return { action: 'human-handoff', reason: 'scope-or-intent-decision-required', invokeShepherd: false, unresolved };
  }
  if (unresolved.every((finding) => finding.classification === 'shepherd-owned')) {
    return { action: 'invoke-shepherd', reason: 'remaining-condition-is-shepherd-owned', invokeShepherd: true, unresolved };
  }
  if (unresolved.some((finding) => finding.classification !== 'implementation')) {
    return { action: 'human-handoff', reason: 'mixed-or-unknown-finding-ownership', invokeShepherd: false, unresolved };
  }
  if (input.localAttempts < input.localLimit) {
    return { action: 'dispatch-local-remediation', reason: 'local-remediation-budget-available', invokeShepherd: false, unresolved };
  }
  if (input.continuationsUsed >= policy.limit) {
    return { action: 'human-handoff', reason: 'global-continuation-ceiling-reached', invokeShepherd: false, unresolved };
  }

  const previous = [...(input.previousState?.findingFingerprints ?? [])].sort();
  if (input.continuationsUsed > 0
      && (!input.previousState
        || previous.length === 0
        || !nonEmpty(input.previousState.headSha)
        || !nonEmpty(input.previousState.diffDigest)
        || !nonEmpty(input.previousState.validationStatus)
        || !Array.isArray(input.previousState.criterionVerdicts))) {
    return { action: 'human-handoff', reason: 'prior-continuation-state-incomplete', invokeShepherd: false, unresolved };
  }
  if (previous.some((fingerprint) => fingerprints.includes(fingerprint))
      && !measurableProgress(input.previousState, input.currentState, fingerprints)) {
    return { action: 'human-handoff', reason: 'unchanged-blocker-without-progress', invokeShepherd: false, unresolved };
  }
  return {
    action: 'persist-continuation-handoff',
    reason: 'local-remediation-budget-exhausted',
    invokeShepherd: false,
    unresolved,
    findingFingerprints: fingerprints,
    nextGeneration: input.continuationsUsed + 1,
    nextLocalBudget: { used: 0, limit: LOCAL_REMEDIATION_LIMIT },
    globalContinuationPolicy: structuredClone(policy),
    validationStatus: input.validation.status,
    failedStepIdentities: (input.validation.steps ?? [])
      .filter((step) => !['passed', 'intermittent'].includes(step?.status))
      .map(stepIdentity)
      .sort(),
  };
}

function expectedHandoffRendering(payload, identifiers = []) {
  const core = normalizePayload(adaptOrchestrationPayload(payload));
  const redacted = redactPayload(core, identifiers);
  const rendered = renderHandoff(redacted.payload);
  const settled = redactTextWithConfiguredIdentifiers(rendered.document, identifiers);
  const counts = new Map();
  for (const entry of [...redacted.redactions, ...settled.redactions]) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + entry.count);
  }
  return {
    document: settled.text,
    redactions: [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => left.category.localeCompare(right.category)),
    suggestedSkillsIncluded: redacted.payload.suggested_skills !== null,
  };
}

export function expectedHandoffDocument(payload, identifiers = []) {
  return expectedHandoffRendering(payload, identifiers).document;
}

export function digestCanonicalContinuationState(state) {
  const copy = structuredClone(state);
  delete copy.digest;
  return crypto.createHash('sha256').update(JSON.stringify(stable(copy))).digest('hex');
}

function readArtifact(receipt) {
  const stat = fs.lstatSync(receipt.path);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(receipt.path) !== receipt.path) {
    throw new Error('handoff artifact is not a real regular file');
  }
  return { bytes: fs.readFileSync(receipt.path), modifiedAt: stat.mtime.toISOString() };
}

export function authorizeFreshContinuation(input, options = {}) {
  const defects = [];
  if (input?.decision?.action !== 'persist-continuation-handoff') {
    defects.push('continuation decision does not authorize persistence');
  }
  let payload = null;
  try {
    payload = normalizeOrchestrationPayload(input?.handoffPayload);
  } catch (error) {
    defects.push(`orchestration handoff payload is invalid: ${error.code ?? error.message}`);
  }
  const receipt = input?.handoffReceipt;
  if (!exactKeys(receipt, HANDOFF_RESULT_KEYS)) {
    defects.push('handoff receipt is incomplete or not the actual persistence result');
  } else {
    if (!nonEmpty(receipt.path) || !nonEmpty(receipt.directory) || !nonEmpty(receipt.name)) {
      defects.push('handoff receipt path metadata is incomplete');
    } else if (path.dirname(receipt.path) !== receipt.directory
        || path.basename(receipt.path) !== receipt.name) {
      defects.push('handoff receipt path metadata is inconsistent');
    }
    if (!Number.isInteger(receipt.bytes) || receipt.bytes < 1
        || !Array.isArray(receipt.headings)
        || !Array.isArray(receipt.redactions)
        || typeof receipt.suggested_skills_included !== 'boolean') {
      defects.push('handoff receipt verification metadata is incomplete');
    }
  }

  let expected = null;
  try {
    expected = options.loadCanonicalState?.(input?.canonicalStateRef);
  } catch (error) {
    defects.push(`canonical Ship state could not be loaded: ${error.code ?? error.message}`);
  }
  if (!expected
      || expected.schemaVersion !== 1
      || expected.confirmed !== true
      || !nonEmpty(expected.digest)
      || digestCanonicalContinuationState(expected) !== expected.digest) {
    defects.push('canonical Ship state is absent, unconfirmed, or digest-mismatched');
    expected = expected ?? {};
  }
  if (input?.decision?.nextGeneration !== expected.nextGeneration
      || input?.decision?.nextLocalBudget?.limit !== LOCAL_REMEDIATION_LIMIT
      || !same(input?.decision?.findingFingerprints, expected.findingFingerprints)
      || !same(input?.decision?.globalContinuationPolicy, expected.globalContinuationPolicy)
      || input?.decision?.invokeShepherd !== false) {
    defects.push('handoff policy does not match the continuation decision');
  }
  if (payload) {
    if (payload.run_identity.run_id !== expected.runId
        || payload.source_agent.id !== expected.sourceAgent
        || payload.target_agent.id !== expected.targetAgent) {
      defects.push('handoff run or agent identity is stale');
    }
    for (const name of REQUIRED_BINDINGS) {
      const entries = binding(payload, name);
      if (entries.length !== 1 || !nonEmpty(entries[0]?.source)) {
        defects.push(`handoff binding ${name} is missing or duplicated`);
      }
    }
    const scalarBindings = {
      issue: expected.issue,
      branch: expected.branch,
      worktree: expected.worktree,
      base_sha: expected.baseSha,
      head_sha: expected.headSha,
      continuation_generation: expected.nextGeneration,
      local_remediation_limit: LOCAL_REMEDIATION_LIMIT,
      global_continuation_limit: expected.globalContinuationPolicy?.limit,
      global_continuation_source: expected.globalContinuationPolicy?.source,
      confirmed_packet_id: expected.globalContinuationPolicy?.packetId,
      confirmed_packet_digest: expected.globalContinuationPolicy?.packetDigest,
    };
    for (const [name, value] of Object.entries(scalarBindings)) {
      const entries = binding(payload, name);
      if (entries.length !== 1 || String(entries[0].value) !== String(value)) {
        defects.push(`handoff binding ${name} does not match current continuation state`);
      }
    }
    const structuredBindings = {
      finding_fingerprints: expected.findingFingerprints,
      change_ledger: expected.changeLedger,
      exclusions: expected.exclusions,
      change_request: expected.changeRequest ?? null,
      isolation_state: expected.isolationState,
      criterion_verdicts: expected.criterionVerdicts,
      reconciliation_result: expected.reconciliationResult,
      run_ci_evidence: expected.runCiEvidence,
      roast_findings: expected.roastFindings,
      prior_remediation_attempts: expected.priorRemediationAttempts,
    };
    for (const [name, value] of Object.entries(structuredBindings)) {
      const entries = binding(payload, name);
      if (entries.length !== 1 || !structuredBindingMatches(entries[0], value)) {
        defects.push(`handoff binding ${name} does not match current continuation state`);
      }
    }
    if (!same(payload.acceptance_criteria, expected.acceptanceCriteria)) {
      defects.push('handoff acceptance criteria do not match');
    }
    if (!same(payload.task_contract, expected.taskContract)) {
      defects.push('handoff task contract does not match current Ship state');
    }
    const runCi = expected.runCiEvidence;
    if (runCi?.evidenceComplete !== true
        || runCi?.repository?.revision !== expected.headSha
        || runCi?.status !== input?.decision?.validationStatus
        || !same(
          (runCi?.steps ?? [])
            .filter((step) => !['passed', 'intermittent'].includes(step?.status))
            .map(stepIdentity)
            .sort(),
          input?.decision?.failedStepIdentities,
        )) {
      defects.push('run-ci evidence is incomplete, stale, or differs from the continuation decision');
    }
  }

  let freshness = {};
  try {
    freshness = options.observeGitState?.(expected) ?? {};
  } catch (error) {
    defects.push(`continuation git state could not be observed: ${error.code ?? error.message}`);
  }
  if (freshness.complete !== true
      || freshness.branch !== expected.branch
      || freshness.worktree !== expected.worktree
      || freshness.baseSha !== expected.baseSha
      || freshness.headSha !== expected.headSha
      || !nonEmpty(freshness.observedAt)) {
    defects.push('continuation branch, worktree, base, or head was not freshly re-read');
  }
  if (receipt && payload && defects.length === 0) {
    try {
      const observation = (options.readArtifact ?? readArtifact)(receipt);
      const expectedRendering = expectedHandoffRendering(
        input.handoffPayload,
        options.identifiers ?? [],
      );
      const expectedDocument = expectedRendering.document;
      const bytes = Buffer.isBuffer(observation.bytes)
        ? observation.bytes
        : Buffer.from(observation.bytes ?? '', 'utf8');
      const content = bytes.toString('utf8');
      const headings = content.split('\n')
        .filter((line) => line.startsWith('## '))
        .map((line) => line.slice(3));
      if (bytes.length !== receipt.bytes
          || content !== expectedDocument
          || !same(headings, receipt.headings)
          || !same(receipt.redactions, expectedRendering.redactions)
          || receipt.suggested_skills_included !== expectedRendering.suggestedSkillsIncluded
          || !nonEmpty(observation.modifiedAt)
          || Date.parse(observation.modifiedAt) > Date.parse(freshness.observedAt)) {
        defects.push('handoff artifact does not verify against the current payload and freshness observation');
      }
    } catch (error) {
      defects.push(`handoff artifact reread failed: ${error.code ?? error.message}`);
    }
  }
  let ownership = {};
  try {
    ownership = options.observeOwnership?.(expected) ?? {};
  } catch (error) {
    defects.push(`continuation ownership could not be observed: ${error.code ?? error.message}`);
  }
  if (ownership.branch !== expected.branch
      || ownership.worktree !== expected.worktree
      || ownership.sourceAgent !== expected.sourceAgent
      || ownership.targetAgent !== expected.targetAgent
      || ownership.sourceReleased !== true
      || ownership.targetActivated !== true
      || ownership.concurrentOwners !== 1) {
    defects.push('branch and worktree ownership was not explicitly transferred');
  }

  if (defects.length > 0) {
    return {
      authorized: false,
      action: 'human-handoff',
      reason: 'stale-or-incomplete-continuation-handoff',
      invokeShepherd: false,
      defects,
    };
  }
  return {
    authorized: true,
    action: 'dispatch-fresh-continuation',
    invokeShepherd: false,
    generation: expected.nextGeneration,
    localBudget: { used: 0, limit: LOCAL_REMEDIATION_LIMIT },
    globalContinuationPolicy: structuredClone(expected.globalContinuationPolicy),
    branch: expected.branch,
    worktree: expected.worktree,
    baseSha: expected.baseSha,
    headSha: expected.headSha,
    requireCompleteDiffReconciliation: true,
    handoffPath: receipt.path,
  };
}
