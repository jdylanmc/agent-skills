#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const AUTHORITY_MARKER = 'prototype-implementation-excluded-from-production-authority';
export const STATE_VERSION = 2;
export const RECEIPT_SCHEMA = 'product-design-human-receipt/v2';
export const SPECIALIST_EVENT_SCHEMA = 'product-design-specialist-event/v1';
export const MERGE_SCHEMA = 'product-design-merge-observation/v1';
export const CONTRACT_SCHEMA = 'product-design-interaction-contract/v1';
export const STATUSES = [
  'needs-discovery',
  'needs-brand-alignment',
  'needs-concept-evidence',
  'needs-human-decision',
  'needs-approval',
  'approved',
  'blocked',
  'cancelled',
];
export const STATUS_PRECEDENCE = [
  'cancelled',
  'blocked',
  'needs-discovery',
  'needs-brand-alignment',
  'needs-concept-evidence',
  'needs-human-decision',
  'needs-approval',
  'approved',
];
export const USAGE = 'Usage: approval-binding.mjs --root <absolute-repository-root> --input <absolute-json-path> [--evidence <absolute-json-path>]';

export class ApprovalBindingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApprovalBindingError';
    this.code = code;
    this.status = 'blocked';
  }
}

function idArray(value, field, options) {
  return stringArray(value, field, options).map((entry, index) => stableId(entry, `${field}[${index}]`));
}

const TOP_FIELDS = [
  'version', 'cancelled', 'subject', 'discovery', 'workspace', 'specialists',
  'artifactManifest', 'brand', 'concepts', 'selectedConceptId', 'interactionContract',
];
const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIGEST = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const RECEIPT_ACTIONS = [
  'discovery-aligned', 'brand-aligned', 'concept-selected', 'product-design-approved',
];
const RECEIPT_FIELDS = [
  'schema', 'receiptId', 'action', 'subjectId', 'prototypeRevision',
  'discoveryDigest', 'brandDigest', 'conceptId', 'conceptDigest',
  'artifactSetDigest', 'interactionContractDigest', 'actor', 'role', 'contextId',
  'channel', 'sourceId', 'observedAt', 'sequence',
];
const SPECIALIST_EVENT_FIELDS = [
  'schema', 'eventId', 'role', 'contextId', 'action', 'subjectId',
  'prototypeRevision', 'artifactRevision', 'channel', 'sourceId',
  'observedAt', 'sequence',
];
const SPECIALIST_ACTIONS = ['specialist-started', 'specialist-completed'];
const MERGE_FIELDS = [
  'schema', 'provider', 'repository', 'changeRequestId', 'state',
  'destinationBranch', 'defaultBranch', 'revision', 'artifactSetDigest',
  'interactionContractDigest', 'mergedAt', 'provenance',
];
const MERGE_PROVENANCE_FIELDS = ['producer', 'sourceId'];
const STATIC_SERVER_PACKAGE = 'http-server';
const STATIC_SERVER_VERSION = '14.1.1';
const STATIC_SERVER_SCRIPT = 'http-server . -a 127.0.0.1 -p 4173 -c-1 --no-dotfiles';
const STORYBOOK_PACKAGE = 'storybook';
const STORYBOOK_VERSION = '8.6.14';
const STORYBOOK_SCRIPT = 'storybook dev --host 127.0.0.1 --port 6006 --ci';
const PACKAGE_RECORD_METADATA = ['version', 'resolved', 'integrity'];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const DISPOSITIONS = new Set(['selected', 'rejected', 'retained']);
const NOT_APPLICABLE_RATIONALES = new Map([
  ['reduced-motion', new Set(['selected-concept-has-no-motion'])],
  ['state-communication', new Set(['selected-concept-has-no-error-or-dynamic-state'])],
]);

function fail(code, message) {
  throw new ApprovalBindingError(code, message);
}

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid-input', `${field} must be an object`);
  }
  return value;
}

function exactFields(value, fields, name) {
  const keys = Object.keys(object(value, name));
  const missing = fields.filter((field) => !keys.includes(field));
  const unknown = keys.filter((field) => !fields.includes(field));
  if (missing.length || unknown.length) {
    fail('invalid-input', `${name} fields differ (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'})`);
  }
}

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') fail('invalid-input', `${field} must be non-empty text`);
  return value.trim();
}

function sequence(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid-evidence', `${field} must be a non-negative integer`);
  return value;
}

function observedTime(value, field) {
  const result = text(value, field);
  const time = Date.parse(result);
  if (!Number.isFinite(time)) fail('invalid-evidence', `${field} must be an ISO timestamp`);
  return { value: result, time };
}

function nullableText(value, field) {
  return value === null ? null : text(value, field);
}

function stableId(value, field) {
  const result = text(value, field);
  if (!ID.test(result)) fail('invalid-input', `${field} must be a stable lowercase identifier`);
  return result;
}

function digestText(value, field) {
  const result = text(value, field).toLowerCase();
  if (!DIGEST.test(result)) fail('invalid-input', `${field} must be a SHA-256 digest`);
  return result;
}

function stringArray(value, field, { nonEmpty = true } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    fail('invalid-input', `${field} must be an array of non-empty strings`);
  }
  if (nonEmpty && value.length === 0) fail('incomplete', `${field} must not be empty`);
  return value.map((item) => item.trim());
}

function bytewise(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRelative(candidate, field) {
  const value = text(candidate, field);
  if (path.isAbsolute(value) || value.includes('\\')) fail('unsafe-path', `${field} must be a repository-relative POSIX path`);
  const normalized = path.posix.normalize(value).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    fail('unsafe-path', `${field} escapes the repository`);
  }
  return normalized;
}

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function digestSet(records) {
  const canonical = [...records]
    .sort((left, right) => bytewise(left.path, right.path))
    .map(({ path: artifactPath, digest }) => `${artifactPath}\0${digest}\n`)
    .join('');
  return sha(canonical);
}

export const canonicalArtifactSetDigest = digestSet;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(bytewise).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertRealDirectory(candidate, field) {
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch {
    fail('missing-artifact', `${field} does not exist`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('unsafe-path', `${field} must be a real, non-symbolic-link directory`);
  if (fs.realpathSync(candidate) !== path.resolve(candidate)) fail('unsafe-path', `${field} resolves through a symbolic link`);
}

function enumerateWorkspace(repositoryRoot, workspace) {
  assertRealDirectory(repositoryRoot, 'repositoryRoot');
  const workspaceRoot = path.join(repositoryRoot, ...workspace.split('/'));
  assertRealDirectory(workspaceRoot, 'workspace');
  const records = [];
  const visit = (absolute, relative) => {
    const entries = fs.readdirSync(absolute, { withFileTypes: true })
      .sort((left, right) => bytewise(left.name, right.name));
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const childAbsolute = path.join(absolute, entry.name);
      const stat = fs.lstatSync(childAbsolute);
      if (entry.name === 'node_modules') fail('forbidden-artifact', `${workspace}/${childRelative} is forbidden`);
      if (stat.isSymbolicLink()) fail('unsafe-path', `${workspace}/${childRelative} is a symbolic link`);
      if (stat.isDirectory()) visit(childAbsolute, childRelative);
      else if (stat.isFile()) {
        records.push({ path: `${workspace}/${childRelative}`, digest: sha(fs.readFileSync(childAbsolute)) });
      } else {
        fail('forbidden-artifact', `${workspace}/${childRelative} is not a regular file`);
      }
    }
  };
  visit(workspaceRoot, '');
  if (records.length === 0) fail('incomplete', 'workspace must contain artifacts');
  return records;
}

function validateManifest(declared, actual) {
  if (!Array.isArray(declared) || declared.length === 0) fail('incomplete', 'artifactManifest must not be empty');
  const normalized = declared.map((entry, index) => {
    exactFields(entry, ['path', 'digest'], `artifactManifest[${index}]`);
    return {
      path: normalizeRelative(entry.path, `artifactManifest[${index}].path`),
      digest: digestText(entry.digest, `artifactManifest[${index}].digest`),
    };
  }).sort((left, right) => bytewise(left.path, right.path));
  if (new Set(normalized.map(({ path: artifactPath }) => artifactPath)).size !== normalized.length) {
    fail('invalid-input', 'artifactManifest paths must be unique');
  }
  if (JSON.stringify(normalized) !== JSON.stringify(actual)) {
    fail('manifest-mismatch', 'artifactManifest must exactly equal the safely enumerated workspace');
  }
  return actual;
}

function subset(records, paths, field) {
  const wanted = stringArray(paths, field).map((entry, index) => normalizeRelative(entry, `${field}[${index}]`));
  if (new Set(wanted).size !== wanted.length) fail('invalid-input', `${field} contains duplicate paths`);
  const byPath = new Map(records.map((record) => [record.path, record]));
  return wanted.map((artifactPath) => {
    const record = byPath.get(artifactPath);
    if (!record) fail('missing-artifact', `${field} names missing artifact ${artifactPath}`);
    return record;
  });
}

function readJsonFile(repositoryRoot, artifactPath, field) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repositoryRoot, ...artifactPath.split('/')), 'utf8'));
  } catch {
    fail('invalid-artifact', `${field} must contain parseable JSON`);
  }
}

