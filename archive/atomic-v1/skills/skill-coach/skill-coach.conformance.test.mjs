/**
 * Conformance tests for the coaching package and its one caller.
 *
 * Four properties are pinned here, because each is cheap to lose and expensive
 * to have lost.
 *
 * 1. **No write authority.** The whole safety argument for letting a persona
 *    drive a conversation is that the conversation can produce nothing but a
 *    packet. A grant that quietly gained `edit` would make that argument false
 *    without changing a word of the prose that makes it.
 * 2. **Routing.** The skill is reachable by `create-skill` and not by a human,
 *    because a coaching packet on its own has nowhere to go.
 * 3. **The confirmation stays downstream.** Coaching shortens the asking. It
 *    must never shorten the gate, and `create-skill` must keep exactly one
 *    confirmation bound to the exact bytes it presented.
 * 4. **Coaching is best effort and its absence is visible.** A required coach
 *    would make `create-skill` fail where it used to work; a silent coach would
 *    report coaching that did not happen. Neither is acceptable.
 *
 * Registration of these suites in continuous integration is also asserted here
 * so the failure names this package; `scripts/workflow-registration.test.mjs`
 * guards the same rule for the repository as a whole.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'skill-coach/SKILL.md';
const CREATE_ENTRY = 'create-skill/SKILL.md';

/** The grant the package was reviewed with. Nothing here may widen it. */
const PINNED_TOOLS = ['execute', 'read', 'search'];

const LOCAL_UNITS = [
  'skill-coach/_molecules/coaching-session/coaching-session.md',
  'skill-coach/_atoms/coach-persona/coach-persona.md',
  'skill-coach/_atoms/coaching-conversation/coaching-conversation.md',
  'skill-coach/_atoms/definition-packet/definition-packet.md',
];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

/** Whitespace-normalised, so a reflow of the source does not fail an assertion. */
function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

test('the skill is reachable by a caller and not by a human', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.name, 'skill-coach');
  assert.equal(parsed.disableModelInvocation, false, 'create-skill must be able to reach it');
  assert.equal(parsed.userInvocable, false, 'a coaching packet on its own has nowhere to go');
  assert.deepEqual(parsed.requiresSkills, [], 'coaching depends on no other skill');
});

test('the routing description says when to use it and when not to', () => {
  const { description } = frontmatter(ENTRY);
  assert.match(description, /Use when/);
  assert.match(description, /Do not use/);
  assert.match(description, /review/, 'the description must exclude the reviewer\'s job by name');
});

test('the package holds no write authority anywhere in its closure', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'), 'coaching writes nothing, so it grants no edit');
  assert.ok(!parsed.allowedTools.includes('task'), 'coaching spawns nothing, so it grants no task');
  assert.ok(!parsed.allowedTools.includes('*'));

  const result = validateRepository(REPOSITORY_ROOT);
  for (const unit of closureFor(result, ENTRY)) {
    const tools = readFrontmatter(read(unit), unit).allowedTools ?? [];
    assert.ok(
      !tools.includes('edit') && !tools.includes('*'),
      `${unit} declares write authority the coaching package must not reach`,
    );
  }
});

test('nothing the skill composes needs a tool outside the pinned grant', () => {
  const derived = deriveGraph(REPOSITORY_ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) {
      required.add(tool);
    }
  }
  const excess = [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort();
  assert.deepEqual(excess, [], `a composed unit needs ${excess.join(', ')}, which would widen the grant`);
  assert.deepEqual(derived.grantViolations, []);
});

test('the skill composes the chronicler and reaches every unit it claims', () => {
  const parsed = frontmatter(ENTRY);
  assert.ok(parsed.composes.includes('_base/_molecules/chronicler/chronicler.md'));

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [...LOCAL_UNITS, '_base/_atoms/agent-resolve/agent-resolve.md']) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('every new unit stays local to this first consumer', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const promoted = [...result.graph.keys()].filter(
    (file) => file.startsWith('_base/') && /(coach|coaching|definition-packet)/.test(file),
  );
  assert.deepEqual(promoted, [], 'ADR 0001 keeps a first-consumer unit local; there is no second consumer');
});

test('the package carries a stored intent written as plain requirements', () => {
  const intentPath = path.join(SKILLS_ROOT, 'skill-coach', 'intent.md');
  assert.ok(fs.lstatSync(intentPath).isFile());
  const intent = fs.readFileSync(intentPath, 'utf8');
  assert.match(intent, /^# Intent: skill-coach\s*$/m);
  assert.ok(!intent.startsWith('---'), 'an intent carries no frontmatter');
});

test('the skill states that it writes nothing and confirms nothing', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /Read-only\./);
  assert.match(entry, /It holds no `edit` grant/);
  assert.match(entry, /Confirms nothing on anyone's behalf/);
  assert.match(entry, /bound to the exact bytes that gate presented/);

  const packet = flat('skill-coach/_atoms/definition-packet/definition-packet.md');
  assert.match(
    packet,
    /A packet never carries the operator's confirmation, an approval, or a stored intent, whatever it is asked to carry/,
  );
  assert.match(packet, /A packet never reports a file, because nothing here writes one/);
});

