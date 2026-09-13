#!/usr/bin/env node

/**
 * Turns what the operator said into the prose that gets stored, and screens the
 * result for the one failure that would make the whole exercise pointless.
 *
 * An intent exists so a competent future model can rebuild the skill without
 * the current package in front of it. That only works if the intent describes
 * the *problem* rather than today's arrangement of the solution. The moment it
 * says which parts the package is cut into, which fields the frontmatter
 * carries, or which script refuses which flag, it has stopped being a
 * requirement and become a description of an implementation that a
 * regeneration is free to discard — and a rationale recorded at that level
 * disappears with it.
 *
 * So the screen refuses structural vocabulary rather than warning about it.
 * The distinction it enforces is the one the issue draws:
 *
 *   not intent: "the code branch does not compose roast-coordinate-review"
 *       intent: "reviewing a set of code changes is not the same job as
 *                reviewing one artifact"
 *
 * Both describe the same decision. Only the second survives into a library
 * arranged differently.
 *
 * The screen is deliberately narrow. Every term in it is one that plain English
 * about a problem has no reason to use, which is why the four intent files
 * already drafted by hand pass it untouched. A screen that flagged ordinary
 * words would be turned off within a week.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class SynthesisError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SynthesisError';
    this.code = code;
  }
}

/**
 * Vocabulary that names this library's machinery. `AGENTS.md` owns these terms;
 * the drift suite asserts each still appears there, so a rename upstream breaks
 * the build rather than silently emptying the screen.
 */
export const STRUCTURAL_TERMS = [
  { kind: 'frontmatter-field', pattern: /\ballowed-tools\b/i },
  { kind: 'frontmatter-field', pattern: /\bused-by\b/i },
  { kind: 'frontmatter-field', pattern: /\bdisable-model-invocation\b/i },
  { kind: 'frontmatter-field', pattern: /\buser-invocable\b/i },
  { kind: 'frontmatter-field', pattern: /\brequires-skills\b/i },
  { kind: 'frontmatter-field', pattern: /\bcomposes\b/i },
  { kind: 'frontmatter-field', pattern: /(?:`includes`|\bincludes:)/i },
  { kind: 'frontmatter-field', pattern: /(?:`level`|\blevel:)/i },
  { kind: 'frontmatter-field', pattern: /\bfrontmatter\b/i },
  { kind: 'composition-shape', pattern: /\batoms?\b/i },
  { kind: 'composition-shape', pattern: /\bmolecules?\b/i },
  { kind: 'composition-shape', pattern: /\b_atoms\b/i },
  { kind: 'composition-shape', pattern: /\b_molecules\b/i },
  { kind: 'composition-shape', pattern: /\b_base\b/i },
  { kind: 'repository-path', pattern: /\bSKILL\.md\b/i },
  { kind: 'repository-path', pattern: /\bAGENTS\.md\b/i },
  { kind: 'repository-path', pattern: /\bintent\.md\b/i },
  { kind: 'repository-path', pattern: /\.mjs\b/i },
  { kind: 'repository-path', pattern: /\.test\.mjs\b/i },
  { kind: 'tooling', pattern: /\bvalidat(?:or|e-skill-graph)\b/i },
  { kind: 'tooling', pattern: /\bderiv(?:er|e-skill-graph)\b/i },
  { kind: 'tooling', pattern: /\bexit\s+code\b/i },
  { kind: 'tooling', pattern: /\bJSON\b/ },
  { kind: 'tooling', pattern: /\bYAML\b/ },
  { kind: 'tooling', pattern: /\bregular\s+expression\b|\bregexe?s?\b/i },
  { kind: 'tooling', pattern: /\bkebab-case\b/i },
];

/**
 * Table headers and section headings that belong to a machine-facing document.
 * An intent is prose for a person; a field table is a schema addressed to a
 * checker.
 */
