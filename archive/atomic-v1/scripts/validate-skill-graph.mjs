#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g;
const SECTION_PATTERN = /^## (Required References|Required Files)\s*$/;
const NEXT_SECTION_PATTERN = /^##\s+/;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const REFERENCE_DEFINITION_PATTERN = /^\s{0,3}\[[^\]]+\]:\s*\S/;
const REFERENCE_USAGE_PATTERN = /\]\s*\[/;

function toPosix(value) {
  return value.split(path.sep).join('/');
}

export function readFrontmatter(rawContent, file) {
  const content = rawContent.replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) {
    return null;
  }

  const end = content.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error(`${file}: unterminated frontmatter`);
  }

  const fields = new Map();
  for (const line of content.slice(4, end).split('\n')) {
    const match = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line);
    if (match) {
      const key = match[1].toLowerCase();
      if (fields.has(key)) {
        throw new Error(`${file}: duplicate frontmatter field: ${key}`);
      }
      fields.set(key, match[2].trim());
    }
  }

  const parseJsonField = (name, fallback) => {
    if (!fields.has(name)) {
      return fallback;
    }
    try {
      return JSON.parse(fields.get(name));
    } catch (error) {
      throw new Error(`${file}: ${name} must be valid JSON: ${error.message}`);
    }
  };

  return {
    body: content.slice(end + 5),
    name: fields.get('name') ?? null,
    description: fields.get('description') ?? null,
    level: fields.get('level') ?? null,
    includes: parseJsonField('includes', null),
    composes: parseJsonField('composes', null),
    requiresSkills: parseJsonField('requires-skills', []),
    allowedTools: parseJsonField('allowed-tools', null),
    usedBy: parseJsonField('used-by', null),
    disableModelInvocation: parseJsonField('disable-model-invocation', null),
    userInvocable: parseJsonField('user-invocable', null),
  };
}

/**
 * Shared level namespaces under `_base`. Skills may also own scoped
 * `<skill>/_atoms/` and `<skill>/_molecules/` namespaces.
 */
export const LEVEL_NAMESPACES = new Map([
  ['_base/_atoms/', 'atom'],
  ['_base/_molecules/', 'molecule'],
]);
export const CHRONICLER = '_base/_molecules/chronicler/chronicler.md';

function levelNamespaceOf(relativePath) {
  for (const [prefix, level] of LEVEL_NAMESPACES) {
    if (relativePath.startsWith(prefix)) {
      return { prefix, level, owner: null };
    }
  }
  const segments = relativePath.split('/');
  if (
    segments.length >= 3
    && segments[0]
    && segments[0] !== '_base'
    && ['_atoms', '_molecules'].includes(segments[1])
  ) {
    return {
      prefix: `${segments[0]}/${segments[1]}/`,
      level: segments[1] === '_atoms' ? 'atom' : 'molecule',
      owner: segments[0],
    };
  }
  return null;
}

/**
 * A unit root is `<level-namespace>/<unit-name>/`. Its canonical Markdown file
 * repeats the unit name, and every support file is isolated in the same root.
 */
function unitNameOf(baseName) {
  return baseName.split('.')[0];
}

export function unitDescriptor(relativeFile) {
  const namespace = levelNamespaceOf(relativeFile);
  if (!namespace) {
    return null;
  }
  const remainder = relativeFile.slice(namespace.prefix.length);
  const segments = remainder.split('/');
  if (segments.length !== 2 || !segments[0] || segments[1] !== `${segments[0]}.md`) {
    return null;
  }
  return {
    ...namespace,
    name: segments[0],
    root: `${namespace.prefix}${segments[0]}/`,
  };
}

function validateLevelNamespaces(skillsRoot, validatedUnits, localSkills) {
  const namespaces = [
    ...LEVEL_NAMESPACES.keys(),
    ...[...localSkills].flatMap((skill) => [
      `${skill}/_atoms/`,
      `${skill}/_molecules/`,
    ]),
  ];
  for (const prefix of namespaces) {
    const directory = path.join(skillsRoot, ...prefix.split('/').filter(Boolean));
    if (!fs.existsSync(directory)) {
      continue;
    }
    const units = validatedUnits.get(prefix) ?? new Set();

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const location = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new Error(`${location}: a level namespace must not contain a symbolic link`);
      }
      if (!entry.isDirectory()) {
        throw new Error(`${location}: a level namespace contains only unit root directories`);
      }

      const unitDirectory = path.join(directory, entry.name);
      for (const child of fs.readdirSync(unitDirectory, { withFileTypes: true })) {
        const childLocation = `${location}/${child.name}`;
        if (child.isSymbolicLink()) {
          throw new Error(`${childLocation}: a unit root must not contain a symbolic link`);
        }
        if (!child.isFile()) {
          throw new Error(`${childLocation}: a unit root contains only regular files`);
        }
        if (child.name === `${entry.name}.md`) {
          continue;
        }
        if (child.name.endsWith('.md')) {
          throw new Error(`${childLocation}: a unit root contains exactly one Markdown unit file`);
        }
        if (unitNameOf(child.name) !== entry.name) {
          throw new Error(
            `${childLocation}: support file name must begin with its unit name ${entry.name}`,
          );
        }
      }
      if (!units.has(entry.name)) {
        throw new Error(`${location}: unit root has no matching ${entry.name}.md unit`);
      }
    }
  }
}

