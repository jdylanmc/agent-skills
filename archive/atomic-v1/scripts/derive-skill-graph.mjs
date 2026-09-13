import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFrontmatter, unitDescriptor, validateRepository } from './validate-skill-graph.mjs';

/**
 * Derived frontmatter for the composition graph.
 *
 * Two fields are derivable from the graph and are therefore generated and
 * committed, never hand-authored, following the `doctrine/manifest.md` pattern:
 *
 * - `used-by` on every unit - who composes it. Hand-authoring a reverse edge
 *   means every new consumer edits a file it does not own, which turns a
 *   popular atom into a merge-conflict hotspot.
 * - `allowed-tools` on every molecule - the transitive union of what it
 *   composes. A molecule has no tool needs of its own; it needs exactly what
 *   its parts need.
 *
 * Skills are deliberately **verified, never rewritten**. A skill's
 * `allowed-tools` is a permission grant. Regenerating it would mean that
 * composing a new unit silently widens the skill's privileges - an atom that
 * gains `execute` would hand `execute` to every skill that transitively reaches
 * it, with no human in the loop. So a skill must declare a grant that is a
 * superset of what its units need, and narrowing it stays a human decision.
 */

const WILDCARD = '*';

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isUnit(relativeFile) {
  return unitDescriptor(relativeFile) !== null;
}

function isMolecule(relativeFile) {
  return unitDescriptor(relativeFile)?.level === 'molecule';
}

function isSkillEntry(relativeFile) {
  return relativeFile.endsWith('/SKILL.md') && !relativeFile.startsWith('_base/');
}

/** Units reachable from `entry`, excluding `entry` itself, in sorted order. */
function unitClosure(graph, entry) {
  const seen = new Set();
  const visit = (node) => {
    for (const target of graph.get(node) ?? []) {
      if (!isUnit(target) || seen.has(target)) {
        continue;
      }
      seen.add(target);
      visit(target);
    }
  };
  visit(entry);
  return [...seen].sort();
}

function unionTools(units, toolsByUnit) {
  const tools = new Set();
  for (const unit of units) {
    for (const tool of toolsByUnit.get(unit) ?? []) {
      tools.add(tool);
    }
  }
  return [...tools].sort();
}

/**
 * Replaces a frontmatter field in place when present, or appends it to the end
 * of the frontmatter block when absent. Every other line is preserved byte for
 * byte, so regeneration never reformats a file it did not need to change.
 */
function setFrontmatterField(rawContent, field, serialized) {
  const usesCrlf = rawContent.includes('\r\n');
  const content = rawContent.replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) {
    throw new Error(`cannot set ${field}: file has no frontmatter`);
  }
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error(`cannot set ${field}: unterminated frontmatter`);
  }

  const header = content.slice(4, end).split('\n');
  const line = `${field}: ${serialized}`;
  const index = header.findIndex((entry) => new RegExp(`^${field}:`).test(entry));
  if (index === -1) {
    header.push(line);
  } else {
    header[index] = line;
  }

  const updated = `---\n${header.join('\n')}\n---\n${content.slice(end + 5)}`;
  return usesCrlf ? updated.replace(/\n/g, '\r\n') : updated;
}

