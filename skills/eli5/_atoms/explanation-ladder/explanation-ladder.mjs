/**
 * Deterministic structure checker for the eli5 explanation ladder.
 *
 * The eli5 skill returns one subject explained at three increasing levels:
 * five-year-old, junior practitioner, expert. Whether level 3 is genuinely
 * deeper than level 2 is a semantic judgement no arithmetic can make, and this
 * module does not pretend to make it.
 *
 * WHAT THIS CHECKS, AND WHAT IT DOES NOT
 *
 * It checks structure and repetition — arithmetic over a parsed response:
 * that exactly the three levels are present, once each, in order, non-empty,
 * concise, bulleted, and that no later level literally restates an earlier
 * line. That is the narrow, real failure a drafting agent leaves behind: the
 * wrong count of sections, the wrong order, an empty or bloated section, or
 * "one giant explanation with three headings and repeated content" — the
 * issue's own explicit non-goal.
 *
 * It does NOT judge whether a level is written for the right audience, whether
 * the junior role was inferred correctly, or whether the expert section says
 * anything an expert did not already know. Those are the reviewer's judgement,
 * and claiming otherwise would make this the kind of promise it exists to
 * replace.
 *
 * Fail closed: empty or unparseable input is `ladder-defective` with a named
 * defect, never `ladder-ok`. A non-string input is refused with a TypeError
 * rather than coerced into a false pass.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The three canonical levels, in the only order they may appear. Each carries
 * a stable `id` used in defects and the exact heading text a section must use.
 */
export const LADDER_LEVELS = [
  { id: 'five-year-old', heading: 'Explain like I am five' },
  { id: 'junior', heading: 'Explain like I am a junior practitioner' },
  { id: 'expert', heading: 'Explain like I am an expert' },
];

/**
 * "Concise" only becomes checkable once it is arithmetic, so these three
 * numbers are the place the word turns into a rule. They are deliberately
 * generous: they catch the essay-in-a-heading and the empty heading, not a
 * merely inelegant sentence, which is a judgement left to the reviewer.
 */

/** A whole level over this many words has stopped being a skimmable summary. */
export const SECTION_WORD_LIMIT = 120;

/** A single line over this many words is a paragraph wearing a bullet. */
export const LINE_WORD_LIMIT = 40;

/** Fewer bullets than this is prose, not the skimmable ladder the skill owes. */
export const MINIMUM_BULLETS = 2;

const LEVEL_BY_NORMALIZED_HEADING = new Map(
  LADDER_LEVELS.map((level) => [normalizeHeading(level.heading), level.id]),
);
const CANONICAL_ORDER = LADDER_LEVELS.map((level) => level.id);

const HEADING_PATTERN = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const BULLET_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const BULLET_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

function normalizeHeading(text) {
  return text
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/[*_`~]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a body line so repetition that differs only by punctuation,
 * emphasis markers, bullet style, or letter case is still recognized as the
 * same line. This is what makes "restate the level-2 bullet in level 3, in
 * bold, with a period" a caught defect rather than a clever bypass.
 */
function normalizeLine(text) {
  return text
    .replace(BULLET_MARKER, '')
    .replace(/[*_`~]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text) {
  const words = text.replace(BULLET_MARKER, '').trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/**
 * Parse a rendered response into an ordered list of heading-delimited
 * sections, plus any preamble that precedes the first heading.
 *
 * Headings inside fenced code blocks are body, not sections: a fence is not a
 * heading, and a `###` line inside one must not be mistaken for a level.
 *
 * @param {string} markdown
 * @returns {{ preamble: string[], sections: Array<{ index: number, id: string|null, heading: string, depth: number, lines: string[] }> }}
 */
export function parseLadder(markdown) {
  if (typeof markdown !== 'string') {
    throw new TypeError('parseLadder expects the rendered response as a string');
  }

  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const preamble = [];
  const sections = [];
  let current = null;
  let fence = null;

  for (const line of lines) {
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      (current ? current.lines : preamble).push(line);
      continue;
    }

    if (fence === null) {
      const headingMatch = HEADING_PATTERN.exec(line);
      if (headingMatch) {
        const heading = headingMatch[2].trim();
        current = {
          index: sections.length,
          id: LEVEL_BY_NORMALIZED_HEADING.get(normalizeHeading(heading)) ?? null,
          heading,
          depth: headingMatch[1].length,
          lines: [],
        };
        sections.push(current);
        continue;
      }
    }

    (current ? current.lines : preamble).push(line);
  }

  return { preamble, sections };
}