function normalizeLinkTarget(raw) {
  let target = raw.trim();

  const title = /\s+("[^"]*"|'[^']*')$/.exec(target);
  if (title) {
    target = target.slice(0, title.index).trim();
  }
  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1).trim();
  }

  target = target.split('#', 1)[0].split('?', 1)[0];

  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function requiredLinks(body, file) {
  const links = [];
  let active = false;
  let fence = null;

  for (const line of body.split('\n')) {
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = marker;
        continue;
      }
      if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
        continue;
      }
    }
    if (fence !== null) {
      continue;
    }

    if (SECTION_PATTERN.test(line)) {
      active = true;
      continue;
    }
    if (active && NEXT_SECTION_PATTERN.test(line)) {
      active = false;
    }
    if (!active) {
      continue;
    }

    if (REFERENCE_DEFINITION_PATTERN.test(line) || REFERENCE_USAGE_PATTERN.test(line)) {
      throw new Error(
        `${file}: reference-style links are not supported in a required section; use inline links: ${line.trim()}`,
      );
    }

    for (const match of line.matchAll(LINK_PATTERN)) {
      const target = normalizeLinkTarget(match[1]);
      if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target)) {
        links.push(target);
      }
    }
  }

  return links;
}

function canonicalizeInclude(skillsRoot, sourceFile, target) {
  if (target.includes('\\')) {
    throw new Error(`${sourceFile}: include must use forward slashes: ${target}`);
  }

  const resolved = path.resolve(path.dirname(sourceFile), target);
  const relative = path.relative(skillsRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${sourceFile}: include escapes the skills root: ${target}`);
  }

  const canonical = toPosix(relative);
  const realRoot = fs.realpathSync(skillsRoot);
  let realTarget;
  try {
    realTarget = fs.realpathSync(resolved);
  } catch {
    throw new Error(`${sourceFile}: unresolved include: ${target}`);
  }
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`${sourceFile}: include escapes the skills root through a symlink: ${target}`);
  }

  const actual = toPosix(path.relative(realRoot, realTarget));
  if (canonical !== actual) {
    throw new Error(`${sourceFile}: include case or canonical path mismatch: ${target}`);
  }
  return canonical;
}

function listMarkdownFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files.sort();
}

function validateSkillDependency(edge, localSkills, file) {
  if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
    throw new Error(`${file}: every requires-skills entry must be an object`);
  }
  const keys = Object.keys(edge).sort().join(',');
  if (keys !== 'id,required,source') {
    throw new Error(`${file}: requires-skills entries require exactly id, source, and required`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edge.id)) {
    throw new Error(`${file}: invalid skill id: ${edge.id}`);
  }
  if (!['local', 'external'].includes(edge.source) || typeof edge.required !== 'boolean') {
    throw new Error(`${file}: invalid requires-skills edge for ${edge.id}`);
  }
  if (edge.source === 'local' && !localSkills.has(edge.id)) {
    throw new Error(`${file}: unresolved local skill dependency: ${edge.id}`);
  }
}

export function validateRepository(repositoryRoot) {
  const skillsRoot = path.join(repositoryRoot, 'skills');
  const markdownFiles = listMarkdownFiles(skillsRoot);
  const localSkills = new Set(
    fs.readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== '_base')
      .filter((entry) => fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md')))
      .map((entry) => entry.name),
  );
  const graph = new Map();
  const participating = new Set();
  const validatedUnits = new Map();

  for (const file of markdownFiles) {
    const relativeFile = toPosix(path.relative(skillsRoot, file));
    const parsed = readFrontmatter(fs.readFileSync(file, 'utf8'), relativeFile);
    const namespace = levelNamespaceOf(relativeFile);
    const unit = unitDescriptor(relativeFile);
    if (namespace?.owner && !localSkills.has(namespace.owner)) {
      throw new Error(
        `${relativeFile}: a local unit must belong to a routable skill package`,
      );
    }
    if (namespace && !unit) {
      throw new Error(
        `${relativeFile}: a unit file must be located at <level-namespace>/<unit-name>/<unit-name>.md`,
      );
    }
    if (!parsed || parsed.includes === null) {
      if (namespace) {
        throw new Error(
          `${relativeFile}: the Markdown file in a unit root must be <unit-name>/<unit-name>.md and declare frontmatter with includes`,
        );
      }
      continue;
    }
    if (!Array.isArray(parsed.includes) || !parsed.includes.every((item) => typeof item === 'string')) {
      throw new Error(`${relativeFile}: includes must be a JSON string array`);
    }
    if (
      parsed.composes !== null
      && (!Array.isArray(parsed.composes) || !parsed.composes.every((item) => typeof item === 'string'))
    ) {
      throw new Error(`${relativeFile}: composes must be a JSON string array`);
    }
    if (!Array.isArray(parsed.requiresSkills)) {
      throw new Error(`${relativeFile}: requires-skills must be a JSON array`);
    }

    const namespaceLevel = unit;
    if (namespaceLevel) {
      const stem = namespaceLevel.name;
      if (!parsed.name) {
        throw new Error(`${relativeFile}: a unit must declare name`);
      }
      if (!parsed.description) {
        throw new Error(`${relativeFile}: a unit must declare description`);
      }
      if (parsed.name !== stem) {
        throw new Error(`${relativeFile}: name ${parsed.name} must match the unit file name ${stem}`);
      }
      if (parsed.level !== namespaceLevel.level) {
        throw new Error(
          `${relativeFile}: level must be ${namespaceLevel.level} to match its namespace; found ${parsed.level ?? 'none'}`,
        );
      }
      if (parsed.requiresSkills.length) {
        throw new Error(`${relativeFile}: a ${namespaceLevel.level} must not declare requires-skills`);
      }
      if (parsed.composes === null) {
        throw new Error(`${relativeFile}: a unit must declare composes`);
      }
      if (namespaceLevel.level === 'atom' && parsed.composes.length) {
        throw new Error(`${relativeFile}: an atom composes no other unit, so composes must be empty`);
      }
      if (
        namespaceLevel.level === 'atom'
        && parsed.includes.some((target) => unitDescriptor(target))
      ) {
        throw new Error(`${relativeFile}: an atom references no other unit`);
      }
      if (namespaceLevel.level === 'molecule') {
        if (parsed.composes.length < 2) {
          throw new Error(
            `${relativeFile}: a molecule composes two or more units; found ${parsed.composes.length}`,
          );
        }
        for (const target of parsed.composes) {
          const targetUnit = unitDescriptor(target);
          if (!targetUnit) {
            throw new Error(
              `${relativeFile}: a molecule composes only canonical atoms and molecules; ${target} is not a unit`,
            );
          }
          if (
            namespaceLevel.owner
            && targetUnit.owner
            && targetUnit.owner !== namespaceLevel.owner
          ) {
            throw new Error(
              `${relativeFile}: a local molecule may not compose a unit owned by ${targetUnit.owner}`,
            );
          }
        }
        for (const target of parsed.includes.filter((item) => item.endsWith('.md'))) {
          if (!unitDescriptor(target)) {
            throw new Error(
              `${relativeFile}: a molecule may include only canonical atoms and molecules; ${target} is not a unit`,
            );
          }
        }
        for (const target of parsed.includes.filter((item) => !item.endsWith('.md'))) {
          if (!target.startsWith(`${namespaceLevel.root}${stem}.`)) {
            throw new Error(
              `${relativeFile}: a unit may include only its own local support files; found ${target}`,
            );
          }
        }
      }
      if (!validatedUnits.has(namespaceLevel.prefix)) {
        validatedUnits.set(namespaceLevel.prefix, new Set());
      }
      validatedUnits.get(namespaceLevel.prefix).add(stem);
    } else if (parsed.level !== null) {
      throw new Error(
        `${relativeFile}: declares level ${parsed.level} but does not live in a level namespace`,
      );
    }

    const markdownIncludes = requiredLinks(parsed.body, relativeFile)
      .map((target) => canonicalizeInclude(skillsRoot, file, target))
      .sort();
    const declared = [...parsed.includes].sort();
    if (declared.some((target) => target.includes('\\') || target.split('/').includes('..'))) {
      throw new Error(`${relativeFile}: declared includes must use normalized forward-slash paths`);
    }
    if (new Set(declared).size !== declared.length) {
      throw new Error(`${relativeFile}: includes contains duplicates`);
    }
    if (JSON.stringify(markdownIncludes) !== JSON.stringify(declared)) {
      throw new Error(
        `${relativeFile}: includes mirror drift; declared=${JSON.stringify(declared)} markdown=${JSON.stringify(markdownIncludes)}`,
      );
    }

    if (parsed.composes !== null) {
      if (
        parsed.composes.some(
          (target) => target.includes('\\') || target.split('/').includes('..'),
        )
      ) {
        throw new Error(`${relativeFile}: composes must use normalized forward-slash paths`);
      }
      if (new Set(parsed.composes).size !== parsed.composes.length) {
        throw new Error(`${relativeFile}: composes contains duplicates`);
      }
      const expectedComposes = parsed.includes
        .filter((target) => unitDescriptor(target))
        .sort();
      const declaredComposes = [...parsed.composes].sort();
      if (JSON.stringify(expectedComposes) !== JSON.stringify(declaredComposes)) {
        throw new Error(
          `${relativeFile}: composes drift; declared=${JSON.stringify(declaredComposes)} expected=${JSON.stringify(expectedComposes)}`,
        );
      }
    }

    const skillEntry = relativeFile.endsWith('/SKILL.md') && !relativeFile.startsWith('_base/');
    if (skillEntry && parsed.composes !== null) {
      if (typeof parsed.disableModelInvocation !== 'boolean') {
        throw new Error(`${relativeFile}: an atomic skill must declare disable-model-invocation`);
      }
      if (typeof parsed.userInvocable !== 'boolean') {
        throw new Error(`${relativeFile}: an atomic skill must declare user-invocable`);
      }
      const skill = relativeFile.split('/')[0];
      for (const target of parsed.composes) {
        const targetUnit = unitDescriptor(target);
        if (targetUnit?.owner && targetUnit.owner !== skill) {
          throw new Error(
            `${relativeFile}: a skill may not compose a local unit owned by ${targetUnit.owner}`,
          );
        }
      }
    }

    for (const dependency of parsed.requiresSkills) {
      validateSkillDependency(dependency, localSkills, relativeFile);
    }
    graph.set(relativeFile, declared);
    participating.add(relativeFile);
  }

  for (const [source, targets] of graph) {
    for (const target of targets) {
      if (target.endsWith('.md') && !participating.has(target)) {
        throw new Error(`${source}: reachable Markdown include has not opted in: ${target}`);
      }
    }
  }

  if (fs.existsSync(path.join(skillsRoot, ...CHRONICLER.split('/')))) {
    for (const skill of localSkills) {
      const entry = `${skill}/SKILL.md`;
      if (!graph.has(entry)) {
        throw new Error(
          `${entry}: every routable skill must declare includes and directly compose ${CHRONICLER}`,
        );
      }
      if (!graph.get(entry).includes(CHRONICLER)) {
        throw new Error(
          `${entry}: every routable skill must directly compose ${CHRONICLER}`,
        );
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (node, trail) => {
    if (visiting.has(node)) {
      throw new Error(`include cycle: ${[...trail, node].join(' -> ')}`);
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    for (const target of graph.get(node) ?? []) {
      if (graph.has(target)) {
        visit(target, [...trail, node]);
      }
    }
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of graph.keys()) {
    visit(node, []);
  }

  const baseSkillEntries = markdownFiles
    .map((file) => toPosix(path.relative(skillsRoot, file)))
    .filter((file) => file.startsWith('_base/') && file.endsWith('/SKILL.md'));
  if (baseSkillEntries.length) {
    throw new Error(`_base must not contain routable SKILL.md files: ${baseSkillEntries.join(', ')}`);
  }

  validateLevelNamespaces(skillsRoot, validatedUnits, localSkills);

  return {
    graph,
    localSkills,
    participating,
    routableSkills: [...localSkills].sort(),
  };
}

/**
 * Returns the include closure for `entry` in deterministic order: the entry
 * first, then each reachable include in declared (sorted) order, depth first.
 * `validateRepository` rejects cycles, so callers must pass a result it
 * produced; an unvalidated cyclic graph would not terminate.
 */
export function closureFor(result, entry) {
  const closure = [];
  const seen = new Set();
  const visit = (node) => {
    if (seen.has(node)) {
      return;
    }
    seen.add(node);
    closure.push(node);
    for (const target of result.graph.get(node) ?? []) {
      if (result.graph.has(target)) {
        visit(target);
      }
    }
  };
  visit(entry);
  return closure;
}

function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(scriptDirectory, '..');
  const result = validateRepository(repositoryRoot);
  console.log(
    `Validated ${result.participating.size} participating Markdown files and ${result.routableSkills.length} routable skills.`,
  );
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
