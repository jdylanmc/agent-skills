#!/usr/bin/env node

/**
 * Accepted-finding schema checks for the artifact branch.
 *
 * The roast contract requires every accepted finding to carry a bounded,
 * actionable Recommendation and a Validation. Stated as prose that requirement
 * is unenforceable: a report with ten findings and zero recommendations
 * satisfied every earlier envelope check, because those checks inspected
 * headings, roster shape, ordering, and terminators, and never looked inside a
 * finding.
 *
 * This module makes the requirement mechanical. It is a schema check and
 * nothing more: it decides whether a finding is *well formed*, never whether it
 * is right, and it never repairs, rewrites, or ranks anything.
 *
 * The counting rule matches the rest of the contract. A heading, a field label,
 * or field content counts only outside every fenced block. A report that quotes
 * a contract template as evidence must not thereby satisfy the contract, and a
 * recommendation that exists only inside a quoted block is evidence of what
 * someone else wrote, not advice this roast is giving.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class FindingSchemaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FindingSchemaError';
    this.code = code;
  }
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const SECTION = /^##\s+(.+?)\s*$/;
const FINDING = /^###\s+(.+?)\s*$/;
const FIELD = /^\s*-\s+([A-Z][A-Za-z ]*?)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/;

/** Sections that hold accepted findings in a roaster report and a final roast. */
export const DEFAULT_FINDING_SECTIONS = ['Findings', 'Must Fix', 'Should Fix', 'Consider'];

/** Fields every accepted finding must carry with content, outside fences. */
export const REQUIRED_FINDING_FIELDS = ['Recommendation', 'Validation'];

/**
 * A section whose whole body is the single word `none` declares no findings.
 * An empty findings section is a real result and never a defect.
 */
function isNone(body) {
  return body.filter((line) => line.trim() !== '').every((line) => line.trim() === 'none');
}

/**
 * Splits a report into findings, tracking fenced blocks so quoted material is
 * inert. Returns one entry per `###` heading inside a findings section.
 */
export function parseFindings(report, sections = DEFAULT_FINDING_SECTIONS) {
  if (typeof report !== 'string') {
    throw new FindingSchemaError('invalid_report', 'report must be a string');
  }
  const wanted = new Set(sections);
  const findings = [];
  const sectionBodies = new Map();

  let fence = null;
  let section = null;
  let finding = null;
  let field = null;

  const closeFinding = () => {
    if (finding) {
      findings.push(finding);
    }
    finding = null;
    field = null;
  };

  const lines = report.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      // Inside a fenced block. Nothing here counts, which is the point.
      continue;
    }

    const sectionMatch = SECTION.exec(line);
    if (sectionMatch) {
      closeFinding();
      section = wanted.has(sectionMatch[1]) ? sectionMatch[1] : null;
      if (section && !sectionBodies.has(section)) {
        sectionBodies.set(section, []);
      }
      continue;
    }
    if (!section) {
      continue;
    }
    sectionBodies.get(section).push(line);

    const findingMatch = FINDING.exec(line);
    if (findingMatch) {
      closeFinding();
      finding = {
        id: findingMatch[1],
        section,
        line: index + 1,
        fields: new Map(),
        order: [],
      };
      continue;
    }
    if (!finding) {
      continue;
    }

    const fieldMatch = FIELD.exec(line);
    if (fieldMatch) {
      field = fieldMatch[1].trim();
      if (!finding.fields.has(field)) {
        finding.order.push(field);
        finding.fields.set(field, { value: fieldMatch[3].trim(), line: index + 1 });
      }
      continue;
    }
    if (field && line.trim() !== '') {
      const entry = finding.fields.get(field);
      entry.value = entry.value ? `${entry.value} ${line.trim()}` : line.trim();
    }
  }
  closeFinding();

  const emptySections = [...sectionBodies.entries()]
    .filter(([, body]) => isNone(body))
    .map(([name]) => name);

  return { findings, emptySections };
}

/**
 * A field is satisfied when it exists and carries content outside every fenced
 * block. A bare label with nothing after it is a defect, and so is a label
 * whose only content sits inside a fence.
 */
