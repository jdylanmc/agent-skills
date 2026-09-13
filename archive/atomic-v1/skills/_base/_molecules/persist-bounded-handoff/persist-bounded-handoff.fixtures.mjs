/**
 * Shared fixtures for the bounded-handoff suites.
 *
 * The sandbox points the runtime's temporary directory at a repository-local
 * scratch root. The suites then exercise the real resolution path without
 * touching the machine's shared temporary directory, which also proves that
 * resolution follows the runtime rather than a hard-coded location.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
export const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');
export const ATOMS = path.join(REPOSITORY_ROOT, 'skills', '_base', '_atoms');
export const MOLECULE_ENTRY = path.join(HERE, 'persist-bounded-handoff.mjs');

/**
 * Suites run in parallel in separate processes and share this scratch root.
 * No suite ever removes the shared root itself: a concurrent removal makes a
 * sibling's create fail, and the failure surfaces under more than one error
 * code, so retrying it is unreliable. Each suite creates and removes only its
 * own sandbox beneath the root, which makes the race impossible rather than
 * unlikely. The root is git-ignored, so leaving it behind keeps the working
 * tree clean.
 */
function makeSandboxRoot(label) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  return fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX_ROOT, `${label}-`)));
}

export function sandbox(t, label) {
  const root = makeSandboxRoot(label);
  const previous = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  for (const key of ['TMPDIR', 'TEMP', 'TMP']) {
    process.env[key] = root;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

export function sandboxEnvironment(root) {
  return { ...process.env, TMPDIR: root, TEMP: root, TMP: root };
}

export function completePayload(overrides = {}) {
  return {
    slug: 'skills-issue-43',
    goal: 'Establish the shared bounded-handoff core.',
    current_progress: 'Five atoms and one molecule exist.',
    decisions_and_constraints: 'The shared core owns rendering and writing.',
    artifacts_and_references: [
      { reference: 'https://github.com/jdylanmc/skills/issues/43', note: 'The issue' },
      'docs/adr/0001-use-local-units-and-promote-proven-shared-units.md',
    ],
    what_worked: 'Deterministic bounds.',
    what_did_not_work: 'A single generic write atom.',
    next_steps: 'Wire the wrapper and the orchestrator.',
    ...overrides,
  };
}

export function headingsOf(document) {
  return document
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3));
}

/**
 * Windows refuses symbolic links without the right privilege, so a suite that
 * needs one asks first and skips rather than failing the platform.
 */
export function trySymlink(target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'UNKNOWN'].includes(error.code)) {
      return false;
    }
    throw error;
  }
}

export function failureOf(code) {
  return (error) => error.code === code;
}
