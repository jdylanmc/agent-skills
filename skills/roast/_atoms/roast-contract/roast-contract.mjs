#!/usr/bin/env node

// Structural checks only: no evidence resolution, repair, or approval.
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

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const SECTION = /^##\s+(.+?)\s*$/;
const FINDING = /^###\s+(.+?)\s*$/;
const FIELD = /^-\s+([A-Z][A-Za-z ]*?)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/;

export const ACCEPTED_FINDING_SECTIONS = [
  'Accepted Findings', 'Findings', 'Must Fix', 'Should Fix', 'Consider',
];
export const EXEMPT_FINDING_SECTIONS = [
  'Rejected, Merged, or Downgraded Findings', 'Rejected, Merged, or Downgraded',
  'Dismissed Suspicions', 'Open Risks and Evidence Gaps', 'Open Risks and Prerequisites',
  'Evidence Gaps', 'Doctrine Uncertainties', 'Residual Uncertainties',
];
export const DEFAULT_FINDING_SECTIONS = ACCEPTED_FINDING_SECTIONS;
export const FINDING_FIELD_LABELS = [
  'Priority', 'Proposed priority', 'Proposed severity', 'Confidence', 'Location',
  'Evidence', 'Consequence', 'Root cause', 'Standard', 'Recommendation', 'Validation',
];
export const REQUIRED_FINDING_FIELDS = ['Recommendation', 'Validation'];
export const ROAST_FINDING_FIELDS = [
  'Priority', 'Confidence', 'Location', 'Evidence', 'Consequence',
  'Standard', 'Recommendation', 'Validation',
];

function visibleLines(report) {
  if (typeof report !== 'string') {
    throw new FindingSchemaError('invalid_report', 'report must be a string');
  }
  let fence = null;
  let comment = false;
  let quote = false;
  const defects = [];
  const lines = report.replace(/\r\n/g, '\n').split('\n').map((source, index) => {
    // Quotes and indented code cannot provide report structure or field content.
    if (/^ {0,3}>/.test(source)) { quote = true; return ''; }
    if (!source.trim() || HEADING.test(source) || FIELD.test(source) || FENCE.test(source)) quote = false;
    if (quote || /^(?: {4}|\t)/.test(source)) return '';
    if (fence) {
      const close = FENCE.exec(source);
      if (close && close[1][0] === fence.marker[0]
          && close[1].length >= fence.marker.length && close[2].trim() === '') fence = null;
      return '';
    }
    let line = '';
    let rest = source;
    while (rest) {
      if (comment) {
        const end = rest.indexOf('-->');
        if (end < 0) return line;
        rest = rest.slice(end + 3);
        comment = false;
      } else {
        const start = rest.indexOf('<!--');
        if (start < 0) { line += rest; break; }
        line += rest.slice(0, start);
        rest = rest.slice(start + 4);
        comment = true;
      }
    }
    const open = FENCE.exec(line);
    if (open) {
      fence = { marker: open[1], line: index + 1 };
      return '';
    }
    return line;
  });
  if (fence) defects.push({
    category: 'Unclosed fence', line: fence.line,
    message: 'fenced material has no matching closing fence',
  });
  if (comment) defects.push({ category: 'Unclosed comment', message: 'HTML comment is not closed' });
  return { lines, defects };
}

export function looksLikeFinding(entry) {
  return FINDING_FIELD_LABELS.some((label) => entry.fields.has(label));
}

export function fieldContent(finding, name) {
  return finding.fields.get(name)?.value.trim() || null;
}

