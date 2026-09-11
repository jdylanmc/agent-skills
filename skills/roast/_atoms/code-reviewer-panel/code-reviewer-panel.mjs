#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  dispatchResolvedAgent,
  ModelRouteResolutionError,
  resolveInlineModelRoute,
  resolveModelRolePanel,
  summarizeModelDiversity,
} from '../../../_base/_atoms/agent-spawn/agent-spawn.mjs';

export class CodeReviewerPanelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CodeReviewerPanelError';
    this.code = code;
  }
}

const BUNDLED_REVIEWERS = Object.freeze([
  {
    reviewerId: 'SOLID-ROASTER',
    agentName: 'solid-yagni-kiss-roaster',
    role: 'architecture-candidate',
  },
  {
    reviewerId: 'SECURITY-ROASTER',
    agentName: 'security-roaster',
    role: null,
  },
  {
    reviewerId: 'TESTING-ROASTER',
    agentName: 'testing-roaster',
    role: 'qa-reviewer',
  },
]);

function repositoryRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}

function read(pathValue) {
  return fs.readFileSync(pathValue, 'utf8').replace(/\r\n/g, '\n');
}

function frontmatter(document, file) {
  if (!document.startsWith('---\n')) {
    throw new CodeReviewerPanelError('invalid_frontmatter', `${file} is missing frontmatter`);
  }
  const end = document.indexOf('\n---\n', 4);
  if (end < 0) {
    throw new CodeReviewerPanelError('invalid_frontmatter', `${file} has unterminated frontmatter`);
  }
  const lines = document.slice(4, end).split('\n');
  const result = {};
  let pendingList = null;
  for (const line of lines) {
    const list = /^  - (.+)$/.exec(line);
    if (list && pendingList) {
      result[pendingList].push(list[1].trim());
      continue;
    }
    pendingList = null;
    const match = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1];
    const value = match[2].trim();
    if (value === '') {
      result[key] = [];
      pendingList = key;
      continue;
    }
    if (value.startsWith('[') || value.startsWith('{')) {
      result[key] = JSON.parse(value);
    } else {
      result[key] = value.replace(/^"(.*)"$/u, '$1');
    }
  }
  return result;
}

function bundledInstructionPath(root, agentName) {
  return path.join(root, 'skills', 'roast', 'references', 'bundled-roasters', agentName, 'instructions.md');
}

function readBundledInstruction(root, agentName) {
  const instructionPath = bundledInstructionPath(root, agentName);
  const parsed = frontmatter(read(instructionPath), instructionPath);
  return {
    instructionPath,
    agentName,
    model: typeof parsed.model === 'string' ? parsed.model : null,
    fallbackModels: Array.isArray(parsed['fallback-models']) ? parsed['fallback-models'] : [],
    reasoningEffort: typeof parsed['reasoning-effort'] === 'string' ? parsed['reasoning-effort'] : null,
    contextTier: typeof parsed['context-tier'] === 'string' ? parsed['context-tier'] : null,
    tools: Array.isArray(parsed.tools) ? parsed.tools : [],
  };
}

function pad(index) {
  return String(index).padStart(2, '0');
}

function stableReviewerId(base, index) {
  return index === 1 ? base : `${base}-${pad(index)}`;
}

function immutable(value) {
  const freeze = (entry) => {
    if (entry && typeof entry === 'object' && !Object.isFrozen(entry)) {
      Object.freeze(entry);
      for (const child of Object.values(entry)) freeze(child);
    }
    return entry;
  };
  return freeze(value);
}

function normalizePanelLengths(value) {
  if (value === undefined || value === null) {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CodeReviewerPanelError('invalid_input', 'panelLengthByRole must be an object');
  }
  return value;
}

