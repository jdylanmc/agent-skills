#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COPILOT_ADAPTER,
  isPathShaped,
  isPublishableCountKey,
} from '../copilot-session-events/copilot-session-events.mjs';
import { replayLog } from '../../../_base/_molecules/chronicler/chronicler.mjs';

/**
 * The provider seam for session evidence.
 *
 * A post-mortem is not about one product. It is about a session, and every agent
 * harness records one differently. So the harness-specific part is one adapter
 * behind this seam, and everything downstream - diagnosis, proposals, the
 * rendered record - reads the common ledger this module defines and never a
 * harness's own event names.
 *
 * Two rules keep the seam honest:
 *
 * - **An unknown harness is a stated gap, not a best effort.** There is no
 *   generic parser that guesses at an unfamiliar log; guessing would produce
 *   confident evidence from a format nobody validated. An unknown harness
 *   returns a limitation and a PROPOSED recommendation describing the adapter
 *   that would close it.
 * - **The recommendation is data.** This module writes nothing, spawns nothing,
 *   and invokes nothing. Adding an adapter is a separate, human-approved
 *   reinforcement run.
 */

export const LEDGER_VERSION = 1;

/** The provider-neutral evidence vocabulary. Every adapter maps into this set. */
export const EVIDENCE_KINDS = [
  'session_started',
  'session_resumed',
  'session_ended',
  'session_aborted',
  'context_compaction_started',
  'context_compaction_completed',
  'runtime_error',
  'runtime_warning',
  'tool_failure',
  'subagent_started',
  'subagent_ended',
  'skill_invoked',
  'permission_denied',
];

export const LEDGER_COUNT_FIELDS = [
  'operator_messages',
  'agent_messages',
  'turns_started',
  'turns_completed',
  'tool_calls',
  'tool_failures',
  'subagent_calls',
  'subagent_failures',
  'skill_invocations',
  'runtime_errors',
];

export const COMPLETENESS_VALUES = ['complete', 'partial', 'compacted', 'summary_only'];
export const CONFIDENCE_CAPS = ['none', 'moderate'];

/**
 * Field names that would mean a harness leaked raw content into the ledger.
 * The seam refuses to certify a ledger carrying one, whoever produced it.
 */
const FORBIDDEN_DETAIL_FIELDS = [
  'content',
  'text',
  'prompt',
  'message',
  'arguments',
  'result',
  'output',
  'stack',
  'body',
  'transcript',
];

const MAX_HARNESS_CHARS = 60;
/** A published detail value is a short identifier or token, never a payload. */
const MAX_DETAIL_CHARS = 200;
const MAX_DETAIL_KEYS = 24;
const MAX_SKILL_ENTRIES = 500;
const MAX_NATIVE_COUNT_KEYS = 200;
const SOURCE_KINDS = ['session-log'];

/** Defects that put a run log's session identity in doubt. */
const IDENTITY_DEFECTS = ['session_identity_drift', 'foreign_run', 'run_identity_drift'];

/** Ledger limitations that make any correlation claim unsafe. */
const CONTESTED_LEDGER_CODES = ['session_identity_contradiction', 'session_identity_unpublishable'];

/** The adapters this repository has validated. One per harness, no fallback. */
export const DEFAULT_ADAPTERS = [COPILOT_ADAPTER];

function safeHarnessName(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_HARNESS_CHARS);
  return cleaned === '' ? null : cleaned;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

/**
 * Resolves a harness name to the adapter identity that owns it. An alias is a
 * label for one runtime, so two names for one runtime must never look like
 * two different sessions to anything downstream.
 */
export function canonicalHarness(harness, adapters = DEFAULT_ADAPTERS) {
  const named = safeHarnessName(harness);
  if (named === null) {
    return null;
  }
  const wanted = named.toLowerCase();
  const matched = adapters.find(
    (adapter) => adapter.id.toLowerCase() === wanted
      || (adapter.harnesses ?? []).some((alias) => alias.toLowerCase() === wanted),
  );
  return matched ? matched.id : named;
}