/** Generic finding parser retained for scoped callers; quoted material is inert. */
export function parseFindings(report, sections = ACCEPTED_FINDING_SECTIONS) {
  const checked = new Set(sections);
  const exempt = new Set(EXEMPT_FINDING_SECTIONS);
  const { lines, defects } = visibleLines(report);
  const entries = [];
  const sectionBodies = new Map();
  let section = null;
  let entry = null;
  let field = null;
  const closeEntry = () => {
    if (entry) entries.push(entry);
    entry = null;
    field = null;
  };
  for (const [index, line] of lines.entries()) {
    const finding = FINDING.exec(line);
    if (finding) {
      closeEntry();
      entry = { id: finding[1], section, line: index + 1, fields: new Map(), order: [] };
      sectionBodies.get(section)?.push(line);
      continue;
    }
    if (HEADING.test(line)) {
      if (checked.has(section) && /^ {0,3}#{3,}/.test(line)) defects.push({
        category: 'Malformed finding heading', line: index + 1,
        message: 'a finding heading must start with ### and carry an identifier',
      });
      closeEntry();
      const heading = SECTION.exec(line);
      section = heading?.[1] ?? null;
      if (section !== null && !sectionBodies.has(section)) sectionBodies.set(section, []);
      continue;
    }
    sectionBodies.get(section)?.push(line);
    const match = FIELD.exec(line);
    if (!entry) {
      if (match && FINDING_FIELD_LABELS.includes(match[1])) defects.push({
        category: 'Stray finding field', field: match[1], line: index + 1,
        message: `${match[1]} is outside a named finding`,
      });
      continue;
    }
    if (match) {
      field = match[1].trim();
      if (entry.fields.has(field)) {
        (entry.duplicateFields ??= []).push({ field, line: index + 1 });
      } else {
        entry.order.push(field);
        entry.fields.set(field, { value: match[3].trim(), line: index + 1 });
      }
    } else if (line.trim() && checked.has(section) && (!field || !/^ {1,3}\S/.test(line))) {
      defects.push({
        category: 'Unexpected finding content', finding: entry.id, section, line: index + 1,
        message: 'expected a field or named finding; multiline field content must be indented',
      });
    } else if (field && line.trim()) {
      const stored = entry.fields.get(field);
      stored.value = [stored.value, line.trim()].filter(Boolean).join(' ');
    }
  }
  closeEntry();
  const classified = { findings: [], exempt: [], unrecognised: [] };
  for (const candidate of entries) {
    if (checked.has(candidate.section)) classified.findings.push(candidate);
    else if (exempt.has(candidate.section)) classified.exempt.push(candidate);
    else if (looksLikeFinding(candidate) || /^R\d+(?::|$)/.test(candidate.id)) {
      classified.unrecognised.push(candidate);
    }
  }
  const emptySections = [...sectionBodies]
    .filter(([, body]) => /^none\.?$/i.test(body.join('\n').trim()))
    .map(([name]) => name);
  for (const [name, body] of sectionBodies) {
    if (checked.has(name) && !emptySections.includes(name)
        && !classified.findings.some((finding) => finding.section === name)) defects.push({
      category: 'Unrecognised findings body', section: name,
      message: `section "${name}" requires named finding entries or an explicit none declaration`,
    });
  }
  return { ...classified, entries, emptySections, defects };
}

export function validateFindingSchema(report, options = {}) {
  const required = options.requiredFields ?? REQUIRED_FINDING_FIELDS;
  const parsed = parseFindings(report, options.sections);
  const defects = [...parsed.defects];
  const ids = new Set();
  for (const finding of parsed.findings) {
    if (ids.has(finding.id)) defects.push({
      category: 'Duplicate finding ID', finding: finding.id, line: finding.line,
      message: `finding ID ${finding.id} repeats`,
    });
    ids.add(finding.id);
    for (const duplicate of finding.duplicateFields ?? []) defects.push({
      category: 'Duplicate field', finding: finding.id, ...duplicate,
      message: `finding ${finding.id} repeats ${duplicate.field}`,
    });
    for (const name of required) {
      if (fieldContent(finding, name) === null) defects.push({
        category: 'Incomplete finding', finding: finding.id, section: finding.section,
        field: name, line: finding.fields.get(name)?.line ?? finding.line,
        message: finding.fields.has(name)
          ? `finding ${finding.id} declares ${name} with no content outside a fenced block or quote`
          : `finding ${finding.id} is missing the required field ${name}`,
      });
    }
  }
  for (const stray of parsed.unrecognised) defects.push({
    category: 'Unrecognised findings section', finding: stray.id, section: stray.section,
    field: null, line: stray.line,
    message: stray.section === null
      ? `finding ${stray.id} appears before any heading, so no section governs it`
      : `finding ${stray.id} sits under the unrecognised heading "${stray.section}", so it was never checked`,
  });
  return {
    status: defects.length ? 'Invalid' : 'Valid', findings: parsed.findings.length,
    unrecognised: parsed.unrecognised.length, exempt: parsed.exempt.length,
    checked: [...required], sections: [...(options.sections ?? ACCEPTED_FINDING_SECTIONS)], defects,
  };
}