export const SCHEMA_SHAPES = [
  { kind: 'schema-table', pattern: /^\|\s*(?:Field|Input|Output|Key|Property|Parameter|Flag|Event|Exit\s+code)s?\s*\|/i },
  { kind: 'schema-heading', pattern: /^#{1,6}\s+(?:Required\s+References|Required\s+Files|Inputs?|Operation|Guarantees)\s*$/i },
];

/**
 * Every probe must be flagged. A screen whose vocabulary drifts out of the
 * prose it screens reports every draft as clean, which is the exact fail-open
 * shape this repository has already shipped; the suite runs each of these
 * through `screenIntentProse` and fails when one comes back plain.
 */
export const STRUCTURAL_PROBES = [
  'It grants allowed-tools of read and execute.',
  'The used-by field is derived and committed.',
  'It declares disable-model-invocation so a human must run it.',
  'The skill composes three units and one shared molecule.',
  'Its `includes` list mirrors the required references.',
  'The frontmatter records which tools it may use.',
  'The work is split into two atoms and one molecule.',
  'Anything shared lives under _base until a second consumer appears.',
  'The workflow lives in SKILL.md alongside its references.',
  'AGENTS.md is the canonical rule set it must satisfy.',
  'It writes intent.md into the new package directory.',
  'The check runs as a node script ending in .mjs.',
  'The validator refuses a package that cannot be derived.',
  'A refusal returns exit code 2 and a usage failure returns 1.',
  'The record is passed as JSON on the command line.',
  'The name must be kebab-case.',
  '| Field | Meaning |',
  '## Required References',
];

/** Prose that must pass. A screen nobody can satisfy is a screen nobody runs. */
export const PLAIN_PROBES = [
  'A review against the wrong standard is worse than one that declines to start.',
  'Reviewing a set of code changes is not the same job as reviewing one artifact.',
  'It must stop and ask before doing anything that cannot be undone.',
  'Severity ranks; it does not gate. A human still decides what ships.',
  'It is allowed to read the whole repository and to change nothing outside the new work.',
];

function lineNumbersOf(text) {
  return text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Screens a candidate intent for anything that is not plain requirements.
 *
 * Unlike the rubber-duck brief screen, this one does **not** skip fenced
 * content. A fenced block inside an intent is a code sample or a field table,
 * and both are the thing being refused; exempting them would leave the one
 * place structural detail most naturally accumulates unchecked.
 */
export function screenIntentProse(text) {
  if (typeof text !== 'string') {
    throw new SynthesisError('invalid_input', 'the intent draft must be a string');
  }
  if (text.trim() === '') {
    throw new SynthesisError('empty_draft', 'the intent draft is empty');
  }

  const findings = [];
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.startsWith('---\n') || normalized.startsWith('---\r\n')) {
    findings.push({
      kind: 'frontmatter-block',
      line: 1,
      text: '---',
      detail: 'an intent carries no frontmatter; it is addressed to a person, not to a checker',
    });
  }

  const lines = lineNumbersOf(normalized);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const { kind, pattern } of [...STRUCTURAL_TERMS, ...SCHEMA_SHAPES]) {
      const match = pattern.exec(line);
      if (match) {
        findings.push({ kind, line: index + 1, text: line.trim(), detail: match[0] });
      }
    }
  }

  return { status: findings.length ? 'structural' : 'plain', findings };
}

/**
 * Checks the shape of a synthesized intent without imposing a template.
 *
 * The only shape requirements are a title naming the skill and at least one
 * section, because the drafted intent files differ from one another everywhere
 * else and should be allowed to. Anything stricter would turn a synthesis back
 * into the form this step exists to avoid.
 */
export function reviewIntentDraft(text, skill) {
  if (typeof skill !== 'string' || skill.trim() === '') {
    throw new SynthesisError(
      'missing_skill',
      'reviewing a draft requires the skill it belongs to; without it the title check silently does nothing',
    );
  }
  const screened = screenIntentProse(text);
  const normalized = text.replace(/\r\n/g, '\n');
  const title = /^#\s+Intent:\s*(\S.*)$/m.exec(normalized);
  const problems = [];
  if (!title) {
    problems.push('the draft must open with a title of the form "# Intent: <skill>"');
  } else if (title[1].trim() !== skill.trim()) {
    problems.push(`the title names ${title[1].trim()} but the intent is for ${skill.trim()}`);
  }
  if (!/^##\s+\S/m.test(normalized)) {
    problems.push('the draft has no sections; an intent is prose a person reads, not one paragraph');
  }
  return { ...screened, problems, shape: problems.length ? 'malformed' : 'well-formed' };
}

const VALUE_FLAGS = ['--screen', '--skill'];

export const USAGE = `Usage: intent-synthesis.mjs --screen <path> --skill <name>

  --screen  Absolute path to a candidate intent draft to screen.
  --skill   Skill name the draft's title must name.
  --probe   Report availability and exit.`;

export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      return { probe: true };
    }
    if (!VALUE_FLAGS.includes(flag)) {
      throw new SynthesisError('usage', `unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new SynthesisError('usage', `${flag} requires a value`);
    }
    const name = flag.slice(2);
    if (name in values) {
      throw new SynthesisError('usage', `${flag} was given more than once`);
    }
    values[name] = value;
    index += 1;
  }
  for (const required of ['screen', 'skill']) {
    if (!(required in values)) {
      throw new SynthesisError(
        'usage',
        `--${required} is required; an omitted skill name would skip the title check silently`,
      );
    }
  }
  return { probe: false, ...values };
}

export function readDraftFile(candidate) {
  if (!path.isAbsolute(candidate)) {
    throw new SynthesisError('unsafe_path', 'draft path must be absolute');
  }
  if (candidate.split(path.sep).includes('..')) {
    throw new SynthesisError('unsafe_path', 'draft path must not traverse upward');
  }
  let stats;
  try {
    stats = fs.lstatSync(candidate);
  } catch {
    throw new SynthesisError('unsafe_path', `draft does not exist: ${candidate}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new SynthesisError('unsafe_path', 'draft path must be a regular file');
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
    streams.stdout.write('intent-synthesis: available\n');
    return 0;
  }
  try {
    const result = reviewIntentDraft(readDraftFile(parsed.screen), parsed.skill);
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'plain' && result.shape === 'well-formed' ? 0 : 2;
  } catch (error) {
    if (error instanceof SynthesisError) {
      streams.stderr.write(`${error.code}: ${error.message}\n`);
      return ['usage', 'unsafe_path'].includes(error.code) ? 1 : 2;
    }
    throw error;
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
