/**
 * One worked declared reduction, shared by this molecule's end-to-end test and by
 * the consuming skill's contract test.
 *
 * It lives in one place because two suites need the *same* reduction to mean
 * anything: the provider's test proves this bundle really reduces to this
 * candidate under this contract with this ledger, and the consumer's test proves
 * the result the provider produces is the result the consumer accepts. Two
 * hand-copied fixtures would let those two facts drift apart silently.
 *
 * Nothing in the machinery knows these values. The contract below is an ordinary
 * caller declaration, not a registered profile, and no code matches on it.
 */

/**
 * The output contract this run obeys: the source skill's human intent, written as
 * plain requirements. Stated by the caller, for this run, and identified by a
 * digest of its own terms.
 */
export const DECLARED = Object.freeze({
  goal: "the source skill's human intent as plain requirements suitable for operator confirmation and later create-skill input",
  sourceKind: 'skill-bundle',
  variantKind: 'intent-prose',
  workspaceRoot: 'synthesis/intent/',
  outputPattern: 'synthesis/intent/<slug>.intent.md',
  wordBudget: 500,
  requiredContent: Object.freeze(['subject', 'purpose', 'requirements', 'refusals']),
  nonOmittableKinds: Object.freeze(['intention', 'criterion', 'non-goal', 'constraint', 'contradiction']),
  structuralHeadings: Object.freeze(['What this is for', 'What it must do', 'What it must refuse']),
});

export const SOURCE_PATH = 'synthesis/intent/s12-demo-adopter-r5-run-1-a1.bundle.md';
export const CANDIDATE_PATH = 'synthesis/intent/s12-demo-adopter-r5-run-1-a1.intent.md';

/**
 * The assembled bundle: the caller's explicit selection of the material an
 * intent has to be derived from, concatenated into the one artifact a run binds.
 */
export const SOURCE = [
  '# Bundle: demo-adopter',
  '',
  'Assembled from the demo-adopter skill and the two support files chosen for it.',
  '',
  'The skill turns a failing test run into one filed defect report.',
  '',
  'It must never file the same defect twice.',
  '',
  'It must never close, triage, or approve a defect it filed.',
  '',
  'The report is written for a maintainer who was not watching the run.',
  '',
].join('\n');

export const CANDIDATE = [
  '# Intent: demo-adopter',
  '',
  '## What this is for',
  '',
  'The skill turns a failing test run into one filed defect report.',
  '',
  '## What it must do',
  '',
  'The report is written for a maintainer who was not watching the run.',
  '',
  '## What it must refuse',
  '',
  'It must never file the same defect twice.',
  '',
  'It must never close, triage, or approve a defect it filed.',
  '',
].join('\n');

export const ENTRIES = [
  {
    id: 'subject',
    kind: 'context',
    classification: 'authoritative',
    disposition: 'reworded',
    covers: ['subject'],
    sourceAnchor: 'Bundle: demo-adopter',
    variantAnchor: 'Intent: demo-adopter',
    reason: 'the bundle names the subject; the intent names the same subject',
    meaningPreserved: true,
  },
  {
    id: 'assembly-note',
    kind: 'context',
    classification: 'supporting',
    disposition: 'omitted',
    sourceAnchor: 'Assembled from the demo-adopter skill and the two support files chosen for it.',
    reason: 'how the bundle was assembled is run evidence, not human intent',
  },
  {
    id: 'purpose',
    kind: 'intention',
    classification: 'authoritative',
    disposition: 'retained',
    covers: ['purpose'],
    sourceAnchor: 'The skill turns a failing test run into one filed defect report.',
    variantAnchor: 'The skill turns a failing test run into one filed defect report.',
  },
  {
    id: 'audience',
    kind: 'constraint',
    classification: 'authoritative',
    disposition: 'retained',
    covers: ['requirements'],
    sourceAnchor: 'The report is written for a maintainer who was not watching the run.',
    variantAnchor: 'The report is written for a maintainer who was not watching the run.',
  },
  {
    id: 'no-duplicates',
    kind: 'non-goal',
    classification: 'authoritative',
    disposition: 'retained',
    covers: ['refusals'],
    sourceAnchor: 'It must never file the same defect twice.',
    variantAnchor: 'It must never file the same defect twice.',
  },
  {
    id: 'no-disposition',
    kind: 'non-goal',
    classification: 'authoritative',
    disposition: 'retained',
    sourceAnchor: 'It must never close, triage, or approve a defect it filed.',
    variantAnchor: 'It must never close, triage, or approve a defect it filed.',
  },
];
