import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUTHORITY_MARKER,
  ApprovalBindingError,
  canonicalArtifactSetDigest,
  canonicalConceptSetRevision,
  CONTRACT_SCHEMA,
  MERGE_SCHEMA,
  RECEIPT_SCHEMA,
  SPECIALIST_EVENT_SCHEMA,
  STATUS_PRECEDENCE,
  STATUSES,
  validateApprovalBinding,
} from './approval-binding.mjs';
import {
  createGitHubMergeVerifier,
  createGitHubRepositoryResolver,
  observeGitHubMerge,
} from './approval-binding.github.mjs';
import {
  createHumanReceiptVerifier,
  createSpecialistEventVerifier,
  RECEIPT_ENVELOPE_SCHEMA,
} from './approval-binding.receipts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.join(HERE, '..', '..', '..', '..', '.test-sandbox', 'product-design-approval');
let serial = 0;

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const bytewise = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const setDigest = (records) => sha([...records].sort((a, b) => bytewise(a.path, b.path))
  .map((entry) => `${entry.path}\0${entry.digest}\n`).join(''));
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

function receiptEnvelopes(payloads, streamId, privateKey) {
  let previousDigest = null;
  return payloads.map((payload, index) => {
    const payloadId = payload.receiptId ?? payload.eventId;
    const payloadDigest = sha(canonical(payload));
    const unsigned = {
      schema: RECEIPT_ENVELOPE_SCHEMA,
      streamId,
      sequence: index + 1,
      previousDigest,
      payloadId,
      payloadDigest,
      keyId: 'runtime-key-1',
    };
    const signature = crypto.sign(null, Buffer.from(canonical(unsigned)), privateKey).toString('base64');
    const envelopeDigest = sha(canonical({ ...unsigned, signature }));
    previousDigest = envelopeDigest;
    return { ...unsigned, payload, signature, envelopeDigest };
  });
}

function siteFiles(root, siteRoot, title, { storybook = false } = {}) {
  const scripts = { start: 'http-server . -a 127.0.0.1 -p 4173 -c-1 --no-dotfiles' };
  const devDependencies = { 'http-server': '14.1.1' };
  if (storybook) {
    scripts.storybook = 'storybook dev --host 127.0.0.1 --port 6006 --ci';
    devDependencies.storybook = '8.6.14';
  }
  const files = {
    [`${siteRoot}/package.json`]: JSON.stringify({
      name: title.toLowerCase().replaceAll(' ', '-'),
      version: '1.0.0',
      scripts,
      devDependencies,
    }),
    [`${siteRoot}/package-lock.json`]: JSON.stringify({
      name: title.toLowerCase().replaceAll(' ', '-'),
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: title.toLowerCase().replaceAll(' ', '-'),
          version: '1.0.0',
          devDependencies,
        },
        'node_modules/http-server': {
          version: '14.1.1',
          resolved: 'https://registry.npmjs.org/http-server/-/http-server-14.1.1.tgz',
          integrity: 'sha512-aHR0cC1zZXJ2ZXItZml4dHVyZS1pbnRlZ3JpdHk=',
        },
        ...(storybook ? {
          'node_modules/storybook': {
            version: '8.6.14',
            resolved: 'https://registry.npmjs.org/storybook/-/storybook-8.6.14.tgz',
            integrity: 'sha512-YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
          },
        } : {}),
      },
    }),
    [`${siteRoot}/index.html`]: `<main>${title}</main>\n`,
    [`${siteRoot}/styles.css`]: ':focus-visible{outline:2px solid}\n',
    [`${siteRoot}/app.js`]: 'document.body.dataset.ready="true";\n',
  };
  if (storybook) {
    files[`${siteRoot}/.storybook/main.js`] = 'export default { stories: ["../src/*.stories.js"] };\n';
    files[`${siteRoot}/src/example.stories.js`] = 'export default { title: "Example" }; export const Primary = { render: () => "example" };\n';
  }
  for (const [relative, bytes] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
  }
  return files;
}

function receipt(action, values, sequence) {
  return {
    schema: RECEIPT_SCHEMA,
    receiptId: `receipt.${action}`,
    action,
    subjectId: 'checkout',
    prototypeRevision: values.prototypeRevision,
    discoveryDigest: values.discoveryDigest,
    brandDigest: values.brandDigest ?? null,
    conceptId: values.conceptId ?? null,
    conceptDigest: values.conceptDigest ?? null,
    artifactSetDigest: values.artifactSetDigest ?? null,
    interactionContractDigest: values.interactionContractDigest ?? null,
    actor: 'human@example.test',
    role: 'accountable-product-owner',
    contextId: 'review-context-155',
    channel: 'change-request-review',
    observedAt: `2026-08-31T12:0${sequence}:00Z`,
    sourceId: `review-${action}`,
    sequence,
  };
}