test('the persona governs voice and can widen nothing', () => {
  const persona = flat('skill-coach/_atoms/coach-persona/coach-persona.md');
  assert.match(persona, /Read the resolved file as a \*\*document\*\*/);
  assert.match(persona, /Never invoke it as a registered agent/);
  assert.match(persona, /never grants a permission, never authorises a write, and never satisfies a gate/);
  assert.match(persona, /Do not improvise a coach/);
});

test('the conversation follows the idea instead of a questionnaire', () => {
  const conversation = flat('skill-coach/_atoms/coaching-conversation/coaching-conversation.md');
  assert.match(conversation, /Open with \*\*one real question\*\*/);
  assert.match(conversation, /\*\*Never re-ask what was already answered\.\*\*/);
  assert.match(conversation, /not a checklist/);
  assert.match(conversation, /\*\*The person chooses\.\*\*/);
  assert.match(conversation, /Never fill the gap with a plausible guess/);
});

test('create-skill reaches the coach by invocation, optionally, and keeps the roast required', () => {
  const parsed = frontmatter(CREATE_ENTRY);
  // `changelog` was added deliberately so a new skill is recorded when it is
  // created. It is optional for the same reason the coach is: a hard
  // requirement would fail creation in a repository that keeps no changelog.
  assert.deepEqual(parsed.requiresSkills, [
    { id: 'roast', source: 'local', required: true },
    { id: 'skill-coach', source: 'local', required: false },
    { id: 'changelog', source: 'local', required: false },
  ]);

  const result = validateRepository(REPOSITORY_ROOT);
  for (const unit of closureFor(result, CREATE_ENTRY)) {
    assert.ok(
      !unit.startsWith('skill-coach/'),
      `${CREATE_ENTRY} must reach the coach by invocation, not by composing ${unit}`,
    );
  }
});

test('create-skill coaches before it captures intent, and captures before it designs', () => {
  const entry = read(CREATE_ENTRY);
  const coach = entry.indexOf('Coach the idea before anything is captured');
  const capture = entry.indexOf('Capture what the skill is for with');
  const design = entry.indexOf('to establish the one reusable job, routing triggers');
  assert.ok(coach > 0 && capture > 0 && design > 0);
  assert.ok(coach < capture, 'coaching shapes the idea before the intent is drafted from it');
  assert.ok(capture < design, 'intent is still captured before any structure is designed');
  assert.match(flat(CREATE_ENTRY), /coach -> elicit intent -> build -> validate -> roast -> resolve -> present/);
});

test('coaching is best effort, and its absence degrades visibly rather than silently', () => {
  const entry = flat(CREATE_ENTRY);
  assert.match(entry, /\*\*Coaching is best effort\.\*\*/);
  assert.match(entry, /run step 3 unaided and report `Coaching: degraded` with the reason/);
  assert.match(
    entry,
    /Degraded coaching lowers nothing: the intent requirement, the confirmation, and the storage gate below are unchanged by it/,
  );
  assert.match(entry, /`Coaching: coached` or `Coaching: degraded` with the reason/);

  const capture = flat('create-skill/_molecules/intent-capture/intent-capture.md');
  assert.match(capture, /run the elicitation below unaided and report the coaching as degraded/);
});

test('the confirmation that stores an intent stays with the storage gate', () => {
  const entry = flat(CREATE_ENTRY);
  assert.match(entry, /There is exactly one confirmation, and it is this one/);
  assert.match(entry, /bound to the exact bytes of the draft shown to him here/);
  assert.match(entry, /Never lets the coach write a file or stand in for the operator's confirmation/);

  const capture = flat('create-skill/_molecules/intent-capture/intent-capture.md');
  assert.match(capture, /A coaching packet supplies the operator's words, never his confirmation/);
  assert.match(capture, /The coach holds no confirmation and cannot supply one/);

  // The gate itself is untouched by this change and must stay that way.
  const gate = flat('create-skill/_atoms/intent-storage-gate/intent-storage-gate.md');
  assert.match(gate, /\*\*Nothing is stored unconfirmed\.\*\*/);
  assert.match(gate, /\*\*A confirmation names the words it confirms\.\*\* It is bound to the exact bytes presented/);
});

test('create-skill treats a coach recommendation as the coach\'s and not the operator\'s', () => {
  const capture = flat('create-skill/_molecules/intent-capture/intent-capture.md');
  assert.match(capture, /A coach recommendation he rejected is not evidence of what he wants/);
  assert.match(
    capture,
    /never treats a coach's recommendation, a rejected alternative, or an unsettled question as something the operator said/,
  );
});

test('every suite this package ships runs in continuous integration', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        found.push(path.relative(REPOSITORY_ROOT, absolute).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(SKILLS_ROOT, 'skill-coach'));

  assert.ok(found.length >= 3, 'the walk found too few suites, which would make this assertion vacuous');
  const unregistered = found.filter((file) => !workflow.includes(file)).sort();
  assert.deepEqual(
    unregistered,
    [],
    `the workflow does not glob; these never run in continuous integration: ${unregistered.join(', ')}`,
  );
});