/**
 * Chooses the adapter for a harness. A named harness matches by identity; an
 * unnamed one may be detected from the runtime environment, but only when
 * exactly one adapter recognizes it. Two claimants is an ambiguity to report,
 * not a race to win.
 */
export function selectProvider({ harness = null, environment = process.env, adapters = DEFAULT_ADAPTERS } = {}) {
  const named = safeHarnessName(harness);
  if (named !== null) {
    const wanted = named.toLowerCase();
    const matched = adapters.filter(
      (adapter) => adapter.id.toLowerCase() === wanted
        || (adapter.harnesses ?? []).some((alias) => alias.toLowerCase() === wanted),
    );
    if (matched.length === 1) {
      return {
        status: 'selected',
        harness: matched[0].id,
        requested_harness: named,
        adapter: matched[0],
      };
    }
    if (matched.length > 1) {
      return {
        status: 'ambiguous',
        harness: null,
        requested_harness: named,
        adapter: null,
        claimants: matched.length,
      };
    }
    return { status: 'unsupported', harness: null, requested_harness: named, adapter: null };
  }

  const detected = adapters.filter((adapter) => {
    try {
      return adapter.detect(environment) === true;
    } catch {
      return false;
    }
  });
  if (detected.length === 1) {
    return {
      status: 'selected',
      harness: detected[0].id,
      requested_harness: null,
      adapter: detected[0],
      detected: true,
    };
  }
  if (detected.length > 1) {
    return { status: 'ambiguous', harness: null, requested_harness: null, adapter: null, claimants: detected.length };
  }
  return { status: 'unsupported', harness: null, requested_harness: null, adapter: null };
}

/**
 * The proposal an unknown harness produces. It is a recommendation with its
 * validation requirements attached, at the only lifecycle state this skill may
 * assign, and it is disposed by a person in a separate run.
 */
export function unsupportedProviderRecommendation(harness) {
  const named = safeHarnessName(harness);
  const subject = named ?? 'the current harness';
  const slug = slugify(named ?? 'unknown-harness');

  return {
    id: `session-evidence-adapter-${slug}`,
    name: `session-evidence adapter for ${subject}`,
    classification: 'new_skill_candidate',
    status: 'PROPOSED',
    reason: `No validated adapter reads ${subject}'s session evidence, so raw runtime evidence was unavailable for this post-mortem.`,
    traces_to: ['unsupported_provider'],
    generality_examples: [
      `every later post-mortem run inside ${subject}`,
      'any run that needs occurrence evidence a conversation cannot establish',
    ],
    package_grounding: 'not_covered',
    cost_of_error: 'A parser written from a guessed format would publish confident evidence nobody validated, which is worse than reporting the gap.',
    evaluator: `Reading a known ${subject} session reproduces its turn, tool, subagent, and failure counts, and publishes no prompt, tool result, or skill content.`,
    disconfirming_observation: `${subject} exposes no stable session record, or its format changes faster than an adapter can track.`,
    confidence: 'moderate',
    validation_requirements: {
      candidate: `session-evidence adapter for ${subject}`,
      independent_evidence_required: `A documented, stable event format for ${subject}, and at least one real session log to test the parser against.`,
      minimum_trial_scope: 'One adapter, read only, behind the existing seam, with the same contract tests every registered adapter passes.',
      success_measure: 'The adapter returns the common evidence ledger, and the ledger contract check passes unchanged.',
      failure_or_retirement_condition: 'The format proves unstable or undocumented, or the adapter cannot bound its output without losing the evidence that made it worth reading.',
      human_approval_required: true,
    },
    disposition: 'A person approves this, then a separate reinforce-skill run adds the adapter. This run applies nothing and invokes nothing.',
  };
}

function unsupportedResult(harness, detail) {
  return {
    status: 'unsupported',
    provider: null,
    harness: safeHarnessName(harness),
    ledger: null,
    limitations: [{ code: 'unsupported_provider', anchor: null, detail }],
    recommendation: unsupportedProviderRecommendation(harness),
  };
}