export function fieldContent(finding, name) {
  const entry = finding.fields.get(name);
  if (!entry) {
    return null;
  }
  const value = entry.value.trim();
  return value === '' ? null : value;
}

/**
 * Validates every accepted finding in a report.
 *
 * Returns `Valid` with an empty defect list, or `Invalid` naming each finding
 * and the specific field it is missing. A report with no findings at all is
 * valid: the requirement is per finding, not a demand that findings exist.
 */
export function validateFindingSchema(report, options = {}) {
  const required = options.requiredFields ?? REQUIRED_FINDING_FIELDS;
  const { findings } = parseFindings(report, options.sections);
  const defects = [];

  for (const finding of findings) {
    for (const name of required) {
      const content = fieldContent(finding, name);
      if (content === null) {
        defects.push({
          category: 'Incomplete finding',
          finding: finding.id,
          section: finding.section,
          field: name,
          line: finding.fields.get(name)?.line ?? finding.line,
          message: finding.fields.has(name)
            ? `finding ${finding.id} declares ${name} with no content outside a fenced block`
            : `finding ${finding.id} is missing the required field ${name}`,
        });
      }
    }
  }

  return {
    status: defects.length ? 'Invalid' : 'Valid',
    findings: findings.length,
    checked: [...required],
    defects,
  };
}

const VALUE_FLAGS = ['--report', '--field', '--section'];

export const USAGE = `Usage: roast-contract.mjs --report <path> \\
  [--field <name>]... [--section <name>]...

  --report   Absolute path to the report or envelope to check. Required.
  --field    A field every accepted finding must carry with content.
             Repeatable. Defaults to Recommendation and Validation.
  --section  A section that holds accepted findings. Repeatable. Defaults to
             Findings, Must Fix, Should Fix, and Consider.
  --probe    Report availability and exit.`;

function failUsage(message) {
  throw new FindingSchemaError('usage', message);
}

export function parseArguments(argv) {
  const values = {};
  const fields = [];
  const sections = [];

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      return { probe: true };
    }
    if (!VALUE_FLAGS.includes(flag)) {
      failUsage(`unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      failUsage(`${flag} requires a value`);
    }
    if (flag === '--field') {
      fields.push(value);
    } else if (flag === '--section') {
      sections.push(value);
    } else {
      const name = flag.slice(2);
      if (name in values) {
        failUsage(`${flag} was given more than once`);
      }
      values[name] = value;
    }
    index += 1;
  }

  if (!('report' in values)) {
    failUsage('missing required argument for --report');
  }
  return { probe: false, ...values, fields, sections };
}

function readReport(candidate) {
  if (!path.isAbsolute(candidate)) {
    throw new FindingSchemaError('unsafe_path', 'report path must be absolute');
  }
  if (candidate.split(path.sep).includes('..')) {
    throw new FindingSchemaError('unsafe_path', 'report path must not traverse upward');
  }
  let stats;
  try {
    stats = fs.lstatSync(candidate);
  } catch {
    throw new FindingSchemaError('unsafe_path', `report does not exist: ${candidate}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new FindingSchemaError('unsafe_path', 'report path must be a regular file');
  }
  return fs.readFileSync(candidate, 'utf8');
}

export function run(argv, streams = process) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    streams.stderr.write(`${error.code ?? 'usage'}: ${error.message}\n${USAGE}\n`);
    return 1;
  }
  if (parsed.probe) {
    streams.stdout.write('roast-contract: available\n');
    return 0;
  }

  let result;
  try {
    result = validateFindingSchema(readReport(parsed.report), {
      requiredFields: parsed.fields.length ? parsed.fields : undefined,
      sections: parsed.sections.length ? parsed.sections : undefined,
    });
  } catch (error) {
    const code = error instanceof FindingSchemaError ? error.code : 'invalid_report';
    streams.stderr.write(`${code}: ${error.message}\n`);
    return 1;
  }

  streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'Valid' ? 0 : 2;
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
