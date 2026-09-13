import { createHash } from 'node:crypto';

export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) {
    throw new Error('expected a short alphanumeric identifier');
  }
  return value;
}

const protectedComponents = new Set([
  '.git', '.bench', '.skill-log', '.copilot', '.user', '.test-sandbox', '.ship-with-squadron', 'node_modules',
  '.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker', '.netrc', '.npmrc', '.pypirc',
  '.git-credentials', '.gitconfig', '.envrc', '.vault-token', '.s3cfg', '.pgpass', '.authinfo',
  'id_rsa', 'id_ecdsa', 'id_ed25519', 'id_dsa',
]);
const credentialConfig = new Set(['gh', 'gcloud', 'aws', 'azure']);

export function isWorkPath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || /[\\:\u0000-\u001f\u007f]/.test(value)) return false;
  const parts = value.split('/');
  return parts.every((part, index) => {
    const name = part.toLowerCase();
    return part && part !== '.' && part !== '..' && !/[. ]$/.test(part) &&
      !protectedComponents.has(name) && !/^\.env(?:\.|$)/.test(name) &&
      !/^\.(?:secrets?|credentials?)(?:\.|$)/.test(name) &&
      !/^(?:con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/.test(name) &&
      !(parts[index - 1]?.toLowerCase() === '.config' && credentialConfig.has(name));
  });
}

export function authorizedWorkPath(value, paths) {
  return isWorkPath(value) && Array.isArray(paths) &&
    paths.some((prefix) => isWorkPath(prefix) && (value === prefix || value.startsWith(`${prefix}/`)));
}

export function normalizeWork(input) {
  const { id, title, requirements, dependsOn = [], paths, validation } = input;
  identifier(id);
  if (typeof title !== 'string' || !title.trim() || title.length > 200 ||
      typeof requirements !== 'string' || !requirements.trim() || requirements.length > 100000) {
    throw new Error('work needs a title and complete bounded requirements');
  }
  if (!Array.isArray(dependsOn) || new Set(dependsOn).size !== dependsOn.length) throw new Error('invalid dependencies');
  dependsOn.forEach(identifier);
  if (dependsOn.includes(id)) throw new Error('self dependency');
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => !isWorkPath(p))) {
    throw new Error('paths must be canonical repository-relative prefixes outside protected metadata, state and credential locations');
  }
  if (!Array.isArray(validation) || !validation.length || validation.some((argv) =>
    !Array.isArray(argv) || !argv.length || argv.some((s) => typeof s !== 'string' || !s || s.includes('\0')))) {
    throw new Error('validation must contain operator-authorized argv arrays');
  }
  return { id, title, requirements, dependsOn, paths, validation };
}

export function admit(state, packet) {
  const work = normalizeWork(packet);
  const old = state.issues.find((i) => i.work.id === work.id);
  if (old) {
    if (digest(old.work) !== digest(work)) throw new Error(`work ${work.id} already exists with different requirements`);
    return old;
  }
  const issue = { work, epoch: 0, phase: 'queued', candidate: null, votes: [], findings: [],
    attempts: 0, pr: null, observation: null, maintenance: false, deliveryPending: true };
  state.issues.push(issue);
  const visit = (id, chain = []) => {
    if (chain.includes(id)) throw new Error('dependency cycle');
    const node = state.issues.find((i) => i.work.id === id);
    node?.work.dependsOn.forEach((dep) => visit(dep, [...chain, id]));
  };
  try { visit(work.id); } catch (error) { state.issues.pop(); throw error; }
  return issue;
}

export function reviewedBasis(issue) {
  return digest({ requirements: issue.work, epoch: issue.epoch, candidate: issue.candidate });
}

export function setCandidate(issue, candidate, context) {
  if (issue.reconciliation?.required) throw new Error('candidate cannot bypass required operator reconciliation');
  if (!candidate || !/^[0-9a-f]{40,64}$/.test(candidate.commit) || !candidate.validation?.length ||
    candidate.validation.some((v) => v.exitCode !== 0 || !v.observedAt || !v.digest)) {
    throw new Error('candidate needs a real commit and successful validation evidence');
  }
  issue.epoch++;
  issue.candidate = candidate;
  issue.deliveryPending = true;
  issue.authorContext = context;
  issue.votes = [];
  issue.findings = [];
  issue.error = null; issue.blockerEvidence = null;
  issue.phase = 'review';
}