function fixture() {
  serial += 1;
  const root = path.join(SANDBOX, `repo-${process.pid}-${serial}`);
  const workspace = 'docs/agent/prototypes/checkout';
  const discoveryPath = 'docs/agent/discovery/checkout.md';
  const discoveryBytes = '# Checkout discovery\n';
  fs.mkdirSync(path.join(root, 'docs/agent/discovery'), { recursive: true });
  fs.writeFileSync(path.join(root, discoveryPath), discoveryBytes);
  const discoveryDigest = sha(discoveryBytes);
  const prototypeRevision = sha('prototype checkout v1');

  const files = {
    ...siteFiles(root, `${workspace}/brand`, 'Brand', { storybook: true }),
    ...siteFiles(root, `${workspace}/concept-guided`, 'Guided checkout'),
  };
  const brandPaths = Object.keys(files).filter((entry) => entry.includes('/brand/'));
  const conceptPaths = Object.keys(files).filter((entry) => entry.includes('/concept-guided/'));
  const brandArtifacts = brandPaths.map((artifactPath) => ({ path: artifactPath, digest: sha(files[artifactPath]) }));
  const conceptArtifacts = conceptPaths.map((artifactPath) => ({ path: artifactPath, digest: sha(files[artifactPath]) }));
  const brandDigest = setDigest(brandArtifacts);
  const conceptDigest = setDigest(conceptArtifacts);
  const contractPath = `${workspace}/interaction-contract.json`;
  const contract = {
    schema: CONTRACT_SCHEMA,
    subject: { id: 'checkout', prototypeRevision },
    discoveryRevision: discoveryDigest,
    brandRevision: brandDigest,
    selectedConceptId: 'concept.checkout-guided',
    features: [{ id: 'feature.checkout', visibleBehavior: 'Shows progress.', rules: ['Progress is visible.'] }],
    flows: [{
      id: 'flow.checkout', featureIds: ['feature.checkout'],
      stateIds: ['state.start', 'state.review'], visibleBehavior: 'Moves to review.', rules: ['Selection is required.'],
    }],
    states: [
      { id: 'state.start', visibleBehavior: 'Options are visible.', rules: ['Nothing selected.'] },
      { id: 'state.review', visibleBehavior: 'Review is visible.', rules: ['Selection is summarized.'] },
    ],
    walkthroughs: [{
      id: 'walkthrough.checkout', featureIds: ['feature.checkout'],
      flowIds: ['flow.checkout'], decisionIds: ['decision.guidance'], stepIds: ['step.choose'],
    }],
    decisions: [{ id: 'decision.guidance', rationale: 'Explicit progress improves recovery.' }],
    alternatives: [{
      id: 'alternative.compact', decisionId: 'decision.guidance',
      conceptId: null, disposition: 'rejected', rationale: 'Hides recovery context.',
    }],
    accessibility: [
      ['keyboard', 'Keyboard order follows visual order.'],
      ['focus', 'Focus moves predictably.'],
      ['semantics', 'Controls expose names and roles.'],
      ['contrast', 'Visible content maintains contrast.'],
      ['reduced-motion', 'Transitions respect reduced motion.'],
      ['resizing', 'Content reflows at enlarged text.'],
      ['state-communication', 'Review and errors are communicated.'],
    ].map(([category, expectation]) => ({
      id: `accessibility.${category}`,
      conceptEvidenceId: `concept-accessibility.${category}`,
      category,
      featureIds: ['feature.checkout'],
      flowIds: ['flow.checkout'],
      stateIds: ['state.start', 'state.review'],
      walkthroughIds: ['walkthrough.checkout'],
      stepIds: ['step.choose'],
      applicability: 'required',
      rationaleCode: null,
      expectation,
    })),
    mockedLimitations: [{
      id: 'mock.payment', behavior: 'Payment succeeds locally.',
      limitations: 'No payment service is called.',
    }],
    assumptions: [{ id: 'assumption.signed-in', text: 'The customer is signed in.' }],
    contradictions: [],
    unresolvedQuestions: [{ id: 'question.tax', text: 'When is tax finalized?' }],
    authority: AUTHORITY_MARKER,
  };
  const contractBytes = `${JSON.stringify(contract, null, 2)}\n`;
  fs.writeFileSync(path.join(root, contractPath), contractBytes);
  files[contractPath] = contractBytes;
  const artifacts = Object.entries(files)
    .map(([artifactPath, bytes]) => ({ path: artifactPath, digest: sha(bytes) }))
    .sort((a, b) => bytewise(a.path, b.path));
  const artifactSetDigest = setDigest(artifacts);
  const contractDigest = sha(contractBytes);

  const packet = {
    version: 2,
    cancelled: false,
    subject: { id: 'checkout', slug: 'checkout', prototypeRevision },
    discovery: { locator: discoveryPath, digest: discoveryDigest },
    workspace,
    specialists: { brandContextId: 'brand.1', uxContextId: 'ux.1' },
    artifactManifest: artifacts,
    brand: {
      artifactPaths: brandPaths,
      packageJsonPath: `${workspace}/brand/package.json`,
      packageLockPath: `${workspace}/brand/package-lock.json`,
      storybookConfigPath: `${workspace}/brand/.storybook/main.js`,
      storybookStoryPath: `${workspace}/brand/src/example.stories.js`,
      htmlPath: `${workspace}/brand/index.html`,
      cssPath: `${workspace}/brand/styles.css`,
      javascriptPath: `${workspace}/brand/app.js`,
      digest: brandDigest,
      outputs: {
        palette: ['ink, paper, accent'],
        typography: ['system sans hierarchy'],
        spacingDensity: ['8px rhythm, comfortable density'],
        shapeBorderElevationRhythm: ['4px radius, 1px borders, low elevation'],
        illustrativeAtomsStates: ['button default, focus, disabled'],
        compositions: ['checkout review composition'],
        moodBoard: ['calm, direct, trustworthy'],
        accessibility: [
          ['keyboard', 'Keyboard navigation is demonstrated.'],
          ['focus', 'Focus is always visible.'],
          ['semantics', 'Landmarks and names are demonstrated.'],
          ['contrast', 'Text and controls meet contrast expectations.'],
          ['reduced-motion', 'Motion can be reduced.'],
          ['resizing', 'Content reflows when text is resized.'],
          ['state-communication', 'Errors and state changes are announced.'],
        ].map(([category, expectation]) => ({
          id: `brand-accessibility.${category}`,
          category,
          expectation,
          evidencePath: `${workspace}/brand/index.html`,
        })),
      },
    },
    concepts: [{
      id: 'concept.checkout-guided',
      brandRevision: brandDigest,
      decisionIds: ['decision.guidance'],
      disposition: 'selected',
      dispositionRationale: 'Makes progress and recovery visible.',
      dispositionDecisionId: 'decision.guidance',
      artifactPaths: conceptPaths,
      packageJsonPath: `${workspace}/concept-guided/package.json`,
      packageLockPath: `${workspace}/concept-guided/package-lock.json`,
      htmlPath: `${workspace}/concept-guided/index.html`,
      cssPath: `${workspace}/concept-guided/styles.css`,
      javascriptPath: `${workspace}/concept-guided/app.js`,
      digest: conceptDigest,
      mockedData: true,
      accessibility: [
        ['keyboard', 'Keyboard order follows visual order.'],
        ['focus', 'Focus moves predictably.'],
        ['semantics', 'Controls expose names and roles.'],
        ['contrast', 'Visible content maintains contrast.'],
        ['reduced-motion', 'Transitions respect reduced motion.'],
        ['resizing', 'Content reflows at enlarged text.'],
        ['state-communication', 'Review and errors are communicated.'],
      ].map(([category, expectation]) => ({
        id: `concept-accessibility.${category}`,
        category,
        featureIds: ['feature.checkout'],
        flowIds: ['flow.checkout'],
        stateIds: ['state.start', 'state.review'],
        walkthroughIds: ['walkthrough.checkout'],
        stepIds: ['step.choose'],
        applicability: 'required',
        rationaleCode: null,
        expectation,
        evidencePath: `${workspace}/concept-guided/index.html`,
        observableTarget: '#payment-options and review heading',
      })),
      designSpace: {
        axes: ['guided versus compact'],
        hypotheses: ['guidance improves recovery'],
        comparisonCriteria: ['completion comprehension'],
        budget: 'one decision, two hours',
        accountableHuman: 'product owner',
        stopRationale: 'The remaining alternative adds no new behavior.',
        alternatives: [{
          id: 'alternative.compact',
          decisionId: 'decision.guidance',
          disposition: 'rejected',
          rationale: 'Hides recovery context.',
        }],
      },
      walkthroughs: [{
        id: 'walkthrough.checkout',
        featureIds: ['feature.checkout'],
        flowIds: ['flow.checkout'],
        decisionIds: ['decision.guidance'],
        restartStateId: 'state.start',
        restartControlId: 'control.restart',
        restartAccessibility: ['Restart is keyboard reachable and returns focus to the walkthrough heading.'],
        whyBehaviorExists: 'Guidance makes recovery visible.',
        mockedBehavior: ['Payment always succeeds.'],
        limitations: ['No service call.'],
        steps: [{
          id: 'step.choose',
          overlay: 'Choose a payment option.',
          target: '#payment-options',
          interaction: 'Select one option.',
          expectedStateId: 'state.review',
          nextStepId: null,
          why: 'Selection enables review.',
          decisionIds: ['decision.guidance'],
          mockedBehavior: ['Selection is stored in memory.'],
          limitations: ['No persistence.'],
          accessibility: ['Focus moves to the review heading.'],
        }],
      }],
    }],
    selectedConceptId: 'concept.checkout-guided',
    interactionContract: { path: contractPath, digest: contractDigest },
  };

  const receipts = [
    receipt('discovery-aligned', { prototypeRevision, discoveryDigest }, 1),
    receipt('brand-aligned', { prototypeRevision, discoveryDigest, brandDigest }, 2),
    receipt('concept-selected', {
      prototypeRevision, discoveryDigest, brandDigest,
      conceptId: 'concept.checkout-guided', conceptDigest,
    }, 3),
    receipt('product-design-approved', {
      prototypeRevision, discoveryDigest, brandDigest,
      conceptId: 'concept.checkout-guided', conceptDigest,
      artifactSetDigest, interactionContractDigest: contractDigest,
    }, 4),
  ];
  const specialistObservations = [
    {
      schema: SPECIALIST_EVENT_SCHEMA,
      eventId: 'event.brand-start',
      role: 'brand-designer',
      contextId: 'brand.1',
      action: 'specialist-started',
      subjectId: 'checkout',
      prototypeRevision,
      artifactRevision: prototypeRevision,
      channel: 'trusted-dispatch-runtime',
      sourceId: 'dispatch-brand-1',
      observedAt: '2026-08-31T12:01:10Z',
      sequence: 1,
    },
    {
      schema: SPECIALIST_EVENT_SCHEMA,
      eventId: 'event.brand',
      role: 'brand-designer',
      contextId: 'brand.1',
      action: 'specialist-completed',
      subjectId: 'checkout',
      prototypeRevision,
      artifactRevision: brandDigest,
      channel: 'trusted-dispatch-runtime',
      sourceId: 'dispatch-brand-1',
      observedAt: '2026-08-31T12:01:50Z',
      sequence: 2,
    },
    {
      schema: SPECIALIST_EVENT_SCHEMA,
      eventId: 'event.ux-start',
      role: 'user-experience-designer',
      contextId: 'ux.1',
      action: 'specialist-started',
      subjectId: 'checkout',
      prototypeRevision,
      artifactRevision: brandDigest,
      channel: 'trusted-dispatch-runtime',
      sourceId: 'dispatch-ux-1',
      observedAt: '2026-08-31T12:02:10Z',
      sequence: 3,
    },
    {
      schema: SPECIALIST_EVENT_SCHEMA,
      eventId: 'event.ux',
      role: 'user-experience-designer',
      contextId: 'ux.1',
      action: 'specialist-completed',
      subjectId: 'checkout',
      prototypeRevision,
      artifactRevision: canonicalConceptSetRevision(packet.concepts, artifacts),
      channel: 'trusted-dispatch-runtime',
      sourceId: 'dispatch-ux-1',
      observedAt: '2026-08-31T12:02:50Z',
      sequence: 4,
    },
  ];
  const mergeObservation = {
    schema: MERGE_SCHEMA,
    provider: 'github',
    repository: 'jdylanmc/example',
    changeRequestId: '155',
    state: 'merged',
    destinationBranch: 'refs/heads/main',
    defaultBranch: 'refs/heads/main',
    revision: 'c'.repeat(40),
    artifactSetDigest,
    interactionContractDigest: contractDigest,
    mergedAt: '2026-08-31T13:00:00Z',
    provenance: { producer: 'publication-provider-workflow', sourceId: 'github-pr-155' },
  };
  const options = {
    repositoryRoot: root,
    humanReceipts: receipts,
    specialistObservations,
    mergeObservation,
    verifyHumanReceipt: () => true,
    verifySpecialistObservation: () => true,
    verifyMergeObservation: () => true,
    resolveExpectedRepository: () => 'jdylanmc/example',
    verifyGitAncestry: () => true,
    readMergedArtifact: (_repo, _revision, artifactPath) => files[artifactPath],
  };
  return {
    root, packet, receipts, specialistObservations, mergeObservation, options, files,
    values: { discoveryDigest, prototypeRevision, brandDigest, conceptDigest, artifactSetDigest, contractDigest },
  };
}