function exactPinnedVersion(value, field) {
  const specifier = text(value, field);
  const match = /^=?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(specifier);
  if (!match) fail('invalid-site', `${field} must use an exact pinned registry version`);
  return match[1];
}

function resolvePackageRecord(packages, parentPath, dependencyName) {
  let cursor = parentPath;
  while (cursor.startsWith('node_modules/')) {
    const nested = `${cursor}/node_modules/${dependencyName}`;
    if (packages[nested]) return nested;
    const marker = cursor.lastIndexOf('/node_modules/');
    if (marker < 0) break;
    cursor = cursor.slice(0, marker);
  }
  return `node_modules/${dependencyName}`;
}

function validateRegistryRecord(record, packagePath, field) {
  for (const metadata of PACKAGE_RECORD_METADATA) {
    text(record[metadata], `${field}.lock.${packagePath}.${metadata}`);
  }
  let resolved;
  try {
    resolved = new URL(record.resolved);
  } catch {
    fail('invalid-site', `${field} lock package ${packagePath} has an invalid registry URL`);
  }
  if (resolved.protocol !== 'https:' || resolved.hostname !== 'registry.npmjs.org'
    || resolved.username || resolved.password || resolved.port) {
    fail('invalid-site', `${field} lock package ${packagePath} must resolve only from registry.npmjs.org`);
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(record.integrity)) {
    fail('invalid-site', `${field} lock package ${packagePath} lacks SHA-512 integrity`);
  }
}

function validateLockClosure(lock, rootDependencies, field) {
  const packages = object(lock.packages, `${field}.package-lock.json packages`);
  const queue = [...Object.keys(rootDependencies).map((name) => `node_modules/${name}`)];
  const visited = new Set();
  while (queue.length) {
    const packagePath = queue.shift();
    if (visited.has(packagePath)) continue;
    visited.add(packagePath);
    const record = object(packages[packagePath], `${field}.package-lock.json package ${packagePath}`);
    validateRegistryRecord(record, packagePath, field);
    for (const dependencyField of DEPENDENCY_FIELDS) {
      const edges = record[dependencyField] === undefined
        ? {}
        : object(record[dependencyField], `${field}.lock.${packagePath}.${dependencyField}`);
      for (const [dependencyName, declaration] of Object.entries(edges)) {
        const dependencyPath = resolvePackageRecord(packages, packagePath, dependencyName);
        const dependency = object(packages[dependencyPath], `${field}.package-lock.json package ${dependencyName}`);
        const expectedVersion = exactPinnedVersion(declaration, `${field}.lock.${packagePath}.${dependencyField}.${dependencyName}`);
        if (text(dependency.version, `${field}.lock.${dependencyPath}.version`) !== expectedVersion) {
          fail('invalid-site', `${field} lock edge ${packagePath} -> ${dependencyName} does not match its exact declaration`);
        }
        queue.push(dependencyPath);
      }
    }
  }
  const packageRecords = Object.keys(packages).filter((packagePath) => packagePath !== '');
  const extras = packageRecords.filter((packagePath) => !visited.has(packagePath));
  if (extras.length) fail('invalid-site', `${field} lockfile contains unreachable package records: ${extras.join(', ')}`);
}

