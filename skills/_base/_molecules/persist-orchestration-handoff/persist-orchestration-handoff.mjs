#!/usr/bin/env node
/**
 * Versioned orchestration handoff adapter over the bounded handoff core.
 *
 * This module validates the agent-to-agent orchestration document schema and
 * adapts it into the existing bounded handoff payload. It deliberately leaves
 * the schema-version-1 core untouched, so the human-facing handoff caller keeps
 * the same strict unknown-field and version checks it already relies on.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadIdentifierConfig } from '../../_atoms/redact-sensitive/redact-sensitive.config.mjs';
import {
  HandoffError,
  MAX_INPUT_BYTES,
  persistBoundedHandoff,
} from '../persist-bounded-handoff/persist-bounded-handoff.mjs';

export const ORCHESTRATION_SCHEMA_VERSION = 1;
export const DEFAULT_ORCHESTRATION_TITLE = 'Orchestration Handoff';

const MAX_LINE_BYTES = 300;
const MAX_TEXT_BYTES = 2000;
const MAX_LIST_ITEMS = 50;
const MAX_INPUTS = 50;

const PAYLOAD_FIELDS = new Set([
  'schema_version',
  'title',
  'slug',
  'slug_source',
  'run_identity',
  'source_agent',
  'target_agent',
  'task_contract',
  'inputs',
  'constraints',
  'assumptions',
  'artifacts_and_references',
  'acceptance_criteria',
  'open_questions',
  'suggested_skills',
  'available_skills',
]);

const RUN_IDENTITY_FIELDS = new Set(['run_id', 'root_skill', 'parent_run_id', 'log_path']);
const SOURCE_AGENT_FIELDS = new Set(['id', 'role']);
const TARGET_AGENT_FIELDS = new Set(['id', 'role', 'invocation_reason']);
const TASK_CONTRACT_FIELDS = new Set([
  'goal',
  'scope',
  'context',
  'verify',
  'timebox',
  'forbidden',
  'report',
  'standing',
]);
const INPUT_FIELDS = new Set(['name', 'value', 'source']);

function fail(code, message, reason = null) {
  throw new HandoffError(code, message, reason);
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKnownKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    fail('malformed_payload', `${field} has unknown field(s): ${unknown.sort().join(', ')}`);
  }
}

function line(value, field, { required = true, limit = MAX_LINE_BYTES } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) {
      return '';
    }
    fail('malformed_payload', `${field} is required`);
  }
  if (typeof value !== 'string') {
    fail('malformed_payload', `${field} must be a string`);
  }
  const next = value.trim();
  if (!next) {
    if (!required) {
      return '';
    }
    fail('malformed_payload', `${field} must not be empty`);
  }
  if (/\r|\n/.test(next)) {
    fail('malformed_payload', `${field} must be a single line`);
  }
  if (byteLength(next) > limit) {
    fail('malformed_payload', `${field} exceeds ${limit} UTF-8 bytes`);
  }
  return next;
}

function text(value, field, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) {
      return '';
    }
    fail('malformed_payload', `${field} is required`);
  }
  if (typeof value !== 'string') {
    fail('malformed_payload', `${field} must be a string`);
  }
  const next = value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((entry) => entry.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
  if (!next && required) {
    fail('malformed_payload', `${field} must not be empty`);
  }
  if (byteLength(next) > MAX_TEXT_BYTES) {
    fail('malformed_payload', `${field} exceeds ${MAX_TEXT_BYTES} UTF-8 bytes`);
  }
  return next;
}

function normalizeStringList(value, field, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) {
      return [];
    }
    fail('malformed_payload', `${field} is required`);
  }
  if (!Array.isArray(value)) {
    fail('malformed_payload', `${field} must be an array of strings`);
  }
  if (value.length > MAX_LIST_ITEMS) {
    fail('malformed_payload', `${field} holds more than ${MAX_LIST_ITEMS} entries`);
  }
  return value.map((entry, index) => line(entry, `${field}[${index}]`));
}

function normalizeRunIdentity(value) {
  if (!isPlainObject(value)) {
    fail('malformed_payload', 'run_identity must be an object');
  }
  assertKnownKeys(value, RUN_IDENTITY_FIELDS, 'run_identity');
  return {
    run_id: line(value.run_id, 'run_identity.run_id'),
    root_skill: line(value.root_skill, 'run_identity.root_skill', { required: false }),
    parent_run_id: line(value.parent_run_id, 'run_identity.parent_run_id', { required: false }),
    log_path: line(value.log_path, 'run_identity.log_path', { required: false }),
  };
}

function normalizeAgent(value, field, { target = false } = {}) {
  if (!isPlainObject(value)) {
    fail('malformed_payload', `${field} must be an object`);
  }
  assertKnownKeys(value, target ? TARGET_AGENT_FIELDS : SOURCE_AGENT_FIELDS, field);
  return {
    id: line(value.id, `${field}.id`),
    role: line(value.role, `${field}.role`, { required: false }),
    invocation_reason: target
      ? line(value.invocation_reason, `${field}.invocation_reason`, { required: false })
      : '',
  };
}

function normalizeTaskContract(value) {
  if (!isPlainObject(value)) {
    fail('malformed_payload', 'task_contract must be an object');
  }
  assertKnownKeys(value, TASK_CONTRACT_FIELDS, 'task_contract');
  return {
    goal: text(value.goal, 'task_contract.goal'),
    scope: text(value.scope, 'task_contract.scope'),
    context: text(value.context, 'task_contract.context'),
    verify: text(value.verify, 'task_contract.verify'),
    timebox: line(value.timebox, 'task_contract.timebox', { required: false }),
    forbidden: text(value.forbidden, 'task_contract.forbidden', { required: false }),
    report: text(value.report, 'task_contract.report'),
    standing: text(value.standing, 'task_contract.standing'),
  };
}

function normalizeInputs(value) {
  if (value === undefined || value === null) {
    fail('malformed_payload', 'inputs is required');
  }
  if (!Array.isArray(value)) {
    fail('malformed_payload', 'inputs must be an array');
  }
  if (value.length > MAX_INPUTS) {
    fail('malformed_payload', `inputs holds more than ${MAX_INPUTS} entries`);
  }
  return value.map((entry, index) => {
    if (typeof entry === 'string') {
      return { name: line(entry, `inputs[${index}]`), value: '', source: '' };
    }
    if (!isPlainObject(entry)) {
      fail('malformed_payload', `inputs[${index}] must be a string or object`);
    }
    assertKnownKeys(entry, INPUT_FIELDS, `inputs[${index}]`);
    return {
      name: line(entry.name, `inputs[${index}].name`),
      value: text(entry.value, `inputs[${index}].value`),
      source: line(entry.source, `inputs[${index}].source`, { required: false }),
    };
  });
}

function normalizeArtifactReferences(value) {
  if (value === undefined || value === null) {
    fail('malformed_payload', 'artifacts_and_references is required');
  }
  if (!Array.isArray(value)) {
    fail('malformed_payload', 'artifacts_and_references must be an array');
  }
  return value;
}

export function normalizeOrchestrationPayload(input) {
  if (!isPlainObject(input)) {
    fail('malformed_payload', 'payload must be a JSON object');
  }
  const unknown = Object.keys(input).filter((key) => !PAYLOAD_FIELDS.has(key));
  if (unknown.length) {
    fail('malformed_payload', `payload has unknown field(s): ${unknown.sort().join(', ')}`);
  }
  if (input.schema_version !== ORCHESTRATION_SCHEMA_VERSION) {
    fail('malformed_payload', `unsupported schema_version: ${JSON.stringify(input.schema_version)}`);
  }
  if (input.slug !== undefined && input.slug_source !== undefined) {
    fail('malformed_payload', 'supply either slug or slug_source, not both');
  }

  return {
    schema_version: ORCHESTRATION_SCHEMA_VERSION,
    title: line(input.title ?? DEFAULT_ORCHESTRATION_TITLE, 'title', { limit: 80 }),
    slug: input.slug === undefined ? undefined : line(input.slug, 'slug', { limit: 64 }),
    slug_source: input.slug_source === undefined
      ? undefined
      : line(input.slug_source, 'slug_source', { limit: MAX_LINE_BYTES }),
    run_identity: normalizeRunIdentity(input.run_identity),
    source_agent: normalizeAgent(input.source_agent, 'source_agent'),
    target_agent: normalizeAgent(input.target_agent, 'target_agent', { target: true }),
    task_contract: normalizeTaskContract(input.task_contract),
    inputs: normalizeInputs(input.inputs),
    constraints: normalizeStringList(input.constraints, 'constraints'),
    assumptions: normalizeStringList(input.assumptions, 'assumptions'),
    artifacts_and_references: normalizeArtifactReferences(input.artifacts_and_references),
    acceptance_criteria: normalizeStringList(input.acceptance_criteria, 'acceptance_criteria'),
    open_questions: normalizeStringList(input.open_questions, 'open_questions'),
    suggested_skills: input.suggested_skills,
    available_skills: input.available_skills,
  };
}

function bulletList(items) {
  return items.length ? items.map((entry) => `- ${entry}`).join('\n') : 'No confirmed information yet.';
}

function inputList(items) {
  if (!items.length) {
    return 'No confirmed information yet.';
  }
  return items
    .map((entry) => {
      const value = entry.value ? `: ${entry.value}` : '';
      const source = entry.source ? ` (source: ${entry.source})` : '';
      return `- ${entry.name}${value}${source}`;
    })
    .join('\n');
}

function labeledLines(entries) {
  return entries.filter(([, value]) => value).map(([label, value]) => `- ${label}: ${value}`).join('\n');
}

function workerBrief(payload) {
  const { task_contract: task } = payload;
  return [
    'GOAL',
    task.goal,
    '',
    'SCOPE',
    task.scope,
    '',
    'CONTEXT',
    task.context,
    '',
    'ACCEPTANCE',
    bulletList(payload.acceptance_criteria),
    '',
    'VERIFY',
    task.verify,
    '',
    'TIMEBOX',
    task.timebox || 'No confirmed timebox.',
    '',
    'FORBIDDEN',
    task.forbidden || bulletList(payload.constraints),
    '',
    'REPORT',
    task.report,
    '',
    'STANDING',
    task.standing,
  ].join('\n');
}

export function adaptOrchestrationPayload(input) {
  const payload = normalizeOrchestrationPayload(input);
  const run = payload.run_identity;
  const source = payload.source_agent;
  const target = payload.target_agent;
  const slugFields = payload.slug === undefined && payload.slug_source === undefined
    ? { slug_source: `orchestration-${run.run_id}` }
    : payload.slug === undefined
      ? { slug_source: payload.slug_source }
      : { slug: payload.slug };

  return {
    schema_version: 1,
    title: payload.title,
    ...slugFields,
    goal: [
      `Create a safe orchestration handoff for target agent ${target.id}.`,
      '',
      workerBrief(payload),
    ].join('\n'),
    current_progress: [
      'Run identity:',
      labeledLines([
        ['run_id', run.run_id],
        ['root_skill', run.root_skill],
        ['parent_run_id', run.parent_run_id],
        ['log_path', run.log_path],
      ]),
      '',
      'Source agent:',
      labeledLines([
        ['id', source.id],
        ['role', source.role],
      ]),
      '',
      'Target agent:',
      labeledLines([
        ['id', target.id],
        ['role', target.role],
        ['invocation_reason', target.invocation_reason],
      ]),
      '',
      'Inputs:',
      inputList(payload.inputs),
    ].join('\n'),
    decisions_and_constraints: [
      'Constraints:',
      bulletList(payload.constraints),
      '',
      'Assumptions:',
      bulletList(payload.assumptions),
    ].join('\n'),
    artifacts_and_references: payload.artifacts_and_references,
    what_worked: 'Structured orchestration context was captured as a versioned worker brief and adapted through the shared persistence core.',
    what_did_not_work: payload.open_questions.length
      ? ['Open questions:', bulletList(payload.open_questions)].join('\n')
      : '',
    suggested_skills: payload.suggested_skills,
    available_skills: payload.available_skills,
    next_steps: [
      `Target agent ${target.id} should execute the worker brief above.`,
      '',
      'Acceptance criteria:',
      bulletList(payload.acceptance_criteria),
      '',
      'Open questions:',
      bulletList(payload.open_questions),
    ].join('\n'),
  };
}

export function persistOrchestrationHandoff(input, options = {}) {
  return persistBoundedHandoff(adaptOrchestrationPayload(input), options);
}

export function probeResponse() {
  return 'persist-orchestration-handoff: available';
}

function readPayloadFromFile(payloadPath) {
  const file = path.resolve(payloadPath);
  const stat = fs.statSync(file);
  if (!stat.isFile()) {
    fail('malformed_payload', 'payload source must be a regular file');
  }
  if (stat.size > MAX_INPUT_BYTES) {
    fail('malformed_payload', `payload exceeds ${MAX_INPUT_BYTES} UTF-8 bytes`);
  }
  return fs.readFileSync(file, 'utf8');
}

function parseArgs(argv) {
  const args = { stdin: false, payload: null, config: null, probe: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--stdin') {
      args.stdin = true;
    } else if (arg === '--payload') {
      args.payload = argv[++index];
      if (!args.payload) fail('usage', '--payload requires a path');
    } else if (arg === '--config') {
      args.config = argv[++index];
      if (!args.config) fail('usage', '--config requires a path');
    } else if (arg === '--probe') {
      args.probe = true;
    } else {
      fail('usage', `unknown argument: ${arg}`);
    }
  }
  return args;
}

export function main(argv = process.argv.slice(2), streams = process) {
  const args = parseArgs(argv);
  if (args.probe) {
    streams.stdout.write(`${probeResponse()}\n`);
    return 0;
  }
  if (args.stdin === Boolean(args.payload)) {
    fail('usage', 'supply exactly one of --stdin or --payload');
  }
  const raw = args.stdin ? fs.readFileSync(0, 'utf8') : readPayloadFromFile(args.payload);
  if (byteLength(raw) > MAX_INPUT_BYTES) {
    fail('malformed_payload', `payload exceeds ${MAX_INPUT_BYTES} UTF-8 bytes`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail('malformed_payload', `payload must be valid JSON: ${error.message}`);
  }
  const configuration = loadIdentifierConfig({
    file: args.config,
    json: args.config ? undefined : process.env.REDACT_SENSITIVE_CONFIG_JSON,
    required: process.env.REDACT_SENSITIVE_CONFIG_REQUIRED === '1',
  });
  const result = persistOrchestrationHandoff(parsed, { identifiers: configuration.identifiers });
  streams.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    const wrapped = error instanceof HandoffError
      ? error
      : new HandoffError('internal_error', error?.message ?? String(error));
    process.stderr.write(`${JSON.stringify({
      error: {
        code: wrapped.code,
        reason: wrapped.reason,
        message: wrapped.message,
      },
    })}\n`);
    process.exitCode = 1;
  }
}
