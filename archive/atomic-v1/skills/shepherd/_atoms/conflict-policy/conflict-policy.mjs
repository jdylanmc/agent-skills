const DEFAULT_DENY_PREFIXES = ['doctrine/'];
const DEFAULT_PROTECTED_PATTERNS = [
  'skills/**/SKILL.md',
  'skills/**/*.test.mjs',
  'scripts/**/*.test.mjs',
];
const DEFAULT_VALIDATION_REGISTRATION_PATTERNS = ['.github/workflows/**'];
const TRUSTED_POLICY_SOURCES = new Set(['caller-explicit', 'base-commit-snapshot']);
const STRUCTURED_OPERATIONS = new Set([
  'union-set',
  'sort-unique-lines',
  'json-key-union',
  'preserve-additive-validation-registrations',
]);
const BROAD_PATTERNS = new Set(['*', '**', '**/*', '*.*']);

function normalizePath(input) {
  return String(input ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern);
  let source = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else if ('\\^$+?.()|{}[]'.includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  source += '$';
  return new RegExp(source);
}

function matchesAny(filePath, patterns = []) {
  const normalized = normalizePath(filePath);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

function broadPatterns(patterns = []) {
  return patterns.map(normalizePath).filter((pattern) => BROAD_PATTERNS.has(pattern));
}

export function validateConflictPolicy(config = {}) {
  const source = config.source?.kind;
  if (!TRUSTED_POLICY_SOURCES.has(source)) {
    return { valid: false, reason: 'untrusted-policy-source' };
  }
  const broadDerived = broadPatterns(config.derivedPathPatterns ?? []);
  if (broadDerived.length > 0) {
    return { valid: false, reason: 'overbroad-derived-pattern', patterns: broadDerived };
  }
  for (const rule of config.structuredMergeRules ?? []) {
    if (!STRUCTURED_OPERATIONS.has(rule.operation)) {
      return { valid: false, reason: 'unknown-structured-operation', operation: rule.operation };
    }
    const broadRulePatterns = broadPatterns(rule.paths ?? rule.patterns ?? []);
    if (broadRulePatterns.length > 0) {
      return { valid: false, reason: 'overbroad-structured-pattern', patterns: broadRulePatterns };
    }
    if (rule.operation === 'preserve-additive-validation-registrations'
      && rule.validationScope !== 'full-repository') {
      return { valid: false, reason: 'additive-validation-rule-requires-full-repository-validation' };
    }
  }
  return { valid: true, reason: 'trusted-policy' };
}

function splitLines(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').split('\n');
}

function additionsByBaseSlot(baseLines, candidateLines) {
  const slots = Array.from({ length: baseLines.length + 1 }, () => []);
  let baseIndex = 0;
  for (const line of candidateLines) {
    if (baseIndex < baseLines.length && line === baseLines[baseIndex]) {
      baseIndex += 1;
    } else {
      slots[baseIndex].push(line);
    }
  }
  if (baseIndex !== baseLines.length) {
    return null;
  }
  return slots;
}

function mergeAdditionSlot(ours, theirs) {
  if (new Set(ours).size !== ours.length || new Set(theirs).size !== theirs.length) {
    return { ok: false, reason: 'duplicate-registration-ambiguous' };
  }
  const nodes = [...new Set([...ours, ...theirs])];
  const edges = new Map(nodes.map((node) => [node, new Set()]));
  const indegree = new Map(nodes.map((node) => [node, 0]));
  for (const sequence of [ours, theirs]) {
    for (let index = 0; index < sequence.length - 1; index += 1) {
      const from = sequence[index];
      const to = sequence[index + 1];
      if (!edges.get(from).has(to)) {
        edges.get(from).add(to);
        indegree.set(to, indegree.get(to) + 1);
      }
    }
  }
  const rank = new Map(nodes.map((node, index) => [node, index]));
  const ready = nodes.filter((node) => indegree.get(node) === 0);
  const merged = [];
  while (ready.length > 0) {
    ready.sort((a, b) => rank.get(a) - rank.get(b));
    const node = ready.shift();
    merged.push(node);
    for (const next of edges.get(node)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  if (merged.length !== nodes.length) {
    return { ok: false, reason: 'incompatible-addition-order' };
  }
  if (ours.some((line) => theirs.includes(line))) {
    return { ok: false, reason: 'duplicate-registration-ambiguous' };
  }
  return { ok: true, lines: merged };
}

export function preserveAdditiveValidationRegistrations({ base, ours, theirs } = {}) {
  const baseLines = splitLines(base);
  const oursSlots = additionsByBaseSlot(baseLines, splitLines(ours));
  const theirsSlots = additionsByBaseSlot(baseLines, splitLines(theirs));
  if (oursSlots === null || theirsSlots === null) {
    return { ok: false, reason: 'trusted-base-line-removed-or-changed' };
  }

  const merged = [];
  for (let index = 0; index < baseLines.length + 1; index += 1) {
    const additions = mergeAdditionSlot(oursSlots[index], theirsSlots[index]);
    if (!additions.ok) {
      return additions;
    }
    merged.push(...additions.lines);
    if (index < baseLines.length) {
      merged.push(baseLines[index]);
    }
  }

  return {
    ok: true,
    operation: 'preserve-additive-validation-registrations',
    content: merged.join('\n'),
    preservedBaseLines: baseLines.length,
    additions: {
      ours: oursSlots.flat(),
      theirs: theirsSlots.flat(),
    },
    requiredValidationScope: 'full-repository',
  };
}

function commandsForPath(filePath, commands = []) {
  return commands.filter((command) => matchesAny(filePath, command.paths ?? command.patterns ?? []));
}

function structuredRulesForPath(filePath, rules = []) {
  return rules.filter((rule) => matchesAny(filePath, rule.paths ?? rule.patterns ?? []));
}

export function classifyConflictPath(filePath, config = {}) {
  const normalized = normalizePath(filePath);
  const policy = validateConflictPolicy(config);
  if (!policy.valid) {
    return { kind: 'ambiguous', path: normalized, reason: policy.reason, policy };
  }

  const denyPatterns = [...DEFAULT_DENY_PREFIXES.map((prefix) => `${prefix}**`), ...(config.authoredPathDenylist ?? [])];
  if (matchesAny(normalized, denyPatterns)) {
    return { kind: 'authored', path: normalized, reason: 'authored-denylist' };
  }

  const structured = structuredRulesForPath(normalized, config.structuredMergeRules ?? []);
  if (structured.length > 1) {
    return { kind: 'ambiguous', path: normalized, reason: 'multiple-structured-rules', rules: structured };
  }
  if (structured.length === 1) {
    const [rule] = structured;
    if (!rule.operation || !rule.validationCommand) {
      return { kind: 'ambiguous', path: normalized, reason: 'structured-rule-missing-validation', rule };
    }
    const protectedPatterns = [...DEFAULT_PROTECTED_PATTERNS, ...(config.protectedPathPatterns ?? [])];
    if (matchesAny(normalized, protectedPatterns)) {
      return { kind: 'authored', path: normalized, reason: 'protected-validation-or-permission-path' };
    }
    const validationPatterns = [
      ...DEFAULT_VALIDATION_REGISTRATION_PATTERNS,
      ...(config.validationRegistrationPathPatterns ?? []),
    ];
    if (matchesAny(normalized, validationPatterns)
      && (rule.operation !== 'preserve-additive-validation-registrations'
        || rule.validationScope !== 'full-repository')) {
      return { kind: 'authored', path: normalized, reason: 'validation-registration-rule-not-safe' };
    }
    return { kind: 'structured', path: normalized, reason: 'configured-structured-rule', rule };
  }

  const protectedPatterns = [...DEFAULT_PROTECTED_PATTERNS, ...(config.protectedPathPatterns ?? [])];
  if (matchesAny(normalized, protectedPatterns)) {
    return { kind: 'authored', path: normalized, reason: 'protected-validation-or-permission-path' };
  }

  const validationPatterns = [
    ...DEFAULT_VALIDATION_REGISTRATION_PATTERNS,
    ...(config.validationRegistrationPathPatterns ?? []),
  ];
  if (matchesAny(normalized, validationPatterns)) {
    return { kind: 'authored', path: normalized, reason: 'validation-registration-needs-additive-rule' };
  }

  if (matchesAny(normalized, config.derivedPathPatterns ?? [])) {
    const commands = commandsForPath(normalized, config.regenerationCommands ?? []);
    if (commands.length === 1) {
      return { kind: 'derived', path: normalized, reason: 'configured-derived-pattern', regenerationCommand: commands[0] };
    }
    return {
      kind: 'ambiguous',
      path: normalized,
      reason: commands.length === 0 ? 'derived-without-regeneration-command' : 'multiple-regeneration-commands',
      regenerationCommands: commands,
    };
  }

  return { kind: 'authored', path: normalized, reason: 'no-derived-policy-match' };
}

export function conflictResolutionAction(classification) {
  if (classification.kind === 'derived') {
    return 'regenerate';
  }
  if (classification.kind === 'structured') {
    return 'apply-configured-structured-rule';
  }
  return 'stop-needs-human';
}
