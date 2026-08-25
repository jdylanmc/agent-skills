#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural review of designed Gherkin.
 *
 * This helper decides only what is decidable from the feature text: whether it
 * parses, whether each scenario is shaped as one example of behavior, and
 * whether it duplicates, contradicts, or leaks implementation. It never decides
 * whether a scenario is bound to a step definition or whether the product
 * behaves as described. That distinction is the whole point of the
 * `coverage.executable` field, which is always `unknown` here.
 */

export class GherkinDesignError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GherkinDesignError';
    this.code = code;
  }
}

const PRIMARY_STEPS = new Set(['Given', 'When', 'Then']);
const CONTINUATION_STEPS = new Set(['And', 'But', '*']);
const STEP_ORDER = new Map([['Given', 0], ['When', 1], ['Then', 2]]);

const LEAK_PATTERNS = [
  { rule: 'css-or-xpath-selector', pattern: /(?:css=|xpath=|\[data-test[^\]]*\]|(?:^|\s)\/\/[a-z]+\[)/i },
  { rule: 'sql-statement', pattern: /\b(?:select\s+\S+\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i },
  { rule: 'http-route', pattern: /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S*/ },
  { rule: 'code-invocation', pattern: /\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\s*\(/ },
  { rule: 'assertion-vocabulary', pattern: /(?:\bassert\b|\bexpect\(|\btoEqual\b|\bshould\.be\b)/i },
];

const IMPLEMENTATION_TERMS = [
  'database', 'api', 'endpoint', 'http', 'json', 'sql', 'cache', 'dom',
  'selector', 'xpath', 'css', 'mock', 'stub', 'backend', 'frontend',
  'microservice', 'step definition',
];

const AMBIGUOUS_TERMS = [
  'correctly', 'properly', 'as expected', 'appropriate', 'appropriately',
  'works', 'valid data', 'various', 'reasonable', 'quickly', 'user-friendly',
  'intuitive', 'etc',
];

function finding(code, severity, location, detail) {
  return { code, severity, location, detail };
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function splitRow(line) {
  const trimmed = line.trim();
  const body = trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed.slice(1);
  return body.split('|').map((cell) => cell.trim());
}

function parseFeature(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const parseErrors = [];
  const scenarios = [];
  let feature = null;
  let rule = null;
  let current = null;
  let examples = null;
  let docString = null;

  const openScenario = (type, name, line) => {
    current = { type, name, line, rule: rule?.name ?? null, steps: [], examples: [] };
    examples = null;
    scenarios.push(current);
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();

    if (docString !== null) {
      if (trimmed === docString) {
        docString = null;
      }
      return;
    }
    if (trimmed === '"""' || trimmed === '```') {
      if (!current || current.steps.length === 0) {
        parseErrors.push(finding('doc-string-outside-step', 'high', `line ${line}`, 'a doc string must follow a step'));
        return;
      }
      docString = trimmed;
      return;
    }
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('@')) {
      return;
    }

    const keyword = /^(Feature|Background|Rule|Scenario Outline|Scenario Template|Scenario|Example|Examples|Scenarios):\s*(.*)$/.exec(trimmed);
    if (keyword) {
      const [, name, value] = keyword;
      if (name === 'Feature') {
        if (feature) {
          parseErrors.push(finding('multiple-features', 'high', `line ${line}`, 'a feature file declares exactly one Feature'));
          return;
        }
        feature = { name: value, line };
        return;
      }
      if (!feature) {
        parseErrors.push(finding('content-before-feature', 'high', `line ${line}`, `${name} appears before any Feature`));
        return;
      }
      if (name === 'Rule') {
        rule = { name: value, line };
        current = null;
        examples = null;
        return;
      }
      if (name === 'Background') {
        openScenario('background', value || 'Background', line);
        return;
      }
      if (name === 'Scenario Outline' || name === 'Scenario Template') {
        openScenario('outline', value, line);
        return;
      }
      if (name === 'Scenario' || name === 'Example') {
        openScenario('scenario', value, line);
        return;
      }
      if (!current || current.type !== 'outline') {
        parseErrors.push(finding('examples-outside-outline', 'high', `line ${line}`, 'Examples must belong to a Scenario Outline'));
        return;
      }
      examples = { line, header: null, rows: [] };
      current.examples.push(examples);
      return;
    }

    if (trimmed.startsWith('|')) {
      const cells = splitRow(trimmed);
      if (examples) {
        if (examples.header === null) {
          examples.header = cells;
        } else {
          examples.rows.push({ line, cells });
        }
        return;
      }
      if (current && current.steps.length) {
        current.steps[current.steps.length - 1].dataTable.push({ line, cells });
        return;
      }
      parseErrors.push(finding('table-outside-step', 'high', `line ${line}`, 'a data table must follow a step or an Examples header'));
      return;
    }

    const step = /^(Given|When|Then|And|But|\*)\s+(.*)$/.exec(trimmed);
    if (step) {
      if (!current) {
        parseErrors.push(finding('step-outside-scenario', 'high', `line ${line}`, 'a step must belong to a Background, Scenario, or Scenario Outline'));
        return;
      }
      current.steps.push({ keyword: step[1], text: step[2].trim(), line, dataTable: [], resolved: null });
      return;
    }

    // Free prose is a description. Gherkin allows one under the feature and one
    // before a scenario's first step, so only prose after a step is unparseable.
    if (current !== null && current.steps.length > 0) {
      parseErrors.push(finding('unrecognized-line', 'high', `line ${line}`, `line is neither a keyword, a step, nor a table: ${trimmed}`));
    }
  });

  if (docString !== null) {
    parseErrors.push(finding('unterminated-doc-string', 'high', 'end of file', 'a doc string was opened and never closed'));
  }
  if (!feature) {
    parseErrors.push(finding('missing-feature', 'high', 'end of file', 'no Feature was declared'));
  }

  return { feature, scenarios, parseErrors };
}

function resolveStepKeywords(scenario, findings) {
  let primary = null;
  for (const step of scenario.steps) {
    if (PRIMARY_STEPS.has(step.keyword)) {
      primary = step.keyword;
      step.resolved = step.keyword;
      continue;
    }
    if (CONTINUATION_STEPS.has(step.keyword)) {
      if (primary === null) {
        findings.push(finding(
          'unanchored-continuation-step',
          'high',
          `${scenario.name || scenario.type} line ${step.line}`,
          `${step.keyword} has no preceding Given, When, or Then`,
        ));
        continue;
      }
      step.resolved = primary;
    }
  }
}

function reviewStepShape(scenario, findings) {
  const location = `${scenario.name || scenario.type} line ${scenario.line}`;
  if (scenario.steps.length === 0) {
    findings.push(finding('empty-scenario', 'high', location, 'the scenario declares no steps'));
    return;
  }
  if (scenario.type === 'background') {
    return;
  }

  const resolved = scenario.steps.map((step) => step.resolved).filter(Boolean);
  if (!resolved.includes('When')) {
    findings.push(finding('missing-when', 'high', location, 'no When step names the event or action under test'));
  }
  if (!resolved.includes('Then')) {
    findings.push(finding('missing-then', 'high', location, 'no Then step names an externally observable outcome'));
  }
  const whenCount = resolved.filter((keyword) => keyword === 'When').length;
  if (whenCount > 1) {
    findings.push(finding('multiple-when', 'medium', location, `the scenario exercises ${whenCount} separate actions and is broader than one example`));
  }

  let highWater = -1;
  for (const step of scenario.steps) {
    if (!step.resolved) {
      continue;
    }
    const rank = STEP_ORDER.get(step.resolved);
    if (rank < highWater) {
      findings.push(finding(
        'out-of-order-steps',
        'medium',
        `${scenario.name || scenario.type} line ${step.line}`,
        `${step.resolved} follows a later phase; keep Given for context, When for the action, and Then for the outcome`,
      ));
      break;
    }
    highWater = rank;
  }
}

function reviewOutline(scenario, findings) {
  if (scenario.type !== 'outline') {
    if (scenario.examples.length) {
      findings.push(finding('examples-outside-outline', 'high', `${scenario.name} line ${scenario.line}`, 'only a Scenario Outline carries Examples'));
    }
    return;
  }

  const location = `${scenario.name} line ${scenario.line}`;
  if (scenario.examples.length === 0) {
    findings.push(finding('outline-without-examples', 'high', location, 'a Scenario Outline without Examples cannot be executed'));
    return;
  }

  const placeholders = new Set();
  for (const step of scenario.steps) {
    for (const match of step.text.matchAll(/<([^<>]+)>/g)) {
      placeholders.add(match[1].trim());
    }
  }

  const columns = new Set();
  for (const table of scenario.examples) {
    if (table.header === null) {
      findings.push(finding('examples-without-header', 'high', `${scenario.name} line ${table.line}`, 'the Examples table declares no header row'));
      continue;
    }
    for (const column of table.header) {
      columns.add(column);
    }
    for (const row of table.rows) {
      if (row.cells.length !== table.header.length) {
        findings.push(finding(
          'examples-row-width-mismatch',
          'high',
          `${scenario.name} line ${row.line}`,
          `the row has ${row.cells.length} cells and the header has ${table.header.length}`,
        ));
      }
    }
    if (table.rows.length === 0) {
      findings.push(finding('examples-without-rows', 'high', `${scenario.name} line ${table.line}`, 'the Examples table declares no example rows'));
    }
  }

  for (const placeholder of [...placeholders].sort()) {
    if (!columns.has(placeholder)) {
      findings.push(finding('outline-placeholder-unbound', 'high', location, `<${placeholder}> has no matching Examples column`));
    }
  }
  for (const column of [...columns].sort()) {
    if (!placeholders.has(column)) {
      findings.push(finding('examples-column-unused', 'medium', location, `the Examples column ${column} is never referenced by a step`));
    }
  }
}

function reviewLanguage(scenario, findings) {
  for (const step of scenario.steps) {
    const location = `${scenario.name || scenario.type} line ${step.line}`;
    for (const { rule, pattern } of LEAK_PATTERNS) {
      if (pattern.test(step.text)) {
        findings.push(finding('implementation-leak', 'high', location, `${rule}: keep implementation out of the specification`));
      }
    }
    const lowered = ` ${normalizeText(step.text)} `;
    for (const term of IMPLEMENTATION_TERMS) {
      if (lowered.includes(` ${term} `) || lowered.includes(` ${term}s `)) {
        findings.push(finding('implementation-vocabulary', 'medium', location, `"${term}" is implementation terminology; express the example in domain language`));
      }
    }
    for (const term of AMBIGUOUS_TERMS) {
      if (lowered.includes(` ${term} `)) {
        findings.push(finding('ambiguous-language', 'medium', location, `"${term}" does not name a decidable outcome`));
      }
    }
  }
}

function reviewDuplication(scenarios, findings) {
  const byName = new Map();
  const byBody = new Map();
  const byPremise = new Map();

  for (const scenario of scenarios) {
    if (scenario.type === 'background') {
      continue;
    }
    const location = `${scenario.name || scenario.type} line ${scenario.line}`;
    const name = normalizeText(scenario.name ?? '');
    if (name) {
      if (byName.has(name)) {
        findings.push(finding('duplicate-scenario-name', 'high', location, `the name repeats ${byName.get(name)}`));
      } else {
        byName.set(name, location);
      }
    }

    const steps = scenario.steps.filter((step) => step.resolved);
    const body = steps.map((step) => `${step.resolved} ${normalizeText(step.text)}`).join(' | ');
    if (body) {
      if (byBody.has(body)) {
        findings.push(finding('duplicate-scenario-body', 'medium', location, `the same example is already given at ${byBody.get(body)}`));
      } else {
        byBody.set(body, location);
      }
    }

    const premise = steps
      .filter((step) => step.resolved !== 'Then')
      .map((step) => `${step.resolved} ${normalizeText(step.text)}`)
      .join(' | ');
    const outcome = steps
      .filter((step) => step.resolved === 'Then')
      .map((step) => normalizeText(step.text))
      .join(' | ');
    if (!premise || !outcome) {
      continue;
    }
    const seen = byPremise.get(premise);
    if (!seen) {
      byPremise.set(premise, { outcome, location });
      continue;
    }
    if (seen.outcome !== outcome) {
      findings.push(finding(
        'contradictory-scenarios',
        'high',
        location,
        `the same context and action at ${seen.location} expects a different outcome`,
      ));
    }
  }
}

export function reviewGherkin(input = {}) {
  const locator = typeof input.locator === 'string' && input.locator.trim() ? input.locator.trim() : 'supplied-feature';
  let text = input.feature;

  if (text === undefined && typeof input.path === 'string') {
    const root = input.repositoryRoot ?? process.cwd();
    const absolute = path.resolve(root, input.path);
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new GherkinDesignError('path_outside_root', 'path must stay inside repositoryRoot');
    }
    try {
      text = fs.readFileSync(absolute, 'utf8');
    } catch (error) {
      throw new GherkinDesignError('unreadable_feature', `cannot read ${input.path}: ${error.message}`);
    }
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new GherkinDesignError('invalid_input', 'provide feature text or a readable path');
  }

  const parsed = parseFeature(text);
  const coverage = {
    executable: 'unknown',
    reason: 'this review parses designed Gherkin; binding to step definitions and product behavior is proven only by executing it',
    missingScenarios: 'not-decidable-here: an unproven requirement is found by traceability reconciliation, not by feature text',
  };

  if (parsed.parseErrors.length) {
    return {
      status: 'parse-failed',
      locator,
      feature: parsed.feature?.name ?? null,
      scenarioCount: parsed.scenarios.filter((scenario) => scenario.type !== 'background').length,
      findings: parsed.parseErrors,
      coverage,
    };
  }

  const findings = [];
  for (const scenario of parsed.scenarios) {
    resolveStepKeywords(scenario, findings);
  }
  for (const scenario of parsed.scenarios) {
    reviewStepShape(scenario, findings);
    reviewOutline(scenario, findings);
    reviewLanguage(scenario, findings);
  }
  reviewDuplication(parsed.scenarios, findings);

  const scenarios = parsed.scenarios.filter((scenario) => scenario.type !== 'background');
  if (scenarios.length === 0) {
    findings.push(finding('no-scenarios', 'high', `feature line ${parsed.feature.line}`, 'the feature declares no scenario'));
  }

  return {
    status: findings.length ? 'findings' : 'clean',
    locator,
    feature: parsed.feature.name,
    scenarioCount: scenarios.length,
    scenarios: scenarios.map((scenario) => ({
      name: scenario.name,
      type: scenario.type,
      rule: scenario.rule,
      line: scenario.line,
      stepCount: scenario.steps.length,
    })),
    findings,
    coverage,
  };
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

export function run(argv, streams = process) {
  if (argv.includes('--probe')) {
    streams.stdout.write('gherkin-design: available\n');
    return 0;
  }
  try {
    const result = reviewGherkin(JSON.parse(readStdin()));
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'clean' ? 0 : 2;
  } catch (error) {
    const code = error instanceof GherkinDesignError ? error.code : 'invalid_input';
    streams.stderr.write(`${code}: ${error.message}\n`);
    return 1;
  }
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
