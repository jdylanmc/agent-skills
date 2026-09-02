import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');
const ENTRY = 'spec/SKILL.md';
const PINNED_TOOLS = ['edit', 'execute', 'read', 'search', 'task'];
const UNITS = [
  'spec/_molecules/product-specification/product-specification.md',
  'spec/_atoms/approval-state/approval-state.md',
  'spec/_atoms/discovery-source/discovery-source.md',
  'spec/_atoms/product-design-evidence/product-design-evidence.md',
  'spec/_atoms/product-requirements/product-requirements.md',
  'spec/_atoms/spec-outcome/spec-outcome.md',
  'spec/_atoms/spec-pair/spec-pair.md',
  'spec/_atoms/spec-publication/spec-publication.md',
];
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const flat = (relative) => read(relative).replace(/\s+/g, ' ');
const frontmatter = (relative) => readFrontmatter(
  fs.readFileSync(path.join(SKILLS_ROOT, relative), 'utf8'),
  relative,
);

test('spec is routable from confirmed Discovery and refuses adjacent jobs', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.name, 'spec');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.deepEqual(parsed.requiresSkills, [{ id: 'roast', source: 'local', required: true }]);
  assert.match(parsed.description, /Markdown artifact or tracker issue/);
  for (const refusal of ['choose architecture', 'author Gherkin', 'create tickets', 'mutate trackers', 'implement']) {
    assert.match(parsed.description, new RegExp(refusal, 'i'));
  }
});

test('composition reaches chronicler and every local unit without widening the grant', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'spec/_atoms/spec-publication/spec-publication.md',
    'spec/_molecules/product-specification/product-specification.md',
  ]);

  const closure = closureFor(validateRepository(ROOT), ENTRY);
  for (const unit of UNITS) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }

  const derived = deriveGraph(ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }
  assert.deepEqual(
    [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort(),
    [],
  );
  assert.deepEqual(derived.grantViolations, []);
});

test('durable workflow artifacts stay under docs agent', () => {
  const intent = flat('skills/spec/intent.md');
  const skill = flat('skills/spec/SKILL.md');
  assert.match(intent, /docs\/agent\/discovery/);
  assert.match(intent, /docs\/agent\/specs/);
  assert.match(intent, /durable workspace/);
  assert.match(skill, /docs\/agent\/specs\/<slug>\.nano\.md/);
  assert.match(skill, /docs\/agent\/specs\/<slug>\.full\.md/);
  assert.match(skill, /Discovery persists aligned application knowledge directly beneath `docs\/agent\/discovery\/`/);
  assert.doesNotMatch(skill, /temporary handoff.*promotion approved/i);
});

test('nano authority and full supporting context cannot silently trade places', () => {
  const skill = flat('skills/spec/SKILL.md');
  const pair = flat('skills/spec/_atoms/spec-pair/spec-pair.md');
  assert.match(skill, /nano document is settled product intent/);
  assert.match(skill, /full document never wins/);
  assert.match(pair, /Every bullet under Product Requirements and Product Decisions contains one authority marker/);
  assert.match(pair, /Every nano acceptance-criteria identifier appears in Traceability/);
});