export function recordReview(issue, assignment, result) {
  if (assignment.basis !== reviewedBasis(issue) || assignment.context === issue.authorContext ||
      result?.basis !== assignment.basis || !['signoff', 'correction', 'blocked'].includes(result?.verdict) ||
      typeof result.evidence !== 'string' || !result.evidence.trim() ||
      !Array.isArray(result.findings) || result.findings.some((f) => typeof f !== 'string' || !f.trim())) {
    throw new Error('review is incomplete, ineligible, or stale');
  }
  if (result.verdict !== 'blocked' && (!Array.isArray(assignment.filesRead) || !assignment.filesRead.length ||
    assignment.filesRead.some((read) => !/^[0-9a-f]{64}$/.test(read.sha256 ?? '') ||
      !authorizedWorkPath(read.path, issue.work.paths)))) throw new Error('review needs current scoped file-read evidence');
  if (result.verdict === 'signoff' && result.findings.length) throw new Error('signoff has unresolved findings');
  if (issue.votes.some((v) => v.slot === assignment.slot || v.context === assignment.context)) {
    throw new Error('duplicate slot or context vote');
  }
  if (result.verdict !== 'signoff') {
    if (!result.findings.length) throw new Error('non-signoff needs actionable findings');
    issue.findings.push(...result.findings);
    issue.phase = result.verdict === 'blocked' ? 'blocked' : 'correction';
    if (result.verdict === 'blocked') {
      issue.error = `Review blocked: ${result.findings.join('; ')}`;
      issue.blockerEvidence = result.evidence;
    }
    issue.votes = [];
    return;
  }
  issue.votes.push({ slot: assignment.slot, context: assignment.context, basis: assignment.basis,
    evidence: result.evidence, doctrine: assignment.doctrine, filesRead: assignment.filesRead });
}

export function recordImplementationResult(issue, result) {
  if (!['implemented', 'blocked'].includes(result?.status) ||
    typeof result.evidence !== 'string' || !result.evidence.trim() || !Array.isArray(result.findings) ||
    result.findings.some((finding) => typeof finding !== 'string' || !finding.trim()) ||
    result.status === 'implemented' && result.findings.length ||
    result.status === 'blocked' && !result.findings.length) {
    issue.phase = 'blocked'; issue.error = 'Malformed implementation response: explicit status, evidence and consistent findings required';
    return false;
  }
  if (result.status === 'blocked') {
    issue.phase = 'blocked';
    issue.findings = [...result.findings];
    issue.blockerEvidence = result.evidence;
    issue.error = `Implementation blocked: ${result.findings.join('; ')}`;
    return false;
  }
  return true;
}

export function currentQuorum(issue, quorum) {
  return !!issue.candidate?.validation.length && issue.candidate.validation.every((v) => v.exitCode === 0) &&
    new Set(issue.votes.filter((v) => v.basis === reviewedBasis(issue) &&
      v.context !== issue.authorContext).map((v) => v.slot)).size >= quorum;
}

export function hasQuorum(issue, quorum) {
  return issue.phase === 'review' && currentQuorum(issue, quorum);
}

export function publicationIsCurrent(issue) {
  return !!issue.candidate && issue.publication?.commit === issue.candidate.commit &&
    issue.publication.basis === reviewedBasis(issue);
}

export function rememberDelivery(issue) {
  issue.delivery = { basis: reviewedBasis(issue), commit: issue.candidate.commit,
    workDigest: digest(issue.work), candidateDigest: digest(issue.candidate) };
  issue.deliveryPending = false;
}

export function publishedWorkUnchanged(issue) {
  return issue.deliveryPending === false && !issue.publication?.pending && !!issue.candidate && !!issue.delivery && !!issue.pr &&
    issue.delivery?.commit === issue.pr?.headRefOid && issue.candidate.commit === issue.pr?.headRefOid &&
    issue.delivery.workDigest === digest(issue.work) && issue.delivery.candidateDigest === digest(issue.candidate);
}

export function dependenciesReady(state, issue) {
  return issue.work.dependsOn.every((id) => state.issues.find((i) => i.work.id === id)?.phase === 'merged');
}

export function reviseRequirements(issue, requirements, expectedHash) {
  if (issue.reconciliation?.required || ['cancelled', 'merged', 'closed'].includes(issue.phase)) {
    throw new Error('requirements revision cannot bypass reconciliation or revive retired work');
  }
  if (expectedHash !== digest(issue.work.requirements)) throw new Error('requirements revision is stale');
  issue.work = normalizeWork({ ...issue.work, requirements });
  issue.epoch++; issue.votes = []; issue.phase = 'correction';
  issue.deliveryPending = true;
  issue.maintenance = false; issue.error = null; issue.blockerEvidence = null;
  issue.findings = ['Operator explicitly rebound the requirements/context; revalidate and obtain fresh affected-candidate reviews.'];
}
