/**
 * The output contract Skill Sniper asks Synthesize for, and the check on what
 * comes back.
 *
 * Skill Sniper does not reduce source text. Bounded reduction with a disclosure
 * ledger is Synthesize's job, and duplicating it here would produce a second
 * synthesizer with its own quiet rules - exactly the thing the ledger exists to
 * prevent. What Skill Sniper owns is the *request*: what the smaller artifact
 * has to be, and what a usable answer looks like.
 *
 * This seam is small on purpose, and it earns its place twice. Synthesize
 * requires the desired result to be stated in full, so something has to state
 * it. And the words that come back are shown to a human for a byte-exact
 * confirmation, so something has to prove they are a reduction of the artifact
 * this run bound and not of anything else. Everything beyond those two jobs
 * belongs to the provider.
 *
 * An earlier version of this unit did something else entirely. It treated a
 * phrase from the operator's own intent as a machine identifier, probed the
 * provider's frontmatter for a declaration of it, and stopped the run when it
 * could not find one. That was wrong twice over: it made the run's outcome
 * depend on the *shape of the provider's document* rather than on anything about
 * the work, and it needed a Markdown-then-YAML reader that was defeated four
 * times running. The probe and its parser are deleted, and the class of bug goes
 * with them. Nothing here detects anything.
 */

import { createHash } from 'node:crypto';

/** The one skill allowed to have produced the reduction. */
export const SYNTHESIS_PROVIDER = 'synthesize';

export const REQUEST_FAILURES = {
  usage: 'usage',
  localSynthesisForbidden: 'local_synthesis_forbidden',
  substitutionForbidden: 'substitution_forbidden',
  unaccountedReduction: 'unaccounted_reduction',
  sourceMismatch: 'source_mismatch',
  candidateMismatch: 'candidate_mismatch',
  outcomeNotComplete: 'outcome_not_complete',
};