function validatePackage(repositoryRoot, site, field, { storybook }) {
  const required = ['packageJsonPath', 'packageLockPath', 'htmlPath', 'cssPath', 'javascriptPath'];
  if (storybook) required.push('storybookConfigPath', 'storybookStoryPath');
  for (const name of required) {
    const artifactPath = normalizeRelative(site[name], `${field}.${name}`);
    if (!site.artifactPaths.includes(artifactPath)) fail('missing-artifact', `${field}.${name} is outside its artifact set`);
  }
  if (new Set(required.map((name) => site[name])).size !== required.length) {
    fail('invalid-site', `${field} package, lock, Storybook, HTML, CSS, and JavaScript paths must be distinct`);
  }
  if (!site.packageJsonPath.endsWith('/package.json') || !site.packageLockPath.endsWith('/package-lock.json')) {
    fail('invalid-site', `${field} requires package.json and package-lock.json`);
  }
  if (storybook && (!site.storybookConfigPath.includes('/.storybook/main.') || !/\.stories\.[cm]?[jt]sx?$/.test(site.storybookStoryPath))) {
    fail('invalid-site', `${field} requires actual Storybook configuration and stories`);
  }
  for (const [name, extension] of [['htmlPath', '.html'], ['cssPath', '.css'], ['javascriptPath', '.js']]) {
    if (!site[name].endsWith(extension)) fail('invalid-site', `${field}.${name} must end in ${extension}`);
  }
  const packageJson = readJsonFile(repositoryRoot, site.packageJsonPath, `${field}.packageJsonPath`);
  const lock = readJsonFile(repositoryRoot, site.packageLockPath, `${field}.packageLockPath`);
  const siteRoot = path.posix.dirname(site.packageJsonPath);
  for (const artifactPath of site.artifactPaths) {
    if (artifactPath !== siteRoot && !artifactPath.startsWith(`${siteRoot}/`)) {
      fail('invalid-site', `${field} artifacts must share one site root`);
    }
    if (!storybook && (artifactPath.includes('/.storybook/') || /\.stories\.[cm]?[jt]sx?$/.test(artifactPath))) {
      fail('invalid-site', `${field} cannot carry concept-local Storybook configuration or stories`);
    }
  }
  for (const name of required) {
    if (!site[name].startsWith(`${siteRoot}/`)) fail('invalid-site', `${field}.${name} must be site-local`);
  }
  const scripts = object(packageJson.scripts, `${field}.package.json scripts`);
  const expectedScripts = storybook ? ['start', 'storybook'] : ['start'];
  if (JSON.stringify(Object.keys(scripts).sort(bytewise)) !== JSON.stringify(expectedScripts.sort(bytewise))) {
    fail('unsafe-command', `${field} scripts must contain exactly ${expectedScripts.join(' and ')} with no lifecycle hooks`);
  }
  if (text(packageJson.scripts.start, `${field}.scripts.start`) !== STATIC_SERVER_SCRIPT) {
    fail('unsafe-command', `${field}.scripts.start must be the fixed human-run static-server command`);
  }
  if (storybook && text(packageJson.scripts.storybook, `${field}.scripts.storybook`) !== STORYBOOK_SCRIPT) {
    fail('unsafe-command', `${field}.scripts.storybook must be the fixed human-run Storybook command`);
  }
  if (!Number.isSafeInteger(lock.lockfileVersion) || lock.lockfileVersion < 2) fail('invalid-site', `${field} requires a modern npm lockfile`);
  if (text(packageJson.name, `${field}.package.json name`) !== text(lock.name, `${field}.package-lock.json name`)
    || text(packageJson.version, `${field}.package.json version`) !== text(lock.version, `${field}.package-lock.json version`)) {
    fail('invalid-site', `${field} package.json and package-lock.json identity must agree`);
  }
  const lockRoot = object(object(lock.packages, `${field}.package-lock.json packages`)[''], `${field}.package-lock.json packages[""]`);
  if (lockRoot.name !== packageJson.name || lockRoot.version !== packageJson.version) {
    fail('invalid-site', `${field} lockfile root package must agree with package.json`);
  }
  const allRootDependencies = {};
  for (const dependencyField of DEPENDENCY_FIELDS) {
    const manifestDependencies = packageJson[dependencyField] === undefined
      ? {}
      : object(packageJson[dependencyField], `${field}.package.json ${dependencyField}`);
    const rootDependencies = lockRoot[dependencyField] === undefined
      ? {}
      : object(lockRoot[dependencyField], `${field}.package-lock.json root ${dependencyField}`);
    const declarations = (value) => JSON.stringify(Object.entries(value).sort(([left], [right]) => bytewise(left, right)));
    if (declarations(manifestDependencies) !== declarations(rootDependencies)) {
      fail('invalid-site', `${field} ${dependencyField} must exactly match lockfile root declarations`);
    }
    for (const [name, declared] of Object.entries(manifestDependencies)) {
      allRootDependencies[name] = declared;
      const specifier = text(declared, `${field}.${dependencyField}.${name}`);
      const locked = object(lock.packages[`node_modules/${name}`], `${field}.package-lock.json package ${name}`);
      const lockedVersion = text(locked.version, `${field}.lock.${name}.version`);
      const normalized = exactPinnedVersion(specifier, `${field}.${dependencyField}.${name}`);
      if (lockedVersion !== normalized) {
        fail('invalid-site', `${field} ${dependencyField}.${name} must have an exact compatible locked package record`);
      }
    }
  }
  validateLockClosure(lock, allRootDependencies, field);
  const devDependencies = object(packageJson.devDependencies, `${field}.package.json devDependencies`);
  if (devDependencies[STATIC_SERVER_PACKAGE] !== STATIC_SERVER_VERSION) {
    fail('invalid-site', `${field} requires the fixed locked static-server devDependency`);
  }
  if (storybook && devDependencies[STORYBOOK_PACKAGE] !== STORYBOOK_VERSION) {
    fail('invalid-site', `${field} requires the fixed locked Storybook devDependency`);
  }
  const allowedDependencies = new Set(storybook
    ? [STATIC_SERVER_PACKAGE, STORYBOOK_PACKAGE]
    : [STATIC_SERVER_PACKAGE]);
  for (const dependencyField of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(packageJson[dependencyField] ?? {})) {
      if (dependencyField !== 'devDependencies' || !allowedDependencies.has(name)) {
        fail('invalid-site', `${field} dependency ${name} is not allowlisted`);
      }
    }
  }
  if (!storybook) return siteRoot;
  const storyArtifacts = site.artifactPaths.filter((artifactPath) => /\.stories\.[cm]?[jt]sx?$/.test(artifactPath));
  const storybookConfigArtifacts = site.artifactPaths.filter((artifactPath) => artifactPath.includes('/.storybook/'));
  if (storyArtifacts.length !== 1 || storyArtifacts[0] !== site.storybookStoryPath
    || storybookConfigArtifacts.length !== 1 || storybookConfigArtifacts[0] !== site.storybookConfigPath) {
    fail('invalid-site', `${field} must declare exactly its one bounded brand story and Storybook configuration`);
  }
  const config = fs.readFileSync(path.join(repositoryRoot, ...site.storybookConfigPath.split('/')), 'utf8');
  const story = fs.readFileSync(path.join(repositoryRoot, ...site.storybookStoryPath.split('/')), 'utf8');
  const relativeStory = path.posix.relative(path.posix.dirname(site.storybookConfigPath), site.storybookStoryPath);
  if (/(?:\bimport\s*\(|\brequire\s*\(|\bimport\s+.+\s+from\b)/s.test(config)
    || /(?:\bimport\s*\(|\brequire\s*\(|\bimport\s+.+\s+from\b)/s.test(story)
    || path.isAbsolute(relativeStory) || relativeStory.startsWith('../..')
    || !/stories\s*:\s*\[\s*["'][.][.]\/src\/\*\.stories\.js["']\s*\]/s.test(config)
    || (!config.includes(relativeStory) && !config.includes('../src/*.stories.js'))
    || !/export\s+default\s+\{[^}]*title\s*:/s.test(story)
    || !/export\s+const\s+[A-Za-z_$][\w$]*\s*=\s*\{[^}]+(?:render|args|play|parameters)\s*:/s.test(story)) {
    fail('invalid-site', `${field} Storybook configuration or story is not substantive`);
  }
  return siteRoot;
}

function validateBrand(repositoryRoot, brand, artifacts) {
  const fields = [
    'artifactPaths', 'packageJsonPath', 'packageLockPath', 'storybookConfigPath',
    'storybookStoryPath', 'htmlPath', 'cssPath', 'javascriptPath', 'digest', 'outputs',
  ];
  exactFields(brand, fields, 'brand');
  const files = subset(artifacts, brand.artifactPaths, 'brand.artifactPaths');
  const siteRoot = validatePackage(repositoryRoot, brand, 'brand', { storybook: true });
  const computed = digestSet(files);
  if (digestText(brand.digest, 'brand.digest') !== computed) fail('digest-mismatch', 'brand digest differs from exact bytes');
  exactFields(brand.outputs, [
    'palette', 'typography', 'spacingDensity', 'shapeBorderElevationRhythm',
    'illustrativeAtomsStates', 'compositions', 'moodBoard', 'accessibility',
  ], 'brand.outputs');
  for (const field of Object.keys(brand.outputs).filter((name) => name !== 'accessibility')) {
    stringArray(brand.outputs[field], `brand.outputs.${field}`);
  }
  const categories = new Set(idRecords(
    brand.outputs.accessibility,
    'brand.outputs.accessibility',
    ['id', 'category', 'expectation', 'evidencePath'],
  ).map((_id, index) => {
    const entry = brand.outputs.accessibility[index];
    const category = text(entry.category, `brand.outputs.accessibility[${index}].category`);
    text(entry.expectation, `brand.outputs.accessibility[${index}].expectation`);
    const evidencePath = normalizeRelative(entry.evidencePath, `brand.outputs.accessibility[${index}].evidencePath`);
    if (!brand.artifactPaths.includes(evidencePath)) fail('cross-reference', `brand accessibility evidence must be brand-owned`);
    return category;
  }));
  requireAccessibilityCategories(categories, 'brand.outputs.accessibility');
  return { digest: computed, siteRoot };
}

function idRecords(value, field, requiredFields, { nonEmpty = true } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) fail('incomplete', `${field} must be an array${nonEmpty ? ' with entries' : ''}`);
  const ids = value.map((entry, index) => {
    exactFields(entry, requiredFields, `${field}[${index}]`);
    return stableId(entry.id, `${field}[${index}].id`);
  });
  if (new Set(ids).size !== ids.length) fail('duplicate-identifier', `${field} contains duplicate identifiers`);
  return ids;
}

const ACCESSIBILITY_CATEGORIES = [
  'keyboard', 'focus', 'semantics', 'contrast', 'reduced-motion', 'resizing', 'state-communication',
];

function requireAccessibilityCategories(categories, field) {
  for (const category of ACCESSIBILITY_CATEGORIES) {
    if (!categories.has(category)) fail('incomplete', `${field} lacks ${category} evidence`);
  }
}

function validateWalkthroughs(walkthroughs, conceptId) {
  if (!Array.isArray(walkthroughs) || walkthroughs.length === 0) fail('incomplete', `${conceptId} needs walkthroughs`);
  const walkthroughIds = [];
  const stepIds = [];
  for (const [index, walkthrough] of walkthroughs.entries()) {
    exactFields(walkthrough, [
      'id', 'featureIds', 'flowIds', 'decisionIds', 'restartStateId',
      'restartControlId', 'restartAccessibility', 'whyBehaviorExists',
      'mockedBehavior', 'limitations', 'steps',
    ], `${conceptId}.walkthroughs[${index}]`);
    walkthroughIds.push(stableId(walkthrough.id, `${conceptId}.walkthroughs[${index}].id`));
    for (const field of ['featureIds', 'flowIds', 'decisionIds']) idArray(walkthrough[field], `${walkthrough.id}.${field}`);
    for (const field of ['mockedBehavior', 'limitations']) stringArray(walkthrough[field], `${walkthrough.id}.${field}`);
    stableId(walkthrough.restartStateId, `${walkthrough.id}.restartStateId`);
    stableId(walkthrough.restartControlId, `${walkthrough.id}.restartControlId`);
    stringArray(walkthrough.restartAccessibility, `${walkthrough.id}.restartAccessibility`);
    text(walkthrough.whyBehaviorExists, `${walkthrough.id}.whyBehaviorExists`);
    if (!Array.isArray(walkthrough.steps) || walkthrough.steps.length === 0) fail('incomplete', `${walkthrough.id} needs steps`);
    for (const [stepIndex, step] of walkthrough.steps.entries()) {
      exactFields(step, [
        'id', 'overlay', 'target', 'interaction', 'expectedStateId',
        'nextStepId', 'why', 'decisionIds', 'mockedBehavior', 'limitations', 'accessibility',
      ], `${walkthrough.id}.steps[${stepIndex}]`);
      stepIds.push(stableId(step.id, `${walkthrough.id}.steps[${stepIndex}].id`));
      for (const field of ['overlay', 'target', 'interaction', 'why']) text(step[field], `${step.id}.${field}`);
      stableId(step.expectedStateId, `${step.id}.expectedStateId`);
      if (step.nextStepId !== null) stableId(step.nextStepId, `${step.id}.nextStepId`);
      idArray(step.decisionIds, `${step.id}.decisionIds`);
      for (const field of ['mockedBehavior', 'limitations', 'accessibility']) stringArray(step[field], `${step.id}.${field}`);
    }
  }
  if (new Set(walkthroughIds).size !== walkthroughIds.length || new Set(stepIds).size !== stepIds.length) {
    fail('duplicate-identifier', 'walkthrough and step identifiers must be globally unique');
  }
  return { walkthroughIds, stepIds };
}

function validateConcepts(repositoryRoot, concepts, artifacts, brandDigest) {
  if (!Array.isArray(concepts)) fail('invalid-input', 'concepts must be an array');
  const conceptIds = [];
  const walkthroughIds = [];
  const stepIds = [];
  const conceptDigests = new Map();
  const decisionIds = [];
  const alternativeRecords = [];
  const accessibilityRecords = [];
  const walkthroughRecords = [];
  const siteRoots = [];
  const ownedPaths = new Set();
  for (const [index, concept] of concepts.entries()) {
    exactFields(concept, [
      'id', 'brandRevision', 'decisionIds', 'disposition', 'dispositionRationale',
      'dispositionDecisionId', 'artifactPaths', 'packageJsonPath',
      'packageLockPath', 'htmlPath',
      'cssPath', 'javascriptPath', 'digest', 'mockedData', 'accessibility',
      'designSpace', 'walkthroughs',
    ], `concepts[${index}]`);
    const conceptId = stableId(concept.id, `concepts[${index}].id`);
    conceptIds.push(conceptId);
    const disposition = text(concept.disposition, `${conceptId}.disposition`);
    if (!['selected', 'rejected'].includes(disposition)) {
      fail('invalid-input', `${conceptId}.disposition must be selected or rejected`);
    }
    text(concept.dispositionRationale, `${conceptId}.dispositionRationale`);
    const dispositionDecisionId = stableId(concept.dispositionDecisionId, `${conceptId}.dispositionDecisionId`);
    if (digestText(concept.brandRevision, `${conceptId}.brandRevision`) !== brandDigest) fail('stale', `${conceptId} does not bind the current brand revision`);
    const ownedDecisionIds = idArray(concept.decisionIds, `${conceptId}.decisionIds`);
    if (!ownedDecisionIds.includes(dispositionDecisionId)) {
      fail('cross-reference', `${conceptId}.dispositionDecisionId must name a concept decision`);
    }
    decisionIds.push(...ownedDecisionIds);
    if (concept.mockedData !== true) fail('incomplete', `${conceptId} must use mocked data`);
    const conceptAccessibilityIds = idRecords(concept.accessibility, `${conceptId}.accessibility`, [
      'id', 'category', 'featureIds', 'flowIds', 'stateIds', 'walkthroughIds',
      'stepIds', 'applicability', 'rationaleCode', 'expectation', 'evidencePath', 'observableTarget',
    ]);
    const conceptAccessibilityCategories = new Set();
    for (const [accessibilityIndex, entry] of concept.accessibility.entries()) {
      const category = text(entry.category, `${entry.id}.category`);
      conceptAccessibilityCategories.add(category);
      if (!['required', 'not-applicable'].includes(entry.applicability)) {
        fail('invalid-input', `${entry.id}.applicability must be required or not-applicable`);
      }
      const rationaleCode = entry.rationaleCode === null ? null : stableId(entry.rationaleCode, `${entry.id}.rationaleCode`);
      const referenceCount = ['featureIds', 'flowIds', 'stateIds', 'walkthroughIds', 'stepIds']
        .reduce((count, name) => count + entry[name].length, 0);
      if (entry.applicability === 'required' && (rationaleCode !== null || referenceCount === 0)) {
        fail('incomplete', `${entry.id} required coverage must bind selected-concept behavior and have no not-applicable rationale`);
      }
      if (entry.applicability === 'not-applicable'
        && (referenceCount !== 0 || !NOT_APPLICABLE_RATIONALES.get(category)?.has(rationaleCode))) {
        fail('incomplete', `${entry.id} not-applicable coverage requires an allowed bounded category rationale and no behavior references`);
      }
      for (const referenceField of ['featureIds', 'flowIds', 'stateIds', 'walkthroughIds', 'stepIds']) {
        idArray(entry[referenceField], `${entry.id}.${referenceField}`, { nonEmpty: false });
      }
      text(entry.expectation, `${entry.id}.expectation`);
      const evidencePath = normalizeRelative(entry.evidencePath, `${entry.id}.evidencePath`);
      if (!concept.artifactPaths.includes(evidencePath)) fail('cross-reference', `${entry.id} evidencePath must be concept-owned`);
      text(entry.observableTarget, `${entry.id}.observableTarget`);
      accessibilityRecords.push({
        ...entry, id: conceptAccessibilityIds[accessibilityIndex], evidencePath, conceptId,
      });
    }
    requireAccessibilityCategories(conceptAccessibilityCategories, `${conceptId}.accessibility`);
    const files = subset(artifacts, concept.artifactPaths, `${conceptId}.artifactPaths`);
    const siteRoot = validatePackage(repositoryRoot, concept, conceptId, { storybook: false });
    siteRoots.push(siteRoot);
    for (const artifactPath of concept.artifactPaths) {
      if (ownedPaths.has(artifactPath)) fail('invalid-site', `${artifactPath} is shared by concepts`);
      ownedPaths.add(artifactPath);
    }
    const conceptDigest = digestSet(files);
    if (digestText(concept.digest, `${conceptId}.digest`) !== conceptDigest) fail('digest-mismatch', `${conceptId} digest differs from exact bytes`);
    conceptDigests.set(conceptId, conceptDigest);
    exactFields(concept.designSpace, [
      'axes', 'hypotheses', 'comparisonCriteria', 'budget', 'accountableHuman',
      'stopRationale', 'alternatives',
    ], `${conceptId}.designSpace`);
    for (const field of ['axes', 'hypotheses', 'comparisonCriteria']) stringArray(concept.designSpace[field], `${conceptId}.designSpace.${field}`);
    text(concept.designSpace.budget, `${conceptId}.designSpace.budget`);
    text(concept.designSpace.accountableHuman, `${conceptId}.designSpace.accountableHuman`);
    text(concept.designSpace.stopRationale, `${conceptId}.designSpace.stopRationale`);
    idRecords(concept.designSpace.alternatives, `${conceptId}.designSpace.alternatives`, [
      'id', 'decisionId', 'disposition', 'rationale',
    ], { nonEmpty: false });
    for (const alternative of concept.designSpace.alternatives) {
      const decisionId = stableId(alternative.decisionId, `${alternative.id}.decisionId`);
      if (!concept.decisionIds.includes(decisionId)) {
        fail('cross-reference', `${alternative.id} must reference a decision owned by ${conceptId}`);
      }
      const disposition = text(alternative.disposition, `${alternative.id}.disposition`);
      if (!DISPOSITIONS.has(disposition)) fail('invalid-input', `${alternative.id}.disposition is not defined`);
      text(alternative.rationale, `${alternative.id}.rationale`);
      if (disposition === 'rejected' && alternative.rationale.trim() === '') fail('incomplete', `${alternative.id} rejection requires rationale`);
      alternativeRecords.push({ ...alternative, conceptId: null, sourceConceptId: conceptId });
    }
    const walkthrough = validateWalkthroughs(concept.walkthroughs, conceptId);
    walkthroughIds.push(...walkthrough.walkthroughIds);
    stepIds.push(...walkthrough.stepIds);
    walkthroughRecords.push(...concept.walkthroughs);
  }
  if (new Set(conceptIds).size !== conceptIds.length
    || new Set(walkthroughIds).size !== walkthroughIds.length
    || new Set(stepIds).size !== stepIds.length) {
    fail('duplicate-identifier', 'concept, walkthrough, and step identifiers must be globally unique');
  }
  if (new Set(siteRoots).size !== siteRoots.length) fail('invalid-site', 'concepts must have distinct site roots');
  for (const [index, left] of siteRoots.entries()) {
    for (const right of siteRoots.slice(index + 1)) {
      if (left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) {
        fail('invalid-site', 'concept site roots must not be nested');
      }
    }
  }
  if (new Set(alternativeRecords.map(({ id }) => id)).size !== alternativeRecords.length) {
    fail('duplicate-identifier', 'concept alternative identifiers must be globally unique');
  }
  if (new Set(accessibilityRecords.map(({ id }) => id)).size !== accessibilityRecords.length) {
    fail('duplicate-identifier', 'concept accessibility identifiers must be globally unique');
  }
  return {
    conceptIds, walkthroughIds, stepIds, conceptDigests, decisionIds,
    walkthroughRecords, siteRoots, ownedPaths, alternativeRecords,
    accessibilityRecords,
    conceptDispositionRecords: concepts.map((concept) => ({
      id: `alternative.${concept.id}`,
      decisionId: concept.dispositionDecisionId,
      conceptId: concept.id,
      disposition: concept.disposition,
      rationale: concept.dispositionRationale,
      sourceConceptId: concept.id,
    })),
  };
}

export function canonicalConceptSetRevision(concepts, artifacts) {
  const records = concepts.map((concept) => ({
    metadata: concept,
    artifacts: subset(artifacts, concept.artifactPaths, `${concept.id}.artifactPaths`),
  }));
  return sha(canonicalJson(records));
}

function validateContract(repositoryRoot, record, artifacts, expected) {
  exactFields(record, ['path', 'digest'], 'interactionContract');
  const contractPath = normalizeRelative(record.path, 'interactionContract.path');
  const artifact = artifacts.find(({ path: artifactPath }) => artifactPath === contractPath);
  if (!artifact) fail('missing-artifact', 'interaction contract must be in the exact workspace manifest');
  if (digestText(record.digest, 'interactionContract.digest') !== artifact.digest) fail('digest-mismatch', 'interaction contract digest differs from exact bytes');
  const contract = readJsonFile(repositoryRoot, contractPath, 'interactionContract.path');
  exactFields(contract, [
    'schema', 'subject', 'discoveryRevision', 'brandRevision', 'selectedConceptId',
    'features', 'flows', 'states', 'walkthroughs', 'decisions', 'alternatives',
    'accessibility', 'mockedLimitations', 'assumptions', 'contradictions',
    'unresolvedQuestions', 'authority',
  ], 'interaction contract bytes');
  if (contract.schema !== CONTRACT_SCHEMA || contract.authority !== AUTHORITY_MARKER) fail('authority-violation', 'interaction contract schema or nonauthority marker is invalid');
  exactFields(contract.subject, ['id', 'prototypeRevision'], 'interaction contract subject');
  if (contract.subject.id !== expected.subjectId
    || contract.subject.prototypeRevision !== expected.prototypeRevision
    || contract.discoveryRevision !== expected.discoveryDigest
    || contract.brandRevision !== expected.brandDigest
    || contract.selectedConceptId !== expected.selectedConceptId) {
    fail('cross-reference', 'interaction contract revisions or selected concept do not match the validated packet');
  }
  const features = idRecords(contract.features, 'contract.features', ['id', 'visibleBehavior', 'rules']);
  const flows = idRecords(contract.flows, 'contract.flows', ['id', 'featureIds', 'stateIds', 'visibleBehavior', 'rules']);
  const states = idRecords(contract.states, 'contract.states', ['id', 'visibleBehavior', 'rules']);
  const walkthroughs = idRecords(contract.walkthroughs, 'contract.walkthroughs', ['id', 'featureIds', 'flowIds', 'decisionIds', 'stepIds']);
  const decisions = idRecords(contract.decisions, 'contract.decisions', ['id', 'rationale']);
  const alternatives = idRecords(
    contract.alternatives,
    'contract.alternatives',
    ['id', 'decisionId', 'conceptId', 'disposition', 'rationale'],
    { nonEmpty: false },
  );
  idRecords(contract.accessibility, 'contract.accessibility', [
    'id', 'conceptEvidenceId', 'category', 'featureIds', 'flowIds', 'stateIds',
    'walkthroughIds', 'stepIds', 'applicability', 'rationaleCode', 'expectation',
  ]);
  idRecords(contract.mockedLimitations, 'contract.mockedLimitations', ['id', 'behavior', 'limitations']);
  idRecords(contract.assumptions, 'contract.assumptions', ['id', 'text'], { nonEmpty: false });
  idRecords(contract.contradictions, 'contract.contradictions', ['id', 'text'], { nonEmpty: false });
  idRecords(contract.unresolvedQuestions, 'contract.unresolvedQuestions', ['id', 'text'], { nonEmpty: false });
  const featureSet = new Set(features);
  const flowSet = new Set(flows);
  const stateSet = new Set(states);
  const decisionSet = new Set(decisions);
  const walkthroughSet = new Set(walkthroughs);
  const stepSet = new Set(expected.stepIds);
  for (const flow of contract.flows) {
    for (const id of idArray(flow.featureIds, `${flow.id}.featureIds`)) {
      if (!featureSet.has(id)) fail('cross-reference', `${flow.id} references unknown feature ${id}`);
    }
    for (const id of idArray(flow.stateIds, `${flow.id}.stateIds`)) {
      if (!stateSet.has(id)) fail('cross-reference', `${flow.id} references unknown state ${id}`);
    }
    stringArray(flow.rules, `${flow.id}.rules`);
    text(flow.visibleBehavior, `${flow.id}.visibleBehavior`);
  }
  for (const collection of [contract.features, contract.states]) {
    for (const entry of collection) {
      text(entry.visibleBehavior, `${entry.id}.visibleBehavior`);
      stringArray(entry.rules, `${entry.id}.rules`);
    }
  }
  for (const entry of contract.walkthroughs) {
    for (const id of idArray(entry.featureIds, `${entry.id}.featureIds`)) {
      if (!featureSet.has(id)) fail('cross-reference', `${entry.id} references wrong-type/unknown feature ${id}`);
    }
    for (const id of idArray(entry.flowIds, `${entry.id}.flowIds`)) {
      if (!flowSet.has(id)) fail('cross-reference', `${entry.id} references wrong-type/unknown flow ${id}`);
    }
    for (const id of idArray(entry.decisionIds, `${entry.id}.decisionIds`)) {
      if (!decisionSet.has(id)) fail('cross-reference', `${entry.id} references wrong-type/unknown decision ${id}`);
    }
    for (const id of idArray(entry.stepIds, `${entry.id}.stepIds`)) {
      if (!stepSet.has(id)) fail('cross-reference', `${entry.id} references wrong-type/unknown step ${id}`);
    }
  }
  for (const entry of contract.decisions) text(entry.rationale, `${entry.id}.rationale`);
  for (const entry of contract.alternatives) {
    const disposition = text(entry.disposition, `${entry.id}.disposition`);
    if (!DISPOSITIONS.has(disposition)) fail('invalid-input', `${entry.id}.disposition is not defined`);
    text(entry.rationale, `${entry.id}.rationale`);
    if (disposition === 'rejected' && entry.rationale.trim() === '') fail('incomplete', `${entry.id} rejection requires rationale`);
    if (!decisionSet.has(stableId(entry.decisionId, `${entry.id}.decisionId`))) {
      fail('cross-reference', `${entry.id} references unknown decision ${entry.decisionId}`);
    }
    if (entry.conceptId !== null) stableId(entry.conceptId, `${entry.id}.conceptId`);
  }
  const canonicalAlternative = (entry) => JSON.stringify({
    id: entry.id,
    decisionId: entry.decisionId,
    conceptId: entry.conceptId,
    disposition: entry.disposition,
    rationale: entry.rationale,
  });
  if (JSON.stringify(contract.alternatives.map(canonicalAlternative).sort(bytewise))
    !== JSON.stringify(expected.alternativeRecords.map(canonicalAlternative).sort(bytewise))) {
    fail('cross-reference', 'contract alternatives must exactly cover the selected concept typed alternatives and their dispositions');
  }
  const accessibilityCategories = new Set();
  const accessibilityCoverage = {
    featureIds: new Set(), flowIds: new Set(), stateIds: new Set(),
    walkthroughIds: new Set(), stepIds: new Set(),
  };
  const typedAccessibility = {
    featureIds: featureSet, flowIds: flowSet, stateIds: stateSet,
    walkthroughIds: walkthroughSet, stepIds: stepSet,
  };
  for (const entry of contract.accessibility) {
    text(entry.expectation, `${entry.id}.expectation`);
    const category = text(entry.category, `${entry.id}.category`);
    accessibilityCategories.add(category);
    stableId(entry.conceptEvidenceId, `${entry.id}.conceptEvidenceId`);
    if (!['required', 'not-applicable'].includes(entry.applicability)) {
      fail('invalid-input', `${entry.id}.applicability must be required or not-applicable`);
    }
    const rationaleCode = entry.rationaleCode === null ? null : stableId(entry.rationaleCode, `${entry.id}.rationaleCode`);
    const referenceCount = ['featureIds', 'flowIds', 'stateIds', 'walkthroughIds', 'stepIds']
      .reduce((count, name) => count + entry[name].length, 0);
    if (entry.applicability === 'required' && (rationaleCode !== null || referenceCount === 0)) {
      fail('incomplete', `${entry.id} required coverage must bind selected-concept behavior`);
    }
    if (entry.applicability === 'not-applicable'
      && (referenceCount !== 0 || !NOT_APPLICABLE_RATIONALES.get(category)?.has(rationaleCode))) {
      fail('incomplete', `${entry.id} not-applicable coverage has no allowed bounded rationale`);
    }
    for (const [field, allowed] of Object.entries(typedAccessibility)) {
      for (const id of idArray(entry[field], `${entry.id}.${field}`, { nonEmpty: false })) {
        if (!allowed.has(id)) fail('cross-reference', `${entry.id}.${field} references wrong-type/unknown ${id}`);
        accessibilityCoverage[field].add(id);
      }
    }
  }
  requireAccessibilityCategories(accessibilityCategories, 'contract.accessibility');
  const canonicalAccessibility = (entry) => JSON.stringify({
    id: entry.id,
    category: entry.category,
    featureIds: entry.featureIds,
    flowIds: entry.flowIds,
    stateIds: entry.stateIds,
    walkthroughIds: entry.walkthroughIds,
    stepIds: entry.stepIds,
    applicability: entry.applicability,
    rationaleCode: entry.rationaleCode,
    expectation: entry.expectation,
  });
  const conceptAccessibilityById = new Map(expected.accessibilityRecords.map((entry) => [entry.id, entry]));
  if (contract.accessibility.length !== expected.accessibilityRecords.length) {
    fail('cross-reference', 'contract accessibility must exactly cover concept accessibility evidence');
  }
  for (const entry of contract.accessibility) {
    const evidence = conceptAccessibilityById.get(entry.conceptEvidenceId);
    if (!evidence || canonicalAccessibility(entry) !== canonicalAccessibility({ ...evidence, id: entry.id })) {
      fail('cross-reference', `${entry.id} must exactly map one typed concept accessibility record`);
    }
  }
  if (new Set(contract.accessibility.map(({ conceptEvidenceId }) => conceptEvidenceId)).size !== expected.accessibilityRecords.length) {
    fail('cross-reference', 'each concept accessibility record must be mapped exactly once');
  }
  for (const [field, required] of Object.entries(typedAccessibility)) {
    for (const id of required) {
      if (!accessibilityCoverage[field].has(id)) fail('incomplete', `contract accessibility does not cover ${field} ${id}`);
    }
  }
  for (const entry of contract.mockedLimitations) {
    text(entry.behavior, `${entry.id}.behavior`);
    text(entry.limitations, `${entry.id}.limitations`);
  }
  for (const collection of [contract.assumptions, contract.contradictions, contract.unresolvedQuestions]) {
    for (const entry of collection) text(entry.text, `${entry.id}.text`);
  }
  for (const walkthrough of expected.walkthroughRecords) {
    for (const id of walkthrough.featureIds) if (!featureSet.has(id)) fail('cross-reference', `${walkthrough.id} references unknown feature ${id}`);
    for (const id of walkthrough.flowIds) if (!flowSet.has(id)) fail('cross-reference', `${walkthrough.id} references unknown flow ${id}`);
    for (const id of walkthrough.decisionIds) if (!decisionSet.has(id)) fail('cross-reference', `${walkthrough.id} references unknown decision ${id}`);
    if (!stateSet.has(walkthrough.restartStateId)) fail('cross-reference', `${walkthrough.id} restart state is unknown`);
    for (const step of walkthrough.steps) {
      if (!stepSet.has(step.id) || !stateSet.has(step.expectedStateId)) fail('cross-reference', `${step.id} state mapping is invalid`);
      for (const id of step.decisionIds) if (!decisionSet.has(id)) fail('cross-reference', `${step.id} references unknown decision ${id}`);
    }
    for (const [index, step] of walkthrough.steps.entries()) {
      const expectedNext = walkthrough.steps[index + 1]?.id ?? null;
      if (step.nextStepId !== expectedNext) fail('cross-reference', `${step.id}.nextStepId does not navigate the ordered walkthrough`);
    }
    const contractWalkthrough = contract.walkthroughs.find(({ id }) => id === walkthrough.id);
    if (!contractWalkthrough
      || JSON.stringify(contractWalkthrough.featureIds) !== JSON.stringify(walkthrough.featureIds)
      || JSON.stringify(contractWalkthrough.flowIds) !== JSON.stringify(walkthrough.flowIds)
      || JSON.stringify(contractWalkthrough.decisionIds) !== JSON.stringify(walkthrough.decisionIds)
      || JSON.stringify(contractWalkthrough.stepIds) !== JSON.stringify(walkthrough.steps.map(({ id }) => id))) {
      fail('cross-reference', `${walkthrough.id} contract mapping must exactly agree with concept walkthrough mapping`);
    }
  }
  for (const id of expected.decisionIds) if (!decisionSet.has(id)) fail('cross-reference', `concept decision ${id} is absent from the contract`);
  if (JSON.stringify([...walkthroughs].sort(bytewise)) !== JSON.stringify([...expected.walkthroughIds].sort(bytewise))) {
    fail('cross-reference', 'contract walkthrough identities do not match concept evidence');
  }
  return {
    path: contractPath,
    digest: artifact.digest,
    bytes: fs.readFileSync(path.join(repositoryRoot, ...contractPath.split('/')), 'utf8'),
    contract,
  };
}

function eventIsStrictlyBefore(left, right) {
  const leftTime = Date.parse(left.observedAt ?? left.mergedAt);
  const rightTime = Date.parse(right.observedAt ?? right.mergedAt);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime) || leftTime >= rightTime) return false;
  const comparable = left.schema === right.schema && left.channel === right.channel;
  return !comparable || left.sequence < right.sequence;
}

function receiptMap(receipts, subjectId, prototypeRevision, verifyHumanReceipt) {
  if (!Array.isArray(receipts)) fail('invalid-evidence', 'humanReceipts must be an array supplied separately from the producing packet');
  const result = new Map();
  let previousSequence = -1;
  let previousTime = -1;
  let previousAction = -1;
  for (const [index, receipt] of receipts.entries()) {
    exactFields(receipt, RECEIPT_FIELDS, `humanReceipts[${index}]`);
    if (receipt.schema !== RECEIPT_SCHEMA) fail('invalid-evidence', `humanReceipts[${index}] has an unsupported schema`);
    stableId(receipt.receiptId, `humanReceipts[${index}].receiptId`);
    if (!RECEIPT_ACTIONS.includes(receipt.action)) fail('invalid-evidence', `humanReceipts[${index}].action is invalid`);
    const actionOrder = RECEIPT_ACTIONS.indexOf(receipt.action);
    if (actionOrder <= previousAction) fail('invalid-evidence', 'human receipt actions must follow lifecycle order');
    previousAction = actionOrder;
    if (receipt.subjectId !== subjectId || receipt.prototypeRevision !== prototypeRevision) fail('invalid-evidence', 'human receipt names another subject or prototype revision');
    for (const field of ['actor', 'role', 'contextId', 'channel', 'sourceId']) text(receipt[field], `humanReceipts[${index}].${field}`);
    const order = sequence(receipt.sequence, `humanReceipts[${index}].sequence`);
    const observed = observedTime(receipt.observedAt, `humanReceipts[${index}].observedAt`);
    if (order <= previousSequence || observed.time < previousTime) fail('invalid-evidence', 'human receipts must be in trusted monotonic observed order');
    previousSequence = order;
    previousTime = observed.time;
    for (const field of RECEIPT_FIELDS.filter((name) => name.endsWith('Digest'))) {
      if (receipt[field] !== null) digestText(receipt[field], `humanReceipts[${index}].${field}`);
    }
    if (receipt.conceptId !== null) stableId(receipt.conceptId, `humanReceipts[${index}].conceptId`);
    if (result.has(receipt.action)) fail('invalid-evidence', `duplicate ${receipt.action} receipt`);
    if (typeof verifyHumanReceipt !== 'function' || verifyHumanReceipt(receipt) !== true) {
      fail('untrusted-human-receipt', `${receipt.action} was not verified by the trusted human-event producer adapter`);
    }
    result.set(receipt.action, receipt);
  }
  return result;
}

function specialistEventMap(events, expected, verifySpecialistObservation) {
  if (!Array.isArray(events)) fail('invalid-evidence', 'specialistObservations must be a separately supplied array');
  const result = new Map();
  let previousSequence = -1;
  let previousTime = -1;
  for (const [index, event] of events.entries()) {
    exactFields(event, SPECIALIST_EVENT_FIELDS, `specialistObservations[${index}]`);
    if (event.schema !== SPECIALIST_EVENT_SCHEMA) fail('invalid-evidence', 'unsupported specialist event schema');
    stableId(event.eventId, `specialistObservations[${index}].eventId`);
    if (!['brand-designer', 'user-experience-designer'].includes(event.role)
      || !SPECIALIST_ACTIONS.includes(event.action)
      || event.subjectId !== expected.subjectId
      || event.prototypeRevision !== expected.prototypeRevision) {
      fail('invalid-evidence', 'specialist event identity, action, subject, or revision is invalid');
    }
    for (const field of ['contextId', 'channel', 'sourceId']) text(event[field], `specialistObservations[${index}].${field}`);
    digestText(event.artifactRevision, `specialistObservations[${index}].artifactRevision`);
    const order = sequence(event.sequence, `specialistObservations[${index}].sequence`);
    const observed = observedTime(event.observedAt, `specialistObservations[${index}].observedAt`);
    if (order < previousSequence || observed.time < previousTime
      || (order === previousSequence && observed.time <= previousTime)) {
      fail('invalid-evidence', 'specialist events must be in monotonic producer order');
    }
    previousSequence = order;
    previousTime = observed.time;
    const key = `${event.role}:${event.action}`;
    if (result.has(key)) fail('invalid-evidence', `duplicate ${event.role} ${event.action} event`);
    if (typeof verifySpecialistObservation !== 'function' || verifySpecialistObservation(event) !== true) {
      fail('untrusted-specialist-event', `${event.role} event was not verified by the trusted dispatch/event adapter`);
    }
    result.set(key, event);
  }
  return result;
}

function requireReceipt(receipts, action, expected) {
  const receipt = receipts.get(action);
  if (!receipt) return null;
  for (const [field, value] of Object.entries(expected)) {
    if (receipt[field] !== value) fail('invalid-evidence', `${action} receipt does not bind ${field}`);
  }
  return receipt;
}

function readFromRevision(repositoryRoot, revision, artifactPath) {
  const result = spawnSync('git', ['-C', repositoryRoot, 'show', `${revision}:${artifactPath}`], {
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) fail('invalid-merge', `cannot read ${artifactPath} from ${revision}`);
  return result.stdout;
}

function verifyLocalAncestry(repositoryRoot, observation) {
  const exists = spawnSync('git', ['-C', repositoryRoot, 'cat-file', '-e', `${observation.revision}^{commit}`]);
  const ancestor = spawnSync('git', ['-C', repositoryRoot, 'merge-base', '--is-ancestor', observation.revision, observation.defaultBranch]);
  return exists.status === 0 && ancestor.status === 0;
}

function validateMerge(observation, expected, options) {
  if (!observation) return null;
  exactFields(observation, MERGE_FIELDS, 'mergeObservation');
  if (observation.schema !== MERGE_SCHEMA || observation.state !== 'merged') fail('invalid-merge', 'observation must report a merged change request');
  for (const field of ['provider', 'repository', 'changeRequestId', 'destinationBranch', 'defaultBranch', 'mergedAt']) text(observation[field], `mergeObservation.${field}`);
  observedTime(observation.mergedAt, 'mergeObservation.mergedAt');
  exactFields(observation.provenance, MERGE_PROVENANCE_FIELDS, 'mergeObservation.provenance');
  for (const field of MERGE_PROVENANCE_FIELDS) text(observation.provenance[field], `mergeObservation.provenance.${field}`);
  if (typeof options.resolveExpectedRepository !== 'function') {
    fail('untrusted-merge', 'trusted canonical repository resolver is required');
  }
  const expectedRepository = text(options.resolveExpectedRepository(options.repositoryRoot), 'expected repository');
  if (observation.repository !== expectedRepository) {
    fail('invalid-merge', 'merge observation repository differs from trusted canonical repository');
  }
  if (observation.destinationBranch !== observation.defaultBranch) fail('invalid-merge', 'change request destination must be the observed default branch');
  if (!COMMIT.test(observation.revision)) fail('invalid-merge', 'merge revision must be a full commit identity');
  if (observation.artifactSetDigest !== expected.artifactSetDigest
    || observation.interactionContractDigest !== expected.interactionContractDigest) {
    fail('invalid-merge', 'merge observation does not bind the approved bytes');
  }
  if (typeof options.verifyMergeObservation !== 'function'
    || options.verifyMergeObservation(observation) !== true) {
    fail('untrusted-merge', 'surrounding provider workflow did not verify change-request identity and merged state');
  }
  const verifyAncestry = options.verifyGitAncestry ?? verifyLocalAncestry;
  if (verifyAncestry(options.repositoryRoot, observation) !== true) {
    fail('invalid-merge', 'merge revision is not verified on the destination/default branch ancestry');
  }
  for (const artifact of expected.artifacts) {
    if (sha((options.readMergedArtifact ?? readFromRevision)(options.repositoryRoot, observation.revision, artifact.path)) !== artifact.digest) {
      fail('invalid-merge', `${artifact.path} at the merge revision differs from approved bytes`);
    }
  }
  return observation;
}

export function validateApprovalBinding(input, options = {}) {
  const {
    repositoryRoot,
    humanReceipts = [],
    specialistObservations = [],
    mergeObservation = null,
    verifyHumanReceipt,
    verifySpecialistObservation,
  } = options;
  if (!path.isAbsolute(repositoryRoot ?? '')) fail('invalid-input', 'repositoryRoot must be absolute');
  exactFields(input, TOP_FIELDS, 'packet');
  if (input.version !== STATE_VERSION) fail('invalid-input', `version must be ${STATE_VERSION}`);
  if (typeof input.cancelled !== 'boolean') fail('invalid-input', 'cancelled must be boolean');

  exactFields(input.subject, ['id', 'slug', 'prototypeRevision'], 'subject');
  const subjectId = stableId(input.subject.id, 'subject.id');
  const slug = text(input.subject.slug, 'subject.slug');
  if (!SLUG.test(slug)) fail('invalid-input', 'subject.slug must be lowercase hyphenated words');
  const prototypeRevision = digestText(input.subject.prototypeRevision, 'subject.prototypeRevision');
  if (input.cancelled) return { status: 'cancelled', subjectId, prototypeRevision };

  exactFields(input.discovery, ['locator', 'digest'], 'discovery');
  const locator = normalizeRelative(input.discovery.locator, 'discovery.locator');
  if (!locator.startsWith('docs/agent/discovery/') || !locator.endsWith('.md')) fail('invalid-source', 'Discovery locator must be durable Markdown beneath docs/agent/discovery/');
  const discoveryPath = path.join(repositoryRoot, ...locator.split('/'));
  let discoveryStat;
  try {
    discoveryStat = fs.lstatSync(discoveryPath);
  } catch {
    fail('missing-source', 'Discovery artifact is missing');
  }
  if (discoveryStat.isSymbolicLink() || !discoveryStat.isFile() || fs.realpathSync(discoveryPath) !== discoveryPath) {
    fail('unsafe-path', 'Discovery artifact must be a real file inside the repository');
  }
  const discoveryDigest = sha(fs.readFileSync(discoveryPath));
  if (digestText(input.discovery.digest, 'discovery.digest') !== discoveryDigest) fail('stale', 'Discovery digest differs from exact current bytes');

  const workspace = normalizeRelative(input.workspace, 'workspace');
  if (workspace !== `docs/agent/prototypes/${slug}`) fail('unsafe-path', `workspace must equal docs/agent/prototypes/${slug}`);
  exactFields(input.specialists, ['brandContextId', 'uxContextId'], 'specialists');
  const brandContextId = stableId(input.specialists.brandContextId, 'specialists.brandContextId');
  const uxContextId = nullableText(input.specialists.uxContextId, 'specialists.uxContextId');
  if (uxContextId !== null && stableId(uxContextId, 'specialists.uxContextId') === brandContextId) fail('reused-specialist-context', 'specialist contexts must be separate');

  const receipts = receiptMap(humanReceipts, subjectId, prototypeRevision, verifyHumanReceipt);
  if (!requireReceipt(receipts, 'discovery-aligned', {
    discoveryDigest,
    brandDigest: null,
    conceptId: null,
    conceptDigest: null,
    artifactSetDigest: null,
    interactionContractDigest: null,
  })) {
    return { status: 'needs-discovery', subjectId, source: { locator, revision: discoveryDigest }, workspace };
  }

  const artifacts = validateManifest(input.artifactManifest, enumerateWorkspace(repositoryRoot, workspace));
  const artifactSetDigest = digestSet(artifacts);
  const brand = validateBrand(repositoryRoot, input.brand, artifacts);
  const brandDigest = brand.digest;
  const events = specialistEventMap(specialistObservations, {
    subjectId,
    prototypeRevision,
  }, verifySpecialistObservation);
  const brandStartEvent = events.get('brand-designer:specialist-started');
  const brandEvent = events.get('brand-designer:specialist-completed');
  const discoveryReceipt = receipts.get('discovery-aligned');
  if (!brandStartEvent || !brandEvent
    || brandStartEvent.contextId !== brandContextId
    || brandEvent.contextId !== brandContextId
    || brandStartEvent.artifactRevision !== discoveryDigest
    || brandEvent.artifactRevision !== brandDigest
    || !eventIsStrictlyBefore(discoveryReceipt, brandStartEvent)
    || !eventIsStrictlyBefore(brandStartEvent, brandEvent)) {
    fail('invalid-evidence', 'trusted brand specialist start/completion must follow Discovery alignment and bind the exact Discovery and brand revisions');
  }
  if (!requireReceipt(receipts, 'brand-aligned', {
    discoveryDigest,
    brandDigest,
    conceptId: null,
    conceptDigest: null,
    artifactSetDigest: null,
    interactionContractDigest: null,
  })) {
    if (events.has('user-experience-designer:specialist-started')
      || events.has('user-experience-designer:specialist-completed')) {
      fail('brand-not-aligned', 'user-experience specialist events require a trusted prior brand-aligned receipt');
    }
    if (input.concepts.length || input.selectedConceptId !== null || input.interactionContract !== null) {
      fail('brand-not-aligned', 'concept claims cannot precede external exact-digest brand alignment');
    }
    return { status: 'needs-brand-alignment', subjectId, workspace, brandDigest };
  }

  const concepts = validateConcepts(repositoryRoot, input.concepts, artifacts, brandDigest);
  if (concepts.conceptIds.length === 0) {
    if (input.selectedConceptId !== null || input.interactionContract !== null) fail('incomplete', 'selection or contract cannot precede concept evidence');
    return { status: 'needs-concept-evidence', subjectId, workspace, brandDigest };
  }
  if (uxContextId === null) fail('incomplete', 'concept evidence requires a separate user-experience specialist context');
  const uxStartEvent = events.get('user-experience-designer:specialist-started');
  const uxEvent = events.get('user-experience-designer:specialist-completed');
  const brandReceipt = receipts.get('brand-aligned');
  const uxRevision = canonicalConceptSetRevision(input.concepts, artifacts);
  if (!uxStartEvent || !uxEvent
    || uxStartEvent.contextId !== uxContextId
    || uxEvent.contextId !== uxContextId
    || uxStartEvent.artifactRevision !== brandDigest
    || uxEvent.artifactRevision !== uxRevision) {
    fail('invalid-evidence', 'trusted user-experience specialist start/completion must bind the brand and canonical concept-set revisions');
  }
  if (!eventIsStrictlyBefore(brandEvent, brandReceipt)
    || !eventIsStrictlyBefore(brandReceipt, uxStartEvent)
    || !eventIsStrictlyBefore(uxStartEvent, uxEvent)) {
    fail('invalid-evidence', 'user-experience specialist start/completion must be strictly after trusted brand alignment');
  }
  const brandOwned = new Set(input.brand.artifactPaths);
  for (const artifactPath of concepts.ownedPaths) {
    if (brandOwned.has(artifactPath)) fail('invalid-site', `${artifactPath} is shared by brand and concept sites`);
  }
  if (concepts.siteRoots.some((siteRoot) => siteRoot === brand.siteRoot || siteRoot.startsWith(`${brand.siteRoot}/`) || brand.siteRoot.startsWith(`${siteRoot}/`))) {
    fail('invalid-site', 'brand and concept site roots must be disjoint');
  }
  if (input.selectedConceptId === null) {
    if (input.interactionContract !== null) fail('incomplete', 'contract cannot precede concept selection');
    return { status: 'needs-human-decision', subjectId, workspace, conceptIds: concepts.conceptIds };
  }
  const selectedConceptId = stableId(input.selectedConceptId, 'selectedConceptId');
  const selectedConceptDigest = concepts.conceptDigests.get(selectedConceptId);
  if (!selectedConceptDigest) fail('cross-reference', 'selectedConceptId does not name validated concept evidence');
  const selectedConcept = input.concepts.find(({ id }) => id === selectedConceptId);
  for (const concept of input.concepts) {
    const expectedDisposition = concept.id === selectedConceptId ? 'selected' : 'rejected';
    if (concept.disposition !== expectedDisposition) {
      fail('incomplete', `${concept.id} must record ${expectedDisposition} disposition and why it ${expectedDisposition === 'selected' ? 'won' : 'lost'}`);
    }
  }
  const conceptSelection = requireReceipt(receipts, 'concept-selected', {
    discoveryDigest,
    brandDigest,
    conceptId: selectedConceptId,
    conceptDigest: selectedConceptDigest,
    artifactSetDigest: null,
    interactionContractDigest: null,
  });
  if (!conceptSelection) {
    return { status: 'needs-human-decision', subjectId, workspace, conceptIds: concepts.conceptIds };
  }
  if (!eventIsStrictlyBefore(uxEvent, conceptSelection)) {
    fail('invalid-evidence', 'concept selection must strictly follow trusted user-experience completion');
  }

  if (input.interactionContract === null) fail('incomplete', 'interactionContract is required after concept selection');
  const contract = validateContract(repositoryRoot, input.interactionContract, artifacts, {
    subjectId,
    prototypeRevision,
    discoveryDigest,
    brandDigest,
    selectedConceptId,
    walkthroughIds: selectedConcept.walkthroughs.map(({ id }) => id),
    stepIds: selectedConcept.walkthroughs.flatMap(({ steps }) => steps.map(({ id }) => id)),
    decisionIds: selectedConcept.decisionIds,
    walkthroughRecords: selectedConcept.walkthroughs,
    alternativeRecords: [
      ...concepts.alternativeRecords.filter((entry) => entry.sourceConceptId === selectedConceptId),
      ...concepts.conceptDispositionRecords.filter((entry) => entry.conceptId !== selectedConceptId),
    ],
    accessibilityRecords: concepts.accessibilityRecords.filter((entry) => entry.conceptId === selectedConceptId),
  });
  const claimedOwners = new Set([...input.brand.artifactPaths, ...concepts.ownedPaths, input.interactionContract.path]);
  if (claimedOwners.size !== artifacts.length || artifacts.some(({ path: artifactPath }) => !claimedOwners.has(artifactPath))) {
    fail('manifest-mismatch', 'every workspace artifact must have exactly one brand, concept, or contract owner');
  }
  const approval = requireReceipt(receipts, 'product-design-approved', {
    discoveryDigest,
    brandDigest,
    conceptId: selectedConceptId,
    conceptDigest: selectedConceptDigest,
    artifactSetDigest,
    interactionContractDigest: contract.digest,
  });
  if (!approval) {
    return {
      status: 'needs-approval', subjectId, workspace, artifactSetDigest,
      interactionContractDigest: contract.digest, selectedConceptId,
    };
  }
  if (!eventIsStrictlyBefore(conceptSelection, approval)) {
    fail('invalid-evidence', 'final approval must strictly follow concept selection');
  }

  const merge = validateMerge(mergeObservation, {
    artifactSetDigest,
    interactionContractDigest: contract.digest,
    artifacts,
  }, options);
  if (!merge) {
    return {
      status: 'needs-approval', subjectId, workspace, artifactSetDigest,
      interactionContractDigest: contract.digest, selectedConceptId,
    };
  }
  if (!eventIsStrictlyBefore(approval, merge)) {
    fail('invalid-merge', 'provider merge must strictly follow final approval');
  }
  return {
    status: 'approved',
    subjectId,
    source: { locator, revision: discoveryDigest },
    prototypeRevision,
    workspace,
    brandDigest,
    conceptIds: concepts.conceptIds,
    walkthroughIds: concepts.walkthroughIds,
    selectedConceptId,
    selectedRunnableConcept: {
      root: path.posix.dirname(selectedConcept.packageJsonPath),
      entrypoint: selectedConcept.htmlPath,
      humanRunCommand: `npm --prefix ${path.posix.dirname(selectedConcept.packageJsonPath)} start`,
      ownedArtifactPaths: [...selectedConcept.artifactPaths].sort(bytewise),
      digest: selectedConceptDigest,
      mergedBytesVerification: {
        revision: merge.revision,
        exact: true,
      },
      trust: 'untrusted-human-run-prototype',
    },
    artifactSetDigest,
    interactionContractDigest: contract.digest,
    interactionContractPath: contract.path,
    interactionContractBytes: contract.bytes,
    interactionContract: contract.contract,
    authority: AUTHORITY_MARKER,
    changeRequestId: merge.changeRequestId,
    mergeRevision: merge.revision,
  };
}

export function run(argv, streams = process) {
  if (![4, 6].includes(argv.length) || argv[0] !== '--root' || argv[2] !== '--input'
    || !path.isAbsolute(argv[1]) || !path.isAbsolute(argv[3])
    || (argv.length === 6 && (argv[4] !== '--evidence' || !path.isAbsolute(argv[5])))) {
    fail('usage', USAGE);
  }
  const input = JSON.parse(fs.readFileSync(argv[3], 'utf8'));
  const evidence = argv.length === 6
    ? JSON.parse(fs.readFileSync(argv[5], 'utf8'))
    : { humanReceipts: [], specialistObservations: [], mergeObservation: null };
  exactFields(evidence, ['humanReceipts', 'specialistObservations', 'mergeObservation'], 'evidence');
  streams.stdout.write(`${JSON.stringify(validateApprovalBinding(input, {
    repositoryRoot: argv[1],
    humanReceipts: evidence.humanReceipts,
    specialistObservations: evidence.specialistObservations,
    mergeObservation: evidence.mergeObservation,
  }), null, 2)}\n`);
  return 0;
}

function direct() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (direct()) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: { status: error.status ?? 'blocked', code: error.code ?? 'invalid-input', message: error.message } })}\n`);
    process.exitCode = 1;
  }
}