function errorCode(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof ApprovalBindingError) return error.code;
    throw error;
  }
}

function bindCurrentConceptRevision(value) {
  value.specialistObservations[3].artifactRevision = canonicalConceptSetRevision(
    value.packet.concepts,
    value.packet.artifactManifest,
  );
}

function addRejectedConcept(value) {
  const workspace = value.packet.workspace;
  const siteRoot = `${workspace}/concept-compact`;
  const added = siteFiles(value.root, siteRoot, 'Compact checkout');
  Object.assign(value.files, added);
  const artifactPaths = Object.keys(added);
  const concept = structuredClone(value.packet.concepts[0]);
  concept.id = 'concept.checkout-compact';
  concept.disposition = 'rejected';
  concept.dispositionRationale = 'Hides progress and recovery context.';
  concept.artifactPaths = artifactPaths;
  concept.packageJsonPath = `${siteRoot}/package.json`;
  concept.packageLockPath = `${siteRoot}/package-lock.json`;
  concept.htmlPath = `${siteRoot}/index.html`;
  concept.cssPath = `${siteRoot}/styles.css`;
  concept.javascriptPath = `${siteRoot}/app.js`;
  concept.digest = setDigest(artifactPaths.map((artifactPath) => ({ path: artifactPath, digest: sha(added[artifactPath]) })));
  concept.designSpace.alternatives = [];
  concept.accessibility = concept.accessibility.map((entry) => ({
    ...entry,
    id: entry.id.replace('concept-accessibility.', 'compact-accessibility.'),
    walkthroughIds: ['walkthrough.compact'],
    stepIds: ['step.compact'],
    evidencePath: `${siteRoot}/index.html`,
  }));
  concept.walkthroughs = concept.walkthroughs.map((walkthrough) => ({
    ...walkthrough,
    id: 'walkthrough.compact',
    steps: walkthrough.steps.map((step) => ({ ...step, id: 'step.compact' })),
  }));
  value.packet.concepts.push(concept);
  value.packet.artifactManifest.push(...artifactPaths.map((artifactPath) => ({
    path: artifactPath,
    digest: sha(added[artifactPath]),
  })));
  value.packet.artifactManifest.sort((a, b) => bytewise(a.path, b.path));
  bindCurrentConceptRevision(value);
  const artifactSetDigest = setDigest(value.packet.artifactManifest);
  value.receipts[3].artifactSetDigest = artifactSetDigest;
  value.mergeObservation.artifactSetDigest = artifactSetDigest;
  return concept;
}

function rewriteContract(value, mutate) {
  const relative = value.packet.interactionContract.path;
  const absolute = path.join(value.root, relative);
  const contract = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  mutate(contract);
  const bytes = `${JSON.stringify(contract, null, 2)}\n`;
  fs.writeFileSync(absolute, bytes);
  value.files[relative] = bytes;
  const entry = value.packet.artifactManifest.find(({ path: artifactPath }) => artifactPath === relative);
  entry.digest = sha(bytes);
  value.packet.interactionContract.digest = entry.digest;
  const artifactSetDigest = setDigest(value.packet.artifactManifest);
  value.receipts[3].artifactSetDigest = artifactSetDigest;
  value.receipts[3].interactionContractDigest = entry.digest;
  value.mergeObservation.artifactSetDigest = artifactSetDigest;
  value.mergeObservation.interactionContractDigest = entry.digest;
}

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