/**
 * Produces the common evidence ledger for whichever harness this session is
 * running in, or an explicit gap when none can be read. Every outcome is
 * reportable evidence; none of them is an exception thrown at the caller.
 */
export function collectSessionEvidence({
  harness = null,
  sessionId = null,
  explicitPath = null,
  transcriptPath = null,
  stateRoot = null,
  environment = process.env,
  adapters = DEFAULT_ADAPTERS,
  readerOptions = {},
} = {}) {
  const provider = selectProvider({ harness, environment, adapters });

  if (provider.status === 'ambiguous') {
    return {
      status: 'unavailable',
      provider: null,
      harness: provider.harness,
      ledger: null,
      limitations: [{
        code: 'provider_ambiguous',
        anchor: null,
        detail: `${provider.claimants} adapters claim this harness; identity must be named rather than guessed`,
      }],
      recommendation: null,
    };
  }
  if (provider.status === 'unsupported') {
    return unsupportedResult(
      harness,
      harness
        ? 'no validated adapter reads this harness, so its session evidence was not read'
        : 'no adapter recognized this runtime, so its session evidence was not read',
    );
  }

  const resolution = provider.adapter.resolve({
    explicitPath,
    transcriptPath,
    sessionId,
    stateRoot,
    environment,
  });
  if (resolution.status !== 'selected') {
    return {
      status: 'unavailable',
      provider: provider.adapter.id,
      harness: provider.harness,
      ledger: null,
      limitations: [{
        code: resolution.reason.code,
        anchor: null,
        detail: resolution.reason.detail,
      }],
      recommendation: null,
    };
  }

  let ledger;
  try {
    ledger = provider.adapter.read(resolution, readerOptions);
  } catch (error) {
    return {
      status: 'unavailable',
      provider: provider.adapter.id,
      harness: provider.harness,
      ledger: null,
      limitations: [{
        code: error.code ?? 'session_evidence_unreadable',
        anchor: null,
        detail: error.message,
      }],
      recommendation: null,
    };
  }

  const problems = assertLedgerContract(ledger);
  if (problems.length) {
    return {
      status: 'unavailable',
      provider: provider.adapter.id,
      harness: provider.harness,
      ledger: null,
      limitations: problems.map((detail) => ({ code: 'ledger_contract_violation', anchor: null, detail })),
      recommendation: null,
    };
  }

  return {
    status: 'collected',
    provider: provider.adapter.id,
    harness: provider.harness,
    ledger,
    limitations: ledger.limitations,
    recommendation: null,
  };
}

/**
 * The contract every adapter's output must satisfy. It is what makes one
 * adapter substitutable for another: whatever the harness, a consumer sees the
 * same shape, the same vocabulary, and the same guarantee that no raw content
 * came through.
 */
function checkDetailValue(problems, where, key, value, depth) {
  if (FORBIDDEN_DETAIL_FIELDS.includes(key)) {
    problems.push(`${where} must not carry raw ${key}`);
    return;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_DETAIL_CHARS) {
      problems.push(`${where}.${key} exceeds ${MAX_DETAIL_CHARS} characters, which is payload rather than evidence`);
    }
    if (isPathShaped(value)) {
      problems.push(`${where}.${key} publishes a filesystem path`);
    }
    return;
  }
  if (Array.isArray(value)) {
    problems.push(`${where}.${key} must be a scalar; a list is a payload in disguise`);
    return;
  }
  if (typeof value === 'object') {
    if (depth >= 1) {
      problems.push(`${where}.${key} nests deeper than the ledger permits`);
      return;
    }
    checkDetailObject(problems, `${where}.${key}`, value, depth + 1);
    return;
  }
  problems.push(`${where}.${key} is not a publishable value`);
}

function checkDetailObject(problems, where, detail, depth = 0) {
  const keys = Object.keys(detail);
  if (keys.length > MAX_DETAIL_KEYS) {
    problems.push(`${where} carries more than ${MAX_DETAIL_KEYS} fields`);
  }
  for (const key of keys) {
    checkDetailValue(problems, where, key, detail[key], depth);
  }
}

