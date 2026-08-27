#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { COPILOT_ADAPTER } from '../copilot-session-events/copilot-session-events.mjs';

/**
 * The provider seam for session evidence.
 *
 * A post-mortem is not about Copilot. It is about a session, and every agent
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
  'context_compacted',
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
      return { status: 'selected', harness: named, adapter: matched[0] };
    }
    if (matched.length > 1) {
      return { status: 'ambiguous', harness: named, adapter: null, claimants: matched.length };
    }
    return { status: 'unsupported', harness: named, adapter: null };
  }

  const detected = adapters.filter((adapter) => {
    try {
      return adapter.detect(environment) === true;
    } catch {
      return false;
    }
  });
  if (detected.length === 1) {
    return { status: 'selected', harness: detected[0].id, adapter: detected[0], detected: true };
  }
  if (detected.length > 1) {
    return { status: 'ambiguous', harness: null, adapter: null, claimants: detected.length };
  }
  return { status: 'unsupported', harness: null, adapter: null };
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
      minimum_trial_scope: 'One adapter, read only, behind the existing seam, with the same contract tests the Copilot adapter passes.',
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
    ledger = provider.adapter.read({ ...resolution, harness: provider.harness }, readerOptions);
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
  if (!COMPLETENESS_VALUES.includes(ledger.completeness)) {
    problems.push(`completeness must be one of ${COMPLETENESS_VALUES.join(', ')}`);
  }
  if (!CONFIDENCE_CAPS.includes(ledger.confidence_cap)) {
    problems.push(`confidence_cap must be one of ${CONFIDENCE_CAPS.join(', ')}`);
  }
  if (ledger.completeness !== 'complete' && ledger.confidence_cap !== 'moderate') {
    problems.push('incomplete evidence must cap confidence');
  }

  const source = ledger.source;
  if (!source || typeof source !== 'object' || typeof source.kind !== 'string') {
    problems.push('source must declare the kind of evidence it came from');
  }

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
      const detail = entry.detail ?? {};
      for (const field of Object.keys(detail)) {
        if (FORBIDDEN_DETAIL_FIELDS.includes(field)) {
          problems.push(`entry detail must not carry raw ${field}`);
        }
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
export function correlateRunLog(replayState, ledger) {
  const runSession = replayState?.session_id ?? null;
  const runHarness = replayState?.harness ?? null;
  const ledgerSession = ledger?.source?.session_id ?? null;
  const ledgerHarness = ledger?.harness ?? null;

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

function main(argv) {
  const options = {};
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
    if (['--harness', '--session-id', '--session-root', '--transcript', '--path'].includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error(JSON.stringify({ error: { code: 'usage', message: `${argument} requires a value` } }));
        return 1;
      }
      index += 1;
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

  console.log(JSON.stringify(collectSessionEvidence(options), null, 2));
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