test('uses only the required canonical status vocabulary', () => {
  assert.deepEqual(STATUSES, [
    'needs-discovery', 'needs-brand-alignment', 'needs-concept-evidence',
    'needs-human-decision', 'needs-approval', 'approved', 'blocked', 'cancelled',
  ]);
  assert.deepEqual(STATUS_PRECEDENCE, [
    'cancelled', 'blocked', 'needs-discovery', 'needs-brand-alignment',
    'needs-concept-evidence', 'needs-human-decision', 'needs-approval', 'approved',
  ]);
});

test('canonical artifact ordering is locale-independent code-unit order', () => {
  const records = [
    { path: 'z', digest: '3'.repeat(64) },
    { path: 'ä', digest: '2'.repeat(64) },
    { path: 'A', digest: '1'.repeat(64) },
  ];
  const expected = sha(records
    .sort((left, right) => bytewise(left.path, right.path))
    .map((entry) => `${entry.path}\0${entry.digest}\n`)
    .join(''));
  assert.equal(canonicalArtifactSetDigest(records.reverse()), expected);
});

test('approves only with external receipts and trusted merged default-branch observation', () => {
  const fixtureData = fixture();
  const result = validateApprovalBinding(fixtureData.packet, fixtureData.options);
  assert.equal(result.status, 'approved');
  assert.equal(result.changeRequestId, '155');
  assert.equal(result.mergeRevision, 'c'.repeat(40));
  assert.equal(result.interactionContractPath, fixtureData.packet.interactionContract.path);
  assert.equal(sha(result.interactionContractBytes), result.interactionContractDigest);
  assert.equal(result.interactionContract.selectedConceptId, result.selectedConceptId);
  assert.deepEqual(result.selectedRunnableConcept, {
    root: 'docs/agent/prototypes/checkout/concept-guided',
    entrypoint: 'docs/agent/prototypes/checkout/concept-guided/index.html',
    humanRunCommand: 'npm --prefix docs/agent/prototypes/checkout/concept-guided start',
    ownedArtifactPaths: fixtureData.packet.concepts[0].artifactPaths.sort(bytewise),
    digest: fixtureData.values.conceptDigest,
    mergedBytesVerification: { revision: 'c'.repeat(40), exact: true },
    trust: 'untrusted-human-run-prototype',
  });
});

test('signed digest-chained runtime envelopes provide concrete fail-closed receipt adapters', () => {
  const data = fixture();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const trustedPublicKeys = new Map([['runtime-key-1', publicKey]]);
  data.options.verifyHumanReceipt = createHumanReceiptVerifier({
    envelopes: receiptEnvelopes(data.receipts, 'human-events', privateKey),
    trustedPublicKeys,
    streamId: 'human-events',
  });
  data.options.verifySpecialistObservation = createSpecialistEventVerifier({
    envelopes: receiptEnvelopes(data.specialistObservations, 'specialist-events', privateKey),
    trustedPublicKeys,
    streamId: 'specialist-events',
  });
  const exec = (command, args) => ({
    status: 0,
    stdout: command === 'git' ? 'git@github.com:jdylanmc/example.git\n' : JSON.stringify(args[0] === 'pr'
      ? {
        number: 155,
        state: 'MERGED',
        baseRefName: 'main',
        mergeCommit: { oid: 'c'.repeat(40) },
        mergedAt: '2026-08-31T13:00:00Z',
        url: 'https://github.com/jdylanmc/example/pull/155',
      }
      : { nameWithOwner: 'jdylanmc/example', defaultBranchRef: { name: 'main' } }),
  });
  data.options.verifyMergeObservation = createGitHubMergeVerifier({
    repositoryRoot: data.root,
    changeRequestId: '155',
  }, { exec });
  data.options.resolveExpectedRepository = createGitHubRepositoryResolver({ exec });
  assert.equal(validateApprovalBinding(data.packet, data.options).status, 'approved');

  const tampered = receiptEnvelopes(data.receipts, 'human-events', privateKey);
  tampered[1].previousDigest = '0'.repeat(64);
  assert.throws(() => createHumanReceiptVerifier({
    envelopes: tampered, trustedPublicKeys, streamId: 'human-events',
  }), /chain is invalid/);
});

test('official gh observation adapter proves merged target/default branch and revision', () => {
  const calls = [];
  const exec = (command, args) => {
    calls.push(args);
    if (command === 'git') return { status: 0, stdout: 'git@github.com:jdylanmc/example.git\n' };
    const payload = args[0] === 'pr'
      ? {
        number: 155,
        state: 'MERGED',
        baseRefName: 'main',
        mergeCommit: { oid: 'c'.repeat(40) },
        mergedAt: '2026-08-31T13:00:00Z',
        url: 'https://github.com/jdylanmc/example/pull/155',
      }
      : { nameWithOwner: 'jdylanmc/example', defaultBranchRef: { name: 'main' } };
    return { status: 0, stdout: JSON.stringify(payload) };
  };
  const request = {
    repositoryRoot: '/repo',
    changeRequestId: '155',
    artifactSetDigest: 'd'.repeat(64),
    interactionContractDigest: 'e'.repeat(64),
  };
  const observation = observeGitHubMerge(request, { exec, observedAt: '2026-08-31T13:00:00Z' });
  assert.equal(observation.state, 'merged');
  assert.equal(observation.destinationBranch, observation.defaultBranch);
  assert.equal(observation.revision, 'c'.repeat(40));
  assert.equal(createGitHubMergeVerifier(request, { exec })(observation), true);
  assert.ok(calls.some((args) => args[0] === 'pr' && args.includes('number,state,baseRefName,mergeCommit,mergedAt,url')));

  const openExec = (command, args) => ({
    status: 0,
    stdout: command === 'git' ? 'https://github.com/jdylanmc/example.git\n' : JSON.stringify(args[0] === 'pr'
      ? { number: 155, state: 'OPEN', baseRefName: 'main', mergeCommit: null, url: 'x' }
      : { nameWithOwner: 'jdylanmc/example', defaultBranchRef: { name: 'main' } }),
  });
  assert.throws(() => observeGitHubMerge(request, { exec: openExec }), /not observed merged/);

  const forkExec = (command, args) => ({
    status: 0,
    stdout: command === 'git'
      ? 'git@github.com:attacker/example.git\n'
      : JSON.stringify({ nameWithOwner: 'jdylanmc/example', defaultBranchRef: { name: 'main' } }),
  });
  assert.throws(() => observeGitHubMerge(request, { exec: forkExec }), /differs from the canonical origin remote/);
});