function checkSource(problems, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    problems.push('source must declare the kind of evidence it came from');
    return;
  }
  if (!SOURCE_KINDS.includes(source.kind)) {
    problems.push(`source.kind must be one of ${SOURCE_KINDS.join(', ')}`);
  }
  if (typeof source.log_id !== 'string' || source.log_id.trim() === '') {
    problems.push('source.log_id must be an opaque identifier');
  } else if (isPathShaped(source.log_id)) {
    problems.push('source.log_id must not be a filesystem path');
  } else if (source.log_id.length > MAX_DETAIL_CHARS) {
    problems.push(`source.log_id exceeds ${MAX_DETAIL_CHARS} characters`);
  }
  if (source.session_id !== null && typeof source.session_id !== 'string') {
    problems.push('source.session_id must be a string or null');
  }
  if (typeof source.session_id === 'string' && isPathShaped(source.session_id)) {
    problems.push('source.session_id must not be a filesystem path');
  }
  if (source.identity !== null && source.identity !== undefined) {
    if (typeof source.identity !== 'object' || Array.isArray(source.identity)) {
      problems.push('source.identity must be an object or null');
    } else {
      checkDetailObject(problems, 'source.identity', source.identity);
    }
  }
  if (source.identity_notes !== undefined && !Array.isArray(source.identity_notes)) {
    problems.push('source.identity_notes must be an array');
  }
}

function checkSkills(problems, skills) {
  if (!Array.isArray(skills)) {
    problems.push('skills must be an array');
    return;
  }
  if (skills.length > MAX_SKILL_ENTRIES) {
    problems.push(`skills exceeds ${MAX_SKILL_ENTRIES} entries`);
  }
  for (const skill of skills) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
      problems.push('every skill entry must be an object');
      continue;
    }
    if (typeof skill.anchor !== 'string' || !/^[A-Z]\d+$/.test(skill.anchor)) {
      problems.push(`skill anchor must be a source-scoped anchor; found ${String(skill.anchor)}`);
    }
    if (typeof skill.name !== 'string' || skill.name.trim() === '') {
      problems.push('every skill entry must name a skill');
    }
    checkDetailObject(problems, 'skills entry', skill);
  }
}

function checkProviderNative(problems, providerNative) {
  if (providerNative === undefined) {
    return;
  }
  if (!providerNative || typeof providerNative !== 'object' || Array.isArray(providerNative)) {
    problems.push('provider_native must be an object of counts');
    return;
  }
  // Counts only, one level of grouping. A harness may say how many of its own
  // events it saw; it may not smuggle a payload through as "native detail".
  for (const [group, value] of Object.entries(providerNative)) {
    if (!isPublishableCountKey(group)) {
      problems.push(`provider_native key ${JSON.stringify(group)} is not a publishable name`);
      continue;
    }
    if (Number.isInteger(value)) {
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      problems.push(`provider_native.${group} must be a count or a group of counts`);
      continue;
    }
    if (Object.keys(value).length > MAX_NATIVE_COUNT_KEYS) {
      problems.push(`provider_native.${group} carries more than ${MAX_NATIVE_COUNT_KEYS} counts`);
    }
    for (const [name, count] of Object.entries(value)) {
      if (!isPublishableCountKey(name)) {
        problems.push(`provider_native.${group} key ${JSON.stringify(name)} is not a publishable name`);
        continue;
      }
      if (!Number.isInteger(count) || count < 0) {
        problems.push(`provider_native.${group}.${name} must be a whole number`);
      }
    }
  }
}