export function deriveGraph(repositoryRoot) {
  const skillsRoot = path.join(repositoryRoot, 'skills');
  const result = validateRepository(repositoryRoot);

  const parsedByFile = new Map();
  for (const relativeFile of result.graph.keys()) {
    const absolute = path.join(skillsRoot, ...relativeFile.split('/'));
    const raw = fs.readFileSync(absolute, 'utf8');
    parsedByFile.set(relativeFile, { absolute, raw, parsed: readFrontmatter(raw, relativeFile) });
  }

  // Authored tools: atoms declare their own. A molecule's declared value is
  // ignored here, because it is exactly what this pass regenerates.
  const authoredTools = new Map();
  for (const [relativeFile, entry] of parsedByFile) {
    if (isUnit(relativeFile) && !isMolecule(relativeFile)) {
      authoredTools.set(relativeFile, entry.parsed.allowedTools ?? []);
    }
  }

  // Molecules resolve deepest-first so a molecule composing another molecule
  // unions an already-resolved value rather than a stale one.
  const molecules = [...parsedByFile.keys()].filter(isMolecule);
  const resolvedTools = new Map(authoredTools);
  const resolving = new Set();
  const resolve = (molecule) => {
    if (resolvedTools.has(molecule)) {
      return resolvedTools.get(molecule);
    }
    if (resolving.has(molecule)) {
      throw new Error(`molecule tool cycle at ${molecule}`);
    }
    resolving.add(molecule);
    const direct = (result.graph.get(molecule) ?? []).filter(isUnit);
    for (const target of direct.filter(isMolecule)) {
      resolve(target);
    }
    const tools = unionTools(direct, resolvedTools);
    resolving.delete(molecule);
    resolvedTools.set(molecule, tools);
    return tools;
  };
  for (const molecule of molecules) {
    resolve(molecule);
  }

  // Reverse edges: who directly composes each unit.
  const usedBy = new Map();
  for (const unit of [...parsedByFile.keys()].filter(isUnit)) {
    usedBy.set(unit, []);
  }
  for (const [source, targets] of result.graph) {
    for (const target of targets) {
      if (usedBy.has(target)) {
        usedBy.get(target).push(source);
      }
    }
  }
  for (const [unit, consumers] of usedBy) {
    usedBy.set(unit, [...new Set(consumers)].sort());
  }

  const updates = [];
  for (const [relativeFile, entry] of parsedByFile) {
    if (!isUnit(relativeFile)) {
      continue;
    }
    const expectedUsedBy = usedBy.get(relativeFile) ?? [];
    if (JSON.stringify(entry.parsed.usedBy ?? null) !== JSON.stringify(expectedUsedBy)) {
      updates.push({ relativeFile, field: 'used-by', expected: expectedUsedBy });
    }
    if (isMolecule(relativeFile)) {
      const expectedTools = resolvedTools.get(relativeFile) ?? [];
      if (JSON.stringify(entry.parsed.allowedTools ?? null) !== JSON.stringify(expectedTools)) {
        updates.push({ relativeFile, field: 'allowed-tools', expected: expectedTools });
      }
    }
  }

  // Skills are verified, never rewritten.
  const grantViolations = [];
  for (const relativeFile of [...parsedByFile.keys()].filter(isSkillEntry)) {
    const entry = parsedByFile.get(relativeFile);
    const granted = entry.parsed.allowedTools;
    if (granted === null) {
      const required = unionTools(unitClosure(result.graph, relativeFile), resolvedTools);
      grantViolations.push({
        relativeFile,
        missing: required,
        required,
        granted: [],
      });
      continue;
    }
    if (granted.includes(WILDCARD)) {
      continue;
    }
    const required = unionTools(unitClosure(result.graph, relativeFile), resolvedTools);
    const missing = required.filter((tool) => !granted.includes(tool));
    if (missing.length) {
      grantViolations.push({ relativeFile, missing, required, granted });
    }
  }

  return { skillsRoot, parsedByFile, resolvedTools, usedBy, updates, grantViolations, result };
}

export function applyUpdates(derived) {
  const written = new Set();
  for (const update of derived.updates) {
    const entry = derived.parsedByFile.get(update.relativeFile);
    const current = fs.readFileSync(entry.absolute, 'utf8');
    const next = setFrontmatterField(current, update.field, JSON.stringify(update.expected));
    fs.writeFileSync(entry.absolute, next);
    written.add(update.relativeFile);
  }
  return [...written].sort();
}

function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const positional = args.filter((value) => !value.startsWith('--'));
  const repositoryRoot = positional[0]
    ? path.resolve(positional[0])
    : path.resolve(scriptDirectory, '..');

  const derived = deriveGraph(repositoryRoot);

  if (derived.grantViolations.length) {
    for (const violation of derived.grantViolations) {
      console.error(
        `${violation.relativeFile}: allowed-tools does not cover its composed units; missing ${JSON.stringify(violation.missing)} (units need ${JSON.stringify(violation.required)}, skill grants ${JSON.stringify(violation.granted)})`,
      );
    }
    console.error(
      'A skill grant is never widened automatically. Add the missing tools deliberately, or stop composing the unit that needs them.',
    );
    throw new Error(`${derived.grantViolations.length} skill grant violation(s)`);
  }

  if (!derived.updates.length) {
    console.log(
      `Derived fields are up to date across ${derived.usedBy.size} units; ${derived.result.routableSkills.length} skill grants cover their composed units.`,
    );
    return;
  }

  if (!write) {
    for (const update of derived.updates) {
      console.error(
        `${update.relativeFile}: ${update.field} is stale; expected ${JSON.stringify(update.expected)}`,
      );
    }
    throw new Error(
      `${derived.updates.length} derived field(s) are stale. Regenerate with: node scripts/derive-skill-graph.mjs --write`,
    );
  }

  const written = applyUpdates(derived);
  console.log(`Updated derived fields in ${written.length} file(s):`);
  for (const file of written) {
    console.log(`  ${file}`);
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
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export { setFrontmatterField, toPosix, unitClosure };