export class IntentRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntentRequestError';
    this.code = code;
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const DECLARED_ID = /^declared:[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The result Skill Sniper asks for: the source skill's human intent, written as
 * plain requirements a person can read, confirm, and be held to.
 *
 * The words are chosen for the two things the result has to survive. An operator
 * confirms them byte for byte, so they have to be readable as requirements
 * rather than as a description of a package. And the destination's own
 * skill-creation workflow takes them as its input, so they have to be the kind
 * of thing that workflow can build from.
 *
 * Every term is stated because the provider requires every term to be stated.
 * That is deliberate on both sides: a caller that will not say what the smaller
 * artifact must contain has not chosen a result, and a result nobody chose is one
 * nobody can be held to afterwards.
 *
 * `requiredContent` names meaning rather than document furniture, and the source
 * path and revision are deliberately absent from it. Requirements that named
 * their own source file would be a machine-facing document instead of plain
 * requirements, and would prove nothing anyway: traceability is proved by the
 * disclosure ledger, which anchors every retained claim to exact source material.
 *
 * `structuralHeadings` is an exemption list, not a template. Existing intent
 * files differ from one another, and a candidate is a proposal a human reshapes,
 * so imposing an outline here would impose it on the wrong artifact at the wrong
 * moment.
 *
 * `wordBudget` is five hundred, and it is a hard maximum over the COMPLETE
 * candidate - every heading, marker, and link included, because a limit that
 * ignored part of the document could always be met by moving text into the part
 * it ignored. The traceability this reduction is judged on does not compete for
 * that budget: the disclosure ledger, the source identity, and the revision all
 * live outside the candidate, so nothing is squeezed out of the requirements to
 * make room for evidence about them.
 *
 * When the essential intent will not fit, the provider refuses and proposes a
 * bounded split. It does not truncate the tail and it does not blur a refusal or
 * a constraint into a vaguer sentence, because both produce a document that
 * still looks like requirements and no longer commits anybody to anything.
 */
export const INTENT_OUTPUT_CONTRACT = Object.freeze({
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

/**
 * Whether the terms a run reports obeying are the terms that were sent. A plain
 * structural comparison over the terms this package stated - not a
 * reimplementation of the provider's contract digest, which would be a second
 * opinion about what a contract is.
 */
function sameTerms(reported, stated) {
  if (!reported || typeof reported !== 'object' || Array.isArray(reported)) return false;
  const keys = Object.keys(stated);
  // Own enumerable keys, exactly. Counting keys and then reading through the
  // prototype accepted an object carrying the right NUMBER of junk own keys and
  // inheriting the expected ones - terms that are not on the object at all.
  if (Object.keys(reported).length !== keys.length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(reported, key)) return false;
    const a = reported[key];
    const b = stated[key];
    if (Array.isArray(b)) {
      if (!Array.isArray(a) || a.length !== b.length) return false;
      // Index-wise, as own properties. `Array.prototype.every` skips the holes
      // of a sparse array such as `Array(4)` and would accept one vacuously - a
      // list that constrains nothing wearing the shape of a list that does.
      for (let index = 0; index < b.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(a, index) || a[index] !== b[index]) return false;
      }
      continue;
    }
    if (a !== b) return false;
  }
  return true;
}

/**
 * The identity of one attempt.
 *
 * A run does not get one shot at this. The operator reads the proposed
 * requirements, and when they are wrong he corrects them and the reduction is
 * asked for again - which is the whole reason the confirmation gate exists.
 *
 * Every attempt therefore gets its own bundle and its own candidate. That is not
 * bookkeeping: Synthesize refuses to overwrite a candidate it has already
 * written, so a second attempt reusing the first attempt's path is refused with
 * `replacement-not-authorized` and the correction loop cannot turn. The fix is
 * to give each attempt a distinct identity, never to relax the provider's
 * no-overwrite boundary - which is also what leaves every superseded proposal on
 * disk beside the one that was confirmed, so what the operator rejected is still
 * readable afterwards.
 *
 * Attempt one is numbered like the rest. A special case for the first attempt is
 * exactly where this bug would grow back.
 */
function attemptSlug(slug, runId, attempt) {
  if (typeof slug !== 'string' || !SLUG.test(slug)
    || typeof runId !== 'string' || !SLUG.test(runId)) return null;
  // Safe integers only. Past `Number.MAX_SAFE_INTEGER` two distinct attempt
  // numbers stringify identically, so two attempts would derive one path - the
  // exact collision this identity exists to prevent, reached by arithmetic
  // rather than by reuse.
  if (!Number.isSafeInteger(attempt) || attempt < 1) return null;
  // Length-prefix both variable-width slugs. Plain hyphen concatenation is
  // ambiguous: (`demo`, `run-1`) and (`demo-run`, `1`) otherwise name the same
  // immutable output. The encoded tuple remains a valid provider slug while
  // making distinct requests distinct without relying on parsing heuristics.
  return `s${slug.length}-${slug}-r${runId.length}-${runId}-a${attempt}`;
}

function attemptPaths(slug, runId, attempt) {
  const identity = attemptSlug(slug, runId, attempt);
  if (identity === null) return null;
  const { workspaceRoot, sourceKind, outputPattern } = INTENT_OUTPUT_CONTRACT;
  const suffix = sourceKind.split('-').slice(1).join('-');
  return {
    identity,
    source: `${workspaceRoot}${identity}.${suffix}.md`,
    candidate: outputPattern.replace('<slug>', identity),
  };
}

/**
 * Build the request handed to the provider.
 *
 * Every part is explicit, because every implicit part is a place the wrong thing
 * gets reduced: the contract is stated in full, the one assembled bundle is
 * named, and the revision is the digest intake pinned rather than a label the
 * caller chose. There is no "reduce this however you like" form of this call.
 *
 * The bundle must be one `<slug>.bundle.md` directly beneath the contract's own
 * workspace, because that is the only shape whose candidate is predictable - and
 * predicting the candidate is how the result gets bound back to the request.
 */
export function buildIntentRequest({ binding, slug, runId, attempt } = {}) {
  if (!binding || typeof binding.digest !== 'string' || !SHA256.test(binding.digest)) {
    throw new IntentRequestError(REQUEST_FAILURES.usage, 'binding must be the bound source evidence');
  }
  const paths = attemptPaths(slug, runId, attempt);
  if (paths === null) {
    throw new IntentRequestError(
      REQUEST_FAILURES.usage,
      `an attempt needs identifier slugs for the subject and run plus an attempt number from 1; "${slug}"/"${runId}"/"${attempt}" is not one`,
    );
  }
  return {
    skill: SYNTHESIS_PROVIDER,
    want: INTENT_OUTPUT_CONTRACT,
    slug,
    runId,
    attempt,
    source: paths.source,
    candidate: paths.candidate,
    // The revision is the digest intake pinned, and it does NOT change between
    // attempts. A correction changes what is asked for, never which bytes are
    // being reduced: every attempt in a run reduces the same bound source, and
    // that is what lets the run report one source identity for all of them.
    revision: binding.digest,
  };
}

/**
 * Judge the result, and refuse the two shortcuts a difficult reduction invites.
 *
 * The first shortcut is for Skill Sniper to reduce the source itself. The second
 * is to accept a reduction of something else - another contract, another
 * artifact, or a run that refused - because it looks confirmable. Both produce a
 * statement no disclosure ledger accounts for, which is worse than stopping,
 * because the operator would confirm it.
 *
 * This is a **shape check on the result record**, and saying so matters. It
 * cannot authenticate that `synthesize` produced the record: there is no signed
 * provenance to check against. What it does catch is the realistic failure - a
 * reduction of the wrong bytes, under the wrong contract, of a run that did not
 * complete, or accompanied by an account of a different artifact.
 *
 * Exactly one digest is recomputed here: the candidate's, over the bytes the
 * operator is about to be shown. Those bytes are this package's own obligation.
 * The ledger digest is required but never recomputed - the canonicalisation
 * behind it belongs to the provider, and reimplementing it would be the second
 * synthesizer this unit exists to refuse.
 */
export function assertIntentResult(record, binding, request) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new IntentRequestError(REQUEST_FAILURES.usage, 'record must be an object');
  }
  if (!binding || typeof binding.digest !== 'string') {
    throw new IntentRequestError(REQUEST_FAILURES.usage, 'binding must be the bound source evidence');
  }
  // The request is REBUILT and compared, not shape-checked.
  //
  // Checking its shape let a request be assembled by hand: one naming attempt
  // two while carrying attempt one's paths accepted attempt one's result and
  // reported it as attempt two, so a superseded proposal could be presented as
  // the corrected one. Recognising a request by its parts and rederiving the
  // rest from them removes the gap between what a request says and what it
  // carries - there is nothing left to disagree about.
  //
  // Rebuilding also keeps transport working. A request that crossed a process
  // boundary - serialized, handed to a subprocess, read back - rebuilds
  // identically, and refusing it for having been transported would refuse the
  // ordinary way this call is actually made.
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new IntentRequestError(REQUEST_FAILURES.usage, 'request must be the one buildIntentRequest produced');
  }
  let canonical;
  try {
    canonical = buildIntentRequest({
      binding,
      slug: request.slug,
      runId: request.runId,
      attempt: request.attempt,
    });
  } catch {
    throw new IntentRequestError(REQUEST_FAILURES.usage, 'request must be the one buildIntentRequest produced');
  }
  for (const field of ['skill', 'slug', 'attempt', 'source', 'candidate', 'revision']) {
    if (request[field] !== canonical[field]) {
      throw new IntentRequestError(REQUEST_FAILURES.usage, `request field ${field} is not what this run asked for`);
    }
  }
  if (!sameTerms(request.want, INTENT_OUTPUT_CONTRACT)) {
    throw new IntentRequestError(REQUEST_FAILURES.usage, 'request must be the one buildIntentRequest produced');
  }
  if (record.synthesizedBy !== SYNTHESIS_PROVIDER) {
    throw new IntentRequestError(
      REQUEST_FAILURES.localSynthesisForbidden,
      `synthesis belongs to ${SYNTHESIS_PROVIDER}; "${record.synthesizedBy}" is not it`,
    );
  }
  // The terms the run reports obeying must be the terms this request stated.
  //
  // The provider identifies a declared contract by a digest of its own terms.
  // This package does not recompute that digest: the canonicalisation is the
  // provider's, and a second implementation of it here could disagree about what
  // a contract is. So the substantive question is asked directly instead - were
  // my terms the terms obeyed? - by comparing the echoed terms with the ones
  // sent. `profileId` is then carried as the provider's own opaque label for
  // them, required to be present and agreed with by the ledger, never derived.
  if (!sameTerms(record.contractTerms, request.want)) {
    throw new IntentRequestError(
      REQUEST_FAILURES.substitutionForbidden,
      'the result reports contract terms this request did not state',
    );
  }
  // The provider identifies a run-time contract as `declared:` and the digest of
  // its own terms. A record echoing this request's terms while reporting a NAMED
  // profile is self-contradictory: a named profile is a settled contract with
  // different terms, so one of the two claims is false either way.
  if (!DECLARED_ID.test(String(record.profileId))) {
    throw new IntentRequestError(
      REQUEST_FAILURES.substitutionForbidden,
      `a run-time contract is identified as declared:<digest>; the record reports "${record.profileId}"`,
    );
  }
  if (record.status !== 'complete') {
    throw new IntentRequestError(
      REQUEST_FAILURES.outcomeNotComplete,
      `the reduction reports "${record.status}"; only a complete reduction carries an intent to confirm`,
    );
  }
  if (record.sourceDigest !== binding.digest) {
    throw new IntentRequestError(
      REQUEST_FAILURES.sourceMismatch,
      `the reduction names source ${record.sourceDigest}; this run bound ${binding.digest}`,
    );
  }
  const candidatePath = typeof record.candidatePath === 'string'
    ? record.candidatePath.split('\\').join('/')
    : null;
  if (candidatePath !== canonical.candidate) {
    throw new IntentRequestError(
      REQUEST_FAILURES.substitutionForbidden,
      `this request asks for ${canonical.candidate}; the record names "${record.candidatePath}"`,
    );
  }
  if (typeof record.intentText !== 'string' || record.intentText.trim() === '') {
    throw new IntentRequestError(REQUEST_FAILURES.candidateMismatch, 'the reduction carries no candidate text to confirm');
  }
  if (typeof record.candidateDigest !== 'string' || !SHA256.test(record.candidateDigest)) {
    throw new IntentRequestError(REQUEST_FAILURES.candidateMismatch, 'the reduction carries no candidate digest');
  }
  const observed = createHash('sha256').update(record.intentText, 'utf8').digest('hex');
  if (observed !== record.candidateDigest) {
    throw new IntentRequestError(
      REQUEST_FAILURES.candidateMismatch,
      `the candidate digest names ${record.candidateDigest}; the text supplied digests to ${observed}`,
    );
  }
  // The ledger must be a clean account OF THIS candidate under THIS contract. An
  // account of something else is worse than none: it looks like an account and
  // reads like approval.
  const ledger = record.ledger;
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)
    || ledger.status !== 'clean'
    || ledger.profileId !== record.profileId
    || typeof ledger.digest !== 'string' || !SHA256.test(ledger.digest)
    || ledger.candidatePath !== record.candidatePath
    || ledger.candidateDigest !== record.candidateDigest
    || !Array.isArray(ledger.entries) || ledger.entries.length === 0
    || !ledger.entries.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
      && isNonEmptyString(entry.id))) {
    throw new IntentRequestError(
      REQUEST_FAILURES.unaccountedReduction,
      'this reduction requires a clean disclosure ledger for this candidate under this contract',
    );
  }
  return {
    permitted: true,
    attempt: canonical.attempt,
    contractId: record.profileId,
    sourceDigest: binding.digest,
    candidatePath,
    candidateDigest: observed,
    ledgerDigest: ledger.digest,
    ledgerAuthenticated: false,
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}