test('official provider observation plus ancestry and exact merged bytes reaches approved', () => {
  const data = fixture();
  const exec = (command, args) => ({
    status: 0,
    stdout: command === 'git' ? 'git@github.com:jdylanmc/example.git\n' : JSON.stringify(args[0] === 'pr'
      ? {
        number: 155,
        state: 'MERGED',
        baseRefName: 'main',
        mergeCommit: { oid: 'c'.repeat(40) },
        mergedAt: '2026-08-31T13:00:00Z',
        url: 'https://github.com/jdylanmc/example/pull/155',
      }
      : { nameWithOwner: 'jdylanmc/example', defaultBranchRef: { name: 'main' } }),
  });
  data.options.verifyMergeObservation = createGitHubMergeVerifier({
    repositoryRoot: data.root,
    changeRequestId: '155',
  }, { exec });
  data.options.resolveExpectedRepository = createGitHubRepositoryResolver({ exec });
  assert.equal(validateApprovalBinding(data.packet, data.options).status, 'approved');

  const unmergedExec = (command, args) => ({
    status: 0,
    stdout: command === 'git' ? 'git@github.com:jdylanmc/example.git\n' : JSON.stringify(args[0] === 'pr'
      ? { number: 155, state: 'OPEN', baseRefName: 'main', mergeCommit: null, url: 'x' }
      : { nameWithOwner: 'jdylanmc/example', defaultBranchRef: { name: 'main' } }),
  });
  data.options.verifyMergeObservation = createGitHubMergeVerifier({
    repositoryRoot: data.root,
    changeRequestId: '155',
  }, { exec: unmergedExec });
  assert.equal(errorCode(() => validateApprovalBinding(data.packet, data.options)), 'untrusted-merge');
});

test('packet claims cannot manufacture human authority', () => {
  const fixtureData = fixture();
  fixtureData.packet.finalApproval = { status: 'confirmed' };
  assert.equal(errorCode(() => validateApprovalBinding(fixtureData.packet, fixtureData.options)), 'invalid-input');

  const noEvidence = fixture();
  assert.equal(validateApprovalBinding(noEvidence.packet, { repositoryRoot: noEvidence.root }).status, 'needs-discovery');
});

test('reads and hashes exact Discovery bytes, rejecting stale, missing, symlinked, and escaping sources', () => {
  const stale = fixture();
  fs.appendFileSync(path.join(stale.root, stale.packet.discovery.locator), 'changed');
  assert.equal(errorCode(() => validateApprovalBinding(stale.packet, stale.options)), 'stale');

  const missing = fixture();
  fs.rmSync(path.join(missing.root, missing.packet.discovery.locator));
  assert.equal(errorCode(() => validateApprovalBinding(missing.packet, missing.options)), 'missing-source');

  const linked = fixture();
  const discovery = path.join(linked.root, linked.packet.discovery.locator);
  fs.renameSync(discovery, `${discovery}.real`);
  fs.symlinkSync(`${discovery}.real`, discovery);
  assert.equal(errorCode(() => validateApprovalBinding(linked.packet, linked.options)), 'unsafe-path');

  const escaping = fixture();
  escaping.packet.discovery.locator = '../checkout.md';
  assert.equal(errorCode(() => validateApprovalBinding(escaping.packet, escaping.options)), 'unsafe-path');
});

test('enumerates the complete workspace and rejects omissions, symlinks, and node_modules', () => {
  const omitted = fixture();
  fs.writeFileSync(path.join(omitted.root, omitted.packet.workspace, 'unexpected.txt'), 'surprise');
  assert.equal(errorCode(() => validateApprovalBinding(omitted.packet, omitted.options)), 'manifest-mismatch');

  const linked = fixture();
  fs.symlinkSync('index.html', path.join(linked.root, linked.packet.workspace, 'brand', 'linked.html'));
  assert.equal(errorCode(() => validateApprovalBinding(linked.packet, linked.options)), 'unsafe-path');

  const dependencies = fixture();
  fs.mkdirSync(path.join(dependencies.root, dependencies.packet.workspace, 'brand', 'node_modules'));
  assert.equal(errorCode(() => validateApprovalBinding(dependencies.packet, dependencies.options)), 'forbidden-artifact');
});

