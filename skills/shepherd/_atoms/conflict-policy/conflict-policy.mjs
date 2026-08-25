const DEFAULT_DENY_PREFIXES = ['doctrine/'];
const DEFAULT_PROTECTED_PATTERNS = [
  '.github/workflows/**',
  'skills/**/SKILL.md',
  'skills/**/*.test.mjs',
  'scripts/**/*.test.mjs',
];
const TRUSTED_POLICY_SOURCES = new Set(['caller-explicit', 'base-commit-snapshot']);
const STRUCTURED_OPERATIONS = new Set(['union-set', 'sort-unique-lines', 'json-key-union']);
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
  }
  return { valid: true, reason: 'trusted-policy' };
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

  const protectedPatterns = [...DEFAULT_PROTECTED_PATTERNS, ...(config.protectedPathPatterns ?? [])];
  if (matchesAny(normalized, protectedPatterns)) {
    return { kind: 'authored', path: normalized, reason: 'protected-validation-or-permission-path' };
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
    return { kind: 'structured', path: normalized, reason: 'configured-structured-rule', rule };
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