export function resolveBundledRoastRoster({
  root = repositoryRoot(),
  repositoryModelRoles = {},
  userModelRoles = {},
  runtimeAvailableModels = null,
  panelLengthByRole = {},
  fanoutCap = null,
  deepRoute = null,
} = {}) {
  const lengths = normalizePanelLengths(panelLengthByRole);
  const effectiveUserRoles = deepRoute === null
    ? userModelRoles
    : {
      ...userModelRoles,
      'architecture-candidate': deepRoute,
      'qa-reviewer': deepRoute,
    };
  const resolvedByReviewer = [];
  for (const reviewer of BUNDLED_REVIEWERS) {
    const instruction = readBundledInstruction(root, reviewer.agentName);
    const declaredInlineRoute = {
      model: instruction.model,
      fallbackModels: instruction.fallbackModels,
      reasoningEffort: instruction.reasoningEffort,
      contextTier: instruction.contextTier,
    };
    const inlineRoute = deepRoute ?? declaredInlineRoute;
    if (reviewer.role === null) {
      const resolved = resolveInlineModelRoute({
        inlineRoute,
        runtimeAvailableModels,
        resolutionSource: 'inline-default',
      });
      resolvedByReviewer.push({ reviewer, instruction, resolved });
      continue;
    }
    const resolved = resolveModelRolePanel({
      role: reviewer.role,
      inlineDefaults: [inlineRoute],
      repositoryModelRoles,
      userModelRoles: effectiveUserRoles,
      runtimeAvailableModels,
      panelLength: lengths[reviewer.role] ?? null,
    });
    resolvedByReviewer.push({ reviewer, instruction, resolved });
  }

  const requestedTotal = resolvedByReviewer.reduce((count, entry) =>
    count + (entry.reviewer.role === null ? 1 : entry.resolved.routes.length), 0);
  if (fanoutCap !== null && (!Number.isInteger(fanoutCap) || fanoutCap < BUNDLED_REVIEWERS.length)) {
    throw new CodeReviewerPanelError(
      'panel_cap_too_small',
      `fanoutCap must fit all ${BUNDLED_REVIEWERS.length} mandatory bundled reviewers`,
    );
  }
  let remaining = fanoutCap === null
    ? Number.POSITIVE_INFINITY
    : fanoutCap - BUNDLED_REVIEWERS.length;
  const appliedByRole = new Map();
  for (const entry of resolvedByReviewer) {
    if (entry.reviewer.role === null) continue;
    const requested = entry.resolved.routes.length;
    const applied = 1 + Math.min(Math.max(requested - 1, 0), remaining);
    appliedByRole.set(entry.reviewer.role, applied);
    remaining -= applied - 1;
  }

  const roster = [];
  const blockedSeats = [];
  const omittedSeats = [];
  const panels = {};
  for (const entry of resolvedByReviewer) {
    const { reviewer, instruction, resolved } = entry;
    const routes = reviewer.role === null ? [resolved.route] : resolved.routes;
    const receipts = reviewer.role === null ? [resolved.receipt] : resolved.receipts;
    const applied = reviewer.role === null ? 1 : appliedByRole.get(reviewer.role);
    if (reviewer.role !== null) {
      const keptReceipts = receipts.slice(0, applied);
      const dropped = receipts.slice(applied).map((receipt) => ({
        reviewerId: stableReviewerId(reviewer.reviewerId, receipt.panelIndex),
        panelIndex: receipt.panelIndex,
        requestedModel: receipt.requestedModel,
        fallbackModels: receipt.fallbackModels,
        resolutionSource: receipt.resolutionSource,
        alias: receipt.alias,
      }));
      omittedSeats.push(...dropped);
      panels[reviewer.role] = summarizeModelDiversity(keptReceipts, {
        fanoutRequested: receipts.length,
        fanoutApplied: applied,
        droppedSeats: dropped,
      });
    }
    for (let index = 0; index < applied; index += 1) {
      const seat = {
        reviewerId: stableReviewerId(reviewer.reviewerId, index + 1),
        agentName: reviewer.agentName,
        role: reviewer.role,
        instructionPath: instruction.instructionPath,
        tools: instruction.tools,
        route: routes[index],
        routeReceipt: receipts[index],
        panelReceipt: reviewer.role === null ? null : panels[reviewer.role],
      };
      if (seat.route === null || seat.routeReceipt.modelStatus === 'Unavailable') {
        blockedSeats.push(seat);
      } else {
        roster.push(seat);
      }
    }
  }
  return immutable({
    roster,
    blockedSeats,
    omittedSeats,
    panels,
    fanoutRequested: requestedTotal,
    fanoutApplied: roster.length + blockedSeats.length,
  });
}

export function resolveBundledRoastmasterRoute({
  root = repositoryRoot(),
  runtimeAvailableModels = null,
  deepRoute = null,
} = {}) {
  const instruction = readBundledInstruction(root, 'the-roastmaster');
  const inlineRoute = deepRoute ?? {
    model: instruction.model,
    fallbackModels: instruction.fallbackModels,
    reasoningEffort: instruction.reasoningEffort,
    contextTier: instruction.contextTier,
  };
  const resolved = resolveInlineModelRoute({
    inlineRoute,
    runtimeAvailableModels,
    role: 'architecture-judge',
    resolutionSource: deepRoute ? 'tiered-deep-policy' : 'inline-default',
  });
  return immutable({
    agentName: instruction.agentName,
    instructionPath: instruction.instructionPath,
    tools: instruction.tools,
    coordinate: resolved,
    synthesize: resolved,
  });
}

export async function dispatchBundledRoastRoster({
  resolvedRoster,
  promptForReviewer,
  personaForReviewer = () => null,
  transport,
} = {}) {
  if (!resolvedRoster || !Array.isArray(resolvedRoster.roster)) {
    throw new CodeReviewerPanelError('invalid_input', 'resolvedRoster is required');
  }
  if (typeof promptForReviewer !== 'function' || typeof personaForReviewer !== 'function') {
    throw new CodeReviewerPanelError(
      'invalid_input',
      'promptForReviewer and personaForReviewer must be functions',
    );
  }
  const results = await Promise.allSettled(resolvedRoster.roster.map(async (seat) =>
    dispatchResolvedAgent({
      prompt: promptForReviewer(seat),
      persona: personaForReviewer(seat),
      tools: seat.tools,
      route: seat.route,
      receipt: seat.routeReceipt,
      transport: (launch) => transport(seat, launch),
    })));
  const launched = [];
  const failed = [];
  results.forEach((result, index) => {
    const reviewerId = resolvedRoster.roster[index].reviewerId;
    if (result.status === 'fulfilled') launched.push({ ...result.value, reviewerId });
    else failed.push({
      reviewerId,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });
  return immutable({
    status: failed.length || resolvedRoster.blockedSeats.length
      || launched.some((result) => result.status !== 'Complete') ? 'Partial' : 'Complete',
    launched,
    failed,
    blocked: resolvedRoster.blockedSeats,
    omitted: resolvedRoster.omittedSeats,
  });
}

export { ModelRouteResolutionError };