test('requires isolated npm and substantive Storybook/static sites with bounded scripts', () => {
  const unsafe = fixture();
  const packagePath = path.join(unsafe.root, unsafe.packet.brand.packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.scripts.start = 'node server.mjs && curl example.test';
  fs.writeFileSync(packagePath, JSON.stringify(packageJson));
  const entry = unsafe.packet.artifactManifest.find(({ path: artifactPath }) => artifactPath === unsafe.packet.brand.packageJsonPath);
  entry.digest = sha(fs.readFileSync(packagePath));
  unsafe.packet.brand.digest = setDigest(unsafe.packet.artifactManifest.filter(({ path: artifactPath }) => unsafe.packet.brand.artifactPaths.includes(artifactPath)));
  assert.equal(errorCode(() => validateApprovalBinding(unsafe.packet, unsafe.options)), 'unsafe-command');

  const story = fixture();
  fs.writeFileSync(path.join(story.root, story.packet.brand.storybookStoryPath), 'export default {};\n');
  const storyEntry = story.packet.artifactManifest.find(({ path: artifactPath }) => artifactPath === story.packet.brand.storybookStoryPath);
  storyEntry.digest = sha('export default {};\n');
  story.packet.brand.digest = setDigest(story.packet.artifactManifest.filter(({ path: artifactPath }) => story.packet.brand.artifactPaths.includes(artifactPath)));
  assert.equal(errorCode(() => validateApprovalBinding(story.packet, story.options)), 'invalid-site');

  for (const [script, command] of [
    ['prestart', 'http-server . -p 4173'],
    ['start', 'node --import=./hook.mjs server.mjs'],
    ['start', 'node -e "eval(process.argv[1])"'],
    ['start', 'node -r ./preload.cjs server.mjs'],
    ['start', 'node child_process.mjs'],
    ['start', 'node fs-server.mjs'],
    ['start', 'node network-server.mjs'],
    ['start', 'python3 -m http.server 4173'],
    ['start', 'http-server .. -p 4173'],
  ]) {
    const unsafeScript = fixture();
    const target = path.join(unsafeScript.root, unsafeScript.packet.concepts[0].packageJsonPath);
    const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
    manifest.scripts[script] = command;
    fs.writeFileSync(target, JSON.stringify(manifest));
    const manifestEntry = unsafeScript.packet.artifactManifest.find(({ path: artifactPath }) => artifactPath === unsafeScript.packet.concepts[0].packageJsonPath);
    manifestEntry.digest = sha(fs.readFileSync(target));
    unsafeScript.packet.concepts[0].digest = setDigest(unsafeScript.packet.artifactManifest.filter(({ path: artifactPath }) => unsafeScript.packet.concepts[0].artifactPaths.includes(artifactPath)));
    assert.equal(errorCode(() => validateApprovalBinding(unsafeScript.packet, unsafeScript.options)), 'unsafe-command');
  }
});

test('requires complete npm lock closure with generated-style package metadata', () => {
  const truncated = fixture();
  const lockPath = path.join(truncated.root, truncated.packet.brand.packageLockPath);
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.packages['node_modules/storybook'].dependencies = { missing: '1.0.0' };
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  const entry = truncated.packet.artifactManifest.find(({ path: artifactPath }) => artifactPath === truncated.packet.brand.packageLockPath);
  entry.digest = sha(fs.readFileSync(lockPath));
  truncated.packet.brand.digest = setDigest(truncated.packet.artifactManifest.filter(({ path: artifactPath }) => truncated.packet.brand.artifactPaths.includes(artifactPath)));
  assert.equal(errorCode(() => validateApprovalBinding(truncated.packet, truncated.options)), 'invalid-input');

  const versionOnly = fixture();
  const versionLockPath = path.join(versionOnly.root, versionOnly.packet.brand.packageLockPath);
  const versionLock = JSON.parse(fs.readFileSync(versionLockPath, 'utf8'));
  delete versionLock.packages['node_modules/storybook'].integrity;
  fs.writeFileSync(versionLockPath, JSON.stringify(versionLock));
  versionOnly.packet.artifactManifest.find(({ path: artifactPath }) => artifactPath === versionOnly.packet.brand.packageLockPath).digest = sha(fs.readFileSync(versionLockPath));
  versionOnly.packet.brand.digest = setDigest(versionOnly.packet.artifactManifest.filter(({ path: artifactPath }) => versionOnly.packet.brand.artifactPaths.includes(artifactPath)));
  assert.equal(errorCode(() => validateApprovalBinding(versionOnly.packet, versionOnly.options)), 'invalid-input');

  const extra = fixture();
  const extraLockPath = path.join(extra.root, extra.packet.brand.packageLockPath);
  const extraLock = JSON.parse(fs.readFileSync(extraLockPath, 'utf8'));
  extraLock.packages['node_modules/unreachable'] = {
    version: '1.0.0',
    resolved: 'https://registry.npmjs.org/unreachable/-/unreachable-1.0.0.tgz',
    integrity: 'sha512-dW5yZWFjaGFibGUtaW50ZWdyaXR5',
  };
  fs.writeFileSync(extraLockPath, JSON.stringify(extraLock));
  extra.packet.artifactManifest.find(({ path: artifactPath }) => artifactPath === extra.packet.brand.packageLockPath).digest = sha(fs.readFileSync(extraLockPath));
  extra.packet.brand.digest = setDigest(extra.packet.artifactManifest.filter(({ path: artifactPath }) => extra.packet.brand.artifactPaths.includes(artifactPath)));
  assert.equal(errorCode(() => validateApprovalBinding(extra.packet, extra.options)), 'invalid-site');

  const foreignRegistry = fixture();
  const foreignLockPath = path.join(foreignRegistry.root, foreignRegistry.packet.concepts[0].packageLockPath);
  const foreignLock = JSON.parse(fs.readFileSync(foreignLockPath, 'utf8'));
  foreignLock.packages['node_modules/http-server'].resolved = 'https://packages.example.test/http-server.tgz';
  fs.writeFileSync(foreignLockPath, JSON.stringify(foreignLock));
  foreignRegistry.packet.artifactManifest.find(({ path: artifactPath }) => artifactPath === foreignRegistry.packet.concepts[0].packageLockPath).digest = sha(fs.readFileSync(foreignLockPath));
  foreignRegistry.packet.concepts[0].digest = setDigest(foreignRegistry.packet.artifactManifest.filter(({ path: artifactPath }) => foreignRegistry.packet.concepts[0].artifactPaths.includes(artifactPath)));
  assert.equal(errorCode(() => validateApprovalBinding(foreignRegistry.packet, foreignRegistry.options)), 'invalid-site');
});

test('Storybook remains brand-root static configuration and concepts cannot import or carry stories', () => {
  for (const configBytes of [
    'import config from "/outside.js"; export default { stories: [config] };\n',
    'export default { stories: ["../../outside/*.stories.js"] };\n',
    'export default { stories: [import("../src/example.stories.js")] };\n',
  ]) {
    const data = fixture();
    fs.writeFileSync(path.join(data.root, data.packet.brand.storybookConfigPath), configBytes);
    data.packet.artifactManifest.find(({ path: artifactPath }) => artifactPath === data.packet.brand.storybookConfigPath).digest = sha(configBytes);
    data.packet.brand.digest = setDigest(data.packet.artifactManifest.filter(({ path: artifactPath }) => data.packet.brand.artifactPaths.includes(artifactPath)));
    assert.equal(errorCode(() => validateApprovalBinding(data.packet, data.options)), 'invalid-site');
  }

  const conceptStory = fixture();
  const storyPath = `${path.posix.dirname(conceptStory.packet.concepts[0].packageJsonPath)}/src/illegal.stories.js`;
  const storyBytes = 'export default { title: "Illegal" };\n';
  fs.mkdirSync(path.dirname(path.join(conceptStory.root, storyPath)), { recursive: true });
  fs.writeFileSync(path.join(conceptStory.root, storyPath), storyBytes);
  conceptStory.packet.concepts[0].artifactPaths.push(storyPath);
  conceptStory.packet.artifactManifest.push({ path: storyPath, digest: sha(storyBytes) });
  conceptStory.packet.artifactManifest.sort((a, b) => bytewise(a.path, b.path));
  conceptStory.packet.concepts[0].digest = setDigest(conceptStory.packet.artifactManifest.filter(({ path: artifactPath }) => conceptStory.packet.concepts[0].artifactPaths.includes(artifactPath)));
  assert.equal(errorCode(() => validateApprovalBinding(conceptStory.packet, conceptStory.options)), 'invalid-site');

  const extraBrandStory = fixture();
  const extraStoryPath = `${path.posix.dirname(extraBrandStory.packet.brand.storybookStoryPath)}/extra.stories.js`;
  const extraStoryBytes = 'export default { title: "Extra" }; export const View = { render: () => "x" };\n';
  fs.writeFileSync(path.join(extraBrandStory.root, extraStoryPath), extraStoryBytes);
  extraBrandStory.packet.brand.artifactPaths.push(extraStoryPath);
  extraBrandStory.packet.artifactManifest.push({ path: extraStoryPath, digest: sha(extraStoryBytes) });
  extraBrandStory.packet.artifactManifest.sort((a, b) => bytewise(a.path, b.path));
  extraBrandStory.packet.brand.digest = setDigest(extraBrandStory.packet.artifactManifest.filter(({ path: artifactPath }) => extraBrandStory.packet.brand.artifactPaths.includes(artifactPath)));
  assert.equal(errorCode(() => validateApprovalBinding(extraBrandStory.packet, extraBrandStory.options)), 'invalid-site');
});

test('requires brand outputs, Design Space evidence, walkthrough explanations, limitations, restart and accessibility', () => {
  const brand = fixture();
  brand.packet.brand.outputs.palette = [];
  assert.equal(errorCode(() => validateApprovalBinding(brand.packet, brand.options)), 'incomplete');

  const design = fixture();
  design.packet.concepts[0].designSpace.stopRationale = '';
  assert.equal(errorCode(() => validateApprovalBinding(design.packet, design.options)), 'invalid-input');

  const walkthrough = fixture();
  walkthrough.packet.concepts[0].walkthroughs[0].steps[0].limitations = [];
  assert.equal(errorCode(() => validateApprovalBinding(walkthrough.packet, walkthrough.options)), 'incomplete');

  const navigation = fixture();
  navigation.packet.concepts[0].walkthroughs[0].steps[0].nextStepId = 'step.missing';
  bindCurrentConceptRevision(navigation);
  assert.equal(errorCode(() => validateApprovalBinding(navigation.packet, navigation.options)), 'cross-reference');
});

test('parses the exact interaction contract and rejects missing fields and broken cross-references', () => {
  const malformed = fixture();
  fs.writeFileSync(path.join(malformed.root, malformed.packet.interactionContract.path), 'not json');
  const entry = malformed.packet.artifactManifest.find(({ path: artifactPath }) => artifactPath === malformed.packet.interactionContract.path);
  entry.digest = sha('not json');
  malformed.packet.interactionContract.digest = entry.digest;
  assert.equal(errorCode(() => validateApprovalBinding(malformed.packet, malformed.options)), 'invalid-artifact');

  const broken = fixture();
  const contractPath = path.join(broken.root, broken.packet.interactionContract.path);
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  contract.accessibility[0].featureIds = ['feature.unknown'];
  const bytes = `${JSON.stringify(contract)}\n`;
  fs.writeFileSync(contractPath, bytes);
  const brokenEntry = broken.packet.artifactManifest.find(({ path: artifactPath }) => artifactPath === broken.packet.interactionContract.path);
  brokenEntry.digest = sha(bytes);
  broken.packet.interactionContract.digest = brokenEntry.digest;
  assert.equal(errorCode(() => validateApprovalBinding(broken.packet, broken.options)), 'cross-reference');
});

test('plain receipt JSON and fabricated specialist IDs cannot cross trusted boundaries', () => {
  const receipts = fixture();
  delete receipts.options.verifyHumanReceipt;
  assert.equal(errorCode(() => validateApprovalBinding(receipts.packet, receipts.options)), 'untrusted-human-receipt');

  const specialists = fixture();
  specialists.options.verifySpecialistObservation = () => false;
  assert.equal(errorCode(() => validateApprovalBinding(specialists.packet, specialists.options)), 'untrusted-specialist-event');

  const reused = fixture();
  reused.specialistObservations[2].contextId = reused.specialistObservations[0].contextId;
  assert.equal(errorCode(() => validateApprovalBinding(reused.packet, reused.options)), 'invalid-evidence');

  const outOfOrder = fixture();
  outOfOrder.specialistObservations[1].sequence = 0;
  assert.equal(errorCode(() => validateApprovalBinding(outOfOrder.packet, outOfOrder.options)), 'invalid-evidence');
});

test('UX specialist start and completion are strictly after trusted brand alignment', () => {
  const noReceipt = fixture();
  noReceipt.options.humanReceipts = noReceipt.receipts.slice(0, 1);
  noReceipt.packet.concepts = [];
  noReceipt.packet.selectedConceptId = null;
  noReceipt.packet.interactionContract = null;
  noReceipt.options.mergeObservation = null;
  assert.equal(errorCode(() => validateApprovalBinding(noReceipt.packet, noReceipt.options)), 'brand-not-aligned');

  const earlyStart = fixture();
  earlyStart.specialistObservations[2].observedAt = earlyStart.receipts[1].observedAt;
  assert.equal(errorCode(() => validateApprovalBinding(earlyStart.packet, earlyStart.options)), 'invalid-evidence');

  const earlyCompletion = fixture();
  earlyCompletion.specialistObservations[3].observedAt = earlyCompletion.specialistObservations[2].observedAt;
  assert.equal(errorCode(() => validateApprovalBinding(earlyCompletion.packet, earlyCompletion.options)), 'invalid-evidence');

  const sharedSequence = fixture();
  sharedSequence.specialistObservations[2].sequence = sharedSequence.specialistObservations[1].sequence;
  assert.equal(validateApprovalBinding(sharedSequence.packet, sharedSequence.options).status, 'approved');
  sharedSequence.specialistObservations[2].observedAt = sharedSequence.specialistObservations[1].observedAt;
  assert.equal(errorCode(() => validateApprovalBinding(sharedSequence.packet, sharedSequence.options)), 'invalid-evidence');
});

test('every trusted causal boundary rejects timestamp reversal or equality', () => {
  const cases = [
    (value) => { value.receipts[1].observedAt = value.specialistObservations[1].observedAt; },
    (value) => { value.specialistObservations[2].observedAt = value.receipts[1].observedAt; },
    (value) => { value.specialistObservations[3].observedAt = value.specialistObservations[2].observedAt; },
    (value) => { value.receipts[2].observedAt = value.specialistObservations[3].observedAt; },
    (value) => { value.receipts[3].observedAt = value.receipts[2].observedAt; },
    (value) => { value.mergeObservation.mergedAt = value.receipts[3].observedAt; },
  ];
  for (const reverse of cases) {
    const value = fixture();
    reverse(value);
    assert.ok(['invalid-evidence', 'invalid-merge'].includes(errorCode(() => validateApprovalBinding(value.packet, value.options))));
  }
});

test('typed references and concept-to-contract mappings reject swaps and omissions', () => {
  const swapped = fixture();
  const contractPath = path.join(swapped.root, swapped.packet.interactionContract.path);
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  contract.walkthroughs[0].featureIds = ['flow.checkout'];
  const bytes = `${JSON.stringify(contract)}\n`;
  fs.writeFileSync(contractPath, bytes);
  swapped.packet.artifactManifest.find(({ path: p }) => p === swapped.packet.interactionContract.path).digest = sha(bytes);
  swapped.packet.interactionContract.digest = sha(bytes);
  assert.equal(errorCode(() => validateApprovalBinding(swapped.packet, swapped.options)), 'cross-reference');

  const mapping = fixture();
  const mappingPath = path.join(mapping.root, mapping.packet.interactionContract.path);
  const mapped = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  mapped.walkthroughs[0].stepIds = [];
  const mappedBytes = `${JSON.stringify(mapped)}\n`;
  fs.writeFileSync(mappingPath, mappedBytes);
  mapping.packet.artifactManifest.find(({ path: p }) => p === mapping.packet.interactionContract.path).digest = sha(mappedBytes);
  mapping.packet.interactionContract.digest = sha(mappedBytes);
  assert.equal(errorCode(() => validateApprovalBinding(mapping.packet, mapping.options)), 'incomplete');
});

test('concept accessibility is structured, artifact-owned, and exactly mapped by the contract', () => {
  const prose = fixture();
  prose.packet.concepts[0].accessibility = ['keyboard'];
  assert.equal(errorCode(() => validateApprovalBinding(prose.packet, prose.options)), 'invalid-input');

  const wrongArtifact = fixture();
  wrongArtifact.packet.concepts[0].accessibility[0].evidencePath = wrongArtifact.packet.brand.htmlPath;
  assert.equal(errorCode(() => validateApprovalBinding(wrongArtifact.packet, wrongArtifact.options)), 'cross-reference');

  const missingCategory = fixture();
  missingCategory.packet.concepts[0].accessibility.pop();
  assert.equal(errorCode(() => validateApprovalBinding(missingCategory.packet, missingCategory.options)), 'incomplete');

  const contractMismatch = fixture();
  const contractPath = path.join(contractMismatch.root, contractMismatch.packet.interactionContract.path);
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  contract.accessibility[0].conceptEvidenceId = contract.accessibility[1].conceptEvidenceId;
  const bytes = `${JSON.stringify(contract)}\n`;
  fs.writeFileSync(contractPath, bytes);
  contractMismatch.packet.artifactManifest.find(({ path: p }) => p === contractMismatch.packet.interactionContract.path).digest = sha(bytes);
  contractMismatch.packet.interactionContract.digest = sha(bytes);
  assert.equal(errorCode(() => validateApprovalBinding(contractMismatch.packet, contractMismatch.options)), 'cross-reference');
});

test('typed concept alternatives require exact contract disposition and rationale coverage', () => {
  const prose = fixture();
  prose.packet.concepts[0].designSpace.alternatives = ['compact'];
  assert.equal(errorCode(() => validateApprovalBinding(prose.packet, prose.options)), 'invalid-input');

  const omitted = fixture();
  omitted.packet.concepts[0].designSpace.alternatives = [];
  bindCurrentConceptRevision(omitted);
  assert.equal(errorCode(() => validateApprovalBinding(omitted.packet, omitted.options)), 'cross-reference');

  const rationale = fixture();
  rationale.packet.concepts[0].designSpace.alternatives[0].rationale = 'Different rationale.';
  bindCurrentConceptRevision(rationale);
  assert.equal(errorCode(() => validateApprovalBinding(rationale.packet, rationale.options)), 'cross-reference');
});

test('two concepts fail when the rejected nonselected concept is absent from contract alternatives', () => {
  const data = fixture();
  addRejectedConcept(data);
  assert.equal(errorCode(() => validateApprovalBinding(data.packet, data.options)), 'cross-reference');
});

test('one selected concept with no alternatives is valid and invalid dispositions are refused', () => {
  const single = fixture();
  single.packet.concepts[0].designSpace.alternatives = [];
  bindCurrentConceptRevision(single);
  rewriteContract(single, (contract) => { contract.alternatives = []; });
  assert.equal(validateApprovalBinding(single.packet, single.options).status, 'approved');

  const invalid = fixture();
  invalid.packet.concepts[0].designSpace.alternatives[0].disposition = 'maybe';
  assert.equal(errorCode(() => validateApprovalBinding(invalid.packet, invalid.options)), 'invalid-input');
});

test('changing concept metadata while retaining UX completion evidence fails', () => {
  const changed = fixture();
  changed.packet.concepts[0].designSpace.stopRationale = 'Changed after completion.';
  assert.equal(errorCode(() => validateApprovalBinding(changed.packet, changed.options)), 'invalid-evidence');
});

test('site roots and artifact ownership are isolated and lockfiles agree', () => {
  const shared = fixture();
  shared.packet.concepts[0].artifactPaths.push(shared.packet.brand.htmlPath);
  assert.equal(errorCode(() => validateApprovalBinding(shared.packet, shared.options)), 'invalid-site');

  const lock = fixture();
  const lockPath = path.join(lock.root, lock.packet.brand.packageLockPath);
  const lockJson = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lockJson.version = '2.0.0';
  fs.writeFileSync(lockPath, JSON.stringify(lockJson));
  const bytes = fs.readFileSync(lockPath);
  lock.packet.artifactManifest.find(({ path: p }) => p === lock.packet.brand.packageLockPath).digest = sha(bytes);
  lock.packet.brand.digest = setDigest(lock.packet.artifactManifest.filter(({ path: p }) => lock.packet.brand.artifactPaths.includes(p)));
  assert.equal(errorCode(() => validateApprovalBinding(lock.packet, lock.options)), 'invalid-site');

  const unlocked = fixture();
  const packagePath = path.join(unlocked.root, unlocked.packet.concepts[0].packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.dependencies = { example: '1.2.3' };
  fs.writeFileSync(packagePath, JSON.stringify(packageJson));
  const packageBytes = fs.readFileSync(packagePath);
  unlocked.packet.artifactManifest.find(({ path: p }) => p === unlocked.packet.concepts[0].packageJsonPath).digest = sha(packageBytes);
  unlocked.packet.concepts[0].digest = setDigest(unlocked.packet.artifactManifest.filter(({ path: p }) => unlocked.packet.concepts[0].artifactPaths.includes(p)));
  assert.equal(errorCode(() => validateApprovalBinding(unlocked.packet, unlocked.options)), 'invalid-site');
});

test('unmerged commits, untrusted observations, wrong destinations, and ancestry failures never approve', () => {
  const unmerged = fixture();
  unmerged.mergeObservation.state = 'open';
  assert.equal(errorCode(() => validateApprovalBinding(unmerged.packet, unmerged.options)), 'invalid-merge');

  const untrusted = fixture();
  untrusted.options.verifyMergeObservation = () => false;
  assert.equal(errorCode(() => validateApprovalBinding(untrusted.packet, untrusted.options)), 'untrusted-merge');

  const wrongBranch = fixture();
  wrongBranch.mergeObservation.destinationBranch = 'refs/heads/release';
  assert.equal(errorCode(() => validateApprovalBinding(wrongBranch.packet, wrongBranch.options)), 'invalid-merge');

  const ancestry = fixture();
  ancestry.options.verifyGitAncestry = () => false;
  assert.equal(errorCode(() => validateApprovalBinding(ancestry.packet, ancestry.options)), 'invalid-merge');

  const fork = fixture();
  fork.mergeObservation.repository = 'attacker/example';
  fork.options.verifyMergeObservation = () => true;
  assert.equal(errorCode(() => validateApprovalBinding(fork.packet, fork.options)), 'invalid-merge');
});

test('resolves lifecycle statuses in deterministic gate order', () => {
  const cancelled = fixture();
  cancelled.packet.cancelled = true;
  assert.equal(validateApprovalBinding(cancelled.packet, cancelled.options).status, 'cancelled');

  const discovery = fixture();
  discovery.options.humanReceipts = [];
  discovery.options.mergeObservation = null;
  assert.equal(validateApprovalBinding(discovery.packet, discovery.options).status, 'needs-discovery');

  const brand = fixture();
  brand.packet.concepts = [];
  brand.packet.selectedConceptId = null;
  brand.packet.interactionContract = null;
  brand.options.humanReceipts = brand.receipts.slice(0, 1);
  brand.options.specialistObservations = brand.specialistObservations.slice(0, 2);
  brand.options.mergeObservation = null;
  assert.equal(validateApprovalBinding(brand.packet, brand.options).status, 'needs-brand-alignment');

  const concepts = fixture();
  concepts.packet.concepts = [];
  concepts.packet.selectedConceptId = null;
  concepts.packet.interactionContract = null;
  concepts.options.humanReceipts = concepts.receipts.slice(0, 2);
  concepts.options.mergeObservation = null;
  assert.equal(validateApprovalBinding(concepts.packet, concepts.options).status, 'needs-concept-evidence');

  const decision = fixture();
  decision.packet.selectedConceptId = null;
  decision.packet.interactionContract = null;
  decision.options.humanReceipts = decision.receipts.slice(0, 2);
  decision.options.mergeObservation = null;
  assert.equal(validateApprovalBinding(decision.packet, decision.options).status, 'needs-human-decision');

  const approval = fixture();
  approval.options.humanReceipts = approval.receipts.slice(0, 3);
  approval.options.mergeObservation = null;
  assert.equal(validateApprovalBinding(approval.packet, approval.options).status, 'needs-approval');
});