test('one-pass Roast stays separate from Ship remediation and human approval', () => {
  const skill = flat('skills/spec/SKILL.md');
  const intent = flat('skills/spec/intent.md');
  assert.match(skill, /Submit the exact candidate pair to `roast`/);
  assert.match(skill, /artifact type `spec`/);
  assert.match(skill, /Roast is read-only/);
  assert.match(skill, /does not repair the pair or approve it/);
  assert.match(skill, /`spec` artifact profile stages both siblings/);
  assert.match(skill, /outer delivery workflow may apply repairs/);
  assert.match(intent, /A roast is one read-only review pass/);
  assert.match(intent, /delivery workflow owns any repeated roast, repair, and re-roast loop/);
  assert.match(skill, /Silence and unrelated replies are not approval/);
  assert.match(skill, /Never approve its own output/);
  assert.match(skill, /`complete` requires .*explicit human approval/);
  assert.doesNotMatch(skill, /artifact type `specification`/);
  assert.doesNotMatch(skill, /issue #118/);
  assert.doesNotMatch(skill, /`complete` remains unreachable/);
});

test('composition is local-first and includes the required chronicler', () => {
  const skill = read('skills/spec/SKILL.md');
  const molecule = read('skills/spec/_molecules/product-specification/product-specification.md');
  assert.match(skill, /_base\/_molecules\/chronicler\/chronicler\.md/);
  // spec-publication is composed by the skill directly, not the molecule
  assert.match(skill, /spec\/_atoms\/spec-publication\/spec-publication\.md/);
  for (const atom of ['approval-state', 'discovery-source', 'product-requirements', 'spec-outcome', 'spec-pair']) {
    assert.match(molecule, new RegExp(`spec/_atoms/${atom}/${atom}\\.md`));
  }
  // spec-publication must NOT be in the molecule's composes/includes
  assert.doesNotMatch(molecule, /spec-publication/);
});

test('human-confirmed intent is present and treated as the source', () => {
  const intent = read('skills/spec/intent.md');
  assert.match(intent, /^# Intent: spec/);
  assert.match(intent, /tracker issue/);
  assert.match(intent, /product requirements documents/i);
  assert.match(intent, /The nano document is intentionally smaller/);
});

test('approval is documented as a merge to the default branch, not a field', () => {
  const skill = flat('skills/spec/SKILL.md');
  const approvalAtom = flat('skills/spec/_atoms/approval-state/approval-state.md');
  assert.match(skill, /merge to the default branch/);
  assert.match(skill, /field the producing agent writes is not/);
  assert.match(approvalAtom, /merge to the default branch/);
  assert.match(approvalAtom, /same agent that wrote the specification writes the claim/);
  assert.match(approvalAtom, /permission guarded only by a promise is not guarded/);
});

test('freshness table documents both draft-stale and approved-held states', () => {
  const skill = flat('skills/spec/SKILL.md');
  assert.match(skill, /draft.*stale.*refuse and re-derive/i);
  assert.match(skill, /approved.*held.*specification remains valid/i);
});

test('held appears in the status vocabulary', () => {
  const skill = flat('skills/spec/SKILL.md');
  assert.match(skill, /`held`/);
  assert.match(skill, /approved specification stands/);
});

test('publication refuses the default branch', () => {
  const pubAtom = flat('skills/spec/_atoms/spec-publication/spec-publication.md');
  assert.match(pubAtom, /default-branch-refused/);
  assert.match(pubAtom, /manufacture its own approval/i);
  assert.match(pubAtom, /never pushes to the default branch/i);
});

test('the intent records the reasoning for approval, freshness, contradiction, and publication', () => {
  const intent = flat('skills/spec/intent.md');
  assert.match(intent, /approval is a merge/i);
  assert.match(intent, /approved specification holds/i);
  assert.match(intent, /contradiction.*signal to revisit/i);
  assert.match(intent, /specification must be published/i);
  assert.match(intent, /specification cannot approve itself/i);
});

test('the trust chain is documented with all four layers', () => {
  const approvalAtom = flat('skills/spec/_atoms/approval-state/approval-state.md');
  // (1) the merge is an act the agent cannot perform, provider enforces
  assert.match(approvalAtom, /merge itself is an act the agent cannot perform/i);
  assert.match(approvalAtom, /provider.*enforces/i);
  // (2) the observation is verified against git objects
  assert.match(approvalAtom, /verified against git objects/i);
  assert.match(approvalAtom, /checkable rather than tamper-proof/i);
  // (3) observedWith records commands for re-derivation
  assert.match(approvalAtom, /observedWith.*records.*commands/i);
  // (4) residual limitation stated plainly: local ref is writable, receipt is checkable
  assert.match(approvalAtom, /residual limitation/i);
  assert.match(approvalAtom, /writable by anything with shell access/i);
  assert.match(approvalAtom, /reproduces against the provider/i);
});

test('the approval atom does not overclaim the boundary', () => {
  const approvalAtom = flat('skills/spec/_atoms/approval-state/approval-state.md');
  // Must not claim the atom uses "evidence the producing agent cannot manufacture"
  assert.doesNotMatch(approvalAtom, /evidence the producing agent cannot manufacture/i);
  // Must not claim the ref "cannot be moved"
  assert.doesNotMatch(approvalAtom, /this run cannot move/i);
  // The SKILL.md approval durability section states the provider enforces the boundary
  const skill = flat('skills/spec/SKILL.md');
  assert.match(skill, /provider.*enforces/i);
  assert.doesNotMatch(skill, /evidence.*cannot manufacture/i);
});

test('slug vocabulary agrees between approval-state and spec-pair', () => {
  const approvalAtom = flat('skills/spec/_atoms/approval-state/approval-state.md');
  const specPair = flat('skills/spec/_atoms/spec-pair/spec-pair.md');
  // Both must accept alphanumeric slugs
  assert.match(approvalAtom, /alphanumeric/i);
  assert.match(specPair, /lowercase ASCII words/i);
  // Verify through the code: import both and test a digit-bearing slug
  // (behavioral test is in approval-state.test.mjs)
});

test('the approval-state atom exports a verification capability', async () => {
  const mod = await import('./_atoms/approval-state/approval-state.mjs');
  assert.equal(typeof mod.verifyApprovalObservation, 'function');
  assert.match(mod.USAGE, /--verify/);
  assert.match(mod.USAGE, /--root/);
});

test('publication documents the exact command to determine the current branch', () => {
  const pubAtom = flat('skills/spec/_atoms/spec-publication/spec-publication.md');
  assert.match(pubAtom, /git rev-parse --abbrev-ref HEAD/);
  assert.match(pubAtom, /provider.*branch protection/i);
});

// F1: verification is the only route to held
test('verification is documented as the only route to held', () => {
  const ds = flat('skills/spec/_atoms/discovery-source/discovery-source.md');
  assert.match(ds, /verification is the only route to held/i);
  assert.match(ds, /verifyApprovalObservation/);
  assert.match(ds, /repositoryRoot/);
  assert.match(ds, /seam exists.*tests.*deterministic/i);
  assert.match(ds, /shipped command-line path uses git/i);
});

// F2: the approval is bound to source and revision
test('the approval is bound to the exact source and revision via published bytes', () => {
  const ds = flat('skills/spec/_atoms/discovery-source/discovery-source.md');
  assert.match(ds, /Source.*Source revision.*provenance/i);
  assert.match(ds, /approval cannot be replayed/i);
  assert.match(ds, /binding is proved by bytes a human merged/i);
});

// F3: the trust chain and its residual limitation are documented accurately
test('the trust chain states the local ref is checkable, not tamper-proof', () => {
  const approvalAtom = flat('skills/spec/_atoms/approval-state/approval-state.md');
  const skill = flat('skills/spec/SKILL.md');
  // The approval atom documents the writable ref
  assert.match(approvalAtom, /writable by anything with shell access/i);
  assert.match(approvalAtom, /checkable rather than tamper-proof/i);
  // The SKILL.md documents the same residual limitation
  assert.match(skill, /checkable rather than tamper-proof/i);
  assert.match(skill, /reproduces against the provider/i);
  // Neither claims the ref cannot be moved
  assert.doesNotMatch(approvalAtom, /this run cannot move/i);
  assert.doesNotMatch(skill, /this run cannot move/i);
});

// F4: git failures are classified, not silently swallowed
test('git failure classification is documented in the approval atom', () => {
  const approvalAtom = flat('skills/spec/_atoms/approval-state/approval-state.md');
  assert.match(approvalAtom, /structured result/i);
  assert.match(approvalAtom, /recognizable missing-path failure/i);
  assert.match(approvalAtom, /repository corruption.*permissions error/i);
});

// F5: publication is composed by the skill, not the molecule
test('publication is composed by the skill and not the molecule', () => {
  const skill = frontmatter(ENTRY);
  const molecule = frontmatter('spec/_molecules/product-specification/product-specification.md');
  assert.ok(
    skill.composes.includes('spec/_atoms/spec-publication/spec-publication.md'),
    'skill must directly compose spec-publication',
  );
  assert.ok(
    !molecule.composes.includes('spec/_atoms/spec-publication/spec-publication.md'),
    'molecule must not compose spec-publication',
  );
  assert.ok(
    !molecule.includes.includes('spec/_atoms/spec-publication/spec-publication.md'),
    'molecule must not include spec-publication',
  );
});

// F6: the Inputs rule is state-dependent
test('the Inputs section documents the state-dependent freshness rule', () => {
  const skill = flat('skills/spec/SKILL.md');
  // Must state draft refuses, approved holds
  assert.match(skill, /refused when the specification is a draft/i);
  assert.match(skill, /approved.*held rather than refused/i);
  // Must not state the old unconditional rule
  assert.doesNotMatch(skill, /a source whose current revision differs from its confirmed revision is refused(?!\s+when)/i);
});

// F7: escalated contradiction produces needs-decision on every applicable path
test('escalated contradiction is documented as needs-decision on non-held non-blocked paths', () => {
  const outcome = flat('skills/spec/_atoms/spec-outcome/spec-outcome.md');
  assert.match(outcome, /escalated contradiction/i);
  assert.match(outcome, /must never be silently dropped/i);
});

// --- Corrected guarantees pinned by this review ---

// F1: the ref identity is proved rather than asserted
test('the ref identity is proved by verification, not merely asserted by the caller', () => {
  const approvalAtom = flat('skills/spec/_atoms/approval-state/approval-state.md');
  // Must document that remote is proved configured
  assert.match(approvalAtom, /git remote get-url/i);
  // Must document that the ref resolves to remote-tracking namespace
  assert.match(approvalAtom, /git rev-parse --symbolic-full-name/i);
  assert.match(approvalAtom, /refs\/remotes\//i);
  // Must document the remote's own default branch is proved
  assert.match(approvalAtom, /git symbolic-ref refs\/remotes\//i);
  assert.match(approvalAtom, /git remote set-head.*--auto/i);
});

// F2: verified === true is required for held
test('verification requiring verified === true and state === approved is documented', () => {
  const ds = flat('skills/spec/_atoms/discovery-source/discovery-source.md');
  assert.match(ds, /verified === true/i);
  assert.match(ds, /state === .approved./i);
});

// F3: provenance must be complete — both Source and Source revision
test('complete provenance is documented as required for held', () => {
  const ds = flat('skills/spec/_atoms/discovery-source/discovery-source.md');
  assert.match(ds, /publishedSource.*publishedSourceRevision.*must be present/i);
  assert.match(ds, /absent.*unparsable.*duplicated/i);
});

// F4: the binding includes specification identity via specNanoPath
test('the three-part binding is documented: specification identity, source locator, source revision', () => {
  const ds = flat('skills/spec/_atoms/discovery-source/discovery-source.md');
  assert.match(ds, /specNanoPath/);
  assert.match(ds, /three-part binding/i);
  assert.match(ds, /specification identity/i);
  assert.match(ds, /source locator/i);
  assert.match(ds, /source revision/i);
  assert.match(ds, /approval for one specification cannot hold another/i);
});

// F5: the held path routes through spec-outcome
test('the held path routes through spec-outcome rather than returning directly', () => {
  const skill = flat('skills/spec/SKILL.md');
  const molecule = flat('skills/spec/_molecules/product-specification/product-specification.md');
  // Must NOT say "stop on held" anymore
  assert.doesNotMatch(skill, /when the source is `held`, stop\b/i);
  assert.doesNotMatch(molecule, /stop on `held`/i);
  // Must route through spec-outcome
  assert.match(skill, /route through.*deterministic resolver/i);
  assert.match(molecule, /route through.*deterministic resolver/i);
  // Must reference spec-outcome on the held path
  assert.match(skill, /Specification outcome.*sourceStatus.*held/i);
  assert.match(molecule, /Specification outcome.*sourceStatus.*held/i);
});

test('held returns before product-design evidence validation', () => {
  const skill = flat('skills/spec/SKILL.md');
  const molecule = flat('skills/spec/_molecules/product-specification/product-specification.md');
  assert.match(skill, /return before product-design evidence validation/i);
  assert.match(molecule, /return before product-design evidence validation/i);
  assert.ok(
    molecule.indexOf('**On `held`') < molecule.indexOf('For a fresh source, run'),
    'held routing must precede fresh product-design evidence validation',
  );
});

// F6: the molecule does not claim publication ownership
test('the molecule does not claim to open a change request', () => {
  const molecule = flat('skills/spec/_molecules/product-specification/product-specification.md');
  assert.doesNotMatch(molecule, /opens one change request for that pair/i);
  assert.match(molecule, /publication belongs to the skill alone/i);
});

// F1: observedWith is a checked field
test('observedWith is documented as a checked field', () => {
  const approvalAtom = flat('skills/spec/_atoms/approval-state/approval-state.md');
  assert.match(approvalAtom, /checked field/i);
  assert.match(approvalAtom, /meaningful tokens/i);
  // The text explicitly states it is checked, not merely an audit note
  assert.match(approvalAtom, /observedWith.*records.*commands/i);
});

// --- #123: the shared contradiction-check unit is the seam spec depends on ---

// Criterion 1: one unit, composed by every consumer that needs the question
// answered. spec is a current consumer, and it must reach the shared unit
// rather than carry its own copy.
test('spec reaches the shared contradiction-check unit through the molecule', () => {
  const closure = closureFor(validateRepository(ROOT), ENTRY);
  assert.ok(
    closure.includes('_base/_atoms/contradiction-check/contradiction-check.md'),
    'spec must reach the shared contradiction-check unit',
  );
  const molecule = frontmatter('spec/_molecules/product-specification/product-specification.md');
  assert.ok(
    molecule.composes.includes('_base/_atoms/contradiction-check/contradiction-check.md'),
    'the molecule that owns the held path composes the shared unit',
  );
  const skill = frontmatter(ENTRY);
  assert.ok(
    !skill.composes.includes('_base/_atoms/contradiction-check/contradiction-check.md'),
    'the skill reaches the unit through the molecule, not by direct composition',
  );
});

// Criterion 1 (evidence): the unit's verdict is exactly what feeds spec-outcome
// on the held path, and the values the unit produces are the ones spec-outcome
// accepts. 'not-checked' is the caller's not-run value and is never produced by
// the unit.
test("the contradiction unit's verdict is what feeds spec-outcome on the held path", async () => {
  const cc = await import('../_base/_atoms/contradiction-check/contradiction-check.mjs');
  const so = await import('./_atoms/spec-outcome/spec-outcome.mjs');

  const base = {
    version: 1,
    artifact: { id: 'spec-x', kind: 'nano-specification' },
    assertions: [{ id: 'AC-001', kind: 'acceptance-criterion', text: 'write exactly one pair' }],
    evidence: [{ ref: 'ev-1', text: 'the enriched foundation now writes two pairs' }],
    accepted: [],
  };
  const none = cc.resolveContradictions({ ...base, findings: [] });
  const escalated = cc.resolveContradictions({
    ...base,
    findings: [{ assertionId: 'AC-001', evidenceRef: 'ev-1', confidence: 'high', description: 'the pair count changed' }],
  });
  assert.equal(none.verdict, 'none');
  assert.equal(escalated.verdict, 'escalated');
  assert.notEqual(none.verdict, 'not-checked');
  assert.notEqual(escalated.verdict, 'not-checked');

  const outcome = (contradiction) => so.resolveSpecOutcome({
    sourceStatus: 'held',
    pairStatus: 'valid',
    discoveryGaps: 0,
    openDecisions: 0,
    siblingConflicts: 0,
    roastStatus: 'complete',
    openMustFix: 0,
    approval: 'approved',
    contradiction,
  });
  assert.equal(outcome(none.verdict).status, 'held');
  assert.equal(outcome(escalated.verdict).status, 'needs-decision');
});

// The held path now produces the verdict with the unit rather than passing
// 'not-checked' because #123 was unimplemented.
test('the held path produces the verdict with the unit, not a not-checked placeholder', () => {
  const skill = flat('skills/spec/SKILL.md');
  const molecule = flat('skills/spec/_molecules/product-specification/product-specification.md');
  assert.doesNotMatch(skill, /not-checked.{0,40}#123 is not yet implemented/i);
  assert.doesNotMatch(molecule, /not-checked.{0,40}#123 is not yet implemented/i);
  assert.match(molecule, /contradiction-check\/contradiction-check\.md/);
  assert.match(molecule, /check contradiction/i);
  assert.match(skill, /shared contradiction check/i);
});

// #123 remediation: the seam is a behavioural round trip through both modes of
// the shared unit, and the held path documents recording the non-escalated
// findings so a lower-confidence divergence is not discarded with the verdict.
test('the contradiction seam round-trips through --bound and --resolve and records non-escalated findings', async () => {
  const cc = await import('../_base/_atoms/contradiction-check/contradiction-check.mjs');
  const so = await import('./_atoms/spec-outcome/spec-outcome.mjs');

  const base = {
    version: 1,
    artifact: { id: 'spec-x', kind: 'nano-specification' },
    assertions: [{ id: 'AC-001', kind: 'acceptance-criterion', text: 'write exactly one pair' }],
    evidence: [{ ref: 'ev-1', text: 'the enriched foundation elaborates the pair' }],
    accepted: [],
  };

  // --bound half: judgement receives exactly the capped comparison surface.
  const surface = cc.boundSurface(base);
  assert.deepEqual(Object.keys(surface).sort(), ['accepted', 'artifact', 'assertions', 'counts', 'evidence']);

  // --resolve half: a medium finding is recorded rather than escalated, does
  // not move the verdict off 'none', and survives in the returned result.
  const recordedRun = cc.resolveContradictions({
    ...base,
    findings: [{ assertionId: 'AC-001', evidenceRef: 'ev-1', confidence: 'medium', description: 'a possible divergence' }],
  });
  assert.equal(recordedRun.verdict, 'none');
  assert.equal(recordedRun.escalated.length, 0);
  assert.equal(recordedRun.recorded.length, 1);

  // The verdict feeds spec-outcome, which holds on 'none'.
  const held = so.resolveSpecOutcome({
    sourceStatus: 'held',
    pairStatus: 'valid',
    discoveryGaps: 0,
    openDecisions: 0,
    siblingConflicts: 0,
    roastStatus: 'complete',
    openMustFix: 0,
    approval: 'approved',
    contradiction: recordedRun.verdict,
  });
  assert.equal(held.status, 'held');
});

test('the held path documents recording the non-escalated findings through Chronicler', () => {
  const skill = flat('skills/spec/SKILL.md');
  const molecule = flat('skills/spec/_molecules/product-specification/product-specification.md');
  assert.match(skill, /findings through Chronicler/i);
  assert.match(skill, /non-escalated/i);
  assert.match(molecule, /through Chronicler/i);
  assert.match(molecule, /medium.{0,20}low|`recorded`.{0,40}`suppressed`/i);
});

// #123 second-pass remediation: a TIGHTER pin on the held-path section
// specifically, rather than the whole flattened file, so the recording contract
// is checked where it lives. `recorded`, `suppressed`, and the recorder
// (Chronicler) must all be named together in the held-path step of each file.
//
// This is a PROSE pin, and that is correct: prose is the contract for a Markdown
// unit, so asserting on prose is the right instrument here. Its failure mode is
// brittleness to rewording — reword the held path and it fails loudly — NOT
// blindness to regression: delete the recording sentence and it fails. Loud
// over-firing is the safe direction for a contract this load-bearing.
test('the held-path section names recorded, suppressed, and the recorder together', () => {
  const heldSection = (relative, marker) => {
    const body = read(relative);
    const start = body.indexOf(marker);
    assert.notEqual(start, -1, `${relative} must contain the held-path marker ${JSON.stringify(marker)}`);
    const rest = body.slice(start);
    const next = rest.slice(marker.length).search(/\n\d+\. /);
    return next === -1 ? rest : rest.slice(0, next + marker.length);
  };

  const molecule = heldSection('skills/spec/_molecules/product-specification/product-specification.md', 'On `held`');
  assert.match(molecule, /`recorded`/, 'the molecule held-path step must name the recorded findings');
  assert.match(molecule, /`suppressed`/, 'the molecule held-path step must name the suppressed findings');
  assert.match(molecule, /Chronicler/, 'the molecule held-path step must name the recorder');

  const skill = heldSection('skills/spec/SKILL.md', 'When the source is `held`');
  assert.match(skill, /`recorded`/, 'the skill held-path step must name the recorded findings');
  assert.match(skill, /`suppressed`/, 'the skill held-path step must name the suppressed findings');
  assert.match(skill, /Chronicler/, 'the skill held-path step must name the recorder');
});

test('required product-design evidence maps observable contract records into requirements and excludes implementation', () => {
  const atom = flat('skills/spec/_atoms/product-requirements/product-requirements.md');
  const molecule = flat('skills/spec/_molecules/product-specification/product-specification.md');
  for (const term of ['feature', 'flow', 'observable state', 'decision', 'accessibility expectation', 'alternative', 'open question']) {
    assert.match(atom, new RegExp(term, 'i'));
    assert.match(molecule, new RegExp(term, 'i'));
  }
  assert.match(atom, /supporting full-document detail/);
  assert.match(atom, /observable acceptance criterion/);
  assert.match(atom, /stable contract IDs.*traceability/i);
  assert.match(atom, /Prototype package scripts, dependencies, HTML, CSS, JavaScript, Storybook/i);
});