function bodyLines(section) {
  return section.lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

/**
 * Check a rendered response against the ladder contract.
 *
 * @param {string} markdown
 * @returns {{ verdict: 'ladder-ok'|'ladder-defective', sections: Array, defects: Array<{ code: string, section: string, detail: string }> }}
 */
export function checkLadder(markdown) {
  const { sections } = parseLadder(markdown);
  const defects = [];

  for (const section of sections) {
    if (section.id === null) {
      defects.push({
        code: 'section-unexpected',
        section: section.heading,
        detail: `heading "${section.heading}" is not one of the three ladder levels`,
      });
    }
  }

  const occurrences = new Map();
  for (const section of sections) {
    if (section.id === null) continue;
    if (!occurrences.has(section.id)) occurrences.set(section.id, []);
    occurrences.get(section.id).push(section);
  }

  for (const [id, matched] of occurrences) {
    if (matched.length > 1) {
      defects.push({
        code: 'section-duplicated',
        section: id,
        detail: `the ${id} level appears ${matched.length} times; it must appear once`,
      });
    }
  }

  for (const level of LADDER_LEVELS) {
    if (!occurrences.has(level.id)) {
      defects.push({
        code: 'section-missing',
        section: level.id,
        detail: `missing the ${level.id} level ("${level.heading}")`,
      });
    }
  }

  const presentOrder = [];
  for (const section of sections) {
    if (section.id !== null && !presentOrder.includes(section.id)) {
      presentOrder.push(section.id);
    }
  }
  const expectedOrder = CANONICAL_ORDER.filter((id) => presentOrder.includes(id));
  if (presentOrder.join(',') !== expectedOrder.join(',')) {
    defects.push({
      code: 'section-out-of-order',
      section: presentOrder.join(' -> '),
      detail: `levels appear as ${presentOrder.join(' -> ')}; required order is ${expectedOrder.join(' -> ')}`,
    });
  }

  const seenLine = new Map();
  for (const level of LADDER_LEVELS) {
    const matched = occurrences.get(level.id);
    if (!matched) continue;
    // The first occurrence carries the section's content for per-level checks;
    // a duplicate is already reported above.
    const section = matched[0];
    const content = bodyLines(section);

    if (content.length === 0) {
      defects.push({
        code: 'section-empty',
        section: level.id,
        detail: `the ${level.id} level has no content`,
      });
      continue;
    }

    const bullets = content.filter((line) => BULLET_PATTERN.test(line));
    if (bullets.length < MINIMUM_BULLETS) {
      defects.push({
        code: 'section-not-bulleted',
        section: level.id,
        detail: `the ${level.id} level has ${bullets.length} bullet(s); at least ${MINIMUM_BULLETS} are required`,
      });
    }

    const sectionWords = content.reduce((total, line) => total + countWords(line), 0);
    if (sectionWords > SECTION_WORD_LIMIT) {
      defects.push({
        code: 'section-too-long',
        section: level.id,
        detail: `the ${level.id} level has ${sectionWords} words; the limit is ${SECTION_WORD_LIMIT}`,
      });
    }

    for (const line of content) {
      if (countWords(line) > LINE_WORD_LIMIT) {
        defects.push({
          code: 'line-too-long',
          section: level.id,
          detail: `a line in the ${level.id} level has ${countWords(line)} words; the limit is ${LINE_WORD_LIMIT}`,
        });
        break;
      }
    }

    for (const line of content) {
      const normalized = normalizeLine(line);
      if (normalized === '') continue;
      const priorLevel = seenLine.get(normalized);
      if (priorLevel !== undefined && priorLevel !== level.id) {
        defects.push({
          code: 'content-repeated',
          section: level.id,
          detail: `the ${level.id} level restates a line already used in the ${priorLevel} level: "${line.trim()}"`,
        });
      } else if (priorLevel === undefined) {
        seenLine.set(normalized, level.id);
      }
    }
  }

  const verdict = defects.length === 0 ? 'ladder-ok' : 'ladder-defective';
  return { verdict, sections, defects };
}

/** True only when the ladder is well formed. Never softened by caller opinion. */
export function ladderAccepted(result) {
  return result?.verdict === 'ladder-ok';
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const markdown = await readStdin();
  const result = checkLadder(markdown);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return ladderAccepted(result) ? 0 : 1;
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
  main().then((code) => {
    process.exitCode = code;
  });
}