/** Validate the final report, optionally bound to a revision supplied by its caller. */
export function validateRoastReport(report, options = {}) {
  if (options.expectedRevision !== undefined
      && (typeof options.expectedRevision !== 'string' || !options.expectedRevision.trim())) {
    throw new FindingSchemaError('invalid_contract', 'expectedRevision must be a non-empty string');
  }
  const schema = validateFindingSchema(report, { sections: ['Findings'], requiredFields: ROAST_FINDING_FIELDS });
  const parsed = parseFindings(report, ['Findings']);
  const { lines } = visibleLines(report);
  const defects = [...schema.defects];
  const defect = (category, item, message, line) => defects.push({ category, item, message, line });
  if (lines[0] !== '# Roast') defect('First-line mismatch', 'title', 'first line must be # Roast', 1);
  const headings = lines.flatMap((line, index) => HEADING.test(line) ? [{ line, index }] : []);
  const sections = headings.filter(({ line }) => /^## /.test(line));
  for (const name of ['Findings', 'Coverage']) {
    const matches = sections.filter(({ line }) => line === `## ${name}`);
    if (matches.length !== 1) defect('Heading cardinality', name, `expected exactly one ## ${name}`);
  }
  if (sections.map(({ line }) => line).join('\n') !== '## Findings\n## Coverage') {
    defect('Report sections', 'headings', 'sections must be Findings then Coverage');
  }
  for (const heading of headings) {
    if (heading.index === 0 || heading.line === '## Findings' || heading.line === '## Coverage'
        || /^### R[1-9]\d*: \S.*$/.test(heading.line)) continue;
    defect('Unexpected heading', 'headings', `unexpected heading: ${heading.line}`, heading.index + 1);
  }
  const firstSection = headings.find(({ index }) => index > 0)?.index ?? lines.length;
  const header = new Map();
  for (let index = 1; index < firstSection; index += 1) {
    const match = FIELD.exec(lines[index]);
    if (!match) continue;
    const name = match[1];
    if (header.has(name)) defect('Duplicate field', name, `header repeats ${name}`, index + 1);
    header.set(name, match[3].trim());
    if (!['Status', 'Scope', 'Standards', 'Revision'].includes(name)) {
      defect('Unexpected field', name, `unexpected header field ${name}`, index + 1);
    }
  }
  for (const name of ['Status', 'Scope', 'Standards']) {
    if (!header.get(name)) defect('Missing or empty field', name, `header requires non-empty ${name}`);
  }
  if (header.has('Revision') && !header.get('Revision')) defect('Empty field', 'Revision', 'Revision must be non-empty');
  if (!['Complete', 'Partial', 'Needs clarification'].includes(header.get('Status'))) {
    defect('Value mismatch', 'Status', 'Status must be Complete, Partial, or Needs clarification');
  }
  if (options.expectedRevision !== undefined && header.get('Revision') !== options.expectedRevision) {
    defect('Revision mismatch', 'Revision', 'Revision must exactly match the caller-supplied expected revision');
  }
  const ids = new Set();
  for (const finding of parsed.entries) {
    const match = /^(R[1-9]\d*): \S.*$/.exec(finding.id);
    if (finding.section !== 'Findings') {
      defect('Stray finding', finding.id, 'finding headings belong only in Findings', finding.line);
    }
    if (!match) defect('Invalid finding ID', finding.id, 'expected ### R1: brief title', finding.line);
    else if (ids.has(match[1])) defect('Duplicate finding ID', match[1], `finding ID ${match[1]} repeats`, finding.line);
    if (match) ids.add(match[1]);
    for (const [name, allowed] of [
      ['Priority', ['Must fix', 'Should fix', 'Consider']], ['Confidence', ['High', 'Medium', 'Low']],
    ]) {
      const value = fieldContent(finding, name);
      if (value !== null && !allowed.includes(value)) defect('Value mismatch', name, `${name} is outside its enum`, finding.line);
    }
    for (const name of finding.order) {
      if (!ROAST_FINDING_FIELDS.includes(name)) defect('Unexpected field', name, `unexpected finding field ${name}`, finding.line);
    }
  }
  const start = lines.indexOf('## Findings');
  const end = lines.indexOf('## Coverage');
  if (start >= 0 && end > start) {
    const first = parsed.findings[0]?.line;
    const prefix = lines.slice(start + 1, first ? first - 1 : end).join('\n').trim();
    if (parsed.findings.length ? prefix !== '' : prefix !== 'None.') {
      defect('Invalid findings body', 'Findings', 'Findings must contain named findings or exactly None.');
    }
  }
  if (end >= 0 && !lines.slice(end + 1).join('\n').trim()) {
    defect('Empty coverage', 'Coverage', 'Coverage requires non-empty content outside quotes');
  }
  return {
    status: defects.length ? 'Invalid' : 'Valid',
    scope: 'final-report-structure', reviewStatus: header.get('Status') ?? null,
    revision: header.get('Revision') ?? null, findings: parsed.findings.length,
    checked: ['report headings and header', 'finding IDs and fields', 'priority and confidence', 'non-empty coverage',
      ...(options.expectedRevision === undefined ? [] : ['expected revision'])],
    remainingChecks: ['evidence truth and freshness', 'coverage sufficiency', 'applicable standards', 'recommendation and validation quality'],
    defects,
  };
}

export const USAGE = `Usage: roast-contract.mjs --report <absolute-path|-> [--roast] \\
  [--expected-revision <revision>] [--field <name>]... [--section <name>]...

  --report   Read a regular file, or - for stdin.
  --roast    Validate the complete final Roast report (not approval).
  --expected-revision  With --roast, compare the Revision header exactly.
  --field    Generic mode: required field, repeatable; defaults to Recommendation and Validation.
  --section  Generic mode: accepted findings section, repeatable.
  --probe    Report availability and exit.`;

function failUsage(message) {
  throw new FindingSchemaError('usage', message);
}

export function parseArguments(argv) {
  const values = {};
  const fields = [];
  const sections = [];
  if (argv.length === 1 && argv[0] === '--probe') return { probe: true };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--roast') {
      if (values.roast) failUsage('--roast was given more than once');
      values.roast = true;
      continue;
    }
    if (!['--report', '--expected-revision', '--field', '--section'].includes(flag)) {
      failUsage(`unknown argument: ${flag}`);
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith('--') || !value.trim()) failUsage(`${flag} requires a value`);
    if (flag === '--field') fields.push(value);
    else if (flag === '--section') sections.push(value);
    else {
      const name = flag.slice(2);
      if (name in values) failUsage(`${flag} was given more than once`);
      values[name] = value;
    }
  }
  if (!('report' in values)) failUsage('missing required argument for --report');
  if (values.roast && (fields.length || sections.length)) failUsage('--roast cannot override --field or --section');
  if ('expected-revision' in values && !values.roast) failUsage('--expected-revision requires --roast');
  return { probe: false, ...values, fields, sections };
}

function readReport(candidate) {
  if (!path.isAbsolute(candidate) || candidate.split(path.sep).includes('..')) {
    throw new FindingSchemaError('unsafe_path', 'report path must be absolute and must not traverse upward');
  }
  try {
    const stats = fs.lstatSync(candidate);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new FindingSchemaError('unsafe_path', 'report path must be a regular file, not a symlink');
    }
    return fs.readFileSync(candidate, 'utf8');
  } catch (error) {
    if (error instanceof FindingSchemaError) throw error;
    throw new FindingSchemaError('file_access', `cannot read report ${candidate}: ${error.code ?? error.message}`);
  }
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
  try {
    const report = parsed.report === '-' ? fs.readFileSync(0, 'utf8') : readReport(parsed.report);
    const result = parsed.roast
      ? validateRoastReport(report, { expectedRevision: parsed['expected-revision'] })
      : validateFindingSchema(report, {
        requiredFields: parsed.fields.length ? parsed.fields : undefined,
        sections: parsed.sections.length ? parsed.sections : undefined,
      });
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'Valid' ? 0 : 2;
  } catch (error) {
    streams.stderr.write(`${error.code ?? 'invalid_report'}: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