export function assertLedgerContract(ledger) {
  const problems = [];
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    return ['the ledger is not an object'];
  }
  if (ledger.ledger_version !== LEDGER_VERSION) {
    problems.push(`ledger_version must be ${LEDGER_VERSION}`);
  }
  if (typeof ledger.provider !== 'string' || ledger.provider.trim() === '') {
    problems.push('provider must name the adapter that produced the ledger');
  }
  if (typeof ledger.harness !== 'string' || ledger.harness.trim() === '') {
    problems.push('harness must name the runtime the ledger was read from');
  } else if (ledger.harness !== ledger.provider) {
    // The published harness is always the adapter's own identity. An alias here
    // would reintroduce the two-names-one-runtime problem downstream.
    problems.push('harness must be the canonical adapter identity, not an alias');
  }
  if (!COMPLETENESS_VALUES.includes(ledger.completeness)) {
    problems.push(`completeness must be one of ${COMPLETENESS_VALUES.join(', ')}`);
  }
  if (!CONFIDENCE_CAPS.includes(ledger.confidence_cap)) {
    problems.push(`confidence_cap must be one of ${CONFIDENCE_CAPS.join(', ')}`);
  }
  if (ledger.completeness !== 'complete' && ledger.confidence_cap !== 'moderate') {
    problems.push('incomplete evidence must cap confidence');
  }

  checkSource(problems, ledger.source);
  checkSkills(problems, ledger.skills);
  checkProviderNative(problems, ledger.provider_native);

  if (!ledger.counts || typeof ledger.counts !== 'object') {
    problems.push('counts must be an object');
  } else {
    for (const field of LEDGER_COUNT_FIELDS) {
      if (!Number.isInteger(ledger.counts[field]) || ledger.counts[field] < 0) {
        problems.push(`counts.${field} must be a whole number`);
      }
    }
  }

  if (!Array.isArray(ledger.entries)) {
    problems.push('entries must be an array');
  } else {
    for (const entry of ledger.entries) {
      if (!entry || typeof entry !== 'object') {
        problems.push('every entry must be an object');
        continue;
      }
      if (typeof entry.anchor !== 'string' || !/^[A-Z]\d+$/.test(entry.anchor)) {
        problems.push(`entry anchor must be a source-scoped anchor such as E12; found ${String(entry.anchor)}`);
      }
      if (!EVIDENCE_KINDS.includes(entry.kind)) {
        problems.push(`entry kind ${String(entry.kind)} is outside the neutral vocabulary`);
      }
      if (entry.at !== null && entry.at !== undefined && typeof entry.at !== 'string') {
        problems.push('entry at must be a timestamp string or null');
      }
      const detail = entry.detail ?? {};
      if (typeof detail !== 'object' || Array.isArray(detail)) {
        problems.push('entry detail must be an object');
      } else {
        checkDetailObject(problems, 'entry detail', detail);
      }
    }
  }

  if (!Array.isArray(ledger.limitations)) {
    problems.push('limitations must be an array');
  } else if (ledger.limitations.some((entry) => typeof entry?.code !== 'string')) {
    problems.push('every limitation must carry a stable code');
  }

  return problems;
}

/**
 * Lines one Skill Run Log up with the session evidence, using the correlation
 * Chronicle records rather than adjacent timestamps. An uncorrelated log is
 * unknown, which is a fact about the log and not a mismatch.
 */
export function correlateRunLog(replayState, ledger, { adapters = DEFAULT_ADAPTERS } = {}) {
  // A ledger whose own session identity is contested cannot anchor a
  // correlation: the question a correlation answers is exactly the one the
  // contradiction left open.
  const contested = (ledger?.limitations ?? []).find(
    (limitation) => CONTESTED_LEDGER_CODES.includes(limitation?.code),
  );
  if (contested) {
    return {
      status: 'unknown',
      reason: `the session evidence reported ${contested.code}, so its identity cannot anchor a correlation`,
    };
  }

  // A replay that reported an identity defect cannot support a correlation
  // claim in either direction: the log's own account of which run and session
  // it belongs to is what is in doubt.
  const defects = Array.isArray(replayState?.defects) ? replayState.defects : [];
  const identityDefect = defects.find((defect) => IDENTITY_DEFECTS.includes(defect?.type));
  if (identityDefect) {
    return {
      status: 'unknown',
      reason: `replay reported ${identityDefect.type}, so the run log's session identity is in doubt`,
    };
  }

  const runSession = replayState?.session_id ?? null;
  const runHarness = canonicalHarness(replayState?.harness ?? null, adapters);
  const ledgerSession = ledger?.source?.session_id ?? null;
  const ledgerHarness = canonicalHarness(ledger?.harness ?? null, adapters);

  if (runSession === null) {
    return { status: 'unknown', reason: 'the run log records no session correlation' };
  }
  if (ledgerSession === null) {
    return { status: 'unknown', reason: 'the session evidence carries no session identity' };
  }
  if (runSession !== ledgerSession) {
    return { status: 'different-session', reason: 'the run log belongs to another session' };
  }
  if (runHarness !== null && ledgerHarness !== null && runHarness !== ledgerHarness) {
    return { status: 'different-session', reason: 'the run log records a different harness' };
  }
  return { status: 'same-session', reason: 'the run log and the session evidence share one session identity' };
}

