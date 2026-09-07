#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ModelRouteResolutionError,
  resolveInlineModelRoute,
  resolveModelRolePanel,
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
  };
}

function pad(index) {
  return String(index).padStart(2, '0');
}

function stableReviewerId(base, index) {
  return index === 1 ? base : `${base}-${pad(index)}`;
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
} = {}) {
  const lengths = normalizePanelLengths(panelLengthByRole);
  const roster = [];
  const panels = {};
  for (const reviewer of BUNDLED_REVIEWERS) {
    const instruction = readBundledInstruction(root, reviewer.agentName);
    const inlineRoute = {
      model: instruction.model,
      fallbackModels: instruction.fallbackModels,
      reasoningEffort: instruction.reasoningEffort,
      contextTier: instruction.contextTier,
    };
    if (reviewer.role === null) {
      const resolved = resolveInlineModelRoute({
        inlineRoute,
        runtimeAvailableModels,
        resolutionSource: 'inline-default',
      });
      roster.push({
        reviewerId: reviewer.reviewerId,
        agentName: reviewer.agentName,
        role: null,
        instructionPath: instruction.instructionPath,
        route: resolved.route,
        routeReceipt: resolved.receipt,
        panelReceipt: null,
      });
      continue;
    }
    const panel = resolveModelRolePanel({
      role: reviewer.role,
      inlineDefaults: [inlineRoute],
      repositoryModelRoles,
      userModelRoles,
      runtimeAvailableModels,
      panelLength: lengths[reviewer.role] ?? null,
      fanoutCap,
    });
    panels[reviewer.role] = panel.panel;
    for (const [index, route] of panel.routes.entries()) {
      roster.push({
        reviewerId: stableReviewerId(reviewer.reviewerId, index + 1),
        agentName: reviewer.agentName,
        role: reviewer.role,
        instructionPath: instruction.instructionPath,
        route,
        routeReceipt: panel.receipts[index],
        panelReceipt: panel.panel,
      });
    }
  }
  return { roster, panels };
}

export { ModelRouteResolutionError };
