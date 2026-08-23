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

/** Sections that hold accepted findings and are therefore checked. */
export const ACCEPTED_FINDING_SECTIONS = [
  'Accepted Findings',
  'Findings',
  'Must Fix',
  'Should Fix',
  'Consider',
];

/**
 * Sections that legitimately hold entries carrying no recommendation.
 *
 * The decision on rejected and downgraded findings, stated rather than left
 * implicit: they are **exempt**. A rejected, merged, or downgraded finding is
 * by definition not an accepted finding. Its content is a disposition — why the
 * council declined it — and demanding a fix for a problem the council decided
 * is not a problem would manufacture advice, which is the opposite of what the
 * requirement is for. The same reasoning covers dismissed suspicions and open
 * risks: an open risk with no bounded fix is precisely where the contract sends
 * a concern that cannot be resolved yet.
 *
 * This is a structural distinction, not a naming one. Neither emitting document
 * gives a disposition entry a `Recommendation` field, which is what the drift
 * test keys on.
 */
export const EXEMPT_FINDING_SECTIONS = [
  'Rejected, Merged, or Downgraded Findings',
  'Rejected, Merged, or Downgraded',
  'Dismissed Suspicions',
  'Open Risks and Evidence Gaps',
  'Open Risks and Prerequisites',
  'Evidence Gaps',
  'Doctrine Uncertainties',
  'Residual Uncertainties',
];

/** Retained name for the checked set. */
export const DEFAULT_FINDING_SECTIONS = ACCEPTED_FINDING_SECTIONS;

/**
 * Field labels that identify an entry as a finding wherever it sits. An entry
 * carrying any of these under an unrecognised heading is a finding in the wrong
 * place, not an unrelated subheading, and the checker fails closed on it.
 */
export const FINDING_FIELD_LABELS = [
  'Priority',
  'Proposed priority',
  'Proposed severity',
  'Confidence',
  'Location',
  'Evidence',
  'Consequence',
  'Root cause',
  'Recommendation',
  'Validation',
];

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
 * Splits a report into entries, tracking fenced blocks so quoted material is
 * inert.
 *
 * Every `###` heading is collected, not only those under a recognised section.
 * The earlier version tracked only recognised sections, so a report written
 * under a heading the list did not name produced `findings: 0` and a `Valid`
 * status — a checker that saw nothing and called it success. Collecting
 * everything is what makes failing closed possible.
 */
export function parseFindings(report, sections = ACCEPTED_FINDING_SECTIONS) {
  if (typeof report !== 'string') {
    throw new FindingSchemaError('invalid_report', 'report must be a string');
  }
  const checked = new Set(sections);
  const exempt = new Set(EXEMPT_FINDING_SECTIONS);
  const entries = [];
  const sectionBodies = new Map();

  let fence = null;
  let section = null;
  let entry = null;
  let field = null;

  const closeEntry = () => {
    if (entry) {
      entries.push(entry);
    }
    entry = null;
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

    const findingMatch = FINDING.exec(line);
    if (findingMatch) {
      closeEntry();
      entry = {
        id: findingMatch[1],
        section,
        line: index + 1,
        fields: new Map(),
        order: [],
      };
      if (section !== null) {
        sectionBodies.get(section).push(line);
      }
      continue;
    }

    const sectionMatch = SECTION.exec(line);
    if (sectionMatch) {
      closeEntry();
      section = sectionMatch[1];
      if (!sectionBodies.has(section)) {
        sectionBodies.set(section, []);
      }
      continue;
    }
    if (section !== null) {
      sectionBodies.get(section).push(line);
    }
    if (!entry) {
      continue;
    }

    const fieldMatch = FIELD.exec(line);
    if (fieldMatch) {
      field = fieldMatch[1].trim();
      if (!entry.fields.has(field)) {
        entry.order.push(field);
        entry.fields.set(field, { value: fieldMatch[3].trim(), line: index + 1 });
      }
      continue;
    }
    if (field && line.trim() !== '') {
      const stored = entry.fields.get(field);
      stored.value = stored.value ? `${stored.value} ${line.trim()}` : line.trim();
    }
  }
  closeEntry();

  const classified = { findings: [], exempt: [], unrecognised: [] };
  for (const candidate of entries) {
    if (candidate.section !== null && checked.has(candidate.section)) {
      classified.findings.push(candidate);
    } else if (candidate.section !== null && exempt.has(candidate.section)) {
      classified.exempt.push(candidate);
    } else if (looksLikeFinding(candidate)) {
      classified.unrecognised.push(candidate);
    }
  }

  const emptySections = [...sectionBodies.entries()]
    .filter(([, body]) => isNone(body))
    .map(([name]) => name);

  return { ...classified, entries, emptySections };
}

/**
 * An entry is a finding wherever it sits when it carries any schema field. This
 * is how a finding under a heading nobody recognised is told apart from an
 * ordinary subheading in a document that happens to be passed in.
 */
export function looksLikeFinding(entry) {
  return FINDING_FIELD_LABELS.some((label) => entry.fields.has(label));
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
 *
 * It fails **closed**. A `###` entry that carries schema fields but sits under
 * a heading this checker does not recognise, or under no heading at all, is an
 * `Unrecognised findings section` defect rather than a silent skip. Returning
 * `findings: 0` for a report that visibly contains findings is the one outcome
 * this unit must never produce, because item 10 of the envelope checklist
 * points at it and a reviewer will trust the answer.
 */
export function validateFindingSchema(report, options = {}) {
  const required = options.requiredFields ?? REQUIRED_FINDING_FIELDS;
  const parsed = parseFindings(report, options.sections);
  const defects = [];

  for (const finding of parsed.findings) {
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

  for (const stray of parsed.unrecognised) {
    defects.push({
      category: 'Unrecognised findings section',
      finding: stray.id,
      section: stray.section,
      field: null,
      line: stray.line,
      message: stray.section === null
        ? `finding ${stray.id} appears before any heading, so no section governs it`
        : `finding ${stray.id} sits under the unrecognised heading "${stray.section}", so it was never checked`,
    });
  }

  return {
    status: defects.length ? 'Invalid' : 'Valid',
    findings: parsed.findings.length,
    unrecognised: parsed.unrecognised.length,
    exempt: parsed.exempt.length,
    checked: [...required],
    sections: [...(options.sections ?? ACCEPTED_FINDING_SECTIONS)],
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