/**
 * The production path for correlating one selected Skill Run Log with the
 * session evidence this seam collected. It replays the log read-only through
 * Chronicle, refuses to guess when replay cannot read it, and returns the
 * verdict with the identities it was decided from.
 */
export function correlateSelectedRunLog(runLogPath, evidence, { adapters = DEFAULT_ADAPTERS } = {}) {
  if (typeof runLogPath !== 'string' || runLogPath.trim() === '') {
    return {
      status: 'unknown',
      reason: 'no run log was selected',
      run_log: null,
      session_evidence: null,
    };
  }

  let replayed;
  try {
    replayed = replayLog(runLogPath, { logId: `runlog:${path.basename(runLogPath)}` });
  } catch (error) {
    return {
      status: 'unknown',
      reason: `the selected run log could not be replayed: ${error.code ?? 'log_unavailable'}`,
      run_log: null,
      session_evidence: null,
    };
  }

  const ledger = evidence?.ledger ?? null;
  const verdict = correlateRunLog(replayed, ledger, { adapters });
  return {
    ...verdict,
    run_log: {
      log_id: replayed.log_id,
      run_id: replayed.run_id,
      root_skill: replayed.root_skill,
      harness: canonicalHarness(replayed.harness, adapters),
      session_id: replayed.session_id,
      complete: replayed.complete,
      defects: replayed.defects.map((defect) => defect.type),
    },
    session_evidence: ledger === null ? null : {
      provider: ledger.provider,
      harness: ledger.harness,
      session_id: ledger.source?.session_id ?? null,
      log_id: ledger.source?.log_id ?? null,
    },
  };
}

function main(argv) {
  const options = {};
  let runLogPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--probe') {
      console.log('session-evidence-adapter: available');
      return 0;
    }
    if (argument === '--providers') {
      console.log(JSON.stringify(DEFAULT_ADAPTERS.map((adapter) => ({
        id: adapter.id,
        harnesses: adapter.harnesses,
      })), null, 2));
      return 0;
    }
    if (['--harness', '--session-id', '--session-root', '--transcript', '--path', '--correlate'].includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error(JSON.stringify({ error: { code: 'usage', message: `${argument} requires a value` } }));
        return 1;
      }
      index += 1;
      if (argument === '--correlate') {
        runLogPath = value;
        continue;
      }
      const field = {
        '--harness': 'harness',
        '--session-id': 'sessionId',
        '--session-root': 'stateRoot',
        '--transcript': 'transcriptPath',
        '--path': 'explicitPath',
      }[argument];
      options[field] = value;
      continue;
    }
    console.error(JSON.stringify({ error: { code: 'usage', message: `unsupported option ${argument}` } }));
    return 1;
  }

  const evidence = collectSessionEvidence(options);
  if (runLogPath === null) {
    console.log(JSON.stringify(evidence, null, 2));
    return 0;
  }
  console.log(JSON.stringify({
    evidence,
    correlation: correlateSelectedRunLog(runLogPath, evidence),
  }, null, 2));
  return 0;
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
